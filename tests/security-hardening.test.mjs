import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("keeps catalogue values inside JSON-LD script data", async () => {
  const [helper, productPage, layout, parser] = await Promise.all([
    read("../lib/safe-json-ld.ts"),
    read("../app/product/[id]/page.tsx"),
    read("../app/layout.tsx"),
    read("../scripts/import-data/parse-rwanda-fda.mjs"),
  ]);

  assert.match(helper, /JSON\.stringify\(value\)\.replace\(\/<\/g, "\\\\u003c"\)/);
  assert.match(productPage, /safeJsonLd\(productSchema\)/);
  assert.match(productPage, /safeJsonLd\(breadcrumbs\)/);
  assert.match(layout, /safeJsonLd\(websiteSchema\)/);
  assert.ok(parser.indexOf("const decoded = value.replace") < parser.indexOf("decoded.replace(/<[^>]*>/g"));
  assert.match(parser, /replace\(\/\[<>\]\/g, " "\)/);
});

test("bounds public request work before expensive processing", async () => {
  const [telemetry, search, marketplace, cleanup, client] = await Promise.all([
    read("../app/api/telemetry/route.ts"),
    read("../lib/catalogue-search.ts"),
    read("../app/marketplace.tsx"),
    read("../supabase/functions/cleanup-prescriptions/index.ts"),
    read("../lib/dawanear-client.ts"),
  ]);

  assert.match(telemetry, /request\.body\.getReader\(\)/);
  assert.match(telemetry, /received > MAX_BODY_BYTES/);
  assert.doesNotMatch(telemetry, /request\.text\(\)/);
  assert.match(search, /MAX_CATALOGUE_QUERY_LENGTH = 160/);
  assert.match(marketplace, /maxLength=\{MAX_CATALOGUE_QUERY_LENGTH\}/);
  assert.match(cleanup, /maxEnumerationPages/);
  assert.match(cleanup, /orphan_page_budget_exhausted/);
  assert.match(client, /String\.fromCharCode\(\.\.\.header\.slice\(0, 5\)\) === "%PDF-"/);
  assert.match(client, /file content does not match its PDF or image type/);
});

test("normalises multilingual catalogue queries before the live RPC", async () => {
  const [client, marketplace] = await Promise.all([
    read("../lib/dawanear-client.ts"),
    read("../app/marketplace.tsx"),
  ]);

  assert.match(client, /normalizeCatalogueText\(rawQuery\)/);
  assert.match(client, /rawQuery\.length > 160/);
  assert.match(marketplace, /const serverCatalogueActive = catalogueBackendConfigured && serverCatalogueAvailable && !initialProductId/);
});

test("enforces pharmacy identity and order lifecycle invariants in the database", async () => {
  const [migration, sendOtp, verifyOtp, sharedAuth, geocoder] = await Promise.all([
    read("../supabase/migrations/20260715180529_med250_security_hardening_20260714.sql"),
    read("../supabase/functions/dawanear-pharmacy-send-otp/index.ts"),
    read("../supabase/functions/dawanear-pharmacy-verify-otp/index.ts"),
    read("../supabase/functions/_shared/dawanear-pharmacy-auth.ts"),
    read("../supabase/functions/geocode-pharmacies/index.ts"),
  ]);

  assert.match(migration, /dawanear_issue_pharmacy_otp/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /dawanear_contacts_retire_authority/);
  assert.match(migration, /status = 'suspended'/);
  assert.match(migration, /dawanear_require_current_offered_product/);
  assert.match(migration, /dawanear_revalidate_selected_offer_products/);
  assert.match(migration, /dawanear_enforce_order_rolling_quota/);
  assert.match(migration, /jsonb_path_query_array[\s\S]*@\.complete == true/);
  assert.match(migration, /candidate\.verification_status in \('source_verified', 'admin_verified'\)/);
  assert.match(migration, /v_pharmacy\.updated_at is distinct from p_expected_updated_at/);
  assert.match(sendOtp, /dawanear_issue_pharmacy_otp/);
  assert.doesNotMatch(sendOtp, /enforceOtpRateLimits/);
  assert.match(verifyOtp, /membership\.status !== "active"/);
  assert.doesNotMatch(verifyOtp, /\.upsert\([\s\S]*dawanear_pharmacy_memberships/);
  assert.doesNotMatch(sharedAuth, /user-agent/);
  assert.match(geocoder, /dawanear_approve_geocode_candidate/);
});

test("binds contact imports and production automation to reviewed artifacts", async () => {
  const [emitter, extractor, workflow, worker, wrangler, vite] = await Promise.all([
    read("../scripts/import-data/emit-rwanda-fda-pharmacy-contact-sql.mjs"),
    read("../scripts/import-data/extract-rwanda-fda-duty-rosters.py"),
    read("../.github/workflows/deploy-cloudflare.yml"),
    read("../worker/index.ts"),
    read("../wrangler.jsonc"),
    read("../vite.config.ts"),
  ]);

  assert.match(emitter, /matched_contacts_sha256/);
  assert.match(emitter, /roster_sources/);
  assert.match(emitter, /verification_status not in \('rejected', 'stale'\)/);
  assert.match(extractor, /sha256_file/);
  assert.doesNotMatch(workflow, /uses:\s+[^\n]+@v\d+/);
  const productionWorkflow = workflow.slice(workflow.indexOf("\n  production:"));
  assert.doesNotMatch(productionWorkflow, /SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY/);
  assert.ok(
    workflow.indexOf("Validate production deployment configuration")
      < workflow.indexOf("Run Worker-D1 production release checks"),
    "production configuration must pass before Worker-D1 packaging checks",
  );
  assert.doesNotMatch(workflow, /MED250_GATE_/);
  assert.doesNotMatch(workflow, /staging|MED250_GATE_WORKER_D1_STAGING_PASSED/);
  assert.match(workflow, /Report operational activation readiness/);
  assert.match(workflow, /continue-on-error: true/);
  assert.doesNotMatch(worker, /supabase\.co|legacy-supabase|neon\.tech/i);
  assert.match(worker, /connect-src 'self' https:\/\/maps\.googleapis\.com https:\/\/maps\.gstatic\.com/);
  assert.match(wrangler, /"compatibility_flags": \["nodejs_compat"\]/);
  assert.doesNotMatch(vite, /compatibility_flags/);
});
