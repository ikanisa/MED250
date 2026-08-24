import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const index = JSON.parse(await readFile(new URL("../data/product-sitemap-index.json", import.meta.url), "utf8"));
const sitemapSource = await readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8");

test("publishes every requestable medicine and consumer product in the compact sitemap index", () => {
  assert.equal(index.length, 4_657);
  assert.equal(new Set(index.map((product) => product.id)).size, index.length);
  assert.equal(index.filter((product) => product.id.startsWith("rwanda-fda-hm-")).length, 2_459);
  assert.equal(index.filter((product) => product.id.startsWith("AMZ-")).length, 2_198);
  assert.ok(!index.some((product) => new Set(["AMZ-032380909X", "AMZ-B01K1S6AHM"]).has(product.id)));
  assert.ok(index.every((product) => Number.isFinite(Date.parse(product.lastModified))));
  assert.match(sitemapSource, /product-sitemap-index\.json/);
  assert.match(sitemapSource, /lastModified: product\.lastModified/);
  assert.doesNotMatch(sitemapSource, /productSeoIndex\.map/);
  assert.doesNotMatch(sitemapSource, /pharmacy-portal|request=/);
});
