import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataset = JSON.parse(await readFile(
  new URL("../outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json", import.meta.url),
  "utf8",
));
const migration = await readFile(
  new URL("../supabase/migrations/20260715184639_add_amazon_marketplace_catalogue.sql", import.meta.url),
  "utf8",
);
const pharmacySellerMigration = await readFile(
  new URL("../supabase/migrations/20260716062012_central_catalogue_pharmacy_sellers.sql", import.meta.url),
  "utf8",
);
const centralPriceMigration = await readFile(
  new URL("../supabase/migrations/20260716070200_central_indicative_prices_whatsapp_first.sql", import.meta.url),
  "utf8",
);
const publicCentralPriceMigration = await readFile(
  new URL("../supabase/migrations/20260716072226_publish_central_indicative_price_columns.sql", import.meta.url),
  "utf8",
);
const removeAmazonPriceMigration = await readFile(
  new URL("../supabase/migrations/20260716081801_remove_amazon_reference_prices.sql", import.meta.url),
  "utf8",
);
const productImageMigration = await readFile(
  new URL("../supabase/migrations/20260716140000_product_image_gallery.sql", import.meta.url),
  "utf8",
);
const optionalProductImageMigration = await readFile(
  new URL("../supabase/migrations/20260716161000_make_verified_product_images_optional.sql", import.meta.url),
  "utf8",
);
const fullProductNameMigration = await readFile(
  new URL("../supabase/migrations/20260716150000_use_full_consumer_product_names.sql", import.meta.url),
  "utf8",
);
const catalogueQualityMigration = await readFile(
  new URL("../supabase/migrations/20260716160000_repair_consumer_catalogue_quality.sql", import.meta.url),
  "utf8",
);
const catalogueQualityOverrides = JSON.parse(await readFile(
  new URL("../data/imports/amazon-product-quality-overrides-2026-07-16.json", import.meta.url),
  "utf8",
));
const marketplaceImporter = await readFile(
  new URL("../scripts/import-data/load-marketplace-products.mjs", import.meta.url),
  "utf8",
);
const nonProductRetirementMigration = await readFile(
  new URL("../supabase/migrations/20260718080000_retire_non_product_catalogue_records.sql", import.meta.url),
  "utf8",
);
const taxonomyMigration = await readFile(
  new URL("../supabase/migrations/20260716085840_remove_inferred_medicine_subcategories.sql", import.meta.url),
  "utf8",
);
const client = await readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8");
const taxonomy = await readFile(new URL("../lib/non-prescription-taxonomy.ts", import.meta.url), "utf8");
const productPage = await readFile(new URL("../app/product/[id]/page.tsx", import.meta.url), "utf8");
const publicProduct = await readFile(new URL("../lib/public-marketplace-product.ts", import.meta.url), "utf8");
const marketplace = await readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8");
const medicinesPage = await readFile(new URL("../app/category/medicines/page.tsx", import.meta.url), "utf8");
const categoryPages = await Promise.all([
  "../app/category/medicines/page.tsx",
  "../app/category/personal-care/page.tsx",
  "../app/category/baby-family/page.tsx",
  "../app/category/wellness/page.tsx",
].map((page) => readFile(new URL(page, import.meta.url), "utf8")));

