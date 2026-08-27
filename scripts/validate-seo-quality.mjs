import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productMetadataDescription, productMetadataTitle } from "../lib/seo-content.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const products = JSON.parse(await readFile(path.join(projectRoot, "data/product-seo-index.json"), "utf8"));
const locations = JSON.parse(await readFile(path.join(projectRoot, "data/seo/location-pages.json"), "utf8"));
const sourceGapAudit = JSON.parse(await readFile(path.join(projectRoot, "data/seo/rwanda-fda-source-gap-audit.json"), "utf8"));
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
  const auditedRecords = sourceGapAudit.missing?.[field] ?? [];
  const auditedIds = auditedRecords.map(({ id }) => id).toSorted();
  const missingIds = products.filter((record) => !String(record[field] ?? "").trim()).map(({ id }) => id).toSorted();
  if (JSON.stringify(auditedIds) !== JSON.stringify(missingIds)) errors.push(`${field}: authority-source gap ledger does not match the product index`);
  if (sourceGapAudit.counts?.[field] !== count) errors.push(`${field}: authority-source gap count does not match the product index`);
  else if (count) warnings.push(`${field}: ${count} fields are blank in the current Rwanda FDA authority source and remain fail-closed`);
}

if (sourceGapAudit.schemaVersion !== "1") errors.push("Rwanda FDA source-gap audit schema is invalid");
if (sourceGapAudit.source?.url !== "https://rwandafda.gov.rw/register/monitoring_preview_register") errors.push("Rwanda FDA source-gap audit URL is invalid");
if (sourceGapAudit.source?.rowCount !== products.length) errors.push("Rwanda FDA source-gap audit row count does not match the product index");
const observedAt = new Date(sourceGapAudit.source?.observedAt ?? "");
if (Number.isNaN(observedAt.valueOf()) || observedAt.valueOf() > Date.now() + 5 * 60 * 1_000) errors.push("Rwanda FDA source-gap audit timestamp is invalid");
else if (Date.now() - observedAt.valueOf() > 90 * 24 * 60 * 60 * 1_000) errors.push("Rwanda FDA source-gap audit is older than 90 days; refresh it before release");

const publicLocationPaths = locations.pages.filter((page) => page.status === "public").map((page) => page.path);
if (publicLocationPaths.join(",") !== "/contact") errors.push("Only the governed contact location page may currently be public");
if (!locations.future_page_gate?.required?.includes("partner_consent")) errors.push("Future location pages must require partner consent");

console.log(JSON.stringify({ valid: errors.length === 0, productCount: products.length, missing, warnings, errors }, null, 2));
if (errors.length) process.exitCode = 1;
