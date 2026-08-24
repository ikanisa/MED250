import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// Kept outside the default *.test.mjs glob because it requires a staging build.
const stagingBuildConfig = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));

function stagingOrigin() {
  const value = process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN?.trim()
    || process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || stagingBuildConfig.vars?.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN
    || stagingBuildConfig.vars?.NEXT_PUBLIC_SITE_URL
    || "https://med250-marketplace-staging.ikanisa.workers.dev";
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:");
  assert.notEqual(parsed.hostname, "med-250.com");
  assert.ok(parsed.hostname.endsWith(".workers.dev") || parsed.hostname === "staging.med-250.com");
  return parsed.origin;
}

async function render(pathname) {
  const origin = stagingOrigin();
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("staging-test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`${origin}${pathname}`, {
    headers: { accept: "text/html,*/*" },
  }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    MED250_RELEASE_MODE: "live",
    MED250_BACKEND_MODE: "worker-d1",
    NEXT_PUBLIC_MED250_INDEXING_MODE: "private",
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("builds an isolated Worker-D1 staging artifact", async () => {
  const [rawConfig, workerBundle] = await Promise.all([
    readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
  ]);
  const config = JSON.parse(rawConfig);
  assert.equal(config.name, "med250-marketplace-staging");
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.routes, []);
  assert.equal(config.vars.MED250_RELEASE_MODE, "live");
  assert.equal(config.vars.MED250_BACKEND_MODE, "worker-d1");
  assert.equal(config.vars.NEXT_PUBLIC_MED250_INDEXING_MODE, "private");
  assert.deepEqual(config.queues.consumers.map((consumer) => consumer.queue), [
    "med250-whatsapp-dispatch-staging",
    "med250-whatsapp-dispatch-dlq-staging",
  ]);
  assert.equal(config.r2_buckets[0].bucket_name, "med250-private-media-staging");
  assert.match(workerBundle, /worker-d1-operator-v1/);
  assert.match(workerBundle, /private_media_retention_swept/);
});

test("ships no Supabase project origin or publishable key in staging browser assets", async () => {
  const pending = [new URL("../dist/client/", import.meta.url)];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = new URL(entry.name, directory);
      if (entry.isDirectory()) {
        pending.push(new URL(`${target.href}/`));
        continue;
      }
      const body = await readFile(target);
      assert.doesNotMatch(body.toString("utf8"), /uskfnszcdqpcfrhjxitl|sb_publishable_|https:\/\/[^\s"']+[.]supabase[.]co/);
    }
  }
});

test("keeps live staging ordering private from search engines", async () => {
  const [home, robots, sitemap] = await Promise.all([
    render("/"),
    render("/robots.txt"),
    render("/sitemap.xml"),
  ]);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(await home.text(), /name="robots" content="noindex, nofollow/);
  assert.match(await robots.text(), /Disallow:\s*\//i);
  assert.doesNotMatch(await sitemap.text(), /<url>/i);
});
