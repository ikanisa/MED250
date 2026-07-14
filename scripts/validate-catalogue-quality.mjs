import { readFile } from "node:fs/promises";

const source = new URL("../data/product-seo-index.json", import.meta.url);
const products = JSON.parse(await readFile(source, "utf8"));
const errors = [];
const warnings = [];

if (!Array.isArray(products) || products.length < 2_000) {
  errors.push(`Expected at least 2,000 current catalogue products; found ${Array.isArray(products) ? products.length : "invalid JSON"}.`);
}

const seenIds = new Set();
const seenRegistrations = new Map();
const categoryCounts = new Map();

for (const [index, product] of products.entries()) {
  const label = `Product ${index + 1}`;
  if (!product?.id || typeof product.id !== "string") errors.push(`${label} has no stable ID.`);
  else if (seenIds.has(product.id)) errors.push(`Duplicate product ID: ${product.id}.`);
  else seenIds.add(product.id);
  if (!product?.brand?.trim()) errors.push(`${label} has no display name.`);
  if (!product?.form?.trim()) errors.push(`${label} has no dosage form.`);
  if (!product?.category?.trim()) errors.push(`${label} has no category.`);
  if (!product?.regulatoryStatus?.trim()) errors.push(`${label} has no regulatory status.`);
  categoryCounts.set(product.category, (categoryCounts.get(product.category) ?? 0) + 1);
  if (product.registrationNumber) {
    const prior = seenRegistrations.get(product.registrationNumber);
    if (prior) warnings.push(`Registration ${product.registrationNumber} appears more than once (${prior}, ${product.id}); retained for source review.`);
    else seenRegistrations.set(product.registrationNumber, product.id);
  }
}

for (const category of ["Medicines", "Pain & fever", "Digestive health", "Allergy", "Diabetes care", "Personal care", "Baby & family", "Wellness"]) {
  const count = categoryCounts.get(category) ?? 0;
  if (!count) errors.push(`The ${category} route has no source-backed products.`);
  else if (count < 10) warnings.push(`The ${category} route is source-backed but sparse (${count} products); do not invent products to fill it.`);
}

if (errors.length) {
  console.error(`Catalogue quality failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Catalogue quality passed for ${products.length.toLocaleString()} source-backed products.`);
  console.log(Object.fromEntries([...categoryCounts.entries()].sort((left, right) => left[0].localeCompare(right[0]))));
}

if (warnings.length) {
  console.warn(`${warnings.length} review warning(s). First 20:`);
  warnings.slice(0, 20).forEach((warning) => console.warn(`- ${warning}`));
}
