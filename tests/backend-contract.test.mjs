import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assessBackendContract,
  expectedBackendContractVersion,
} from "../scripts/backend-contract-invariants.mjs";

function validContract() {
  return {
    contract_version: expectedBackendContractVersion,
    privacy: { aggregate_only: true, contains_row_identifiers: false, contains_object_names: false },
    catalogue_search: {
      exists: true,
      security_invoker: true,
      stable: true,
      search_path_locked: true,
      anon_can_execute: true,
      authenticated_can_execute: true,
    },
    marketplace_catalogue: {
      table_exists: true,
      rls_enabled: true,
      product_count: 2200,
      distinct_ids: 2200,
      distinct_asins: 2200,
      taxonomy_pair_count: 25,
      minimum_taxonomy_pair_count: 50,
      minimum_required_per_pair: 50,
      candidate_count: 2405,
      rejected_candidate_count: 205,
      unsafe_publication_count: 0,
      unsafe_projection_count: 0,
      public_policy_exists: true,
      public_table_select_expected: true,
      view_exists: true,
      view_security_invoker: true,
      search_exists: true,
      search_security_invoker: true,
      search_stable: true,
      search_path_locked: true,
      anon_can_search: true,
      authenticated_can_search: true,
      approval_projection_exists: true,
    },
    marketplace_moderation: {
      review_table_exists: true,
      review_table_rls: true,
      immutable_audit_trigger: true,
      publication_audit_constraint_trigger: true,
      approved_without_review_metadata_count: 0,
      approved_without_audit_count: 0,
      rejected_without_audit_count: 0,
      audit_reconciliation_complete: true,
      product_seller_columns_absent: true,
      review_function_exists: true,
      review_function_security_definer: true,
      review_function_search_path_locked: true,
      service_role_can_review: true,
      anon_can_review: false,
      authenticated_can_review: false,
    },
    pricing_model: {
      central_price_count: 116,
      amazon_reference_price_count: 0,
      amazon_usd_value_count: 0,
      amazon_price_reference_supported: false,
      current_pharmacy_price_count: 0,
      public_view_avoids_pharmacy_prices: true,
      confirmation_price_optional: true,
      pharmacy_catalogue_price_write_disabled: true,
      public_stock_supported: false,
      final_price_claimed: false,
    },
    product_images: {
      table_exists: true,
      rls_enabled: true,
      public_policy_exists: true,
      public_table_select_expected: true,
      bucket_configured: true,
      publish_function_exists: true,
      publish_function_security_definer: true,
      publish_function_search_path_locked: true,
      service_role_can_publish: true,
      anon_can_publish: false,
      authenticated_can_publish: false,
      live_product_count: 4659,
      complete_product_count: 0,
      missing_product_count: 4659,
      coverage_required: false,
      missing_images_hidden: true,
      generated_placeholders_allowed: false,
      partial_product_count: 0,
      unsafe_image_count: 0,
    },
    monitoring: {
      health_exists: true,
      health_security_definer: true,
      health_search_path_locked: true,
      anon_can_execute_health: false,
      authenticated_can_execute_health: false,
      service_role_can_execute_health: true,
    },
    pharmacy_privacy: {
      anon_can_read_pharmacies: false,
      authenticated_can_read_pharmacies: false,
      anon_can_read_recipients: false,
      authenticated_can_read_recipients: false,
    },
    geocode_governance: {
      review_column_count: 4,
      expected_review_column_count: 4,
      review_constraint_exists: true,
      review_constraint_validated: true,
      unique_verified_place_index: true,
      verified_without_review_count: 0,
    },
    contact_governance: {
      review_function_exists: true,
      service_role_can_review: true,
      anon_can_review: false,
      authenticated_can_review: false,
      reviewed_without_evidence_count: 0,
      admin_verified_without_evidence_count: 0,
    },
    member_contacts: {
      function_exists: true,
      security_definer: true,
      search_path_locked: true,
      authenticated_can_execute: true,
      anon_can_execute: false,
    },
    security_hardening: {
      atomic_otp_function_exists: true,
      atomic_otp_security_definer: true,
      atomic_otp_search_path_locked: true,
      atomic_otp_service_role_can_execute: true,
      atomic_otp_anon_can_execute: false,
      atomic_otp_authenticated_can_execute: false,
      geocode_approval_function_exists: true,
      geocode_approval_security_definer: true,
      geocode_approval_search_path_locked: true,
      geocode_approval_service_role_can_execute: true,
      geocode_approval_anon_can_execute: false,
      geocode_approval_authenticated_can_execute: false,
      contact_retirement_trigger: true,
      offer_product_write_trigger: true,
      offer_product_selection_trigger: true,
      order_rate_limit_trigger: true,
      active_orders_complete_offer_filter: true,
      selected_contact_complete_offer_guard: true,
    },
    prescriptions: { bucket_exists: true, cleanup_claims_rls: true },
    realtime: { orders: true, offers: true, notifications: true },
    api_surface: {
      function_count: 29,
      expected_function_count: 29,
      public_execute_count: 0,
      anonymous_security_definer_count: 0,
      mutable_security_definer_path_count: 0,
      expected_authenticated_security_definer_count: 13,
      missing_authenticated_security_definer_count: 0,
      unexpected_authenticated_security_definer_count: 0,
    },
    table_surface: {
      table_count: 22,
      expected_table_count: 22,
      rls_disabled_count: 0,
      anonymous_select_count: 0,
      expected_deny_by_default_count: 9,
      missing_deny_by_default_count: 0,
      unexpected_deny_by_default_count: 0,
      expected_authenticated_select_count: 9,
      missing_authenticated_select_count: 0,
      unexpected_authenticated_select_count: 0,
    },
  };
}

