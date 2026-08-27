import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assessDeploymentEvidence,
  buildDeploymentEvidence,
  parseArguments,
  validateDeploymentOrigin,
} from "../scripts/verify-deployed-site.mjs";

const verifierSource = await readFile(new URL("../scripts/verify-deployed-site.mjs", import.meta.url), "utf8");

const securityHeaders = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site",
  "permissions-policy":
    "accelerometer=(), browsing-topics=(), camera=(), geolocation=(self), gyroscope=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "server-timing": "app;dur=12.4",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-med250-release-revision": "0123456789abcdef0123456789abcdef01234567",
  "x-request-id": "123e4567-e89b-12d3-a456-426614174000",
};

function records(origin, mode) {
  const paths = [
    "/",
    "/categories",
    "/category/medicines",
    "/product/rwanda-fda-hm-0734",
    "/product/AMZ-B004L5JCZ4",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/sw.js",
    "/offline.html",
  ];
  return paths.map((route, index) => ({
    route,
    status: 200,
    finalOrigin: origin,
    headers: route === "/" ? {
      ...securityHeaders,
      ...(mode === "preview" ? { "x-robots-tag": "noindex, nofollow" } : {}),
    } : index < 7 ? {
      "x-med250-release-revision": securityHeaders["x-med250-release-revision"],
    } : {},
    body: route === "/"
      ? "<title>MED+250</title><h1>Health and everyday care. <em>Found at the nearest Pharmacy.</em></h1>"
      : route === "/robots.txt"
        ? mode === "preview" ? "User-Agent: *\nDisallow: /" : `User-Agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`
        : route === "/sitemap.xml"
          ? mode === "preview" ? "<urlset></urlset>" : `<urlset><url><loc>${origin}/product/rwanda-fda-hm-0001</loc></url><url><loc>${origin}/product/AMZ-B004L5JCZ4</loc></url>${`<url><loc>${origin}/product/example</loc></url>`.repeat(4_598)}</urlset>`
          : route === "/manifest.webmanifest"
            ? JSON.stringify({ id: "/", scope: "/", display: "standalone", description: "Send availability requests to eligible pharmacies." })
            : route === "/sw.js"
              ? 'const OFFLINE_URL = "/offline.html"; function isPrivatePath(url) { return url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/orders") || url.pathname.startsWith("/api/pharmacy/") || url.pathname.startsWith("/api/internal/") || url.pathname.startsWith("/api/twilio/"); } if (isPrivatePath(url)) return;'
              : route === "/offline.html"
                ? "<h1>You are offline</h1><p>MED+250 will never show a request as sent while you are offline.</p>"
                : "ok",
  }));
}

test("accepts a protected preview deployment", () => {
  const origin = "https://med250-marketplace-preview.example.workers.dev";
  assert.deepEqual(assessDeploymentEvidence({ origin, mode: "preview", records: records(origin, "preview") }).errors, []);
});

