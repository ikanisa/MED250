import { readFile, writeFile } from "node:fs/promises";

const source = new URL(
  "../outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json",
  import.meta.url,
);
const destination = new URL("../data/product-sitemap-index.json", import.meta.url);
const qualityOverridesSource = new URL("../data/imports/amazon-product-quality-overrides-2026-07-16.json", import.meta.url);
const requestableMedicineStatuses = new Set(["valid", "active", "expiring_soon"]);

const [dataset, qualityOverrides] = await Promise.all([
  readFile(source, "utf8").then(JSON.parse),
  readFile(qualityOverridesSource, "utf8").then(JSON.parse),
]);
const excludedAsins = new Set(Object.keys(qualityOverrides.excluded_asins ?? {}));
const medicines = dataset.fda_medicines
  .filter((product) => product.is_active !== false && requestableMedicineStatuses.has(String(product.regulatory_status).toLowerCase()));
const consumerProducts = dataset.consumer_products
  .filter((product) => product.publication_status === "approved" && product.is_active === true && product.is_orderable === true)
  .filter((product) => !excludedAsins.has(String(product.asin ?? "")));
const products = [...medicines, ...consumerProducts]
  .map((product) => ({
    id: String(product.id),
    lastModified: product.source_refreshed_at || dataset.research_as_of,
  }))
  .toSorted((left, right) => left.id.localeCompare(right.id));

if (products.length !== 4_657) throw new Error(`Expected 4,657 publishable sitemap products after governed exclusions; found ${products.length}.`);
if (new Set(products.map((product) => product.id)).size !== products.length) throw new Error("Product sitemap IDs are not unique.");
if (products.some((product) => !/^(?:rwanda-fda-hm-\d{4}|AMZ-[A-Z0-9]{10})$/.test(product.id))) {
  throw new Error("Product sitemap contains a noncanonical product ID.");
}
if (products.some((product) => !Number.isFinite(Date.parse(product.lastModified)))) {
  throw new Error("Product sitemap contains an invalid source refresh date.");
}

await writeFile(destination, `${JSON.stringify(products)}\n`, "utf8");
console.log(`Wrote ${products.length.toLocaleString()} requestable product sitemap records.`);
