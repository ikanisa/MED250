import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateLocalizationFiles, validateLocalizationRegistry } from "../scripts/validate-localization.mjs";

const registry = JSON.parse(await readFile(new URL("../data/localization/locale-releases.json", import.meta.url), "utf8"));
const inventory = JSON.parse(await readFile(new URL("../data/localization/source-copy-inventory.json", import.meta.url), "utf8"));

test("keeps locale publication fail-closed until complete review evidence exists", async () => {
  const result = await validateLocalizationFiles();
  assert.deepEqual(result.errors, []);
  assert.equal(result.localeCount, 3);
  assert.equal(result.publicLocaleCount, 1);
  assert.ok(result.requiredMessageCount >= 30);
  assert.ok(result.highRiskMessageCount >= 20);
  assert.ok(result.sourceMessageCount >= result.requiredMessageCount);
  assert.equal(result.inventoryMessageCount, result.sourceMessageCount);
  assert.ok(result.runtimeCatalogMessageCount >= result.runtimeCataloguedMessageCount);
  assert.equal(result.hardcodedMessageCount, 0);
  assert.equal(result.highRiskHardcodedMessageCount, 0);
  for (const [surface, budget] of Object.entries(registry.runtime_extraction.max_high_risk_hardcoded_by_surface)) {
    assert.ok((result.highRiskHardcodedBySurface[surface] ?? 0) <= budget, `${surface} exceeds its high-risk runtime-extraction budget`);
  }

  const kinyarwanda = registry.releases.find(({ locale }) => locale === "rw-RW");
  assert.equal(kinyarwanda.public, false);
  assert.equal(kinyarwanda.runtime_ready, false);
  assert.equal(kinyarwanda.route_mode, "blocked_until_approved");
  assert.equal(kinyarwanda.catalog, null);
});

test("routes every privacy and marketplace-terms string through the governed runtime catalog", () => {
  const legalOccurrences = inventory.messages.flatMap(({ occurrences }) => occurrences)
    .filter(({ file }) => file === "app/privacy/page.tsx" || file === "app/terms/page.tsx");
  assert.equal(legalOccurrences.length, 30);
  assert.deepEqual([...new Set(legalOccurrences.map(({ kind }) => kind))], ["catalog_reference"]);
});

test("keeps all high-risk customer, legal, location, system, and pharmacy copy runtime-catalogued", () => {
  const remaining = inventory.messages.flatMap((message) => (
    message.risk !== "high" || !message.hardcoded
      ? []
      : message.occurrences.filter(({ kind }) => kind !== "catalog_reference")
  ));
  assert.deepEqual(remaining, []);
});

test("routes every inventoried user-facing source occurrence through the runtime catalog", () => {
  assert.deepEqual(inventory.messages.filter(({ hardcoded }) => hardcoded), []);
});

test("rejects a public translation without a catalog and accountable review", async () => {
  const unsafe = structuredClone(registry);
  const kinyarwanda = unsafe.releases.find(({ locale }) => locale === "rw-RW");
  kinyarwanda.public = true;
  kinyarwanda.runtime_ready = true;
  kinyarwanda.status = "approved_translation";
  kinyarwanda.route_mode = "localized_prefix";
  const result = await validateLocalizationRegistry(unsafe);
  assert.ok(result.errors.some((error) => error.includes("rw-RW: public locale requires a catalog")));
});

test("reserves locale-prefixed aliases without exposing draft translations", async () => {
  const route = await readFile(new URL("../app/[locale]/[[...segments]]/route.ts", import.meta.url), "utf8");
  const localeHelpers = await readFile(new URL("../lib/marketplace-locale.ts", import.meta.url), "utf8");
  assert.match(route, /isPublicMarketplaceLocale/);
  assert.match(route, /Response\.redirect/);
  assert.match(route, /x-robots-tag/);
  assert.match(localeHelpers, /marketplaceCanonicalRoute/);
  assert.match(localeHelpers, /marketplaceLanguageAlternates/);
});

test("preserves catalogue URL state on the English alias and blocks draft locales", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("localization", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };

  const english = await worker.fetch(
    new Request("https://med250.gikundiro.com/en/categories?search=ibupar&view=list"),
    env,
    context,
  );
  assert.equal(english.status, 308);
  assert.equal(english.headers.get("location"), "https://med250.gikundiro.com/categories?search=ibupar&view=list");

  for (const path of ["/rw/categories", "/fr/privacy"]) {
    const response = await worker.fetch(new Request(`https://med250.gikundiro.com${path}`), env, context);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  }

  const root = await worker.fetch(
    new Request("https://med250.gikundiro.com/", { headers: { accept: "text/html" } }),
    env,
    context,
  );
  const html = await root.text();
  assert.match(html, /<html lang="en-RW">/);
  assert.match(html, /rel="alternate" hrefLang="en-RW"/);
  assert.doesNotMatch(html, /hrefLang="(?:rw-RW|fr-RW)"/);
});
