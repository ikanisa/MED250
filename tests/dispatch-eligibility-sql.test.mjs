import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260713211648_marketplace_dispatch_eligibility.sql",
    import.meta.url,
  ),
  "utf8",
);

const helperDefinition = migration.match(
  /create or replace function dawanear_private\.dawanear_pharmacy_is_dispatch_eligible[\s\S]*?\n\$\$;/,
)?.[0];

assert.ok(helperDefinition, "dispatch eligibility helper must be present");

const database = new PGlite();
await database.exec(`
  create schema dawanear_private;
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
  ${helperDefinition}
`);

after(async () => database.close());

test("approves a dispatch-ready retail pharmacy without an online-premises flag", async () => {
  await database.exec(`
    insert into public.dawanear_pharmacies (
      id, marketplace_approved, online_license_verified,
      geocode_status, location, license_expires_on
    ) values (
      '11111111-1111-4111-8111-111111111111', true, false,
      'verified', 'approved-point', current_date + 30
    );
    insert into public.dawanear_pharmacy_contacts (
      pharmacy_id, contact_type, verification_status, is_login_enabled
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'whatsapp', 'source_verified', true
    );
  `);

  const result = await database.query(`
    select dawanear_private.dawanear_pharmacy_is_dispatch_eligible(
      '11111111-1111-4111-8111-111111111111'
    ) as eligible
  `);
  assert.equal(result.rows[0].eligible, true);
});

test("fails closed without approved GPS, a current licence or verified WhatsApp login", async () => {
  await database.exec(`
    insert into public.dawanear_pharmacies (
      id, marketplace_approved, online_license_verified,
      geocode_status, location, license_expires_on
    ) values
      ('22222222-2222-4222-8222-222222222222', true, true, 'pending', null, current_date + 30),
      ('33333333-3333-4333-8333-333333333333', true, true, 'verified', 'point', current_date - 1),
      ('44444444-4444-4444-8444-444444444444', true, true, 'verified', 'point', current_date + 30);
    insert into public.dawanear_pharmacy_contacts (
      pharmacy_id, contact_type, verification_status, is_login_enabled
    ) values
      ('22222222-2222-4222-8222-222222222222', 'whatsapp', 'source_verified', true),
      ('33333333-3333-4333-8333-333333333333', 'whatsapp', 'source_verified', true),
      ('44444444-4444-4444-8444-444444444444', 'whatsapp', 'candidate', false);
  `);

  const result = await database.query(`
    select id,
      dawanear_private.dawanear_pharmacy_is_dispatch_eligible(id) as eligible
    from public.dawanear_pharmacies
    where id <> '11111111-1111-4111-8111-111111111111'
    order by id
  `);
  assert.deepEqual(result.rows.map((row) => row.eligible), [false, false, false]);
});

test("rewrites every order-routing surface and keeps the online flag informational", () => {
  assert.match(migration, /dawanear_create_order/);
  assert.match(migration, /dawanear_pharmacy_requests/);
  assert.match(migration, /dawanear_submit_offer/);
  assert.match(migration, /dawanear_select_offer/);
  assert.match(migration, /dawanear_selected_contact/);
  assert.match(migration, /dawanear_my_confirmed_offers/);
  assert.match(migration, /dawanear_selected_pharmacy_can_read/);
  assert.match(migration, /dawanear_operational_health/);
  assert.match(migration, /Informational source-register attribute only/);
  assert.doesNotMatch(helperDefinition, /online_license_verified/);
});