test("Amazon source retains 2,200 traceable rows while the governed import publishes 2,198 products", () => {
  const rows = dataset.consumer_products;
  const excludedAsins = new Set(Object.keys(catalogueQualityOverrides.excluded_asins));
  const publishableRows = rows.filter((row) => !excludedAsins.has(row.asin));
  assert.equal(rows.length, 2_200);
  assert.equal(publishableRows.length, 2_198);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2_200);
  assert.equal(new Set(rows.map((row) => row.asin)).size, 2_200);
  assert.equal(new Set(rows.map((row) => `${row.category} / ${row.subcategory}`)).size, 25);
  assert.ok(rows.every((row) => row.id === `AMZ-${row.asin}`));
  assert.ok(rows.every((row) => row.publication_status === "approved"));
  assert.ok(rows.every((row) => row.is_active === true && row.is_orderable === true));
  assert.ok(rows.every((row) => !("seller_verification_required" in row)));
  assert.ok(rows.every((row) => row.amazon_price_usd_observed == null));
  assert.equal(rows.filter((row) => row.indicative_price_basis === "rwanda_observed_catalogue").length, 128);
  assert.ok(rows.every((row) => row.indicative_price_basis !== "amazon_usd_reference_conversion"));
  assert.ok(rows.filter((row) => row.indicative_price_rwf == null).every((row) => row.price_display == null && row.price_disclaimer == null));
  assert.ok(rows.every((row) => typeof row.product_name === "string" && row.product_name.trim().length > 0));
  const normalizedNames = rows.map((row) => row.product_name.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim());
  assert.equal(new Set(normalizedNames).size, rows.length);
  assert.ok(rows.every((row) => row.product_name.length >= 12 && row.product_name.trim().split(/\s+/).length >= 3));
  assert.ok(Object.values(rows.reduce((counts, row) => {
    const key = `${row.category} / ${row.subcategory}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {})).every((count) => count >= 50));
  assert.ok(!publishableRows.some((row) => new Set(["032380909X", "B01K1S6AHM"]).has(row.asin)));
});

test("uses complete consumer product names instead of quantity or pack tokens", () => {
  assert.match(fullProductNameMigration, /marketplace\.product_name as brand_name/);
  assert.match(fullProductNameMigration, /new\.product_name/);
  assert.match(fullProductNameMigration, /update of[\s\S]*product_name/);
  assert.match(fullProductNameMigration, /product\.brand_name is distinct from marketplace\.product_name/);
  assert.match(marketplaceImporter, /packOnlyName/);
  assert.match(marketplaceImporter, /does not have a customer-facing product name/);
  assert.match(marketplaceImporter, /Duplicate customer-facing product name/);
  assert.match(marketplaceImporter, /Could not retire superseded products/);
  assert.match(marketplaceImporter, /filter\(\(product\) => !excludedAsins\.has/);
  assert.match(marketplaceImporter, /publication_status: "rejected"/);
  assert.match(catalogueQualityMigration, /canonical product metadata/i);
  assert.match(catalogueQualityMigration, /marketplace\.generic_name, marketplace\.strength, marketplace\.dosage_form/);
  assert.match(catalogueQualityMigration, /publication_status = 'rejected'/);
  assert.ok(Object.keys(catalogueQualityOverrides.title_corrections).length >= 200);
  assert.ok(Object.keys(catalogueQualityOverrides.excluded_asins).length >= 90);
  assert.equal(catalogueQualityOverrides.excluded_asins["032380909X"], "Book/ISBN study guide, not a pharmacy catalogue product.");
  assert.equal(catalogueQualityOverrides.excluded_asins.B01K1S6AHM, "Clinical-skills textbook, not a pharmacy catalogue product.");
  assert.match(nonProductRetirementMigration, /AMZ-032380909X/);
  assert.match(nonProductRetirementMigration, /AMZ-B01K1S6AHM/);
  assert.match(nonProductRetirementMigration, /insert into public\.dawanear_marketplace_product_reviews/);
  assert.match(nonProductRetirementMigration, /expected_product_updated_at/);
  assert.match(nonProductRetirementMigration, /previous_state/);
  assert.match(nonProductRetirementMigration, /resulting_state/);
  assert.match(nonProductRetirementMigration, /publication_status = 'rejected'/);
  assert.match(nonProductRetirementMigration, /raise exception 'Non-product catalogue records remain publicly visible'/);
  assert.equal(dataset.qa.duplicate_product_titles, 0);
  assert.ok(dataset.consumer_products.some((row) => row.brand_name === "10pcs" && row.product_name.includes("Makeup Brushes")));
});

test("marketplace schema is RLS-protected and keeps pricing central", () => {
  assert.match(migration, /create table public\.dawanear_marketplace_products/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /dawanear_marketplace_products_fail_closed_check/);
  assert.match(pharmacySellerMigration, /publication_status = 'approved' and is_active and is_orderable/);
  assert.match(pharmacySellerMigration, /drop column if exists seller_verification_required/);
  assert.match(pharmacySellerMigration, /drop column if exists seller_evidence_url/);
  assert.match(pharmacySellerMigration, /pharmacies are the only sellers/i);
  assert.doesNotMatch(pharmacySellerMigration, /p_seller_evidence_url/);
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /dawanear_sync_marketplace_product/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[\s\S]*to (anon|authenticated)/i);
  assert.match(centralPriceMigration, /indicative_price_rwf/);
  assert.match(centralPriceMigration, /From RWF reference/);
  assert.match(centralPriceMigration, /public_view_avoids_pharmacy_prices/);
  assert.match(centralPriceMigration, /Pharmacy-specific catalogue prices are not supported/);
  assert.match(centralPriceMigration, /confirmation_price_optional/);
  assert.match(centralPriceMigration, /'public_stock_supported', false/);
  assert.match(removeAmazonPriceMigration, /amazon_price_usd_observed = null/);
  assert.match(removeAmazonPriceMigration, /dawanear_marketplace_products_no_amazon_price_check/);
  assert.match(removeAmazonPriceMigration, /'amazon_price_reference_supported', false/);
  assert.doesNotMatch(
    removeAmazonPriceMigration.slice(
      removeAmazonPriceMigration.indexOf("create or replace function dawanear_private.dawanear_sync_marketplace_indicative_price"),
      removeAmazonPriceMigration.indexOf("update public.dawanear_products as product"),
    ),
    /amazon_price_usd_observed|amazon_usd_reference_conversion/,
  );
  assert.doesNotMatch(
    centralPriceMigration.slice(
      centralPriceMigration.indexOf("create or replace view public.dawanear_product_catalog"),
      centralPriceMigration.indexOf("drop function if exists public.dawanear_search_marketplace_catalogue"),
    ),
    /join public\.dawanear_pharmacy_prices/i,
  );
});

test("public server rendering fails blank instead of returning a transient upstream 503", () => {
  assert.match(publicProduct, /async function fetchPublicRows/);
  assert.match(publicProduct, /AbortSignal\.timeout\(PUBLIC_FETCH_TIMEOUT_MS\)/);
  assert.match(publicProduct, /catch \{[\s\S]*return \[\];[\s\S]*\}/);
  assert.doesNotMatch(publicProduct, /const \[response, imageUrls\]/);
  for (const page of categoryPages) {
    assert.match(page, /initialTaxonomy\.length > 0 && !initialTaxonomy\.some/);
  }
});

test("publishes central indicative price columns through the RLS-protected catalogue", () => {
  assert.match(publicCentralPriceMigration, /grant select \([\s\S]*indicative_price_rwf[\s\S]*indicative_price_basis[\s\S]*indicative_price_source_url[\s\S]*indicative_price_updated_at[\s\S]*\) on table public\.dawanear_products to anon, authenticated/);
  assert.doesNotMatch(publicCentralPriceMigration, /dawanear_pharmacy_prices|observed_inventory_units/);
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
  assert.match(client, /indicativePriceRwf/);
  assert.match(publicProduct, /indicative_price_rwf/);
  assert.doesNotMatch(publicProduct, /SERVICE_ROLE|SECRET_KEY/);
  assert.match(productImageMigration, /create table public\.dawanear_product_images/);
  assert.match(productImageMigration, /Exactly three product images are required/);
  assert.match(productImageMigration, /grant execute on function public\.dawanear_publish_product_images\(text, jsonb\)[\s\S]*to service_role/);
  assert.doesNotMatch(productImageMigration, /grant execute on function public\.dawanear_publish_product_images\(text, jsonb\)[\s\S]*to (anon|authenticated)/);
  assert.match(optionalProductImageMigration, /coverage_required[\s\S]*false/);
  assert.match(optionalProductImageMigration, /missing_images_hidden[\s\S]*true/);
  assert.match(optionalProductImageMigration, /generated_placeholders_allowed[\s\S]*false/);
  assert.match(optionalProductImageMigration, /partial_product_count/);
  assert.match(publicProduct, /dawanear_product_images/);
  assert.match(productPage, /getPublicProductImages/);
});

test("medicine taxonomy is source-backed and empty subcategories stay hidden", () => {
  assert.match(taxonomyMigration, /dawanear_catalogue_taxonomy/);
  assert.match(taxonomyMigration, /nullif\(trim\(catalogue\.subcategory\), ''\)/);
  assert.match(taxonomyMigration, /products\.category = input\.category/);
  assert.doesNotMatch(taxonomyMigration, /Pain & fever|Digestive health|Allergy|Diabetes care|inferred_category/);
  assert.match(client, /loadCatalogueTaxonomy/);
  assert.doesNotMatch(client, /inferProductCategory|Pain & fever|Digestive health|Allergy|Diabetes care/);
  assert.match(publicProduct, /getPublicCatalogueTaxonomy/);
  assert.match(marketplace, /availableDepartments\.has\(item\.department\)/);
  assert.match(marketplace, /departmentCards\.length/);
  assert.doesNotMatch(marketplace, /Medicines &amp;<br \/>pain relief|Find relief from pain/);
  assert.match(medicinesPage, /if \(initialTaxonomy\.length > 0 && !initialTaxonomy\.some[\s\S]*redirect\("\/categories"\)/);
});
