import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

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
const products = dataset.consumer_products;
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
  "publication_status", "seller_verification_required", "age_gate_required",
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
const taxonomy = new Set();
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
  if (ids.has(product.id) || asins.has(product.asin)) {
    throw new Error(`Duplicate Amazon product at row ${index + 1}: ${product.asin}`);
  }
  if (product.is_active || product.is_orderable || product.publication_status !== "research_candidate") {
    throw new Error(`Product ${product.id} is not fail-closed`);
  }
  ids.add(product.id);
  asins.add(product.asin);
  taxonomy.add(`${product.category} / ${product.subcategory}`);
  return Object.fromEntries(expectedFields.map((field) => [field, product[field] ?? null]));
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
const { count, error: countError } = await supabase
  .from("dawanear_marketplace_products")
  .select("id", { head: true, count: "exact" })
  .eq("source_register", sourceRegister);
if (countError) throw new Error(`Post-import count verification failed: ${countError.message}`);
if (count !== rows.length) {
  throw new Error(`Post-import count mismatch: expected ${rows.length}, found ${count ?? "unknown"}`);
}

console.log(JSON.stringify({ written, verified: count, taxonomyPairs: taxonomy.size, sourceRegister }, null, 2));
