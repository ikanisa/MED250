import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataset = JSON.parse(await readFile(
  new URL("../outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json", import.meta.url),
  "utf8",
));
const migration = await readFile(
  new URL("../supabase/migrations/20260715184400_add_amazon_marketplace_catalogue.sql", import.meta.url),
  "utf8",
);
const client = await readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8");
const taxonomy = await readFile(new URL("../lib/non-prescription-taxonomy.ts", import.meta.url), "utf8");
const productPage = await readFile(new URL("../app/product/[id]/page.tsx", import.meta.url), "utf8");
const publicProduct = await readFile(new URL("../lib/public-marketplace-product.ts", import.meta.url), "utf8");

test("Amazon-first import contains 2,200 unique, fail-closed products across all 25 taxonomy pairs", () => {
  const rows = dataset.consumer_products;
  assert.equal(rows.length, 2_200);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2_200);
  assert.equal(new Set(rows.map((row) => row.asin)).size, 2_200);
  assert.equal(new Set(rows.map((row) => `${row.category} / ${row.subcategory}`)).size, 25);
  assert.ok(rows.every((row) => row.id === `AMZ-${row.asin}`));
  assert.ok(rows.every((row) => row.publication_status === "research_candidate"));
  assert.ok(rows.every((row) => row.is_active === false && row.is_orderable === false));
});

test("marketplace product schema is RLS-protected and cannot publish unreviewed rows", () => {
  assert.match(migration, /create table public\.dawanear_marketplace_products/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /dawanear_marketplace_products_fail_closed_check/);
  assert.match(migration, /publication_status = 'approved'[\s\S]*not seller_verification_required[\s\S]*lower\(compliance_status\) = 'approved'/);
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /dawanear_sync_marketplace_product/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[\s\S]*to (anon|authenticated)/i);
});

test("storefront loads and searches the unified catalogue with exact taxonomy fields", () => {
  assert.match(client, /dawanear_all_product_catalog/);
  assert.match(client, /dawanear_search_marketplace_catalogue/);
  assert.match(client, /subcategory: stringValue\(row, "subcategory"\)/);
  assert.match(taxonomy, /product\.subcategory/);
  assert.match(taxonomy, /return value;/);
  assert.match(productPage, /getPublicMarketplaceProduct/);
  assert.match(publicProduct, /dawanear_all_product_catalog/);
  assert.match(publicProduct, /cache: "no-store"/);
  assert.doesNotMatch(publicProduct, /SERVICE_ROLE|SECRET_KEY/);
});
