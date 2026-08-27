import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const RWANDA_FDA_REGISTER_URL = "https://rwandafda.gov.rw/register/monitoring_preview_register";
const PRODUCT_INDEX_URL = new URL("../data/product-seo-index.json", import.meta.url);
const AUDIT_URL = new URL("../data/seo/rwanda-fda-source-gap-audit.json", import.meta.url);
const TRACKED_FIELDS = Object.freeze({ generic: 3, strength: 4, packSize: 6, manufacturer: 8 });

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function text(value) {
  const normalized = decodeHtml(String(value ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return !normalized || /^—+$/.test(normalized) ? "" : normalized;
}

export function parseRegisteredProductsHtml(html) {
  const title = text(html.match(/<h1[^>]*class=["'][^"']*reg-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const rows = [...html.matchAll(/<tr[^>]*class=["'][^"']*hm-reg-row[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(([, row]) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => text(cell)))
    .filter((row) => row.length === 14);
  return { title, rows };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildSourceGapAudit({ html, products, observedAt = new Date().toISOString() }) {
  const { title, rows } = parseRegisteredProductsHtml(html);
  const errors = [];
  if (!/LIST OF REGISTERED PHARMACEUTICAL PRODUCTS/i.test(title)) errors.push("Rwanda FDA register title is missing");
  if (rows.length !== products.length) errors.push(`Rwanda FDA row count ${rows.length} does not match product index ${products.length}`);

  const missing = Object.fromEntries(Object.keys(TRACKED_FIELDS).map((field) => [field, []]));
  for (let index = 0; index < Math.min(rows.length, products.length); index += 1) {
    const row = rows[index];
    const product = products[index];
    const registrationNumber = text(row[1]);
    if (registrationNumber.toLocaleLowerCase("en") !== text(product.registrationNumber).toLocaleLowerCase("en")) {
      errors.push(`${product.id}: live registration ${registrationNumber || "blank"} does not match the committed index`);
      continue;
    }
    for (const [field, cellIndex] of Object.entries(TRACKED_FIELDS)) {
      const liveValue = text(row[cellIndex]);
      const localValue = text(product[field]);
      if (!liveValue) missing[field].push({ id: product.id, registrationNumber });
      if (!localValue && liveValue) errors.push(`${product.id}: ${field} is available in the live authority source but missing locally`);
    }
  }

  const projection = rows.map((row) => [row[1], row[3], row[4], row[6], row[8]]);
  return {
    audit: {
      schemaVersion: "1",
      classification: "authoritative-source gaps; no medical field may be inferred from a brand name or adjacent field",
      source: {
        name: "Rwanda Food and Drugs Authority registered pharmaceutical products",
        url: RWANDA_FDA_REGISTER_URL,
        registerTitle: title,
        observedAt,
        rowCount: rows.length,
        trackedFieldProjectionSha256: sha256(JSON.stringify(projection)),
      },
      missing,
      counts: Object.fromEntries(Object.entries(missing).map(([field, records]) => [field, records.length])),
      publicationRule: "Keep the field blank until the Rwanda FDA register or a separately approved authoritative product record supplies the exact value.",
    },
    errors,
  };
}

async function main() {
  const response = await fetch(RWANDA_FDA_REGISTER_URL, { headers: { accept: "text/html" }, redirect: "error" });
  if (!response.ok) throw new Error(`Rwanda FDA register returned HTTP ${response.status}`);
  const products = JSON.parse(await readFile(PRODUCT_INDEX_URL, "utf8"));
  const result = buildSourceGapAudit({ html: await response.text(), products });
  if (result.errors.length) {
    console.error(JSON.stringify({ valid: false, errors: result.errors }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--write")) await writeFile(AUDIT_URL, `${JSON.stringify(result.audit, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ valid: true, wrote: process.argv.includes("--write") ? fileURLToPath(AUDIT_URL) : null, ...result.audit.source, counts: result.audit.counts }, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
