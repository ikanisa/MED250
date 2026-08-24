import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { parseDashboardCsv } from "./dashboard-recovery.mjs";

const root = resolve(import.meta.dirname, "..");
const workRoot = join(root, "work");
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const execFileAsync = promisify(execFile);

const SCHEMA_VERSION = "med250.cloudflare-catalogue-recovery.v1";
const FDA_PRODUCTS_PATH = "data/imports/rwanda-fda-products-july-2026.csv";
const SOURCE_MANIFEST_PATH = "data/imports/source-manifest.json";
const CONSUMER_PRODUCTS_PATH = "outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json";
const QUALITY_OVERRIDES_PATH = "data/imports/amazon-product-quality-overrides-2026-07-16.json";
const FDA_REGISTER = "rwanda_fda_human_medicines_2026_07";
const CONSUMER_REGISTER = "amazon_us_catalogue_research_2026_07_15";
const EXPECTED_FDA_COUNT = 2_480;
const EXPECTED_FDA_ORDERABLE = 2_459;
const EXPECTED_CONSUMER_COUNT = 2_200;
const EXPECTED_CONSUMER_EXCLUDED = 2;
const EXPECTED_TAXONOMY_PAIRS = 25;
const SHA256 = /^[a-f0-9]{64}$/;
const PRODUCT_ID = /^(?:rwanda-fda-hm-[0-9]{4}|AMZ-[A-Z0-9]{10})$/;
const TARGETS = Object.freeze({
  staging: { database_name: "med250-staging" },
  production: { database_name: "med250-production" },
});

const PRODUCT_COLUMNS = Object.freeze([
  "id", "source_kind", "source_register", "source_serial", "source_name", "source_url",
  "source_refreshed_at", "registration_number", "brand_name", "generic_name", "strength",
  "dosage_form", "pack_size", "product_type", "category", "department", "subcategory",
  "prescription_status", "regulatory_status", "manufacturer", "manufacturer_country",
  "expiry_date", "indicative_price_rwf", "indicative_price_basis",
  "indicative_price_source_url", "indicative_price_updated_at", "publication_status",
  "compliance_status", "compliance_evidence_url", "reviewed_by_label",
  "publication_review_note", "publication_reviewed_at", "publication_approved_at",
  "is_orderable", "is_active", "created_at", "updated_at",
]);

const UPDATE_COLUMNS = PRODUCT_COLUMNS.filter((column) => ![
  "id", "created_at", "reviewed_by_label", "publication_review_note",
  "publication_reviewed_at", "publication_approved_at",
].includes(column));

export class CatalogueRecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CatalogueRecoveryError";
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableJson(value, space = 0) {
  return JSON.stringify(canonicalize(value), null, space);
}

function canonicalHash(value) {
  return sha256(Buffer.from(stableJson(value), "utf8"));
}

function repositoryPath(value, label) {
  const path = resolve(root, value);
  if (!path.startsWith(`${root}${sep}`)) throw new CatalogueRecoveryError("unsafe_path", `${label} escapes the repository.`);
  return path;
}

function approvedWorkPath(value, label) {
  const path = resolve(value);
  if (path !== workRoot && !path.startsWith(`${workRoot}${sep}`)) {
    throw new CatalogueRecoveryError("unsafe_path", `${label} must be inside the repository work directory.`);
  }
  return path;
}

function exactTarget(value) {
  const target = String(value ?? "").trim().toLowerCase();
  if (!(target in TARGETS)) throw new CatalogueRecoveryError("invalid_target", "Target must be staging or production.");
  return target;
}

function exactIso(value, label) {
  const source = String(value ?? "").trim();
  if (!source || !Number.isFinite(Date.parse(source))) {
    throw new CatalogueRecoveryError("invalid_timestamp", `${label} must be an ISO-8601 timestamp.`);
  }
  return new Date(source).toISOString();
}

function text(value, maximum = 2_000) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length > maximum) throw new CatalogueRecoveryError("invalid_source", `Source text exceeds ${maximum} characters.`);
  return normalized || null;
}

function requiredText(value, label, maximum = 2_000) {
  const normalized = text(value, maximum);
  if (!normalized) throw new CatalogueRecoveryError("invalid_source", `${label} is required.`);
  return normalized;
}