test("accepts the complete MED+250 backend deployment contract", () => {
  assert.deepEqual(assessBackendContract(validContract()), []);
});

test("detects privilege, function-mode and Realtime drift", () => {
  const contract = validContract();
  contract.catalogue_search.security_invoker = false;
  contract.pharmacy_privacy.authenticated_can_read_recipients = true;
  contract.realtime.offers = false;
  contract.api_surface.public_execute_count = 1;
  contract.table_surface.unexpected_authenticated_select_count = 1;

  assert.deepEqual(assessBackendContract(contract), [
    "Catalogue-search RPC is not SECURITY INVOKER.",
    "Authenticated users can read routing recipients.",
    "Offers are missing from Realtime publication.",
    "PUBLIC can execute a MED+250 function.",
    "An unexpected MED+250 table is directly selectable by authenticated clients.",
  ]);
});

test("detects pharmacy-specific pricing or stock drift", () => {
  const contract = validContract();
  contract.pricing_model.current_pharmacy_price_count = 1;
  contract.pricing_model.amazon_reference_price_count = 1;
  contract.pricing_model.amazon_usd_value_count = 1;
  contract.pricing_model.amazon_price_reference_supported = true;
  contract.pricing_model.public_view_avoids_pharmacy_prices = false;
  contract.pricing_model.confirmation_price_optional = false;
  contract.pricing_model.public_stock_supported = true;

  assert.deepEqual(assessBackendContract(contract), [
    "Amazon-derived catalogue prices still exist.",
    "Raw Amazon USD price values still exist.",
    "The backend contract still permits Amazon-derived prices.",
    "Current pharmacy-specific catalogue prices still exist.",
    "A public catalogue view still reads pharmacy-specific prices.",
    "Pharmacy availability confirmation still requires a price.",
    "The backend contract incorrectly claims public pharmacy stock support.",
  ]);
});

