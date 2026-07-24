import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseCsv } from "./import-data/verify-duplicate-register-review.mjs";

const DEFAULT_SITE_URL = "https://med250-rwanda.ikanisa.chatgpt.site";
const DEFAULT_OUTPUT_DIR = "outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23";
const LOCAL_INDEX = "data/product-related-index.json";
const MEDICINE_SEO_INDEX = "data/product-seo-index.json";
const QUALITY_OVERRIDES = "data/imports/amazon-product-quality-overrides-2026-07-16.json";
const FDA_PRODUCTS = "data/imports/rwanda-fda-products-july-2026.csv";

function option(name, fallback = "") {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredMatch(value, pattern, label) {
  const match = value.match(pattern)?.[0];
  if (!match) throw new Error(`Could not discover ${label} from the public deployment.`);
  return match;
}

function rwandaPriceSourceName(value) {
  if (!value) return null;
  const hostname = new URL(value).hostname;
  if (hostname === "www.kasha.rw") return "Kasha Rwanda live product API";
  if (hostname === "kigaliproteinstore.store") return "Kigali Protein Store";
  return hostname;
}

async function publicSupabaseConfiguration(siteUrl) {
  const normalizedSiteUrl = siteUrl.replace(/\/+$/, "");
  const pageResponse = await fetch(normalizedSiteUrl);
  if (!pageResponse.ok) throw new Error(`Public site returned HTTP ${pageResponse.status}.`);
  const page = await pageResponse.text();
  const assets = [...new Set(
    [...page.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.js/g)].map((match) => match[0]),
  )];
  for (const asset of assets) {
    const response = await fetch(`${normalizedSiteUrl}${asset}`);
    if (!response.ok) continue;
    const source = await response.text();
    if (!source.includes("sb_publishable_")) continue;
    return {
      supabaseUrl: requiredMatch(
        source,
        /https:\/\/[a-z0-9]+\.supabase\.co/,
        "the public Supabase URL",
      ),
      publishableKey: requiredMatch(
        source,
        /sb_publishable_[A-Za-z0-9_-]+/,
        "the public Supabase publishable key",
      ),
    };
  }
  throw new Error("No public Supabase configuration was present in the deployed JavaScript.");
}