test("accepts an indexable live custom domain", () => {
  const origin = "https://med-250.com";
  const result = assessDeploymentEvidence({
    origin,
    mode: "live",
    records: records(origin, "live"),
    expectedRevision: securityHeaders["x-med250-release-revision"],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.releaseRevision, "0123456789abcdef0123456789abcdef01234567");
});

test("requires an exact release revision when one is supplied", () => {
  const origin = "https://med-250.com";
  const matching = assessDeploymentEvidence({
    origin,
    mode: "live",
    records: records(origin, "live"),
    expectedRevision: securityHeaders["x-med250-release-revision"],
  });
  assert.deepEqual(matching.errors, []);

  const mismatched = assessDeploymentEvidence({
    origin,
    mode: "live",
    records: records(origin, "live"),
    expectedRevision: "fedcba9876543210fedcba9876543210fedcba98",
  });
  assert.equal(mismatched.status, "failed");
  assert.ok(mismatched.errors.some((error) => error.includes("does not match the expected release")));
});

test("rejects a mixed-revision Worker deployment even when the homepage is current", () => {
  const origin = "https://med-250.com";
  const evidenceRecords = records(origin, "live");
  const categories = evidenceRecords.find((record) => record.route === "/categories");
  categories.headers["x-med250-release-revision"] = "fedcba9876543210fedcba9876543210fedcba98";
  const result = assessDeploymentEvidence({
    origin,
    mode: "live",
    records: evidenceRecords,
    expectedRevision: securityHeaders["x-med250-release-revision"],
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /\/categories: X-MED250-Release-Revision does not match/);
});

test("builds a durable receipt without response bodies or unapproved headers", () => {
  const origin = "https://med-250.com";
  const evidenceRecords = records(origin, "live");
  evidenceRecords[0].headers["set-cookie"] = "secret=value";
  const result = assessDeploymentEvidence({
    origin,
    mode: "live",
    records: evidenceRecords,
    expectedRevision: securityHeaders["x-med250-release-revision"],
  });
  const evidence = buildDeploymentEvidence({
    result,
    records: evidenceRecords,
    expectedRevision: securityHeaders["x-med250-release-revision"],
    capturedAt: "2026-07-18T12:00:00.000Z",
    verifierSha256: "a".repeat(64),
  });
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.releaseRevisionExpectation, "matched");
  assert.equal(evidence.routes.length, 10);
  assert.equal(evidence.routes[0].bodySha256.length, 64);
  assert.equal(evidence.routes[0].headers["set-cookie"], undefined);
  assert.equal("body" in evidence.routes[0], false);
});

test("accepts an indexable public catalog on Sites", () => {
  const origin = "https://med250-rwanda.ikanisa.chatgpt.site";
  assert.deepEqual(assessDeploymentEvidence({ origin, mode: "catalog", records: records(origin, "catalog") }).errors, []);
  assert.equal(validateDeploymentOrigin(origin, "catalog"), origin);
  assert.throws(
    () => validateDeploymentOrigin("https://med-250.com", "catalog"),
    /governed MED\+250 Sites origin/,
  );
});

test("keeps the public Sites deployment catalog-only", () => {
  const origin = "https://med250-rwanda.ikanisa.chatgpt.site";
  const result = assessDeploymentEvidence({ origin, mode: "live", records: records(origin, "live") });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /catalog-only/);
  assert.throws(() => validateDeploymentOrigin(origin, "live"), /canonical MED\+250 production domain/);
});

test("requires immutable Git provenance for every live CLI verification", () => {
  const origin = "https://med-250.com";
  assert.throws(
    () => parseArguments(["--url", origin, "--mode", "live"]),
    /exact lowercase 40-character Git release revision/,
  );
  assert.throws(
    () => parseArguments(["--url", origin, "--mode", "live", "--expected-revision", "artifact-1234567"]),
    /exact lowercase 40-character Git release revision/,
  );
  assert.equal(
    parseArguments(["--url", origin, "--mode", "live", "--expected-revision", securityHeaders["x-med250-release-revision"]]).expectedRevision,
    securityHeaders["x-med250-release-revision"],
  );
  assert.throws(() => parseArguments(["--url", origin, "--mode", "staging"]), /preview, catalog, or live/);
});

test("detects indexing, security-header, redirect and sitemap failures", () => {
  const origin = "https://med-250.com";
  const evidence = records(origin, "live");
  evidence[0].headers["x-robots-tag"] = "noindex, nofollow";
  delete evidence[0].headers["content-security-policy"];
  delete evidence[0].headers["x-med250-release-revision"];
  evidence[1].finalOrigin = "https://unexpected.example";
  evidence.find((record) => record.route === "/sitemap.xml").body = "<urlset></urlset>";
  const result = assessDeploymentEvidence({ origin, mode: "live", records: evidence });
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("redirected outside")));
  assert.ok(result.errors.some((error) => error.includes("Content-Security-Policy")));
  assert.ok(result.errors.some((error) => error.includes("X-MED250-Release-Revision")));
  assert.ok(result.errors.some((error) => error.includes("unexpectedly blocked")));
  assert.ok(result.errors.some((error) => error.includes("at least 4,600")));
});