test("detects RLS, allowlist and privileged-function drift", () => {
  const contract = validContract();
  contract.api_surface.unexpected_authenticated_security_definer_count = 1;
  contract.api_surface.mutable_security_definer_path_count = 1;
  contract.table_surface.rls_disabled_count = 1;
  contract.table_surface.unexpected_deny_by_default_count = 1;

  assert.deepEqual(assessBackendContract(contract), [
    "A privileged MED+250 function has a mutable search path.",
    "An unexpected privileged function is exposed to authenticated clients.",
    "A MED+250 table does not have RLS enabled.",
    "An undocumented MED+250 table has RLS but no policy.",
  ]);
});

test("detects pharmacy GPS review-governance drift", () => {
  const contract = validContract();
  contract.geocode_governance.review_constraint_validated = false;
  contract.geocode_governance.verified_without_review_count = 1;

  assert.deepEqual(assessBackendContract(contract), [
    "Pharmacy GPS review constraint is not validated.",
    "A dispatch-eligible pharmacy lacks durable GPS review evidence.",
  ]);
});

test("detects pharmacy contact-review governance drift", () => {
  const contract = validContract();
  contract.contact_governance.authenticated_can_review = true;
  contract.contact_governance.admin_verified_without_evidence_count = 1;

  assert.deepEqual(assessBackendContract(contract), [
    "Pharmacy users can approve their own contact changes.",
    "An administrator-verified pharmacy contact lacks operator evidence.",
  ]);
});

test("keeps contact review atomic, evidenced and service-only", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260713202237_govern_pharmacy_contact_edit_reviews.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /for update/);
  assert.match(migration, /p_decision not in \('approve', 'reject'\)/);
  assert.match(migration, /reviewed_by_label/);
  assert.match(migration, /verification_note/);
  assert.match(migration, /contact_type = 'whatsapp'/);
  assert.match(migration, /'phone'/);
  assert.match(migration, /grant execute on function public\.dawanear_review_pharmacy_contact_edit[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.dawanear_review_pharmacy_contact_edit[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /'contract_version', '2026-07-13\.6'/);
});

test("detects member-owned pharmacy contact access drift", () => {
  const contract = validContract();
  contract.member_contacts.anon_can_execute = true;
  contract.member_contacts.search_path_locked = false;

  assert.deepEqual(assessBackendContract(contract), [
    "Member-owned pharmacy contact function has a mutable search path.",
    "Anonymous users can execute member-owned pharmacy contact access.",
  ]);
});

test("detects partial security-hardening deployment", () => {
  const contract = validContract();
  contract.security_hardening.atomic_otp_anon_can_execute = true;
  contract.security_hardening.contact_retirement_trigger = false;
  contract.security_hardening.selected_contact_complete_offer_guard = false;

  assert.deepEqual(assessBackendContract(contract), [
    "Anonymous users can call atomic OTP issuance directly.",
    "Retiring a pharmacy login contact does not revoke its authority atomically.",
    "Selected contact release is not bound to a complete offer.",
  ]);
});

test("refreshes the aggregate backend contract after security hardening", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260715180533_refresh_med250_security_backend_contract_20260714.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /dawanear_private\.dawanear_backend_contract_v7/);
  assert.match(migration, /'contract_version', '2026-07-14\.1'/);
  assert.match(migration, /'\{api_surface,expected_function_count\}'[\s\S]*'26'::jsonb/);
  assert.match(migration, /'security_hardening'/);
  assert.match(migration, /dawanear_issue_pharmacy_otp/);
  assert.match(migration, /dawanear_approve_geocode_candidate/);
  assert.match(migration, /dawanear_contacts_retire_authority/);
  assert.match(migration, /dawanear_orders_rolling_quota/);
  assert.match(migration, /grant execute on function public\.dawanear_backend_contract\(\)[\s\S]*to service_role/);
});