async function loadAllPublicConsumerRows(supabaseUrl, publishableKey) {
  const rows = [];
  for (let from = 0; ; from += 1_000) {
    const endpoint = new URL("/rest/v1/dawanear_all_product_catalog", supabaseUrl);
    endpoint.searchParams.set("select", "*");
    endpoint.searchParams.set("id", "like.AMZ-*");
    endpoint.searchParams.set("order", "id.asc");
    const response = await fetch(endpoint, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        Range: `${from}-${from + 999}`,
        "Range-Unit": "items",
      },
    });
    if (!response.ok) {
      throw new Error(`Public catalogue query returned HTTP ${response.status}.`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

const siteUrl = option("--site-url", DEFAULT_SITE_URL);
const outputDir = path.resolve(option("--output-dir", DEFAULT_OUTPUT_DIR));
const generatedAt = new Date().toISOString();
const [
  { supabaseUrl, publishableKey },
  localIndex,
  medicineSeoIndex,
  qualityOverrides,
  fdaProductsCsv,
] = await Promise.all([
  publicSupabaseConfiguration(siteUrl),
  readFile(LOCAL_INDEX, "utf8").then(JSON.parse),
  readFile(MEDICINE_SEO_INDEX, "utf8").then(JSON.parse),
  readFile(QUALITY_OVERRIDES, "utf8").then(JSON.parse),
  readFile(FDA_PRODUCTS, "utf8"),
]);
const publicRows = await loadAllPublicConsumerRows(supabaseUrl, publishableKey);
const localRows = localIndex.filter((row) => row.kind === "consumer");
const activeMedicineIds = new Set(
  localIndex.filter((row) => row.kind === "medicine").map((row) => row.id),
);
const localById = new Map(localRows.map((row) => [row.id, row]));
const publicById = new Map(publicRows.map((row) => [row.id, row]));
const excludedAsins = new Set(Object.keys(qualityOverrides.excluded_asins ?? {}));

if (localRows.length !== 2_200 || new Set(localRows.map((row) => row.id)).size !== 2_200) {
  throw new Error("The committed consumer identity index is not the expected unique 2,200-row snapshot.");
}
if (publicRows.length !== 2_198 || publicById.size !== 2_198) {
  throw new Error("The public consumer catalogue is not the expected unique 2,198-row selection.");
}

const unexpectedPublicIds = publicRows
  .map((row) => row.id)
  .filter((id) => !localById.has(id));
if (unexpectedPublicIds.length) {
  throw new Error(`The public catalogue has ${unexpectedPublicIds.length} identity not present in the committed index.`);
}

const recoveredRows = localRows
  .map((local) => {
    const live = publicById.get(local.id);
    const asin = local.id.replace(/^AMZ-/, "");
    return {
      id: local.id,
      asin,
      source_product_id: asin,
      public_catalogue_present: Boolean(live),
      governed_exclusion: excludedAsins.has(asin),
      governed_exclusion_reason: qualityOverrides.excluded_asins?.[asin] ?? null,
      product_name: live?.brand_name ?? local.brand,
      generic_name: live?.generic_name ?? local.generic ?? null,
      strength: live?.strength ?? local.strength ?? null,
      dosage_form: live?.dosage_form ?? local.form ?? null,
      pack_size: live?.pack_size ?? local.packSize ?? null,
      product_type: live?.product_type ?? local.productType ?? null,
      category: live?.category ?? local.category,
      department: live?.department ?? null,
      subcategory: live?.subcategory ?? local.subcategory,
      prescription_status: live?.prescription_status ?? local.prescriptionStatus,
      regulatory_status: live?.regulatory_status ?? local.regulatoryStatus,
      manufacturer: live?.manufacturer ?? local.manufacturer ?? null,
      manufacturer_country: live?.manufacturer_country ?? local.manufacturerCountry ?? null,
      is_orderable: live?.is_orderable ?? local.isRequestable,
      is_active: true,
      publication_status: "approved",
      source_name: live?.source_name ?? null,
      source_url: live?.source_url ?? null,
      amazon_product_url: live?.amazon_product_url ?? `https://www.amazon.com/dp/${asin}`,
      indicative_price_rwf: live?.indicative_price_rwf ?? null,
      indicative_price_basis: live?.indicative_price_basis ?? null,
      indicative_price_source_url: live?.indicative_price_source_url ?? null,
      indicative_price_updated_at: live?.indicative_price_updated_at ?? null,
      rwanda_source_name: rwandaPriceSourceName(live?.indicative_price_source_url),
      amazon_price_usd_observed: null,
      price_display: null,
      price_disclaimer: null,
    };
  })
  .sort((left, right) => left.id.localeCompare(right.id));

const absentIds = recoveredRows.filter((row) => !row.public_catalogue_present);
const normalizedConsumerTitles = recoveredRows.map((row) => String(row.product_name ?? "")
  .toLocaleLowerCase("en")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim());
if (
  absentIds.length !== 2
  || absentIds.some((row) => !row.governed_exclusion)
  || new Set(normalizedConsumerTitles).size !== recoveredRows.length
  || recoveredRows.filter((row) => row.indicative_price_basis === "rwanda_observed_catalogue").length !== 128
) {
  throw new Error("The recovered selection does not match the governed exclusion or Rwanda-price evidence.");
}

const medicineSeoById = new Map(medicineSeoIndex.map((row) => [row.id, row]));
const fdaMedicines = parseCsv(fdaProductsCsv, FDA_PRODUCTS).rows.map((row) => {
  const id = `rwanda-fda-hm-${String(row.source_serial).padStart(4, "0")}`;
  const canonical = medicineSeoById.get(id);
  if (!canonical) throw new Error(`The medicine SEO index is missing ${id}.`);
  const productName = canonical.generic || canonical.brand !== row.registration_number
    ? canonical.brand
    : `Registered medicine (${row.registration_number})`;
  return {
    id,
    source_serial: Number(row.source_serial),
    registration_number: row.registration_number,
    product_name: productName,
    brand_name: canonical.brand,
    generic_name: canonical.generic,
    strength: canonical.strength,
    dosage_form: canonical.form,
    pack_size: canonical.packSize,
    shelf_life: row.shelf_life,
    product_type: "human_medicine",
    manufacturer: canonical.manufacturer,
    manufacturer_country: canonical.manufacturerCountry,
    marketing_authorization_holder: row.marketing_authorization_holder,
    local_technical_representative: row.local_technical_representative,
    registration_date: row.registration_date,
    expiry_date: row.expiry_date,
    regulatory_status: row.regulatory_status,
    is_orderable: false,
    is_active: activeMedicineIds.has(id),
    source_name: row.source_name,
    source_url: row.source_url,
  };
});
if (
  fdaMedicines.length !== 2_480
  || new Set(fdaMedicines.map((row) => row.id)).size !== 2_480
  || fdaMedicines.some((row, index) => row.source_serial !== index + 1)
) {
  throw new Error("The committed Rwanda FDA product register is not the expected ordered 2,480-row snapshot.");
}

const recovery = {
  schema_version: "1",
  classification: "reconstructed_public_catalogue_evidence",
  generated_at: generatedAt,
  research_as_of: "2026-07-15",
  limitations: [
    "This is not the missing corrected Amazon research dataset and must not be represented as that source.",
    "It does not restore private research fields, raw Amazon observations, the original workbook, or the recorded original SHA-256.",
    "It combines the committed 2,200-row consumer identity index, current public 2,198-row consumer projection, and committed 2,480-row Rwanda FDA derived register.",
  ],
  provenance: {
    public_site: siteUrl,
    public_view: "public.dawanear_all_product_catalog",
    committed_identity_index: LOCAL_INDEX,
    committed_medicine_seo_index: MEDICINE_SEO_INDEX,
    governed_quality_overrides: QUALITY_OVERRIDES,
    committed_rwanda_fda_register: FDA_PRODUCTS,
  },
  qa: {
    consumer_identity_rows: recoveredRows.length,
    public_consumer_rows: recoveredRows.filter((row) => row.public_catalogue_present).length,
    governed_consumer_exclusions: absentIds.length,
    unique_consumer_ids: new Set(recoveredRows.map((row) => row.id)).size,
    rwanda_fda_rows: fdaMedicines.length,
    total_pipeline_identities: recoveredRows.length + fdaMedicines.length,
    duplicate_product_titles: 0,
    rwanda_observed_price_rows: recoveredRows.filter(
      (row) => row.indicative_price_basis === "rwanda_observed_catalogue",
    ).length,
  },
  consumer_products: recoveredRows,
  fda_medicines: fdaMedicines,
};
const recoveryText = `${JSON.stringify(recovery, null, 2)}\n`;
const manifest = {
  schema_version: "1",
  classification: "recovery_manifest_not_source_retention_approval",
  generated_at: generatedAt,
  artifact: {
    path: path.join(outputDir, "recovered-public-marketplace-catalogue.json"),
    bytes: Buffer.byteLength(recoveryText),
    sha256: sha256(recoveryText),
  },
  original_source_status: {
    recovered: false,
    expected_path: "outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json",
    expected_sha256: "5000580eb85403a58de8e604bdd055b25b22958ae5755206913a070bcae31383",
  },
  qa: recovery.qa,
};

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDir, "recovered-public-marketplace-catalogue.json"), recoveryText),
  writeFile(path.join(outputDir, "recovery-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
]);

console.log(JSON.stringify({
  status: "recovered_public_projection",
  outputDir,
  artifactSha256: manifest.artifact.sha256,
  qa: recovery.qa,
  originalSourceRecovered: false,
}, null, 2));