test("requires HTTPS and a custom domain for live verification", () => {
  assert.throws(() => validateDeploymentOrigin("http://med-250.com", "live"), /requires HTTPS/);
  assert.throws(() => validateDeploymentOrigin("https://med250.workers.dev", "live"), /custom domain/);
  assert.equal(validateDeploymentOrigin("https://preview.workers.dev", "preview"), "https://preview.workers.dev");
});

test("supports private Sites verification without putting the bypass token in the URL or output", () => {
  assert.match(verifierSource, /SITES_BYPASS_BEARER_TOKEN/);
  assert.match(verifierSource, /"OAI-Sites-Authorization": `Bearer \$\{sitesBypassToken\}`/);
  assert.doesNotMatch(verifierSource, /console\.(?:log|error)\([^\n]*sitesBypassToken/);
  assert.doesNotMatch(verifierSource, /searchParams[^\n]*sitesBypassToken/);
});

test("keeps production as the only remotely deployable Worker target", async () => {
  const [wrangler, packageJson, quality, deployment] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-cloudflare.yml", import.meta.url), "utf8"),
  ]);
  assert.equal(wrangler.name, "med250-marketplace-preview");
  assert.equal(wrangler.vars.MED250_RELEASE_MODE, "preview");
  assert.equal(wrangler.vars.MED250_BACKEND_MODE, "worker-d1");
  assert.equal(wrangler.env.staging, undefined);
  assert.equal(wrangler.env.production.name, "med250-marketplace-gikundiro");
  assert.equal(wrangler.env.production.workers_dev, false);
  assert.equal(wrangler.env.production.preview_urls, false);
  assert.equal(wrangler.env.production.vars.MED250_RELEASE_MODE, "live");
  assert.equal(wrangler.env.production.vars.MED250_BACKEND_MODE, "worker-d1");
  assert.equal(wrangler.env.production.vars.MED250_ADMIN_WHATSAPP, "250795588248");
  assert.equal(wrangler.env.production.vars.NEXT_PUBLIC_MED250_DEPLOYMENT_MODE, "live");
  assert.equal(wrangler.env.production.vars.NEXT_PUBLIC_MED250_INDEXING_MODE, "public");
  assert.equal(wrangler.env.production.vars.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN, "https://med-250.com");
  assert.equal(wrangler.env.production.vars.NEXT_PUBLIC_MARKETPLACE_MODE, "live");
  assert.equal(wrangler.env.production.vars.NEXT_PUBLIC_SITE_URL, "https://med-250.com");
  assert.equal(wrangler.env.production.vars.NEXT_PUBLIC_MED250_OBSERVABILITY, "cloud");
  assert.deepEqual(wrangler.env.production.routes.map((route) => route.pattern), [
    "med-250.com",
  ]);
  assert.doesNotMatch(JSON.stringify(wrangler.env.production.routes), /med250\.gikundiro\.com/);
  assert.match(packageJson.scripts["build:production"], /CLOUDFLARE_ENV=production/);
  assert.equal(packageJson.scripts["build:staging"], undefined);
  assert.equal(packageJson.scripts["deploy:staging"], undefined);
  assert.doesNotMatch(packageJson.scripts["build:production"], /SUPABASE|NEON/i);
  assert.match(packageJson.scripts["build:production"], /NEXT_PUBLIC_MED250_AUTH_BACKEND=worker-d1/);
  assert.match(packageJson.scripts["build:sites"], /NEXT_PUBLIC_MED250_DEPLOYMENT_MODE=catalog/);
  assert.match(packageJson.scripts["build:sites"], /NEXT_PUBLIC_MARKETPLACE_MODE=catalog/);
  assert.match(packageJson.scripts["build:sites"], /NEXT_PUBLIC_SITE_URL=https:\/\/med250-rwanda\.ikanisa\.chatgpt\.site/);
  assert.match(packageJson.scripts["sites:verify:catalog"], /--mode catalog/);
  assert.match(packageJson.scripts["domain:evidence:refresh"], /refresh-domain-launch-evidence\.mjs/);
  assert.match(packageJson.scripts["test:sites:catalog"], /npm run build:sites/);
  assert.match(packageJson.scripts["test:sites:catalog"], /NEXT_PUBLIC_MARKETPLACE_MODE=catalog/);
  assert.match(packageJson.scripts["release:check:deployment"], /npm run test:preview/);
  assert.match(packageJson.scripts["cloudflare:check:worker-d1"], /npm run test:production/);
  assert.match(packageJson.scripts["release:check:live"], /npm run launch:go-live:status/);
  assert.match(packageJson.scripts["release:check:live"], /npm run release:check:deployment/);
  assert.match(packageJson.scripts["release:check:deployment"], /cloudflare:check:worker-d1/);
  assert.match(packageJson.scripts["deploy:live"], /^npm run release:check:deployment/);
  assert.match(packageJson.scripts["deploy:live"], /wrangler deploy --config dist\/server\/wrangler[.]worker-d1[.]production[.]json --strict/);
  assert.doesNotMatch(packageJson.scripts["deploy:live"], /--keep-vars/);
  assert.match(packageJson.scripts["cloudflare:check:production"], /wrangler deploy --env production --dry-run --strict/);
  assert.equal(packageJson.scripts["cloudflare:prepare:gikundiro"], "npm run cloudflare:prepare:worker-d1");
  assert.equal(packageJson.scripts["cloudflare:check:gikundiro"], "npm run cloudflare:check:worker-d1");
  assert.equal(packageJson.scripts["deploy:gikundiro"], "npm run deploy:live");
  assert.match(quality, /npm run release:check/);
  assert.match(deployment, /workflow_dispatch:/);
  assert.doesNotMatch(deployment, /\n\s+push:/);
  assert.match(deployment, /environment: med250-production/);
  assert.match(deployment, /DEPLOY MED250 LIVE/);
  assert.doesNotMatch(deployment, /npm run uat:verify:live/);
  assert.match(deployment, /Validate production deployment configuration[\s\S]*npm run release:preflight:live/);
  assert.match(deployment, /Run Worker-D1 production release checks[\s\S]*npm run cloudflare:typecheck[\s\S]*npm run cloudflare:check:worker-d1/);
  assert.doesNotMatch(deployment.slice(deployment.indexOf("\n  production:")), /SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|MED250_ADMIN_TOKEN/);
  assert.doesNotMatch(deployment, /MED250_GATE_/);
  assert.doesNotMatch(deployment, /staging|MED250_GATE_WORKER_D1_STAGING_PASSED/);
  assert.match(deployment, /Report operational activation readiness[\s\S]*continue-on-error: true[\s\S]*launch:go-live:status/);
  assert.match(deployment, /cloudflare\/wrangler-action@[0-9a-f]{40}/);
  assert.match(deployment, /command: deploy --config dist\/server\/wrangler[.]worker-d1[.]production[.]json --strict/);
  assert.doesNotMatch(deployment, /--keep-vars/);
  assert.doesNotMatch(deployment, /catalogue:verify:live|backend:verify|monitor-operational-health/);
  assert.match(deployment, /ops:health:worker-d1/);
  assert.match(deployment, /deployment:verify[\s\S]*--mode live --expected-revision "\$\{\{ github\.sha \}\}"/);
});

test("prepares an immutable Worker-D1 live config from the generated vinext artifact", async () => {
  const source = await readFile(new URL("../scripts/prepare-worker-d1-config.mjs", import.meta.url), "utf8");
  assert.match(source, /const name = "med250-marketplace-gikundiro"/);
  assert.match(source, /workers_dev: false/);
  assert.match(source, /preview_urls: false/);
  assert.match(source, /routes: \[\{ pattern: "med-250\.com", custom_domain: true \}\]/);
  assert.match(source, /MED250_BACKEND_MODE: "worker-d1"/);
  assert.match(source, /d1_databases/);
  assert.match(source, /migrations_dir: "\.\.\/\.\.\/db\/d1\/migrations"/);
  assert.match(source, /PRIVATE_MEDIA/);
  assert.match(source, /med250-whatsapp-dispatch-/);
  assert.match(source, /requiredWorkerSecretNames/);
  assert.doesNotMatch(source, /supabase\.co|neon/i);
});
