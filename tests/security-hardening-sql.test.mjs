import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/20260715180529_med250_security_hardening_20260714.sql", import.meta.url), "utf8");

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema dawanear_private;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.dawanear_pharmacy_otp_challenges (
      id uuid primary key default gen_random_uuid(), phone text not null, code_hash text not null,
      source_hash text not null, attempts smallint not null default 0, max_attempts smallint not null default 5,
      delivery_status text not null default 'queued', expires_at timestamptz not null,
      used_at timestamptz, created_at timestamptz not null default now()
    );
    create table public.dawanear_pharmacies (
      id uuid primary key, name text not null, momo_code text, is_active boolean not null default true,
      marketplace_approved boolean not null default true, online_license_verified boolean not null default true,
      license_expires_on date not null default current_date + 1, geocode_status text not null default 'candidate',
      google_place_id text, location text, location_confidence numeric, updated_at timestamptz not null default now(),
      geocode_review_place_id text, geocode_reviewed_by text, geocode_reviewed_at timestamptz,
      geocode_review_note text
    );
    create table public.dawanear_pharmacy_contacts (
      id uuid primary key, pharmacy_id uuid not null, contact_type text not null, e164 text not null,
      is_primary boolean not null default false, is_login_enabled boolean not null default false,
      verification_status text not null, verified_at timestamptz, verification_note text,
      derived_from_contact_id uuid
    );
    create table public.dawanear_pharmacy_identities (phone text primary key, user_id uuid not null);
    create table public.dawanear_pharmacy_memberships (
      id uuid primary key default gen_random_uuid(), pharmacy_id uuid not null, user_id uuid not null,
      role text not null default 'staff', status text not null default 'active', updated_at timestamptz not null default now()
    );
    create table public.dawanear_products (id text primary key, is_active boolean not null, is_orderable boolean not null);
    create table public.dawanear_orders (
      id uuid primary key default gen_random_uuid(), user_id uuid not null, reference text not null default 'T',
      status text not null default 'broadcast', created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '1 hour',
      updated_at timestamptz not null default now(), delivery_preference text not null default 'either', substitutes_allowed boolean not null default true,
      selected_offer_id uuid, selected_at timestamptz
    );
    create table public.dawanear_offers (
      id uuid primary key, order_id uuid not null, pharmacy_id uuid not null, status text not null default 'submitted', complete boolean not null default true
    );
    create table public.dawanear_offer_items (
      id uuid primary key default gen_random_uuid(), offer_id uuid not null, order_item_id uuid not null,
      offered_product_id text, available boolean not null, is_substitute boolean not null default false
    );
    create function public.dawanear_my_active_orders()
    returns table (
      order_id uuid, reference text, status text, created_at timestamptz, expires_at timestamptz,
      updated_at timestamptz, delivery_preference text, substitutes_allowed boolean,
      recipient_count integer, offer_count integer, selected_offer_id uuid, items jsonb, offers jsonb
    ) language sql security definer as $$
      select '00000000-0000-0000-0000-000000000001'::uuid, 'T', 'broadcast', now(), now() + interval '1 hour', now(),
        'either', true, 1, 2, null::uuid, '[]'::jsonb,
        '[{"offer_id":"draft","complete":false},{"offer_id":"ready","complete":true}]'::jsonb
    $$;
  `);
  await db.exec(migration);
  return db;
}

test("applies the forward security migration and filters incomplete offers", async () => {
  const db = await database();
  const result = await db.query("select offer_count, offers from public.dawanear_my_active_orders()");
  assert.equal(result.rows[0].offer_count, 1);
  assert.deepEqual(result.rows[0].offers, [{ offer_id: "ready", complete: true }]);
  await db.close();
});

test("issues one OTP atomically and rate-limits the immediate retry", async () => {
  const db = await database();
  const first = await db.query("select * from public.dawanear_issue_pharmacy_otp($1,$2,$3,now()+interval '5 minutes')", [
    "250788888888", "a".repeat(64), "b".repeat(64),
  ]);
  assert.ok(first.rows[0].challenge_id);
  const second = await db.query("select * from public.dawanear_issue_pharmacy_otp($1,$2,$3,now()+interval '5 minutes')", [
    "250788888888", "c".repeat(64), "b".repeat(64),
  ]);
  assert.equal(second.rows[0].challenge_id, null);
  assert.match(second.rows[0].rate_limit_reason, /wait 60 seconds/i);
  await db.close();
});

test("retires derived contacts and suspends the linked identity", async () => {
  const db = await database();
  const pharmacy = "00000000-0000-0000-0000-000000000010";
  const user = "00000000-0000-0000-0000-000000000020";
  const parent = "00000000-0000-0000-0000-000000000030";
  await db.query("insert into public.dawanear_pharmacies(id,name) values ($1,'A')", [pharmacy]);
  await db.query("insert into public.dawanear_pharmacy_identities(phone,user_id) values ('250788888888',$1)", [user]);
  await db.query("insert into public.dawanear_pharmacy_memberships(pharmacy_id,user_id) values ($1,$2)", [pharmacy, user]);
  await db.query("insert into public.dawanear_pharmacy_contacts(id,pharmacy_id,contact_type,e164,is_login_enabled,verification_status) values ($1,$2,'whatsapp','250788888888',true,'source_verified')", [parent, pharmacy]);
  await db.query("insert into public.dawanear_pharmacy_contacts(id,pharmacy_id,contact_type,e164,verification_status,derived_from_contact_id) values (gen_random_uuid(),$1,'phone','250788888888','source_verified',$2)", [pharmacy, parent]);
  await db.query("update public.dawanear_pharmacy_contacts set is_login_enabled=false, verification_status='stale' where id=$1", [parent]);
  assert.equal((await db.query("select status from public.dawanear_pharmacy_memberships")).rows[0].status, "suspended");
  assert.equal((await db.query("select verification_status from public.dawanear_pharmacy_contacts where derived_from_contact_id=$1", [parent])).rows[0].verification_status, "stale");
  await db.close();
});

test("rejects disabled offer products at the database boundary", async () => {
  const db = await database();
  await db.exec("insert into public.dawanear_products values ('disabled',false,false); insert into public.dawanear_offers(id,order_id,pharmacy_id) values ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000042');");
  await assert.rejects(
    db.exec("insert into public.dawanear_offer_items(offer_id,order_item_id,offered_product_id,available) values ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000043','disabled',true)"),
    /no longer available for ordering/i,
  );
  await db.close();
});
