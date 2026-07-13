import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`https://med250.rw${pathname}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the MED+250 marketplace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>MED\+250/);
  assert.match(html, /One request/);
  assert.match(html, /Frequently requested today/);
  assert.match(html, /All Categories/);
  assert.doesNotMatch(html, /Check licensed pharmacy records/);
  assert.doesNotMatch(html, /Connected private preview/);
  assert.doesNotMatch(html, /marketplace—not a simple pharmacy website/);
  assert.doesNotMatch(html, /class="eyebrow"/);
  assert.match(html, /Pharmacy portal/);
  assert.match(html, /og:image/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("server-renders every dedicated marketplace route", async () => {
  const routes = [
    ["/categories", /All pharmacy categories/],
    ["/category/medicines", /Search by brand, generic name, symptom/],
    ["/category/personal-care", /Browse everyday hygiene, oral care, skin care/],
    ["/category/baby-family", /infant, child, and family care products/],
    ["/category/wellness", /monitoring devices, and wellness products/],
    ["/pharmacies", /One pharmacy portal for nearby marketplace demand/],
  ];
  for (const [pathname, expected] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(await response.text(), expected, pathname);
  }
});

test("keeps the launch candidate honest, connected, and free of simulated fulfilment", async () => {
  const [page, marketplace, client, migration, layout, css, packageJson, pharmacyCsv, geocoder, cleanup, productReview] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260712130000_dawanear_marketplace.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/rwanda-fda-pharmacies-may-2026.csv", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/geocode-pharmacies/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/cleanup-prescriptions/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/import-data/apply-product-orderability-review.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<Marketplace \/>/);
  assert.match(client, /signInAnonymously/);
  assert.match(client, /dawanear_create_order/);
  assert.match(client, /p_client_request_id/);
  assert.match(client, /packSize/);
  assert.match(client, /dawanear_close_order/);
  assert.match(client, /dawanear-prescriptions/);
  assert.match(client, /postgres_changes/);
  assert.match(client, /dawanear_my_active_orders/);
  assert.match(client, /dawanear_pharmacy_selected_orders/);
  assert.match(client, /dawanear_pharmacy_notifications/);
  assert.match(client, /deletePrescription/);
  assert.match(client, /signOutPharmacy/);
  assert.match(client, /prescription_access_seconds_remaining/);
  assert.match(client, /Math\.min\(10 \* 60, remainingSeconds\)/);
  assert.match(marketplace, /navigator\.geolocation/);
  assert.match(marketplace, /pharmacySupabase/);
  assert.match(marketplace, /wa\.me/);
  assert.match(marketplace, /NEXT_PUBLIC_MARKETPLACE_MODE/);
  assert.match(marketplace, /recipientCount/);
  assert.match(marketplace, /pendingOrderAttempt/);
  assert.match(marketplace, /Retry the same secure request/);
  assert.match(marketplace, /if \(!locationConsent\)/);
  assert.match(marketplace, /pendingOrderAttempt\?\.rpcAttempted/);
  assert.match(marketplace, /isCompatibleSubstitute/);
  assert.match(marketplace, /normalizedSubstitutionField\(product\.packSize\)/);
  assert.match(marketplace, /Mark completed and start another/);
  assert.match(marketplace, /Promise\.allSettled/);
  assert.match(marketplace, /Selected pharmacy contact unavailable/);
  assert.doesNotMatch(marketplace, /const quotes|Vine Pharmacy|setTimeout\(\(\) => \{ setOrdering/);
  assert.doesNotMatch(marketplace, /pack-box|pill-one|Google Maps candidate/);
  assert.doesNotMatch(marketplace, /Beauty & wellness/);
  assert.match(marketplace, /disabled=\{!offer\.complete \|\| selectionLocked\}/);
  assert.match(marketplace, /Sign out of pharmacy portal/);
  assert.match(migration, /dawanear_create_order/);
  assert.match(migration, /p_client_request_id/);
  assert.match(migration, /dawanear_close_order/);
  assert.match(migration, /dawanear_submit_offer/);
  assert.match(migration, /dawanear_contribute_price/);
  assert.match(migration, /dawanear_my_active_orders/);
  assert.match(migration, /dawanear_pharmacy_selected_orders/);
  assert.match(migration, /dawanear_pharmacy_notifications/);
  assert.match(migration, /bool_or\(p\.prescription_status = 'prescription'\)/);
  assert.match(migration, /ceil\(r\.distance_m \/ 500\.0\) \* 500\.0/);
  assert.match(migration, /dawanear_prescriptions_owner_delete/);
  assert.match(migration, /client_request_id uuid not null/);
  assert.match(migration, /dawanear_orders_one_active_per_user_uidx/);
  assert.match(migration, /dawanear_expire_timed_out_selected_orders/);
  assert.match(migration, /dawanear_maintenance_state/);
  assert.match(migration, /dawanear_prescription_cleanup_claims/);
  assert.match(migration, /dawanear_claim_prescription_cleanup/);
  assert.match(migration, /dawanear_claim_orphan_prescription_cleanup/);
  assert.match(migration, /dawanear_recover_expired_prescription_cleanup_claims/);
  assert.match(migration, /dawanear_finalize_prescription_cleanup/);
  assert.match(migration, /prescription_access_seconds_remaining/);
  assert.match(migration, /requested_product\.pack_size/);
  assert.match(migration, /selected_at > now\(\) - interval '24 hours'/);
  assert.match(layout, /MED\+250/);
  assert.match(layout, /og\.png/);
  assert.match(css, /@media \(max-width:760px\)/);
  assert.doesNotMatch(pharmacyCsv.split("\n", 1)[0], /google_|phone|whatsapp/i);
  assert.match(geocoder, /dawanear_pharmacies/);
  assert.doesNotMatch(geocoder, /marketplace_pharmacies|app_metadata|user_metadata/);
  assert.match(cleanup, /DAWANEAR_CRON_TOKEN/);
  assert.match(cleanup, /dawanear-prescriptions/);
  assert.match(cleanup, /offset,/);
  assert.match(cleanup, /orphan_scan_complete/);
  assert.match(cleanup, /selected_access_hours: 24/);
  assert.match(cleanup, /folder_cursor/);
  assert.match(cleanup, /perFolderLimit/);
  assert.match(cleanup, /dawanear_claim_prescription_cleanup/);
  assert.match(cleanup, /dawanear_claim_orphan_prescription_cleanup/);
  assert.match(cleanup, /dawanear_recover_expired_prescription_cleanup_claims/);
  assert.match(cleanup, /dawanear_finalize_prescription_cleanup/);
  assert.match(productReview, /SUPABASE_SECRET_KEY/);
  assert.match(productReview, /pharmacist_only/);
  assert.match(productReview, /\.update\(\{[\s\S]*prescription_status:[\s\S]*is_orderable:/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../data/imports/pharmacies-map-matched.csv", import.meta.url)));
  await assert.rejects(access(new URL("../data/imports/pharmacies-map-review.csv", import.meta.url)));
});

test("isolates anonymous customer auth from permanent pharmacy auth", async () => {
  const [supabaseModule, client] = await Promise.all([
    readFile(new URL("../lib/supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(supabaseModule, /storageKey: "dawanear-customer-auth"/);
  assert.match(supabaseModule, /customerSupabase[\s\S]*detectSessionInUrl: false/);
  assert.match(supabaseModule, /storageKey: "dawanear-pharmacy-auth"/);
  assert.match(supabaseModule, /pharmacySupabase[\s\S]*persistSession: true[\s\S]*autoRefreshToken: true[\s\S]*detectSessionInUrl: false/);
  assert.doesNotMatch(supabaseModule, /export const supabase\s*=/);
  assert.match(client, /backendConfigured = customerSupabase !== null && pharmacySupabase !== null/);

  const customerSessionSection = client.slice(
    client.indexOf("export async function ensureAnonymousCustomer"),
    client.indexOf("export async function requestPharmacyWhatsappOtp"),
  );
  const pharmacySessionSection = client.slice(client.indexOf("export async function requestPharmacyWhatsappOtp"));
  assert.match(customerSessionSection, /requireCustomerBackend/);
  assert.doesNotMatch(customerSessionSection, /requirePharmacyBackend/);
  assert.match(pharmacySessionSection, /requirePharmacyBackend/);
  assert.doesNotMatch(client, /customerSupabase[\s\S]{0,80}signOut/);
  const pharmacySignOutSection = client.slice(
    client.indexOf("export async function signOutPharmacy"),
    client.indexOf("export async function verifyPharmacyWhatsappOtp"),
  );
  assert.match(pharmacySignOutSection, /requirePharmacyBackend/);
  assert.match(pharmacySignOutSection, /signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(pharmacySignOutSection, /requireCustomerBackend|customerSupabase/);
  assert.match(pharmacySessionSection, /dawanear-pharmacy-send-otp/);
  assert.match(pharmacySessionSection, /dawanear-pharmacy-verify-otp/);
  assert.match(pharmacySessionSection, /auth\.setSession/);
  assert.doesNotMatch(pharmacySessionSection, /signInWithOtp|verifyOtp/);
});

test("uses WhatsApp Cloud OTP only for pharmacy portal access", async () => {
  const [marketplace, migration, sendOtp, verifyOtp, shared] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713084601_pharmacy_whatsapp_otp_auth.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/dawanear-pharmacy-send-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/dawanear-pharmacy-verify-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/_shared/dawanear-pharmacy-auth.ts", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /Send code on WhatsApp/);
  assert.match(marketplace, /Sign in with registered WhatsApp number/);
  assert.match(marketplace, /Enter your WhatsApp code/);
  assert.match(marketplace, /autoComplete="one-time-code"/);
  assert.doesNotMatch(marketplace, /Email me a sign-in link|Email address|Already signed in but not linked|Submit a claim/);
  assert.doesNotMatch(marketplace, /Customers use anonymous sessions; pharmacy staff use a permanent email identity/);
  assert.match(migration, /dawanear_pharmacy_otp_challenges/);
  assert.match(migration, /code_hash/);
  assert.match(migration, /for update/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(sendOtp, /enforceOtpRateLimits/);
  assert.match(sendOtp, /eligiblePharmacies/);
  assert.match(sendOtp, /sendWhatsappOtp/);
  assert.match(verifyOtp, /dawanear_consume_pharmacy_otp/);
  assert.match(verifyOtp, /whatsapp_cloud_otp/);
  assert.match(verifyOtp, /signInWithPassword/);
  assert.match(shared, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(shared, /WHATSAPP_TEMPLATE_NAME/);
  assert.match(shared, /WHATSAPP_TEMPLATE_URL_BUTTON_INDEX/);
  assert.match(shared, /crypto\.getRandomValues/);
  assert.doesNotMatch(sendOtp, /console\.log\([^\n]*code/);
});

test("coordinates cleanup for every order sharing one prescription path", async () => {
  const [migration, cleanup] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260712130000_dawanear_marketplace.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/cleanup-prescriptions/index.ts", import.meta.url), "utf8"),
  ]);

  const createOrder = migration.slice(
    migration.indexOf("create function public.dawanear_create_order"),
    migration.indexOf("drop function if exists public.dawanear_pharmacy_requests"),
  );
  const pathLock = createOrder.indexOf("'dawanear-prescription:' || p_prescription_path");
  const staleOrderLock = createOrder.indexOf("select stale_order.id");
  const storageOwnershipCheck = createOrder.indexOf("from storage.objects as so");
  assert.ok(pathLock >= 0 && staleOrderLock > pathLock && storageOwnershipCheck > staleOrderLock,
    "order creation must lock the path before stale-order rows and Storage validation");
  assert.match(createOrder, /dawanear_prescription_cleanup_claims/);

  const eligibility = migration.slice(
    migration.indexOf("create or replace function dawanear_private.dawanear_prescription_reference_is_cleanup_eligible"),
    migration.indexOf("create or replace function dawanear_private.dawanear_guard_prescription_cleanup_claim"),
  );
  assert.match(eligibility, /p_status = 'expired'[\s\S]*p_selected_at <= now\(\) - interval '24 hours'/);
  assert.match(eligibility, /p_status in \('draft', 'broadcast', 'offers_received', 'cancelled', 'expired'\)[\s\S]*p_expires_at < now\(\) - interval '24 hours'/);
  assert.match(eligibility, /p_status = 'completed'[\s\S]*p_updated_at < now\(\) - interval '30 days'/);
  assert.doesNotMatch(eligibility, /p_status in \([^)]*'selected'/);

  const claimRpc = migration.slice(
    migration.indexOf("create function public.dawanear_claim_prescription_cleanup"),
    migration.indexOf("drop function if exists public.dawanear_claim_orphan_prescription_cleanup"),
  );
  assert.match(claimRpc, /pg_advisory_xact_lock/);
  assert.match(claimRpc, /foreach v_path in array v_paths[\s\S]*pg_advisory_xact_lock[\s\S]*end loop;[\s\S]*foreach v_path in array v_paths[\s\S]*from public\.dawanear_orders as o/);
  assert.match(claimRpc, /where o\.prescription_path = v_path[\s\S]*for update/);
  assert.match(claimRpc, /having pg_catalog\.bool_and\([\s\S]*dawanear_prescription_reference_is_cleanup_eligible/);
  assert.match(claimRpc, /not exists \([\s\S]*dawanear_prescription_cleanup_claims[\s\S]*c\.prescription_path = o\.prescription_path/);
  assert.match(claimRpc, /storage\.objects[\s\S]*so\.created_at >= now\(\) - interval '24 hours'/);
  assert.match(claimRpc, /and not dawanear_private\.dawanear_prescription_reference_is_cleanup_eligible/);
  assert.match(claimRpc, /lease_expires_at[\s\S]*interval '15 minutes'/);

  const orphanClaimRpc = migration.slice(
    migration.indexOf("create function public.dawanear_claim_orphan_prescription_cleanup"),
    migration.indexOf("drop function if exists public.dawanear_recover_expired_prescription_cleanup_claims"),
  );
  assert.match(orphanClaimRpc, /foreach v_path in array v_paths[\s\S]*pg_advisory_xact_lock[\s\S]*end loop;[\s\S]*foreach v_path in array v_paths[\s\S]*from public\.dawanear_orders as o/);
  assert.match(orphanClaimRpc, /if found then[\s\S]*continue/);
  assert.match(orphanClaimRpc, /from storage\.objects as so[\s\S]*so\.created_at < now\(\) - interval '24 hours'/);
  assert.match(orphanClaimRpc, /select distinct candidate\.path as path/);
  assert.doesNotMatch(orphanClaimRpc, /btrim\(candidate\.path\) as path/);
  assert.match(migration, /grant execute on function public\.dawanear_claim_orphan_prescription_cleanup\(text\[\], integer\)[\s\S]*to service_role/);

  const recoveryRpc = migration.slice(
    migration.indexOf("create function public.dawanear_recover_expired_prescription_cleanup_claims"),
    migration.indexOf("drop function if exists public.dawanear_finalize_prescription_cleanup"),
  );
  assert.match(recoveryRpc, /from dawanear_private\.dawanear_prescription_cleanup_claims as c[\s\S]*c\.lease_expires_at <= now\(\)/);
  assert.match(recoveryRpc, /foreach v_path in array v_paths[\s\S]*pg_advisory_xact_lock[\s\S]*for update/);
  assert.match(recoveryRpc, /v_reference_count = 0 and not v_object_exists[\s\S]*delete from dawanear_private\.dawanear_prescription_cleanup_claims/);
  assert.match(recoveryRpc, /set claim_token = v_token,[\s\S]*lease_expires_at = now\(\) \+ interval '15 minutes'/);

  const finalizeRpc = migration.slice(
    migration.indexOf("create function public.dawanear_finalize_prescription_cleanup"),
    migration.indexOf("drop function if exists public.dawanear_my_active_orders"),
  );
  assert.match(finalizeRpc, /c\.claim_token = p_claim_token[\s\S]*for update/);
  assert.match(finalizeRpc, /and not dawanear_private\.dawanear_prescription_reference_is_cleanup_eligible/);
  assert.match(finalizeRpc, /update public\.dawanear_orders as o[\s\S]*set prescription_path = null[\s\S]*where o\.prescription_path = p_prescription_path/);
  assert.match(migration, /create trigger dawanear_orders_guard_prescription_cleanup/);
  assert.match(migration, /grant execute on function public\.dawanear_claim_prescription_cleanup\(integer\)[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.dawanear_recover_expired_prescription_cleanup_claims\(integer\)[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.dawanear_finalize_prescription_cleanup\(text, uuid\)[\s\S]*to service_role/);

  const storageInsertGuard = migration.slice(
    migration.indexOf("create or replace function dawanear_private.dawanear_customer_can_insert_prescription"),
    migration.indexOf("create or replace function dawanear_private.dawanear_customer_can_delete_prescription"),
  );
  assert.match(storageInsertGuard, /pg_advisory_xact_lock/);
  assert.match(storageInsertGuard, /dawanear_prescription_cleanup_claims/);
  assert.match(storageInsertGuard, /not exists \([\s\S]*from public\.dawanear_orders/);
  const storageDeleteGuard = migration.slice(
    migration.indexOf("create or replace function dawanear_private.dawanear_customer_can_delete_prescription"),
    migration.indexOf("drop policy if exists dawanear_prescriptions_owner_insert"),
  );
  assert.match(storageDeleteGuard, /language plpgsql[\s\S]*volatile[\s\S]*pg_advisory_xact_lock/);
  assert.match(storageDeleteGuard, /if exists \([\s\S]*dawanear_prescription_cleanup_claims[\s\S]*return false/);
  assert.match(migration, /create policy dawanear_prescriptions_owner_insert[\s\S]*dawanear_customer_can_insert_prescription\(name\)/);
  assert.match(migration, /create policy dawanear_prescriptions_owner_delete[\s\S]*dawanear_customer_can_delete_prescription\(name\)/);
  assert.match(migration, /create policy dawanear_prescriptions_authenticated_insert_guard[\s\S]*as restrictive for insert[\s\S]*dawanear_customer_can_insert_prescription\(name\)/);
  assert.match(migration, /create policy dawanear_prescriptions_authenticated_delete_guard[\s\S]*as restrictive for delete[\s\S]*dawanear_customer_can_delete_prescription\(name\)/);
  assert.match(migration, /create policy dawanear_prescriptions_no_client_update[\s\S]*as restrictive for update[\s\S]*bucket_id <> 'dawanear-prescriptions'/);
  assert.match(migration, /create policy dawanear_prescriptions_anon_select_guard[\s\S]*as restrictive for select[\s\S]*bucket_id <> 'dawanear-prescriptions'/);
  assert.match(migration, /create policy dawanear_prescriptions_authenticated_select_guard[\s\S]*as restrictive for select[\s\S]*dawanear_selected_pharmacy_can_read\(name\)/);

  const recoveryCall = cleanup.indexOf('"dawanear_recover_expired_prescription_cleanup_claims"');
  const claimCall = cleanup.indexOf('"dawanear_claim_prescription_cleanup"');
  const storageDelete = cleanup.indexOf(".remove([claim.prescription_path])");
  const finalizeCall = cleanup.indexOf('"dawanear_finalize_prescription_cleanup"');
  assert.ok(recoveryCall >= 0 && claimCall > recoveryCall && storageDelete > claimCall && finalizeCall > storageDelete,
    "the Edge Function must recover leases, claim due paths, delete through Storage, then finalize");
  assert.doesNotMatch(cleanup, /\.from\("dawanear_orders"\)\s*\.update\(\{ prescription_path: null \}\)/);
  assert.doesNotMatch(cleanup, /timedOutRetryResponse|abandonedResponse|completedResponse/);
  assert.doesNotMatch(cleanup, /remainingLimit/);
  assert.match(cleanup, /const recoveryLimit = Math\.max\(1, Math\.floor\(batchLimit \/ 2\)\)/);
  assert.match(cleanup, /const dueLimit = Math\.max\(1, batchLimit - recoveryLimit\)/);
  const orphanClaimCall = cleanup.indexOf('"dawanear_claim_orphan_prescription_cleanup"');
  const orphanStorageDelete = cleanup.indexOf("bucket.remove([claim.prescription_path])", orphanClaimCall);
  const orphanFinalizeCall = cleanup.indexOf('"dawanear_finalize_prescription_cleanup"', orphanStorageDelete);
  assert.ok(orphanClaimCall >= 0 && orphanStorageDelete > orphanClaimCall && orphanFinalizeCall > orphanStorageDelete,
    "orphan cleanup must claim before Storage deletion and finalize afterward");
  assert.doesNotMatch(cleanup, /bucket\.remove\(orphanPaths\)/);
  assert.match(cleanup, /recovered_claims: recoveredClaims\.length/);
  assert.match(cleanup, /due_claims: dueClaims\.length/);
  assert.match(cleanup, /claimed_paths: cleanupClaims\.length/);
  assert.match(cleanup, /recovery_limit: recoveryLimit/);
  assert.match(cleanup, /due_limit: dueLimit/);
  assert.match(cleanup, /references_cleared/);
});
