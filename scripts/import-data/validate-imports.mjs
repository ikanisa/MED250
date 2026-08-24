import { readFile } from "node:fs/promises";

const PRODUCT_TOTAL = 2480;
const RETAIL_PHARMACY_TOTAL = 766;
const ONLINE_PHARMACY_TOTAL = 3;
const PRODUCT_STATUS_COUNTS = Object.freeze({ valid: 2430, expiring_soon: 29, grace_period: 21 });
const PRODUCT_STATUSES = new Set(["valid", "expiring_soon", "grace_period", "expired"]);
const PUBLIC_PHARMACY_COLUMNS = ["source_serial", "name", "technician", "council_registration_number", "province", "district", "sector_cell_raw", "license_expiration_date", "source_url"];
const PRODUCT_REVIEW_COLUMNS = ["product_id", "registration_number", "prescription_status", "is_orderable", "reviewer", "reviewed_at", "note"];
const PUBLIC_HEALTH_CHEMICAL_REGISTER_URL = "https://rwandafda.gov.rw/wp-content/uploads/2026/02/eRWANDA-FDA-PUBLIC-HEALTH-CHEMICAL-PRODUCTS-REGISTER-JANUARY-2026-2.pdf";

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    parsed[value.slice(2)] = next;
    index++;
  }
  return parsed;
}

const args = {
  "retail-pharmacies": "data/imports/rwanda-fda-retail-pharmacies-may-2026.csv",
  "online-pharmacies": "data/imports/rwanda-fda-online-pharmacies-may-2026.csv",
  products: "data/imports/rwanda-fda-products-july-2026.csv",
  "public-retail-pharmacies": "public/data/rwanda-fda-pharmacies-may-2026.csv",
  "public-online-pharmacies": "public/data/rwanda-fda-online-pharmacies-may-2026.csv",
  "public-products": "public/data/rwanda-fda-products-july-2026.csv",
  "product-review-template": "data/imports/product-orderability-review-template.csv",
  ...parseArgs(process.argv.slice(2)),
};

