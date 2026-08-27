import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productMetadataDescription, productMetadataTitle } from "../lib/seo-content.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const products = JSON.parse(await readFile(path.join(projectRoot, "data/product-seo-index.json"), "utf8"));
const locations = JSON.parse(await readFile(path.join(projectRoot, "data/seo/location-pages.json"), "utf8"));
const errors = [];
const warnings = [];
const seenIds = new Set();
const missing = { generic: 0, strength: 0, packSize: 0, manufacturer: 0 };
const regressionBudgets = { generic: 24, strength: 98, packSize: 352, manufacturer: 86 };

for (const record of products) {
  if (seenIds.has(record.id)) errors.push(`duplicate product id: ${record.id}`);
  seenIds.add(record.id);
  for (const field of Object.keys(missing)) if (!String(record[field] ?? "").trim()) missing[field] += 1;
  const product = { ...record, subcategory: "" };
  const title = productMetadataTitle(product);
  const description = productMetadataDescription(product);
  if (!title || title.length > 65) errors.push(`${record.id}: invalid metadata title length ${title.length}`);
  if (!description || description.length > 160) errors.push(`${record.id}: invalid metadata description length ${description.length}`);
  if (/[\u2026\uFFFD]|[|,;:–—-]\s*$/u.test(title)) errors.push(`${record.id}: metadata title contains a broken terminal marker`);
  if (/[\u2026\uFFFD]/u.test(description)) errors.push(`${record.id}: metadata description contains a broken marker`);
}

for (const [field, count] of Object.entries(missing)) {
  if (count > regressionBudgets[field]) errors.push(`${field} missing count ${count} exceeds regression budget ${regressionBudgets[field]}`);
  else if (count) warnings.push(`${field}: ${count} records remain in the governed completion queue`);
}

const publicLocationPaths = locations.pages.filter((page) => page.status === "public").map((page) => page.path);
if (publicLocationPaths.join(",") !== "/contact") errors.push("Only the governed contact location page may currently be public");
if (!locations.future_page_gate?.required?.includes("partner_consent")) errors.push("Future location pages must require partner consent");

console.log(JSON.stringify({ valid: errors.length === 0, productCount: products.length, missing, warnings, errors }, null, 2));
if (errors.length) process.exitCode = 1;
