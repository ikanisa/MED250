import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assessDeploymentEvidence,
  validateDeploymentOrigin,
} from "../scripts/verify-deployed-site.mjs";

const verifierSource = await readFile(new URL("../scripts/verify-deployed-site.mjs", import.meta.url), "utf8");

const securityHeaders = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site",
  "permissions-policy": "camera=(), geolocation=(self), microphone=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "server-timing": "app;dur=12.4",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-request-id": "123e4567-e89b-12d3-a456-426614174000",
};

function records(origin, mode) {
  const paths = [
    "/",
    "/categories",
    "/category/medicines",
    "/product/rwanda-fda-hm-0734",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
  ];
  return paths.map((route) => ({
    route,
    status: 200,
    finalOrigin: origin,
    headers: route === "/" ? {
      ...securityHeaders,
      ...(mode === "preview" ? { "x-robots-tag": "noindex, nofollow" } : {}),
    } : {},
    body: route === "/"
      ? "<title>MED+250</title><h1>Connect with a pharmacy that has it</h1>"
      : route === "/robots.txt"
        ? mode === "preview" ? "User-Agent: *\nDisallow: /" : `User-Agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`
        : route === "/sitemap.xml"
          ? mode === "preview" ? "<urlset></urlset>" : `<urlset>${`<url><loc>${origin}/product/example</loc></url>`.repeat(2_400)}</urlset>`
          : "ok",
  }));
}

test("accepts a protected preview deployment", () => {
  const origin = "https://med250-marketplace-preview.example.workers.dev";
  assert.deepEqual(assessDeploymentEvidence({ origin, mode: "preview", records: records(origin, "preview") }).errors, []);
});

test("accepts an indexable live custom domain", () => {
  const origin = "https://med250.gikundiro.com";
  assert.deepEqual(assessDeploymentEvidence({ origin, mode: "live", records: records(origin, "live") }).errors, []);
});

test("accepts an indexable public catalog on Sites", () => {
  const origin = "https://med250-rwanda.ikanisa.chatgpt.site";
  assert.deepEqual(assessDeploymentEvidence({ origin, mode: "catalog", records: records(origin, "catalog") }).errors, []);
  assert.equal(validateDeploymentOrigin(origin, "catalog"), origin);
});

test("accepts the public Sites deployment as a live ordering origin", () => {
  const origin = "https://med250-rwanda.ikanisa.chatgpt.site";
  assert.deepEqual(assessDeploymentEvidence({ origin, mode: "live", records: records(origin, "live") }).errors, []);
  assert.equal(validateDeploymentOrigin(origin, "live"), origin);
});

test("detects indexing, security-header, redirect and sitemap failures", () => {
  const origin = "https://med250.gikundiro.com";
  const evidence = records(origin, "live");
  evidence[0].headers["x-robots-tag"] = "noindex, nofollow";
  delete evidence[0].headers["content-security-policy"];
  evidence[1].finalOrigin = "https://unexpected.example";
  evidence.find((record) => record.route === "/sitemap.xml").body = "<urlset></urlset>";
  const result = assessDeploymentEvidence({ origin, mode: "live", records: evidence });
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("redirected outside")));
  assert.ok(result.errors.some((error) => error.includes("Content-Security-Policy")));
  assert.ok(result.errors.some((error) => error.includes("unexpectedly blocked")));
  assert.ok(result.errors.some((error) => error.includes("at least 2,400")));
});

test("requires HTTPS and a custom domain for live verification", () => {
  assert.throws(() => validateDeploymentOrigin("http://med250.gikundiro.com", "live"), /requires HTTPS/);
  assert.throws(() => validateDeploymentOrigin("https://med250.workers.dev", "live"), /custom domain/);
  assert.equal(validateDeploymentOrigin("https://preview.workers.dev", "preview"), "https://preview.workers.dev");
});

test("supports private Sites verification without putting the bypass token in the URL or output", () => {
  assert.match(verifierSource, /SITES_BYPASS_BEARER_TOKEN/);
  assert.match(verifierSource, /"OAI-Sites-Authorization": `Bearer \$\{sitesBypassToken\}`/);
  assert.doesNotMatch(verifierSource, /console\.(?:log|error)\([^\n]*sitesBypassToken/);
  assert.doesNotMatch(verifierSource, /searchParams[^\n]*sitesBypassToken/);
});

test("keeps preview and production Workers isolated behind manual protected deployment", async () => {
  const [wrangler, packageJson, quality, deployment] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-cloudflare.yml", import.meta.url), "utf8"),
  ]);
  assert.equal(wrangler.name, "med250-marketplace-preview");
  assert.equal(wrangler.vars.MED250_RELEASE_MODE, "preview");
  assert.equal(wrangler.env.production.name, "med250-marketplace-gikundiro");
  assert.equal(wrangler.env.production.workers_dev, false);
  assert.equal(wrangler.env.production.vars.MED250_RELEASE_MODE, "live");
  assert.deepEqual(wrangler.env.production.routes.map((route) => route.pattern), [
    "med250.gikundiro.com",
  ]);
  assert.match(packageJson.scripts["build:production"], /CLOUDFLARE_ENV=production/);
  assert.match(packageJson.scripts["release:check:live"], /npm run test:preview/);
  assert.match(packageJson.scripts["release:check:live"], /npm run test:production/);
  assert.match(packageJson.scripts["release:check:live"], /wrangler deploy --env production --dry-run --strict/);
  assert.match(packageJson.scripts["deploy:live"], /wrangler deploy --env production --strict/);
  assert.match(packageJson.scripts["cloudflare:check:production"], /wrangler deploy --env production --dry-run --strict/);
  assert.match(quality, /npm run release:check/);
  assert.match(deployment, /workflow_dispatch:/);
  assert.doesNotMatch(deployment, /\n\s+push:/);
  assert.match(deployment, /environment: med250-production/);
  assert.match(deployment, /DEPLOY MED250 LIVE/);
  assert.match(deployment, /npm run uat:verify:live/);
  assert.match(deployment, /npm run backend:verify && npm run ops:health:strict/);
  assert.match(deployment, /SUPABASE_SECRET_KEY:[^\n]*secrets\.SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(deployment.split("steps:")[0], /SUPABASE_SECRET_KEY/);
  assert.match(deployment, /cloudflare\/wrangler-action@[0-9a-f]{40}/);
  assert.match(deployment, /command: deploy --env production --strict/);
  assert.match(deployment, /deployment:verify[\s\S]*--mode preview/);
  assert.match(deployment, /deployment:verify[\s\S]*--mode live/);
});