function parseCsv(text, sourcePath) {
  const rawRows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && character === "\n") {
      row.push(cell);
      rawRows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  if (quoted) throw new Error(`${sourcePath}: unterminated quoted CSV field.`);
  if (cell || row.length > 0) {
    row.push(cell);
    rawRows.push(row);
  }
  const headers = rawRows.shift();
  if (!headers?.length) throw new Error(`${sourcePath}: CSV is empty.`);
  if (new Set(headers).size !== headers.length) throw new Error(`${sourcePath}: duplicate CSV header names.`);
  const rows = rawRows
    .filter((values) => values.some((value) => value !== ""))
    .map((values, index) => {
      if (values.length !== headers.length) throw new Error(`${sourcePath}: row ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
      return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
    });
  return { headers, rows };
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function canonicalProductId(serial) {
  return `rwanda-fda-hm-${String(serial).padStart(4, "0")}`;
}

function canonicalPharmacyKey(registryType, serial) {
  return `${registryType}-2026-05-${serial}`;
}

function normalizedRegulatoryNumber(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function duplicateGroups(rows, valueForRow, referenceForRow) {
  const groups = new Map();
  for (const row of rows) {
    const value = normalizedRegulatoryNumber(valueForRow(row));
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), referenceForRow(row)]);
  }
  return [...groups.entries()]
    .filter(([, references]) => references.length > 1)
    .map(([value, references]) => ({ value, references }));
}

const files = await Promise.all(Object.entries(args).map(async ([name, path]) => [name, parseCsv(await readFile(path, "utf8"), path)]));
const parsed = Object.fromEntries(files);
const sourceManifest = JSON.parse(await readFile("data/imports/source-manifest.json", "utf8"));
const retailRows = parsed["retail-pharmacies"].rows;
const onlineRows = parsed["online-pharmacies"].rows;
const productRows = parsed.products.rows;
const errors = [];

function checkRequiredFields(rows, fields, label) {
  for (let index = 0; index < rows.length; index++) {
    for (const field of fields) {
      if (!String(rows[index][field] ?? "").trim()) errors.push(`${label} row ${index + 2}: missing required field ${field}`);
    }
  }
}

function checkSerialCoverage(rows, expectedTotal, label) {
  const serials = rows.map((row) => Number(row.source_serial));
  const invalid = serials.filter((serial) => !Number.isInteger(serial) || serial < 1 || serial > expectedTotal);
  const unique = new Set(serials);
  const missing = [];
  for (let serial = 1; serial <= expectedTotal; serial++) if (!unique.has(serial)) missing.push(serial);
  if (rows.length !== expectedTotal) errors.push(`${label}: expected ${expectedTotal} rows, received ${rows.length}`);
  if (invalid.length > 0) errors.push(`${label}: invalid/out-of-range source serials: ${invalid.slice(0, 20).join(", ")}`);
  if (unique.size !== rows.length) errors.push(`${label}: duplicate source serial values detected`);
  if (missing.length > 0) errors.push(`${label}: incomplete source serial coverage; missing ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "…" : ""}`);
}

function checkCanonicalKeys(values, label) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size > 0) errors.push(`${label}: duplicate canonical IDs: ${[...duplicates].slice(0, 20).join(", ")}`);
}

checkRequiredFields(retailRows, PUBLIC_PHARMACY_COLUMNS, "retail pharmacies");
checkRequiredFields(onlineRows, PUBLIC_PHARMACY_COLUMNS, "online pharmacies");
checkRequiredFields(productRows, ["source_serial", "registration_number", "expiry_date", "regulatory_status", "source_name", "source_url"], "products");
checkSerialCoverage(retailRows, RETAIL_PHARMACY_TOTAL, "retail pharmacies");
checkSerialCoverage(onlineRows, ONLINE_PHARMACY_TOTAL, "online pharmacies");
checkSerialCoverage(productRows, PRODUCT_TOTAL, "products");

for (const [registryType, rows] of [["retail", retailRows], ["online", onlineRows]]) {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.license_expiration_date && !isIsoDate(row.license_expiration_date)) errors.push(`${registryType} pharmacy row ${index + 2}: invalid license_expiration_date ${row.license_expiration_date}`);
    if (row.source_url && !/^https:\/\//.test(row.source_url)) errors.push(`${registryType} pharmacy row ${index + 2}: source_url must use HTTPS`);
  }
}

const actualStatusCounts = {};
for (let index = 0; index < productRows.length; index++) {
  const row = productRows[index];
  if (row.registration_date && !isIsoDate(row.registration_date)) errors.push(`product row ${index + 2}: invalid registration_date ${row.registration_date}`);
  if (row.expiry_date && !isIsoDate(row.expiry_date)) errors.push(`product row ${index + 2}: invalid expiry_date ${row.expiry_date}`);
  if (row.regulatory_status && !PRODUCT_STATUSES.has(row.regulatory_status)) errors.push(`product row ${index + 2}: invalid regulatory_status ${row.regulatory_status}`);
  if (row.source_url && !/^https:\/\//.test(row.source_url)) errors.push(`product row ${index + 2}: source_url must use HTTPS`);
  if (!String(row.brand_name ?? "").trim() && !String(row.generic_name ?? "").trim() && !String(row.registration_number ?? "").trim()) errors.push(`product row ${index + 2}: no usable product name or registration number`);
  actualStatusCounts[row.regulatory_status] = (actualStatusCounts[row.regulatory_status] ?? 0) + 1;
}
for (const [status, expected] of Object.entries(PRODUCT_STATUS_COUNTS)) {
  if (actualStatusCounts[status] !== expected) errors.push(`products: expected ${expected} ${status} rows, received ${actualStatusCounts[status] ?? 0}`);
}

checkCanonicalKeys(productRows.map((row) => canonicalProductId(Number(row.source_serial))), "products");
checkCanonicalKeys([
  ...retailRows.map((row) => canonicalPharmacyKey("retail", Number(row.source_serial))),
  ...onlineRows.map((row) => canonicalPharmacyKey("online", Number(row.source_serial))),
], "pharmacies");

function comparePublicProjection(sourceRows, publicData, label) {
  if (JSON.stringify(publicData.headers) !== JSON.stringify(PUBLIC_PHARMACY_COLUMNS)) errors.push(`${label}: public CSV headers are not the official-field projection`);
  const projected = sourceRows.map((row) => Object.fromEntries(PUBLIC_PHARMACY_COLUMNS.map((field) => [field, row[field] ?? ""])));
  if (JSON.stringify(projected) !== JSON.stringify(publicData.rows)) errors.push(`${label}: public CSV is not synchronized with the official import CSV`);
}

comparePublicProjection(retailRows, parsed["public-retail-pharmacies"], "retail pharmacies");
comparePublicProjection(onlineRows, parsed["public-online-pharmacies"], "online pharmacies");
if (JSON.stringify(parsed.products) !== JSON.stringify(parsed["public-products"])) errors.push("products: public CSV is not synchronized with the official import CSV");
if (JSON.stringify(parsed["product-review-template"].headers) !== JSON.stringify(PRODUCT_REVIEW_COLUMNS)) {
  errors.push("product review template: headers do not match the controlled review contract");
}
if (parsed["product-review-template"].rows.length !== 0) {
  errors.push("product review template: must remain header-only so no product is activated by default");
}
const publicHealthRegister = sourceManifest.public_health_chemical_products_january_2026;
if (
  !publicHealthRegister
  || publicHealthRegister.status !== "identified_not_imported"
  || publicHealthRegister.official_total !== 314
  || publicHealthRegister.official_pages !== 34
  || publicHealthRegister.imported !== 0
  || publicHealthRegister.source_url !== PUBLIC_HEALTH_CHEMICAL_REGISTER_URL
) {
  errors.push("source manifest: January 2026 Public Health Chemical Products Register must remain identified_not_imported with the official 314-row, 34-page metadata");
}

const productRegulatoryWarnings = duplicateGroups(productRows, (row) => row.registration_number, (row) => `product:${row.source_serial}`);
const pharmacyRegulatoryWarnings = duplicateGroups([
  ...retailRows.map((row) => ({ ...row, registry_type: "retail" })),
  ...onlineRows.map((row) => ({ ...row, registry_type: "online" })),
], (row) => row.council_registration_number, (row) => `${row.registry_type}:${row.source_serial}`);

for (const warning of productRegulatoryWarnings) console.warn(`REVIEW WARNING: duplicate product registration number ${warning.value} at ${warning.references.join(", ")}`);
for (const warning of pharmacyRegulatoryWarnings) console.warn(`REVIEW WARNING: duplicate pharmacy professional registration number ${warning.value} at ${warning.references.join(", ")}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`VALIDATION ERROR: ${error}`);
  console.error(JSON.stringify({ valid: false, errorCount: errors.length }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    valid: true,
    retailPharmacies: retailRows.length,
    onlinePharmacies: onlineRows.length,
    products: productRows.length,
    productReviewTemplateRows: parsed["product-review-template"].rows.length,
    productStatusCounts: actualStatusCounts,
    productRegistrationDuplicateGroups: productRegulatoryWarnings.length,
    pharmacyProfessionalRegistrationDuplicateGroups: pharmacyRegulatoryWarnings.length,
  }, null, 2));
}
