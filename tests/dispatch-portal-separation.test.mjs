import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260730120000_separate_dispatch_whatsapp_from_portal_authority.sql",
    import.meta.url,
  ),
  "utf8",
);

const duplicateTestPharmacyRepair = await readFile(
  new URL(
    "../supabase/migrations/20260801113000_retire_duplicate_kigali_test_pharmacy.sql",
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
  create role anon;
  create role authenticated;
  create schema dawanear_private;
  create table public.dawanear_pharmacies (
    id uuid primary key,
    is_active boolean not null default true,
    marketplace_approved boolean not null default true,
    license_expires_on date
  );
  create table public.dawanear_pharmacy_contacts (
    pharmacy_id uuid not null,
    contact_type text not null,
    verification_status text not null,
    is_login_enabled boolean not null default false,
    verified_at timestamptz
  );
  ${helperDefinition}
`);

after(async () => database.close());

test("dispatch accepts a verified public-source WhatsApp without portal authority", async () => {
  await database.exec(`
    insert into public.dawanear_pharmacies (
      id, is_active, marketplace_approved, license_expires_on
    ) values (
      '11111111-1111-4111-8111-111111111111', true, true, current_date + 30
    );
    insert into public.dawanear_pharmacy_contacts (
      pharmacy_id, contact_type, verification_status, is_login_enabled, verified_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'whatsapp', 'source_verified', false, now()
    );
  `);

  const result = await database.query(`
    select dawanear_private.dawanear_pharmacy_is_dispatch_eligible(
      '11111111-1111-4111-8111-111111111111'
    ) as eligible
  `);
  assert.equal(result.rows[0].eligible, true);
});

test("dispatch still rejects candidate, expired, inactive, and unapproved records", async () => {
  await database.exec(`
    insert into public.dawanear_pharmacies (
      id, is_active, marketplace_approved, license_expires_on
    ) values
      ('22222222-2222-4222-8222-222222222222', true, true, current_date + 30),
      ('33333333-3333-4333-8333-333333333333', true, true, current_date - 1),
      ('44444444-4444-4444-8444-444444444444', false, true, current_date + 30),
      ('55555555-5555-4555-8555-555555555555', true, false, current_date + 30);
    insert into public.dawanear_pharmacy_contacts (
      pharmacy_id, contact_type, verification_status, is_login_enabled, verified_at
    ) values
      ('22222222-2222-4222-8222-222222222222', 'whatsapp', 'candidate', false, null),
      ('33333333-3333-4333-8333-333333333333', 'whatsapp', 'source_verified', false, now()),
      ('44444444-4444-4444-8444-444444444444', 'whatsapp', 'source_verified', false, now()),
      ('55555555-5555-4555-8555-555555555555', 'whatsapp', 'source_verified', false, now());
  `);

  const result = await database.query(`
    select dawanear_private.dawanear_pharmacy_is_dispatch_eligible(id) as eligible
    from public.dawanear_pharmacies
    where id <> '11111111-1111-4111-8111-111111111111'
    order by id
  `);
  assert.deepEqual(result.rows.map((row) => row.eligible), [false, false, false, false]);
});

test("keeps portal OTP authority separate and routes orders to ten pharmacies", () => {
  assert.doesNotMatch(helperDefinition, /is_login_enabled/);
  assert.match(migration, /dawanear_pharmacy_contacts_login_authority/);
  assert.match(migration, /source_type in \('admin', 'pharmacy_submission'\)/);
  assert.match(migration, /verified_by_label is not null/);
  assert.match(migration, /verification_note is not null/);
  assert.match(migration, /dawanear_bind_pharmacy_identity/);
  assert.match(migration, /contact\.is_login_enabled/);
  assert.match(migration, /limit 10/);
  assert.match(migration, /broadcast_limit = 10/);
});

test("the outbox selects verified WhatsApp destinations without granting login", () => {
  const enqueueDefinition = migration.match(
    /create or replace function dawanear_private\.dawanear_enqueue_pharmacy_request_message\(\)[\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(enqueueDefinition);
  assert.match(enqueueDefinition, /contact\.contact_type = 'whatsapp'/);
  assert.match(enqueueDefinition, /contact\.verification_status in \('source_verified', 'admin_verified'\)/);
  assert.match(enqueueDefinition, /contact\.verified_at is not null/);
  assert.doesNotMatch(enqueueDefinition, /contact\.is_login_enabled/);
  assert.match(enqueueDefinition, /dawanear_whatsapp_outbox/);
});

test("installs three owner-authorized test pharmacies with stable keys and coordinates", () => {
  for (const value of [
    "med250-test-kigali-01",
    "med250-test-musanze-01",
    "med250-test-musanze-02",
    "250788767816",
    "35677186193",
    "35699742524",
    "-1.944000",
    "30.061900",
    "-1.497700",
    "29.634600",
    "-1.501500",
    "29.630200",
  ]) {
    assert.match(migration, new RegExp(value.replaceAll(".", "\\.")));
  }
  assert.match(migration, /on conflict \(registry_entry_key\) do update/);
  assert.match(migration, /is_login_enabled,[\s\S]*true,[\s\S]*'admin_verified'/);
  assert.match(migration, /v_test_pharmacies <> 3 or v_test_contacts <> 3/);
});

test("retires the duplicate Kigali fixture without weakening the authorized test fleet", () => {
  assert.match(duplicateTestPharmacyRepair, /dev-test-whatsapp-250788767816/);
  assert.match(duplicateTestPharmacyRepair, /med250-test-kigali-01/);
  assert.match(duplicateTestPharmacyRepair, /verification_status = 'stale'/);
  assert.match(duplicateTestPharmacyRepair, /is_active = false/);
  assert.match(duplicateTestPharmacyRepair, /marketplace_approved = false/);
  assert.match(duplicateTestPharmacyRepair, /v_authorized_contact_count <> 3 or v_portal_contact_count <> 3/);
  assert.match(duplicateTestPharmacyRepair, /membership\.status = 'active'/);
  assert.match(duplicateTestPharmacyRepair, /transaction history or active membership authority/);
  assert.doesNotMatch(duplicateTestPharmacyRepair, /delete\s+from/i);
});
