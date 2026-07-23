import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Kept outside the default *.test.mjs glob because it requires a production build.

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("production-test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`https://med-250.com${pathname}`, {
    headers: { accept: "text/html,*/*" },
  }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    MED250_RELEASE_MODE: "live",
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("builds the explicit production Worker and custom-domain routes", async () => {
  const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  assert.equal(config.name, "med250-marketplace-gikundiro");
  assert.equal(config.vars.MED250_RELEASE_MODE, "live");
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes.map((route) => route.pattern), [
    "med-250.com",
  ]);
  assert.doesNotMatch(JSON.stringify(config.routes), /med250\.gikundiro\.com/);
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.images.binding, "IMAGES");
});

test("renders live indexable metadata and security headers", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), null);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  const html = await response.text();
  assert.match(html, /<title>MED\+250/);
  assert.match(html, /name="robots" content="index, follow/);
  assert.doesNotMatch(html, /name="robots" content="noindex/);
});

test("publishes live robots directives and the complete source-backed sitemap", async () => {
  const robotsResponse = await render("/robots.txt");
  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /User-Agent: \*/i);
  assert.match(robots, /Allow: \//i);
  assert.match(robots, /Disallow: \/pharmacies/i);
  assert.match(robots, /Sitemap: https:\/\/med-250\.com\/sitemap\.xml/i);

  const sitemapResponse = await render("/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assert.ok((sitemap.match(/<url>/g) ?? []).length >= 4_600);
  assert.match(sitemap, /https:\/\/med-250\.com\/product\/rwanda-fda-hm-/);
  assert.match(sitemap, /https:\/\/med-250\.com\/product\/AMZ-/);
});
