import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

import { PGlite } from "@electric-sql/pglite";

const database = new PGlite();

await database.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema dawanear_private;

  create table public.dawanear_pharmacy_contacts (id uuid);
  create table public.dawanear_offer_items (id uuid);
  create table public.dawanear_offers (id uuid);
  create table public.dawanear_orders (id uuid);

  create function dawanear_private.contract_test_trigger()
  returns trigger language plpgsql set search_path = '' as $$
  begin
    return new;
  end;
  $$;

  create trigger dawanear_contacts_retire_authority
    before update on public.dawanear_pharmacy_contacts
    for each row execute function dawanear_private.contract_test_trigger();
  create trigger dawanear_offer_items_current_product
    before update on public.dawanear_offer_items
    for each row execute function dawanear_private.contract_test_trigger();
  create trigger dawanear_offers_revalidate_products
    before update on public.dawanear_offers
    for each row execute function dawanear_private.contract_test_trigger();
  create trigger dawanear_orders_rolling_quota
    before insert on public.dawanear_orders
    for each row execute function dawanear_private.contract_test_trigger();

  create function public.dawanear_issue_pharmacy_otp(text, text, text, timestamptz)
  returns void language plpgsql security definer set search_path = '' as $$
  begin
    return;
  end;
  $$;
  revoke all on function public.dawanear_issue_pharmacy_otp(text, text, text, timestamptz)
    from public, anon, authenticated;
  grant execute on function public.dawanear_issue_pharmacy_otp(text, text, text, timestamptz)
    to service_role;

  create function public.dawanear_approve_geocode_candidate(uuid, text, timestamptz, text, text)
  returns void language plpgsql security definer set search_path = '' as $$
  begin
    return;
  end;
  $$;
  revoke all on function public.dawanear_approve_geocode_candidate(uuid, text, timestamptz, text, text)
    from public, anon, authenticated;
  grant execute on function public.dawanear_approve_geocode_candidate(uuid, text, timestamptz, text, text)
    to service_role;

  create function public.dawanear_my_active_orders()
  returns text language sql security definer set search_path = '' as $$
    select '@.complete == true'::text
  $$;

  create function public.dawanear_selected_contact(uuid)
  returns text language sql security definer set search_path = '' as $$
    select 'and f.complete'::text
  $$;

  create function public.dawanear_backend_contract()
  returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object(
      'contract_version', '2026-07-13.7',
      'api_surface', jsonb_build_object(
        'function_count', 26,
        'expected_function_count', 24
      )
    )
  $$;
`);

const migration = await readFile(
  new URL("../supabase/migrations/20260715180533_refresh_med250_security_backend_contract_20260714.sql", import.meta.url),
  "utf8",
);
await database.exec(migration);

after(async () => database.close());

test("executes the security backend-contract refresh", async () => {
  const result = await database.query("select public.dawanear_backend_contract() as contract");
  const contract = result.rows[0]?.contract;

  assert.equal(contract.contract_version, "2026-07-14.1");
  assert.equal(contract.api_surface.function_count, 26);
  assert.equal(contract.api_surface.expected_function_count, 26);
  assert.deepEqual(contract.security_hardening, {
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
  });
});

test("keeps the refreshed contract service-only", async () => {
  const result = await database.query(`
    select
      has_function_privilege('service_role', 'public.dawanear_backend_contract()', 'execute') as service_role_can_execute,
      has_function_privilege('anon', 'public.dawanear_backend_contract()', 'execute') as anon_can_execute,
      has_function_privilege('authenticated', 'public.dawanear_backend_contract()', 'execute') as authenticated_can_execute
  `);

  assert.deepEqual(result.rows, [{
    service_role_can_execute: true,
    anon_can_execute: false,
    authenticated_can_execute: false,
  }]);
});