function httpsUrl(value, label, { required = false } = {}) {
  const normalized = text(value, 2_000);
  if (!normalized) {
    if (required) throw new CatalogueRecoveryError("invalid_source", `${label} is required.`);
    return null;
  }
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new CatalogueRecoveryError("invalid_source", `${label} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") throw new CatalogueRecoveryError("invalid_source", `${label} must use HTTPS.`);
  return parsed.toString();
}

function catalogueTitle(value) {
  const source = text(value, 2_000);
  if (!source) return null;
  return source
    .replace(/\bamazon(?:\.com|as)?\b/giu, " ")
    .replace(/\s+([,;:.])/gu, "$1")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function requiredCatalogueTitle(value, label = "Product name") {
  const normalized = catalogueTitle(value);
  if (!normalized) throw new CatalogueRecoveryError("invalid_source", `${label} is empty after catalogue sanitization.`);
  if (normalized.length > 500) throw new CatalogueRecoveryError("invalid_source", `${label} exceeds 500 characters.`);
  return normalized;
}

function integer(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, nullable = false } = {}) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CatalogueRecoveryError("invalid_source", `${label} is not a valid integer.`);
  }
  return parsed;
}

function sourceTimestamp(value, fallback) {
  return exactIso(value || fallback, "Source timestamp");
}

async function inputFile(path) {
  const absolute = repositoryPath(path, "Source input");
  const metadata = await stat(absolute);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > 32 * 1024 * 1024) {
    throw new CatalogueRecoveryError("invalid_source", `${path} is not a bounded source file.`);
  }
  const bytes = await readFile(absolute);
  return { path, absolute, bytes, byte_count: bytes.length, sha256: sha256(bytes) };
}

function validateFdaRows(source, capturedAt) {
  const parsed = parseDashboardCsv(source.toString("utf8"));
  if (parsed.rows.length !== EXPECTED_FDA_COUNT) {
    throw new CatalogueRecoveryError("source_count_mismatch", `Expected ${EXPECTED_FDA_COUNT} FDA products; found ${parsed.rows.length}.`);
  }
  const expectedStatus = new Map([["valid", 2_430], ["expiring_soon", 29], ["grace_period", 21]]);
  const observedStatus = new Map();
  const serials = new Set();
  const rows = parsed.rows.map(({ payload }, index) => {
    const serial = integer(payload.source_serial, `FDA row ${index + 2} source_serial`, { minimum: 1, maximum: EXPECTED_FDA_COUNT });
    if (serials.has(serial)) throw new CatalogueRecoveryError("duplicate_source", `FDA source serial ${serial} is duplicated.`);
    serials.add(serial);
    const regulatoryStatus = requiredText(payload.regulatory_status, `FDA row ${index + 2} regulatory_status`, 40);
    if (!expectedStatus.has(regulatoryStatus)) throw new CatalogueRecoveryError("invalid_source", `FDA row ${index + 2} has unsupported status ${regulatoryStatus}.`);
    observedStatus.set(regulatoryStatus, (observedStatus.get(regulatoryStatus) ?? 0) + 1);
    const id = `rwanda-fda-hm-${String(serial).padStart(4, "0")}`;
    let brandName = null;
    for (const candidate of [payload.brand_name, payload.generic_name, payload.registration_number]) {
      const normalized = catalogueTitle(candidate);
      if (normalized && normalized.length <= 500) {
        brandName = normalized;
        break;
      }
    }
    if (!brandName) throw new CatalogueRecoveryError("invalid_source", `${id} has no usable catalogue title.`);
    const orderable = regulatoryStatus === "valid" || regulatoryStatus === "expiring_soon";
    return {
      id,
      source_kind: "rwanda_fda",
      source_register: FDA_REGISTER,
      source_serial: serial,
      source_name: requiredText(payload.source_name, `${id} source_name`, 500),
      source_url: httpsUrl(payload.source_url, `${id} source_url`, { required: true }),
      source_refreshed_at: capturedAt,
      registration_number: requiredText(payload.registration_number, `${id} registration_number`, 500),
      brand_name: brandName,
      generic_name: text(payload.generic_name),
      strength: text(payload.strength),
      dosage_form: text(payload.dosage_form),
      pack_size: text(payload.pack_size),
      product_type: "human_medicine",
      category: "Medicines",
      department: "Medicines",
      subcategory: null,
      prescription_status: "unclassified",
      regulatory_status: regulatoryStatus,
      manufacturer: text(payload.manufacturer),
      manufacturer_country: text(payload.manufacturer_country, 250),
      expiry_date: requiredText(payload.expiry_date, `${id} expiry_date`, 20),
      indicative_price_rwf: null,
      indicative_price_basis: null,
      indicative_price_source_url: null,
      indicative_price_updated_at: null,
      publication_status: "approved",
      compliance_status: "governed_source_import",
      compliance_evidence_url: httpsUrl(payload.source_url, `${id} compliance source`, { required: true }),
      reviewed_by_label: "Rwanda FDA source-register import",
      publication_review_note: "Official register row retained; pharmacy confirmation remains required before fulfilment.",
      publication_reviewed_at: capturedAt,
      publication_approved_at: capturedAt,
      is_orderable: orderable ? 1 : 0,
      is_active: 1,
      created_at: capturedAt,
      updated_at: capturedAt,
    };
  });
  for (let serial = 1; serial <= EXPECTED_FDA_COUNT; serial += 1) {
    if (!serials.has(serial)) throw new CatalogueRecoveryError("source_count_mismatch", `FDA source serial ${serial} is missing.`);
  }
  for (const [status, count] of expectedStatus) {
    if (observedStatus.get(status) !== count) throw new CatalogueRecoveryError("source_count_mismatch", `FDA ${status} count changed.`);
  }
  if (rows.filter((row) => row.is_orderable === 1).length !== EXPECTED_FDA_ORDERABLE) {
    throw new CatalogueRecoveryError("source_count_mismatch", "FDA orderable count changed.");
  }
  return rows;
}

function validateConsumerRows(dataset, overrides) {
  if (!Array.isArray(dataset?.consumer_products) || dataset.consumer_products.length !== EXPECTED_CONSUMER_COUNT) {
    throw new CatalogueRecoveryError("source_count_mismatch", `Expected ${EXPECTED_CONSUMER_COUNT} consumer products.`);
  }
  const excludedAsins = new Map(Object.entries(overrides?.excluded_asins ?? {}));
  const ids = new Set();
  const asins = new Set();
  const names = new Set();
  const taxonomy = new Set();
  let excludedCount = 0;
  const rows = dataset.consumer_products.map((product, index) => {
    const asin = requiredText(product.asin, `Consumer row ${index + 1} ASIN`, 10);
    const id = requiredText(product.id, `Consumer row ${index + 1} id`, 80);
    if (!/^[A-Z0-9]{10}$/.test(asin) || id !== `AMZ-${asin}` || product.source_product_id !== asin) {
      throw new CatalogueRecoveryError("invalid_source", `Consumer row ${index + 1} has inconsistent identifiers.`);
    }
    if (ids.has(id) || asins.has(asin)) throw new CatalogueRecoveryError("duplicate_source", `${id} is duplicated.`);
    ids.add(id);
    asins.add(asin);
    const productName = requiredCatalogueTitle(product.product_name, `${id} product name`);
    const normalizedName = productName.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    if (names.has(normalizedName)) throw new CatalogueRecoveryError("duplicate_source", `${id} repeats a catalogue title.`);
    names.add(normalizedName);
    if (product.amazon_price_usd_observed !== null && product.amazon_price_usd_observed !== undefined) {
      throw new CatalogueRecoveryError("invalid_source", `${id} retains a prohibited Amazon price.`);
    }
    const excludedReason = excludedAsins.get(asin);
    const excluded = typeof excludedReason === "string";
    if (excluded) excludedCount += 1;
    if (!excluded && (!product.is_active || !product.is_orderable || product.publication_status !== "approved")) {
      throw new CatalogueRecoveryError("invalid_source", `${id} is not an approved source-catalogue row.`);
    }
    const category = requiredText(product.category, `${id} category`, 200);
    const subcategory = requiredText(product.subcategory, `${id} subcategory`, 200);
    if (!excluded) taxonomy.add(`${category}\u0000${subcategory}`);
    const capturedAt = sourceTimestamp(product.source_refreshed_at, dataset.generated_at);
    const indicativePrice = product.indicative_price_rwf === null || product.indicative_price_rwf === undefined
      ? null
      : integer(product.indicative_price_rwf, `${id} indicative price`, { minimum: 1, maximum: 100_000_000 });
    const priceUrl = indicativePrice === null ? null : httpsUrl(product.indicative_price_source_url, `${id} indicative price source`, { required: true });
    return {
      id,
      source_kind: "governed_consumer_catalogue",
      source_register: requiredText(product.source_register, `${id} source_register`, 500),
      source_serial: null,
      source_name: requiredText(product.source_name, `${id} source_name`, 500),
      source_url: httpsUrl(product.source_url, `${id} source_url`, { required: true }),
      source_refreshed_at: capturedAt,
      registration_number: null,
      brand_name: productName,
      generic_name: text(product.generic_name) ?? subcategory,
      strength: text(product.strength),
      dosage_form: text(product.dosage_form) ?? text(product.product_type),
      pack_size: text(product.pack_size),
      product_type: requiredText(product.product_type, `${id} product_type`, 200),
      category,
      department: category,
      subcategory,
      prescription_status: "non_prescription",
      regulatory_status: "unclassified",
      manufacturer: text(product.manufacturer),
      manufacturer_country: text(product.manufacturer_country, 250),
      expiry_date: text(product.expiry_date, 20),
      indicative_price_rwf: indicativePrice,
      indicative_price_basis: indicativePrice === null ? null : requiredText(product.indicative_price_basis, `${id} indicative price basis`, 500),
      indicative_price_source_url: priceUrl,
      indicative_price_updated_at: indicativePrice === null ? null : sourceTimestamp(product.indicative_price_updated_at, capturedAt),
      publication_status: excluded ? "rejected" : "approved",
      compliance_status: excluded ? "governed_source_exclusion" : "central_catalogue_pharmacy_fulfilment",
      compliance_evidence_url: httpsUrl(product.rwanda_product_url, `${id} compliance evidence`),
      reviewed_by_label: "MED+250 catalogue quality audit",
      publication_review_note: excluded
        ? requiredText(excludedReason, `${id} exclusion reason`, 1_000)
        : "Canonical title, taxonomy relevance and central pharmacy-fulfilment boundary were validated.",
      publication_reviewed_at: capturedAt,
      publication_approved_at: excluded ? null : capturedAt,
      is_orderable: excluded ? 0 : 1,
      is_active: excluded ? 0 : 1,
      created_at: capturedAt,
      updated_at: capturedAt,
    };
  });
  if (excludedCount !== EXPECTED_CONSUMER_EXCLUDED) {
    throw new CatalogueRecoveryError("source_count_mismatch", `Expected ${EXPECTED_CONSUMER_EXCLUDED} governed consumer exclusions; found ${excludedCount}.`);
  }
  if (taxonomy.size !== EXPECTED_TAXONOMY_PAIRS) {
    throw new CatalogueRecoveryError("source_count_mismatch", `Expected ${EXPECTED_TAXONOMY_PAIRS} active taxonomy pairs; found ${taxonomy.size}.`);
  }
  return rows;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CatalogueRecoveryError("invalid_source", "SQL numeric value is invalid.");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertBatches(rows, batchSize = 25) {
  const statements = [];
  const updates = UPDATE_COLUMNS.map((column) => `${column}=excluded.${column}`).join(", ");
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const values = batch.map((row) => `(${PRODUCT_COLUMNS.map((column) => sqlLiteral(row[column])).join(", ")})`).join(",\n");
    statements.push(`INSERT INTO med250_catalogue_products (${PRODUCT_COLUMNS.join(", ")}) VALUES\n${values}\nON CONFLICT(id) DO UPDATE SET ${updates}\nWHERE med250_catalogue_products.source_kind IN ('rwanda_fda', 'governed_consumer_catalogue', 'local_governed_snapshot');`);
  }
  return statements;
}

function importSql(bundle, rows) {
  const sourceManifest = {
    schema_version: SCHEMA_VERSION,
    source_snapshot_sha256: bundle.source_snapshot_sha256,
    row_set_sha256: bundle.row_set_sha256,
    input_files: bundle.input_files,
    counts: bundle.counts,
    target: bundle.target,
  };
  // D1 remote imports reject SQL BEGIN/COMMIT. Every product upsert is
  // idempotent and the immutable receipt is deliberately written last, only
  // when aggregate source counts prove the whole upload is present. A stopped
  // import therefore has no completion receipt and can be safely resumed.
  const statements = ["PRAGMA foreign_keys = ON;"];
  statements.push(...insertBatches(rows));
  statements.push(`INSERT OR IGNORE INTO med250_catalogue_import_receipts (id, source_snapshot_sha256, source_manifest, source_row_count, inserted_count, updated_count, target, imported_at)
SELECT ${sqlLiteral(bundle.receipt_id)}, ${sqlLiteral(bundle.source_snapshot_sha256)}, ${sqlLiteral(stableJson(sourceManifest))}, ${bundle.counts.source_rows}, ${bundle.counts.source_rows}, 0, ${sqlLiteral(bundle.target)}, ${sqlLiteral(bundle.imported_at)}
WHERE (SELECT count(*) FROM med250_catalogue_products WHERE source_kind = 'rwanda_fda' AND source_register = ${sqlLiteral(FDA_REGISTER)}) = ${bundle.counts.fda_rows}
  AND (SELECT count(*) FROM med250_catalogue_products WHERE source_kind = 'governed_consumer_catalogue' AND source_register = ${sqlLiteral(CONSUMER_REGISTER)}) = ${bundle.counts.consumer_rows}
  AND (SELECT count(*) FROM med250_catalogue_products WHERE source_kind IN ('rwanda_fda', 'governed_consumer_catalogue') AND publication_status = 'approved' AND is_active = 1 AND is_orderable = 1) = ${bundle.counts.public_orderable_rows}
  AND (SELECT count(*) FROM med250_catalogue_products WHERE source_kind = 'governed_consumer_catalogue' AND publication_status = 'rejected' AND is_active = 0 AND is_orderable = 0) = ${bundle.counts.consumer_excluded_rows};`);
  return `${statements.join("\n")}\n`;
}

function bundleCore(bundle) {
  const { bundle_sha256: _bundle, ...core } = bundle;
  return core;
}

export async function buildCatalogueRecoveryBundle({ target, importedAt } = {}) {
  const normalizedTarget = exactTarget(target);
  const normalizedImportedAt = exactIso(importedAt, "imported-at");
  const inputs = await Promise.all([
    inputFile(FDA_PRODUCTS_PATH),
    inputFile(SOURCE_MANIFEST_PATH),
    inputFile(CONSUMER_PRODUCTS_PATH),
    inputFile(QUALITY_OVERRIDES_PATH),
  ]);
  const byPath = new Map(inputs.map((input) => [input.path, input]));
  let sourceManifest;
  let consumerDataset;
  let qualityOverrides;
  try {
    sourceManifest = JSON.parse(byPath.get(SOURCE_MANIFEST_PATH).bytes.toString("utf8"));
    consumerDataset = JSON.parse(byPath.get(CONSUMER_PRODUCTS_PATH).bytes.toString("utf8"));
    qualityOverrides = JSON.parse(byPath.get(QUALITY_OVERRIDES_PATH).bytes.toString("utf8"));
  } catch {
    throw new CatalogueRecoveryError("invalid_source", "A catalogue source JSON file is malformed.");
  }
  const fdaCapturedAt = exactIso(sourceManifest.generated_at, "FDA source manifest generated_at");
  const fdaRows = validateFdaRows(byPath.get(FDA_PRODUCTS_PATH).bytes, fdaCapturedAt);
  const consumerRows = validateConsumerRows(consumerDataset, qualityOverrides);
  const rows = [...fdaRows, ...consumerRows].sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set();
  for (const row of rows) {
    if (!PRODUCT_ID.test(row.id) || ids.has(row.id)) throw new CatalogueRecoveryError("duplicate_source", `Catalogue product ${row.id} is invalid or duplicated.`);
    ids.add(row.id);
  }
  const inputFiles = inputs.map(({ path, byte_count, sha256: digest }) => ({ path, byte_count, sha256: digest }));
  const counts = {
    source_rows: rows.length,
    fda_rows: fdaRows.length,
    fda_orderable_rows: fdaRows.filter((row) => row.is_orderable === 1).length,
    consumer_rows: consumerRows.length,
    consumer_orderable_rows: consumerRows.filter((row) => row.is_orderable === 1).length,
    consumer_excluded_rows: consumerRows.filter((row) => row.publication_status === "rejected").length,
    public_orderable_rows: rows.filter((row) => row.publication_status === "approved" && row.is_active === 1 && row.is_orderable === 1).length,
    taxonomy_pairs: new Set(consumerRows.filter((row) => row.is_orderable === 1).map((row) => `${row.department}\u0000${row.subcategory}`)).size,
  };
  const sourceSnapshot = canonicalHash({ schema_version: SCHEMA_VERSION, input_files: inputFiles, row_set_sha256: canonicalHash(rows), counts });
  const initial = {
    schema_version: SCHEMA_VERSION,
    target: normalizedTarget,
    database_name: TARGETS[normalizedTarget].database_name,
    imported_at: normalizedImportedAt,
    source_snapshot_sha256: sourceSnapshot,
    row_set_sha256: canonicalHash(rows),
    receipt_id: `catalogue-${sourceSnapshot.slice(0, 24)}-${normalizedTarget}`,
    input_files: inputFiles,
    counts,
  };
  const provisionalSql = importSql(initial, rows);
  const withSql = { ...initial, sql_sha256: sha256(provisionalSql) };
  const sql = importSql(withSql, rows);
  if (sha256(sql) !== withSql.sql_sha256) throw new CatalogueRecoveryError("non_deterministic_sql", "Catalogue recovery SQL is not deterministic.");
  const bundle = { ...withSql, bundle_sha256: canonicalHash(withSql) };
  return { bundle, sql, rows };
}

async function verifyInputs(bundle) {
  if (!Array.isArray(bundle.input_files) || bundle.input_files.length !== 4) {
    throw new CatalogueRecoveryError("invalid_bundle", "Catalogue bundle input inventory is invalid.");
  }
  for (const expected of bundle.input_files) {
    const actual = await inputFile(expected.path);
    if (actual.byte_count !== expected.byte_count || actual.sha256 !== expected.sha256) {
      throw new CatalogueRecoveryError("source_checksum_mismatch", `${expected.path} changed after bundle creation.`);
    }
  }
}

export async function verifyCatalogueRecoveryBundle(bundle, sql) {
  if (!bundle || typeof bundle !== "object" || bundle.schema_version !== SCHEMA_VERSION) {
    throw new CatalogueRecoveryError("invalid_bundle", "Catalogue recovery bundle schema is unsupported.");
  }
  const target = exactTarget(bundle.target);
  if (bundle.database_name !== TARGETS[target].database_name) {
    throw new CatalogueRecoveryError("environment_mismatch", "Catalogue bundle database does not match its target.");
  }
  if (!SHA256.test(String(bundle.bundle_sha256 ?? "")) || canonicalHash(bundleCore(bundle)) !== bundle.bundle_sha256) {
    throw new CatalogueRecoveryError("bundle_checksum_mismatch", "Catalogue bundle checksum does not match its content.");
  }
  if (!SHA256.test(String(bundle.sql_sha256 ?? "")) || sha256(sql) !== bundle.sql_sha256) {
    throw new CatalogueRecoveryError("sql_checksum_mismatch", "Catalogue import SQL checksum does not match the bundle.");
  }
  if (!SHA256.test(String(bundle.source_snapshot_sha256 ?? "")) || !SHA256.test(String(bundle.row_set_sha256 ?? ""))) {
    throw new CatalogueRecoveryError("invalid_bundle", "Catalogue bundle source checksums are invalid.");
  }
  const expectedCounts = {
    source_rows: 4_680,
    fda_rows: 2_480,
    fda_orderable_rows: 2_459,
    consumer_rows: 2_200,
    consumer_orderable_rows: 2_198,
    consumer_excluded_rows: 2,
    public_orderable_rows: 4_657,
    taxonomy_pairs: 25,
  };
  if (stableJson(bundle.counts) !== stableJson(expectedCounts)) {
    throw new CatalogueRecoveryError("source_count_mismatch", "Catalogue bundle counts do not match the governed source pack.");
  }
  await verifyInputs(bundle);
  return bundle;
}

export async function writeCatalogueRecoveryBundle(output, bundle, sql) {
  const directory = approvedWorkPath(output, "--output");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "bundle.json"), `${stableJson(bundle, 2)}\n`, { mode: 0o600 });
  await writeFile(join(directory, "import.sql"), sql, { mode: 0o600 });
  return directory;
}

export async function readCatalogueRecoveryBundle(directory) {
  const bundleDirectory = approvedWorkPath(directory, "--bundle");
  let bundle;
  let sql;
  try {
    [bundle, sql] = await Promise.all([
      readFile(join(bundleDirectory, "bundle.json"), "utf8").then(JSON.parse),
      readFile(join(bundleDirectory, "import.sql"), "utf8"),
    ]);
  } catch {
    throw new CatalogueRecoveryError("invalid_bundle", "Catalogue bundle.json or import.sql is missing or malformed.");
  }
  await verifyCatalogueRecoveryBundle(bundle, sql);
  return { bundle, sql, directory: bundleDirectory };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new CatalogueRecoveryError("missing_argument", `${name} requires a value.`);
  return value;
}

async function wranglerCommand(args, maxBuffer = 8 * 1024 * 1024) {
  try {
    return await execFileAsync(wrangler, args, { cwd: root, maxBuffer });
  } catch (error) {
    const message = String(error?.stderr || error?.stdout || error?.message || "Wrangler command failed.").trim();
    throw new CatalogueRecoveryError("cloudflare_command_failed", message.slice(0, 4_000));
  }
}

function readbackSql(bundle) {
  return `SELECT
    receipt.id, receipt.source_snapshot_sha256, receipt.source_row_count,
    receipt.inserted_count, receipt.updated_count,
    (SELECT count(*) FROM med250_catalogue_products WHERE source_kind = 'rwanda_fda' AND source_register = '${FDA_REGISTER}') AS fda_rows,
    (SELECT count(*) FROM med250_catalogue_products WHERE source_kind = 'governed_consumer_catalogue' AND source_register = '${CONSUMER_REGISTER}') AS consumer_rows,
    (SELECT count(*) FROM med250_catalogue_products WHERE source_kind IN ('rwanda_fda', 'governed_consumer_catalogue') AND publication_status = 'approved' AND is_active = 1 AND is_orderable = 1) AS public_orderable_rows,
    (SELECT count(*) FROM med250_catalogue_products WHERE source_kind = 'governed_consumer_catalogue' AND publication_status = 'rejected' AND is_active = 0 AND is_orderable = 0) AS consumer_excluded_rows
  FROM med250_catalogue_import_receipts receipt WHERE receipt.id = '${bundle.receipt_id}';`;
}

async function remoteReadback(bundle) {
  const { stdout } = await wranglerCommand([
    "d1", "execute", bundle.database_name, "--remote", "--config", "wrangler.jsonc",
    "--command", readbackSql(bundle), "--json",
  ]);
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new CatalogueRecoveryError("d1_readback_mismatch", "D1 catalogue readback was not valid JSON.");
  }
  const row = payload?.[0]?.results?.[0];
  if (
    payload?.[0]?.success !== true
    || row?.id !== bundle.receipt_id
    || row?.source_snapshot_sha256 !== bundle.source_snapshot_sha256
    || Number(row?.source_row_count) !== bundle.counts.source_rows
    || Number(row?.fda_rows) !== bundle.counts.fda_rows
    || Number(row?.consumer_rows) !== bundle.counts.consumer_rows
    || Number(row?.public_orderable_rows) !== bundle.counts.public_orderable_rows
    || Number(row?.consumer_excluded_rows) !== bundle.counts.consumer_excluded_rows
  ) throw new CatalogueRecoveryError("d1_readback_mismatch", "D1 catalogue recovery receipt does not match the bundle.");
  return row;
}

function preflightSql(bundle) {
  return `SELECT
    (SELECT count(*) FROM med250_catalogue_import_receipts WHERE id = '${bundle.receipt_id}') AS receipt_count,
    (SELECT count(*) FROM med250_catalogue_products WHERE source_kind = 'rwanda_fda' AND source_register = '${FDA_REGISTER}') AS fda_rows,
    (SELECT count(*) FROM med250_catalogue_products WHERE source_kind = 'governed_consumer_catalogue' AND source_register = '${CONSUMER_REGISTER}') AS consumer_rows,
    (SELECT count(*) FROM med250_catalogue_products
      WHERE (id GLOB 'rwanda-fda-hm-[0-9][0-9][0-9][0-9]' OR id GLOB 'AMZ-[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]')
        AND NOT (
          (source_kind = 'rwanda_fda' AND source_register = '${FDA_REGISTER}')
          OR (source_kind = 'governed_consumer_catalogue' AND source_register = '${CONSUMER_REGISTER}')
        )) AS conflicting_rows;`;
}

async function remotePreflight(bundle) {
  const { stdout } = await wranglerCommand([
    "d1", "execute", bundle.database_name, "--remote", "--config", "wrangler.jsonc",
    "--command", preflightSql(bundle), "--json",
  ]);
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new CatalogueRecoveryError("d1_preflight_failed", "D1 catalogue preflight was not valid JSON.");
  }
  const row = payload?.[0]?.results?.[0];
  if (payload?.[0]?.success !== true || !row) throw new CatalogueRecoveryError("d1_preflight_failed", "D1 catalogue preflight failed.");
  const receiptCount = Number(row.receipt_count);
  const fdaRows = Number(row.fda_rows);
  const consumerRows = Number(row.consumer_rows);
  const conflictingRows = Number(row.conflicting_rows);
  if (![receiptCount, fdaRows, consumerRows, conflictingRows].every(Number.isSafeInteger)) {
    throw new CatalogueRecoveryError("d1_preflight_failed", "D1 catalogue preflight returned invalid counts.");
  }
  if (receiptCount > 1 || fdaRows > bundle.counts.fda_rows || consumerRows > bundle.counts.consumer_rows || conflictingRows !== 0) {
    throw new CatalogueRecoveryError("d1_preflight_conflict", "D1 contains catalogue rows that conflict with the governed source bundle.");
  }
  return { receipt_count: receiptCount, fda_rows: fdaRows, consumer_rows: consumerRows, conflicting_rows: conflictingRows };
}

async function runCli() {
  const command = process.argv[2];
  if (command === "build") {
    const target = exactTarget(argument("--target"));
    const importedAt = argument("--imported-at");
    const output = argument("--output");
    const built = await buildCatalogueRecoveryBundle({ target, importedAt });
    const directory = await writeCatalogueRecoveryBundle(output, built.bundle, built.sql);
    console.log(JSON.stringify({
      event: "cloudflare_catalogue_recovery_bundle_built",
      target,
      directory: relative(root, directory),
      bundle_sha256: built.bundle.bundle_sha256,
      source_snapshot_sha256: built.bundle.source_snapshot_sha256,
      counts: built.bundle.counts,
    }, null, 2));
    return;
  }
  if (command !== "apply" && command !== "verify") {
    throw new CatalogueRecoveryError("invalid_command", "Command must be build, apply, or verify.");
  }
  const loaded = await readCatalogueRecoveryBundle(argument("--bundle"));
  const confirmation = `MED250 CLOUDFLARE CATALOGUE ${loaded.bundle.target.toUpperCase()}`;
  if (command === "apply") {
    if (argument("--confirm") !== confirmation) {
      throw new CatalogueRecoveryError("confirmation_required", `Apply requires --confirm '${confirmation}'.`);
    }
    const preflight = await remotePreflight(loaded.bundle);
    if (preflight.receipt_count === 0) {
      await wranglerCommand([
        "d1", "execute", loaded.bundle.database_name, "--remote", "--config", "wrangler.jsonc",
        "--file", join(loaded.directory, "import.sql"), "--yes",
      ], 32 * 1024 * 1024);
    }
  }
  const receipt = await remoteReadback(loaded.bundle);
  console.log(JSON.stringify({
    event: command === "apply" ? "cloudflare_catalogue_recovery_applied" : "cloudflare_catalogue_recovery_verified",
    target: loaded.bundle.target,
    bundle_sha256: loaded.bundle.bundle_sha256,
    source_snapshot_sha256: loaded.bundle.source_snapshot_sha256,
    receipt_id: receipt.id,
    inserted_count: Number(receipt.inserted_count),
    updated_count: Number(receipt.updated_count),
    counts: loaded.bundle.counts,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(JSON.stringify({
      event: "cloudflare_catalogue_recovery_failed",
      code: error instanceof CatalogueRecoveryError ? error.code : "unexpected_error",
      error: error instanceof Error ? error.message : "Catalogue recovery failed.",
    }, null, 2));
    process.exitCode = 1;
  });
}
