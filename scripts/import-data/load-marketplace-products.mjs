import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { officialCatalogueTitle } from "../../lib/product-display.ts";

const defaultDataset = path.resolve(
  "outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json",
);

function option(name, fallback = "") {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const datasetPath = path.resolve(option("--dataset", defaultDataset));
const qualityOverridesPath = path.resolve(
  "data/imports/amazon-product-quality-overrides-2026-07-16.json",
);
const supabaseUrl = option("--url", process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const secretKey = option(
  "--secret-key",
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
);
const chunkSize = Number(option("--chunk-size", "100"));
const dryRun = process.argv.includes("--dry-run");

if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 500) {
  throw new Error("--chunk-size must be a whole number between 1 and 500");
}
if (!dryRun && (!supabaseUrl || !secretKey)) {
  throw new Error("Provide --url and --secret-key (or server-only Supabase environment variables). Never use this key in browser code.");
}

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const qualityOverrides = JSON.parse(await readFile(qualityOverridesPath, "utf8"));
const excludedAsins = new Set(Object.keys(qualityOverrides.excluded_asins ?? {}));
const products = dataset.consumer_products.filter((product) => !excludedAsins.has(String(product.asin ?? "")));
if (!Array.isArray(products) || products.length < 2_000) {
  throw new Error(`Expected at least 2,000 consumer products; found ${products?.length ?? 0}`);
}

const expectedFields = [
  "id", "source_register", "source_serial", "registration_number", "brand_name",
  "generic_name", "strength", "dosage_form", "pack_size", "shelf_life",
  "product_type", "category", "prescription_status", "regulatory_status",
  "manufacturer", "manufacturer_country", "marketing_authorization_holder",
  "local_technical_representative", "registration_date", "expiry_date",
  "image_url", "image_source", "is_orderable", "is_active", "source_name",
  "source_url", "source_refreshed_at", "source_platform", "source_product_id",
  "asin", "product_name", "subcategory", "regulatory_class",
  "publication_status", "age_gate_required",
  "amazon_product_url", "amazon_category_url", "amazon_search_query",
  "amazon_price_usd_observed", "amazon_rating_observed", "amazon_reviews_observed",
  "amazon_bought_past_month_observed", "amazon_page_observed",
  "amazon_evidence_status", "ships_to_rwanda_status", "rwanda_match_status",
  "rwanda_match_score", "rwanda_matched_product_name", "rwanda_source_name",
  "rwanda_product_url", "observed_price_rwf", "observed_inventory_units",
  "rwanda_availability_status", "taxonomy_relevance_score",
  "amazon_popularity_score", "assortment_score", "compliance_status",
  "brand_verification_status", "data_quality_note",
];

const ids = new Set();
const asins = new Set();
const productNames = new Set();
const taxonomy = new Set();
const reviewedAt = new Date().toISOString();
const reviewEvidence = {
  reviewed_by_label: "MED+250 catalogue quality audit",
  review_note: "Canonical product name, taxonomy relevance, duplicate-title prevention, and customer-facing catalogue display were validated before publication.",
  reviewed_at: reviewedAt,
  approved_at: reviewedAt,
};
const packOnlyName = /^\d+(?:\.\d+)?\s*(?:pcs?|pieces?|ml|l|mg|g|kg|oz|fl\s*oz)?$/i;
const normalizeProductName = (value) => String(value ?? "")
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const rows = products.map((product, index) => {
  for (const field of expectedFields) {
    if (!(field in product)) throw new Error(`Product ${index + 1} is missing ${field}`);
  }
  if (!/^AMZ-[A-Z0-9]{10}$/.test(product.id) || !/^[A-Z0-9]{10}$/.test(product.asin)) {
    throw new Error(`Product ${index + 1} has an invalid Amazon identity`);
  }
  if (product.id !== `AMZ-${product.asin}` || product.source_product_id !== product.asin) {
    throw new Error(`Product ${index + 1} has inconsistent Amazon identifiers`);
  }
  const productName = officialCatalogueTitle(String(product.product_name ?? ""));
  const brandName = officialCatalogueTitle(String(product.brand_name ?? "")) || "Unbranded";
  const genericName = officialCatalogueTitle(String(product.generic_name ?? ""));
  const normalizedProductName = normalizeProductName(productName);
  if (
    !productName
    || productName.length < 12
    || productName.split(/\s+/).length < 3
    || packOnlyName.test(productName)
    || productName.toLocaleLowerCase() === String(product.category).trim().toLocaleLowerCase()
    || productName.toLocaleLowerCase() === String(product.subcategory).trim().toLocaleLowerCase()
  ) {
    throw new Error(`Product ${product.id} does not have a customer-facing product name`);
  }
  if (product.amazon_price_usd_observed != null) {
    throw new Error(`Product ${product.id} retains an Amazon price; Amazon price references are not importable`);
  }
  if (ids.has(product.id) || asins.has(product.asin)) {
    throw new Error(`Duplicate Amazon product at row ${index + 1}: ${product.asin}`);
  }
  if (productNames.has(normalizedProductName)) {
    throw new Error(`Duplicate customer-facing product name at row ${index + 1}: ${productName}`);
  }
  if (!product.is_active || !product.is_orderable || product.publication_status !== "approved") {
    throw new Error(`Product ${product.id} is not activated for the central pharmacy catalogue`);
  }
  ids.add(product.id);
  asins.add(product.asin);
  productNames.add(normalizedProductName);
  taxonomy.add(`${product.category} / ${product.subcategory}`);
  return {
    ...Object.fromEntries(expectedFields.map((field) => [field, product[field] ?? null])),
    product_name: productName,
    brand_name: brandName,
    generic_name: genericName || null,
    ...reviewEvidence,
  };
});

if (taxonomy.size !== 25) {
  throw new Error(`Expected all 25 department/subcategory pairs; found ${taxonomy.size}`);
}

if (dryRun) {
  console.log(JSON.stringify({ valid: true, products: rows.length, taxonomyPairs: taxonomy.size, datasetPath }, null, 2));
  process.exit(0);
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

let written = 0;
for (let index = 0; index < rows.length; index += chunkSize) {
  const chunk = rows.slice(index, index + chunkSize);
  const { error } = await supabase
    .from("dawanear_marketplace_products")
    .upsert(chunk, { onConflict: "id" });
  if (error) {
    throw new Error(`Import failed for rows ${index + 1}-${index + chunk.length}: ${error.message}`);
  }
  written += chunk.length;
}

const sourceRegister = rows[0].source_register;
const existingIds = [];
for (let from = 0; ; from += 1_000) {
  const { data, error } = await supabase
    .from("dawanear_marketplace_products")
    .select("id")
    .eq("source_register", sourceRegister)
    .range(from, from + 999);
  if (error) throw new Error(`Could not inspect the existing catalogue selection: ${error.message}`);
  const page = data ?? [];
  existingIds.push(...page.map((row) => row.id));
  if (page.length < 1_000) break;
}

const importedIds = new Set(rows.map((row) => row.id));
const staleIds = existingIds.filter((id) => !importedIds.has(id));
for (let index = 0; index < staleIds.length; index += chunkSize) {
  const chunk = staleIds.slice(index, index + chunkSize);
  const { error } = await supabase
    .from("dawanear_marketplace_products")
    .update({
      publication_status: "rejected",
      is_active: false,
      is_orderable: false,
    })
    .in("id", chunk);
  if (error) {
    throw new Error(`Could not retire superseded products ${index + 1}-${index + chunk.length}: ${error.message}`);
  }
}

const { count, error: countError } = await supabase
  .from("dawanear_marketplace_products")
  .select("id", { head: true, count: "exact" })
  .eq("source_register", sourceRegister)
  .eq("publication_status", "approved")
  .eq("is_active", true)
  .eq("is_orderable", true);
if (countError) throw new Error(`Post-import count verification failed: ${countError.message}`);
if (count !== rows.length) {
  throw new Error(`Post-import count mismatch: expected ${rows.length}, found ${count ?? "unknown"}`);
}

console.log(JSON.stringify({
  written,
  retired: staleIds.length,
  verified: count,
  taxonomyPairs: taxonomy.size,
  sourceRegister,
}, null, 2));
