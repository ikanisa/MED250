import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function edgeBundleSha256(files) {
  const digest = createHash("sha256");
  for (const [path, source] of files) {
    digest.update(path);
    digest.update("\0");
    digest.update(source);
    digest.update("\0");
  }
  return digest.digest("hex");
}

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
  assert.match(marketplace, /const serverCatalogueActive = backendConfigured\s+&& serverCatalogueAvailable\s+&& serverCatalogueDemanded\s+&& !initialProductId/);
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
  assert.match(verifyOtp, /dawanear_bind_pharmacy_identity/);
  assert.match(verifyOtp, /pharmacies\.length !== 1/);
  assert.doesNotMatch(verifyOtp, /\.from\("dawanear_pharmacy_memberships"\)/);
  assert.doesNotMatch(verifyOtp, /\.upsert\([\s\S]*dawanear_pharmacy_memberships/);
  assert.match(sharedAuth, /https:\/\/med-250\.com/);
  assert.doesNotMatch(sharedAuth, /https:\/\/med250\.gikundiro\.com/);
  assert.doesNotMatch(sharedAuth, /https:\/\/med250-rwanda\.ikanisa\.chatgpt\.site/);
  assert.doesNotMatch(sharedAuth, /user-agent/);
  assert.match(geocoder, /dawanear_approve_geocode_candidate/);
});

test("binds the owner-ready Edge deployment packet to the complete canonical-origin bundle", async () => {
  const entrypointPath = "supabase/functions/dawanear-pharmacy-verify-otp/index.ts";
  const sharedPath = "supabase/functions/_shared/dawanear-pharmacy-auth.ts";
  const [entrypoint, shared, packetSource, snapshotSource] = await Promise.all([
    read(`../${entrypointPath}`),
    read(`../${sharedPath}`),
    read("../docs/launch/evidence/edge-functions-deployment-pending-2026-07-24.json"),
    read("../desktop-output/goal-progress-2026-07-24/supabase-deployment-gap-2026-07-24.json"),
  ]);
  const packet = JSON.parse(packetSource);
  const snapshot = JSON.parse(snapshotSource);
  const entrypointDigest = sha256(entrypoint);
  const sharedDigest = sha256(shared);
  const bundleDigest = edgeBundleSha256([
    [entrypointPath, entrypoint],
    [sharedPath, shared],
  ]);
  const candidateDetail = packet.checks.find((check) => check.name === "Candidate function digest")?.detail ?? "";

  assert.match(candidateDetail, new RegExp(entrypointDigest));
  assert.match(candidateDetail, new RegExp(sharedDigest));
  assert.match(candidateDetail, new RegExp(bundleDigest));
  assert.equal(snapshot.edge_function_gap.candidate_entrypoint_sha256, entrypointDigest);
  assert.equal(snapshot.edge_function_gap.candidate_shared_auth_sha256, sharedDigest);
  assert.equal(snapshot.edge_function_gap.candidate_bundle_sha256, bundleDigest);
  assert.match(shared, /https:\/\/med-250\.com/);
  assert.doesNotMatch(shared, /med250\.gikundiro\.com|med250-rwanda\.ikanisa\.chatgpt\.site/);
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
  assert.doesNotMatch(workflow.split("steps:")[0], /SUPABASE_SECRET_KEY/);
  assert.ok(
    workflow.indexOf("Validate production attestations and governed sources")
      < workflow.indexOf("Verify privileged production backend"),
    "production attestations must pass before the workflow receives a Supabase secret",
  );
  assert.ok(
    workflow.indexOf("data:source-authority:verify:strict")
      < workflow.indexOf("Verify privileged production backend"),
    "source authority must pass before the workflow receives a Supabase secret",
  );
  assert.match(workflow, /MED250_GATE_SECURITY_HARDENING_DEPLOYED/);
  assert.match(workflow, /MED250_GATE_EDGE_FUNCTIONS_DEPLOYED/);
  assert.match(workflow, /MED250_GATE_PRESCRIPTION_RETENTION_APPROVED/);
  assert.match(workflow, /MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED/);
  assert.match(workflow, /MED250_GATE_DOMAIN_DNS_VERIFIED/);
  assert.match(workflow, /audit:browser-evidence:verify:live/);
  assert.match(workflow, /localization:verify/);
  assert.match(workflow, /test:sites:catalog/);
  assert.match(worker, /uskfnszcdqpcfrhjxitl\.supabase\.co/);
  assert.doesNotMatch(worker, /\*\.supabase\.co/);
  assert.match(wrangler, /"compatibility_flags": \["nodejs_compat"\]/);
  assert.doesNotMatch(vite, /compatibility_flags/);
});
