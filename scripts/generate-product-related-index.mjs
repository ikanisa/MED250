import { readFile, writeFile } from "node:fs/promises";

import { officialCatalogueTitle } from "../lib/product-display.ts";

const source = new URL(
  "../outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json",
  import.meta.url,
);
const destination = new URL("../data/product-related-index.json", import.meta.url);
const qualityOverridesSource = new URL("../data/imports/amazon-product-quality-overrides-2026-07-16.json", import.meta.url);
const requestableMedicineStatuses = new Set(["valid", "active", "expiring_soon"]);
const text = (value) => typeof value === "string" ? value.trim() : "";
const titleText = (value) => officialCatalogueTitle(text(value));

const [dataset, qualityOverrides] = await Promise.all([
  readFile(source, "utf8").then(JSON.parse),
  readFile(qualityOverridesSource, "utf8").then(JSON.parse),
]);
const excludedAsins = new Set(Object.keys(qualityOverrides.excluded_asins ?? {}));
const medicines = dataset.fda_medicines
  .filter((product) => product.is_active !== false && requestableMedicineStatuses.has(text(product.regulatory_status).toLowerCase()))
  .map((product) => ({
    id: text(product.id),
    kind: "medicine",
    brand: titleText(product.brand_name),
    generic: titleText(product.generic_name),
    strength: text(product.strength),
    form: text(product.dosage_form),
    packSize: text(product.pack_size),
    manufacturer: text(product.manufacturer),
    manufacturerCountry: text(product.manufacturer_country),
    registrationNumber: text(product.registration_number),
    category: "Medicines",
    subcategory: "",
    productType: "human_medicine",
    prescriptionStatus: text(product.prescription_status) || "unclassified",
    regulatoryStatus: text(product.regulatory_status),
    isRequestable: true,
    recommendable: true,
  }));
const consumerProducts = dataset.consumer_products
  .filter((product) => product.publication_status === "approved" && product.is_active === true && product.is_orderable === true)
  .map((product) => ({
    id: text(product.id),
    kind: "consumer",
    brand: titleText(product.product_name),
    generic: titleText(product.generic_name),
    strength: text(product.strength),
    form: text(product.dosage_form),
    packSize: text(product.pack_size),
    manufacturer: text(product.manufacturer),
    manufacturerCountry: text(product.manufacturer_country),
    registrationNumber: "",
    category: text(product.category),
    subcategory: text(product.subcategory),
    productType: text(product.product_type) || "consumer_product",
    prescriptionStatus: text(product.prescription_status) || "not_applicable",
    regulatoryStatus: text(product.regulatory_status) || "verification_pending",
    isRequestable: true,
    recommendable: !excludedAsins.has(text(product.asin)),
  }));
const products = [...medicines, ...consumerProducts]
  .toSorted((left, right) => left.id.localeCompare(right.id));

if (products.length !== 4_659) throw new Error(`Expected 4,659 requestable related-product records; found ${products.length}.`);
if (new Set(products.map((product) => product.id)).size !== products.length) throw new Error("Related-product IDs are not unique.");
if (products.some((product) => !product.id || !product.brand || !product.category || product.isRequestable !== true)) {
  throw new Error("Related-product index contains an incomplete or non-requestable record.");
}
if (products.some((product) => /amazon/i.test(`${product.brand} ${product.generic}`))) {
  throw new Error("Related-product index contains a prohibited marketplace reference.");
}
if (products.filter((product) => product.kind === "medicine").length !== 2_459) throw new Error("Medicine population drifted.");
if (products.filter((product) => product.kind === "consumer").length !== 2_200) throw new Error("Consumer population drifted.");
const suppressed = products.filter((product) => product.recommendable === false).map((product) => product.id);
if (suppressed.length !== 2 || !suppressed.includes("AMZ-032380909X") || !suppressed.includes("AMZ-B01K1S6AHM")) {
  throw new Error(`Expected the two known non-product records to fail closed; found ${suppressed.join(", ") || "none"}.`);
}

await writeFile(destination, `${JSON.stringify(products)}\n`, "utf8");
console.log(`Wrote ${products.length.toLocaleString()} requestable related-product records.`);
