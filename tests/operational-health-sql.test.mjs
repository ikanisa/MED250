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

  create table public.dawanear_products (
    id text primary key,
    is_active boolean not null default true,
    is_orderable boolean not null default false,
    source_refreshed_at timestamptz
  );
  create table public.dawanear_pharmacy_prices (
    product_id text not null,
    pharmacy_id uuid not null,
    is_current boolean not null default true,
    observed_at timestamptz not null default now()
  );
  create table public.dawanear_pharmacies (
    id uuid primary key,
    is_active boolean not null default true,
    marketplace_approved boolean not null default true,
    online_license_verified boolean not null default false,
    geocode_status text not null default 'pending',
    location text,
    license_expires_on date
  );
  create table public.dawanear_pharmacy_contacts (
    pharmacy_id uuid not null,
    contact_type text not null,
    verification_status text not null,
    is_login_enabled boolean not null default false
  );
  create table public.dawanear_orders (
    id uuid primary key,
    status text not null,
    created_at timestamptz not null default now(),
    broadcast_at timestamptz,
    expires_at timestamptz not null
  );
  create table public.dawanear_order_recipients (
    order_id uuid not null,
    pharmacy_id uuid not null
  );
  create table public.dawanear_offers (
    order_id uuid not null,
    complete boolean not null default false,
    status text not null,
    submitted_at timestamptz not null default now()
  );
  create table public.dawanear_pharmacy_otp_challenges (
    created_at timestamptz not null default now(),
    delivery_status text not null
  );
  create table public.dawanear_pharmacy_identities (
    last_login_at timestamptz not null default now()
  );
  create table dawanear_private.dawanear_prescription_cleanup_claims (
    lease_expires_at timestamptz not null
  );
`);

const migration = await readFile(
  new URL("../supabase/migrations/20260713214500_operational_health.sql", import.meta.url),
  "utf8",
);
await database.exec(migration);

await database.exec(`
  insert into public.dawanear_products (id, is_active, is_orderable, source_refreshed_at)
  values ('product-1', true, true, now());
  insert into public.dawanear_pharmacies (
    id, is_active, marketplace_approved, online_license_verified,
    geocode_status, location, license_expires_on
  ) values (
    '11111111-1111-4111-8111-111111111111', true, true, true,
    'verified', 'approved-point', current_date + 30
  );
  insert into public.dawanear_pharmacy_prices (product_id, pharmacy_id)
  values ('product-1', '11111111-1111-4111-8111-111111111111');
  insert into public.dawanear_pharmacy_contacts (
    pharmacy_id, contact_type, verification_status, is_login_enabled
  ) values
    ('11111111-1111-4111-8111-111111111111', 'phone', 'source_verified', false),
    ('11111111-1111-4111-8111-111111111111', 'whatsapp', 'source_verified', true);
  insert into public.dawanear_orders (id, status, broadcast_at, expires_at)
  values ('22222222-2222-4222-8222-222222222222', 'offers_received', now() - interval '5 minutes', now() + interval '2 hours');
  insert into public.dawanear_order_recipients (order_id, pharmacy_id)
  values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
  insert into public.dawanear_offers (order_id, complete, status, submitted_at)
  values ('22222222-2222-4222-8222-222222222222', true, 'submitted', now());
  insert into public.dawanear_pharmacy_otp_challenges (delivery_status) values ('sent');
  insert into public.dawanear_pharmacy_identities default values;
  select public.dawanear_record_maintenance_run(
    'prescription_cleanup', 'succeeded', '{"deleted":1,"orphan_scan_complete":true}'::jsonb
  );
`);

after(async () => database.close());

test("returns aggregate marketplace operations without row identifiers", async () => {
  const result = await database.query("select public.dawanear_operational_health() as health");
  const health = result.rows[0].health;

  assert.equal(health.privacy.aggregate_only, true);
  assert.equal(health.privacy.contains_health_or_location_data, false);
  assert.equal(health.catalogue.active_products, 1);
  assert.equal(health.catalogue.products_with_current_prices, 1);
  assert.equal(health.pharmacies.dispatch_ready, 1);
  assert.equal(health.pharmacies.login_enabled_whatsapp_contacts, 1);
  assert.equal(health.orders.dispatched_24h, 1);
  assert.equal(health.orders.orders_confirmed_24h, 1);
  assert.equal(health.pharmacy_auth.otp_sent_24h, 1);
  assert.equal(health.prescription_cleanup.last_status, "succeeded");
  assert.equal(health.prescription_cleanup.stale, false);

  const serialized = JSON.stringify(health);
  assert.doesNotMatch(serialized, /product-1|11111111|22222222|approved-point/);
});

test("keeps health and maintenance functions service-only", async () => {
  const result = await database.query(`
    select
      has_function_privilege('anon', 'public.dawanear_operational_health()', 'execute') as anon_health,
      has_function_privilege('authenticated', 'public.dawanear_operational_health()', 'execute') as authenticated_health,
      has_function_privilege('service_role', 'public.dawanear_operational_health()', 'execute') as service_health,
      has_function_privilege('anon', 'public.dawanear_record_maintenance_run(text,text,jsonb)', 'execute') as anon_record,
      has_function_privilege('service_role', 'public.dawanear_record_maintenance_run(text,text,jsonb)', 'execute') as service_record
  `);
  assert.deepEqual(result.rows[0], {
    anon_health: false,
    authenticated_health: false,
    service_health: true,
    anon_record: false,
    service_record: true,
  });
});
