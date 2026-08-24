import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
  const [rawConfig, workerBundle] = await Promise.all([
    readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
  ]);
  const config = JSON.parse(rawConfig);
  assert.equal(config.name, "med250-marketplace-gikundiro");
  assert.equal(config.vars.MED250_RELEASE_MODE, "live");
  assert.equal(config.vars.MED250_BACKEND_MODE, "worker-d1");
  assert.equal(config.vars.NEXT_PUBLIC_MED250_INDEXING_MODE, "public");
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes.map((route) => route.pattern), [
    "med-250.com",
  ]);
  assert.doesNotMatch(JSON.stringify(config.routes), /med250\.gikundiro\.com/);
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.images.binding, "IMAGES");
  assert.deepEqual(config.queues.consumers.map((consumer) => consumer.queue), [
    "med250-whatsapp-dispatch-production",
    "med250-whatsapp-dispatch-dlq-production",
  ]);
  assert.match(workerBundle, /api\/internal\/health/);
  assert.match(workerBundle, /api\/internal\/operator\//);
  assert.match(workerBundle, /worker-d1-operator-v1/);
  assert.match(workerBundle, /med250_runtime_contract/);
  assert.match(workerBundle, /dispatch_dead_letter_receipt_failed/);
  assert.match(workerBundle, /private_media_retention_swept/);
});

test("ships no Supabase project origin or publishable key in production browser assets", async () => {
  const root = new URL("../dist/client/", import.meta.url);
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = new URL(entry.name, directory);
      if (entry.isDirectory()) {
        pending.push(new URL(`${target.href}/`));
        continue;
      }
      const body = await readFile(target);
      assert.doesNotMatch(body.toString("utf8"), /uskfnszcdqpcfrhjxitl|sb_publishable_|https:\/\/[^\s"']+\.supabase\.co/);
    }
  }
});

test("renders live indexable metadata and security headers", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), null);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", /supabase\.co/);
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