test("keeps linked contacts private to permanent active pharmacy members", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260713203240_expose_member_owned_pharmacy_contacts.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /dawanear_is_permanent_user/);
  assert.match(migration, /dawanear_pharmacy_memberships/);
  assert.match(migration, /membership\.user_id = v_user_id/);
  assert.match(migration, /membership\.pharmacy_id = p_pharmacy_id/);
  assert.match(migration, /membership\.status = 'active'/);
  assert.match(migration, /revoke all on function public\.dawanear_my_pharmacy_contacts\(uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.dawanear_my_pharmacy_contacts\(uuid\)[\s\S]*to authenticated/);
  assert.match(migration, /'contract_version', '2026-07-13\.7'/);
});

test("stores an explicit pharmacy-confirmed fulfilment method", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260713210502_add_offer_fulfilment_method.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /add column if not exists fulfilment_method/);
  assert.match(migration, /p_fulfilment_method not in \('pickup', 'delivery', 'either'\)/);
  assert.match(migration, /p_fulfilment_method <> v_order_preference/);
  assert.match(migration, /offer\.fulfilment_method/);
  assert.match(migration, /revoke all on function public\.dawanear_submit_offer\(uuid, uuid, jsonb, text, integer, text\)/);
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /public\.dawanear_submit_offer\(uuid,uuid,jsonb,text,integer,text\)/);
});

test("keeps the aggregate backend contract aligned with the new offer RPC", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260713210717_refresh_offer_backend_contract.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /dawanear_private\.dawanear_backend_contract_v4/);
  assert.match(migration, /public\.dawanear_submit_offer\(uuid,uuid,jsonb,text,integer,text\)/);
  assert.match(migration, /allowlist is unrecognized/);
});

test("keeps GPS governance in the service-only aggregate deployment contract", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260713200843_extend_backend_contract_for_geocode_governance.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /'contract_version', '2026-07-13\.5'/);
  assert.match(migration, /'geocode_governance'/);
  assert.match(migration, /dawanear_pharmacies_verified_geocode_review_ck/);
  assert.match(migration, /dawanear_pharmacies_verified_google_place_uidx/);
  assert.match(migration, /'verified_without_review_count'/);
  assert.match(migration, /revoke all on function public\.dawanear_backend_contract\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.dawanear_backend_contract\(\)[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /jsonb_agg/);
});

test("keeps the deployed contract service-only and identifier-free", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260713192952_med250_least_privilege_contract.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /revoke all on function public\.dawanear_backend_contract\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.dawanear_backend_contract\(\)[\s\S]*to service_role/);
  assert.match(migration, /contains_row_identifiers', false/);
  assert.match(migration, /contains_object_names', false/);
  assert.doesNotMatch(migration, /jsonb_agg/);
  assert.doesNotMatch(migration, /phone_numbers|whatsapp_numbers|customer_location/);
});

test("makes backend drift and operational health mandatory in the live release gate", async () => {
  const packageJson = JSON.parse(await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  const liveGate = packageJson.scripts["release:check:live"];
  assert.match(liveGate, /^npm run release:preflight:live/);
  assert.match(liveGate, /&& npm run data:duplicates:verify -- --strict/);
  assert.match(liveGate, /&& npm run backend:verify/);
  assert.match(liveGate, /&& npm run ops:health:strict/);
  assert.ok(
    liveGate.indexOf("release:preflight:live") < liveGate.indexOf("data:duplicates:verify"),
    "fail-closed attestation checks must run before a service credential is used",
  );
  assert.ok(
    liveGate.indexOf("data:duplicates:verify") < liveGate.indexOf("backend:verify"),
    "source-governance review must pass before a service credential is used",
  );
  assert.ok(
    liveGate.indexOf("backend:verify") < liveGate.indexOf("wrangler deploy"),
    "backend drift must be checked before Cloudflare packaging",
  );
  assert.ok(
    liveGate.indexOf("ops:health:strict") < liveGate.indexOf("wrangler deploy"),
    "operational readiness must be checked before Cloudflare packaging",
  );
});
