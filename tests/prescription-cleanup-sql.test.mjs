import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../supabase/migrations/20260712130000_dawanear_marketplace.sql", import.meta.url),
  "utf8",
);

function sqlFunction(marker) {
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `missing SQL function: ${marker}`);
  const bodyStart = migration.indexOf("as $$", start);
  const end = migration.indexOf("$$;", bodyStart) + 3;
  return migration.slice(start, end);
}

function sqlRange(startMarker, endMarker) {
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing SQL range start: ${startMarker}`);
  assert.notEqual(end, -1, `missing SQL range end: ${endMarker}`);
  return migration.slice(start, end);
}

async function cleanupDatabase() {
  const db = new PGlite();
  await db.exec(`
    create schema dawanear_private;
    create schema storage;
    create table public.dawanear_orders (
      id uuid primary key default gen_random_uuid(),
      status text not null,
      selected_at timestamptz,
      expires_at timestamptz not null,
      updated_at timestamptz not null default now(),
      prescription_path text
    );
    create index dawanear_orders_prescription_path_idx
      on public.dawanear_orders (prescription_path)
      where prescription_path is not null;
    create table storage.objects (
      bucket_id text not null,
      name text not null,
      owner_id text,
      created_at timestamptz not null default now(),
      primary key (bucket_id, name)
    );
    create table dawanear_private.dawanear_prescription_cleanup_claims (
      prescription_path text primary key check (btrim(prescription_path) <> ''),
      claim_token uuid not null,
      claimed_at timestamptz not null,
      lease_expires_at timestamptz not null,
      check (lease_expires_at > claimed_at)
    );
  `);
  for (const marker of [
    "create or replace function dawanear_private.dawanear_prescription_reference_is_cleanup_eligible",
    "create or replace function dawanear_private.dawanear_guard_prescription_cleanup_claim",
    "create function public.dawanear_claim_prescription_cleanup",
    "create function public.dawanear_claim_orphan_prescription_cleanup",
    "create function public.dawanear_recover_expired_prescription_cleanup_claims",
    "create function public.dawanear_finalize_prescription_cleanup",
  ]) {
    await db.exec(sqlFunction(marker));
  }
  await db.exec(`
    create trigger dawanear_orders_guard_prescription_cleanup
    before insert or update of prescription_path on public.dawanear_orders
    for each row execute function dawanear_private.dawanear_guard_prescription_cleanup_claim();
  `);
  return db;
}

test("executes shared-path cleanup, exact orphan, and lease recovery invariants", async () => {
  const db = await cleanupDatabase();
  try {
    await db.exec(`
      insert into public.dawanear_orders
        (status, selected_at, expires_at, updated_at, prescription_path)
      values
        ('cancelled', null, now() - interval '3 days', now() - interval '10 days', 'owner/shared'),
        ('selected', now() - interval '1 hour', now() + interval '1 hour', now(), 'owner/shared'),
        ('cancelled', null, now() - interval '3 days', now() - interval '5 days', 'owner/eligible'),
        ('cancelled', null, now() - interval '3 days', now() - interval '4 days', 'owner/recent');
      insert into storage.objects(bucket_id, name, created_at)
        values ('dawanear-prescriptions', 'owner/recent', now());
    `);

    let rows = (await db.query(
      "select * from public.dawanear_claim_prescription_cleanup(1)",
    )).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prescription_path, "owner/eligible");
    assert.equal(rows[0].reference_count, 1);
    await db.query(
      "select * from public.dawanear_finalize_prescription_cleanup($1, $2::uuid)",
      ["owner/eligible", rows[0].claim_token],
    );

    rows = (await db.query(
      "select * from public.dawanear_claim_prescription_cleanup(20)",
    )).rows;
    assert.equal(rows.length, 0, "retained shared and recent-object paths must be skipped");

    await db.exec(`
      update public.dawanear_orders
      set status = 'expired',
          selected_at = now() - interval '2 days',
          expires_at = now() - interval '2 days'
      where prescription_path = 'owner/shared' and status = 'selected';
    `);
    rows = (await db.query(
      "select * from public.dawanear_claim_prescription_cleanup(20)",
    )).rows;
    const shared = rows.find((row) => row.prescription_path === "owner/shared");
    assert.ok(shared);
    assert.equal(shared.reference_count, 2);

    await assert.rejects(
      db.exec(`
        insert into public.dawanear_orders(status, expires_at, prescription_path)
        values ('cancelled', now() - interval '3 days', 'owner/shared')
      `),
      /being retired/,
    );
    await assert.rejects(
      db.query(
        "select * from public.dawanear_finalize_prescription_cleanup($1, $2::uuid)",
        ["owner/shared", "00000000-0000-0000-0000-000000000000"],
      ),
      /missing or was superseded/,
    );
    rows = (await db.query(
      "select * from public.dawanear_finalize_prescription_cleanup($1, $2::uuid)",
      ["owner/shared", shared.claim_token],
    )).rows;
    assert.equal(rows[0].cleared_reference_count, 2);

    const exactOrphan = "owner/orphan ";
    await db.query(`
      insert into storage.objects(bucket_id, name, created_at)
      values ('dawanear-prescriptions', $1, now() - interval '25 hours')
    `, [exactOrphan]);
    rows = (await db.query(
      "select * from public.dawanear_claim_orphan_prescription_cleanup(array[$1]::text[], 20)",
      [exactOrphan],
    )).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prescription_path, exactOrphan);
    await db.query(
      "delete from storage.objects where bucket_id = 'dawanear-prescriptions' and name = $1",
      [exactOrphan],
    );
    await db.query(
      "select * from public.dawanear_finalize_prescription_cleanup($1, $2::uuid)",
      [exactOrphan, rows[0].claim_token],
    );

    await db.exec(`
      insert into public.dawanear_orders(status, expires_at, updated_at, prescription_path)
      values ('cancelled', now() - interval '3 days', now() - interval '3 days', 'owner/recoverable');
    `);
    rows = (await db.query(
      "select * from public.dawanear_claim_prescription_cleanup(20)",
    )).rows;
    const firstClaim = rows.find((row) => row.prescription_path === "owner/recoverable");
    assert.ok(firstClaim);
    await db.query(`
      update dawanear_private.dawanear_prescription_cleanup_claims
      set claimed_at = now() - interval '2 hours',
          lease_expires_at = now() - interval '1 hour'
      where prescription_path = $1
    `, ["owner/recoverable"]);
    rows = (await db.query(
      "select * from public.dawanear_recover_expired_prescription_cleanup_claims(20)",
    )).rows;
    const recovered = rows.find((row) => row.prescription_path === "owner/recoverable");
    assert.ok(recovered);
    assert.notEqual(recovered.claim_token, firstClaim.claim_token);
    await db.query(
      "select * from public.dawanear_finalize_prescription_cleanup($1, $2::uuid)",
      ["owner/recoverable", recovered.claim_token],
    );

    await db.exec(`
      insert into dawanear_private.dawanear_prescription_cleanup_claims
        (prescription_path, claim_token, claimed_at, lease_expires_at)
      values (
        'owner/finished-orphan',
        '11111111-1111-1111-1111-111111111111',
        now() - interval '2 hours',
        now() - interval '1 hour'
      );
    `);
    rows = (await db.query(
      "select * from public.dawanear_recover_expired_prescription_cleanup_claims(20)",
    )).rows;
    assert.equal(rows.some((row) => row.prescription_path === "owner/finished-orphan"), false);
    const staleClaimCount = (await db.query(`
      select count(*)::integer as count
      from dawanear_private.dawanear_prescription_cleanup_claims
      where prescription_path = 'owner/finished-orphan'
    `)).rows[0].count;
    assert.equal(staleClaimCount, 0);
  } finally {
    await db.close();
  }
});

test("restrictive Storage policies override a pre-existing permissive policy", async () => {
  const db = new PGlite();
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema storage;
      create schema dawanear_private;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function storage.foldername(p_name text) returns text[]
      language sql immutable as $$ select string_to_array(p_name, '/') $$;
      create function dawanear_private.dawanear_selected_pharmacy_can_read(p_name text)
      returns boolean language sql stable security definer as $$
        select coalesce(current_setting('test.selected_pharmacy', true), '') = 'true'
      $$;
      create table public.dawanear_orders (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        status text not null,
        prescription_path text
      );
      create table storage.objects (
        bucket_id text not null,
        name text not null,
        owner_id text,
        created_at timestamptz not null default now(),
        primary key (bucket_id, name)
      );
      create table dawanear_private.dawanear_prescription_cleanup_claims (
        prescription_path text primary key,
        claim_token uuid not null,
        claimed_at timestamptz not null,
        lease_expires_at timestamptz not null
      );
    `);
    await db.exec(sqlFunction(
      "create or replace function dawanear_private.dawanear_customer_can_insert_prescription",
    ));
    await db.exec(sqlFunction(
      "create or replace function dawanear_private.dawanear_customer_can_delete_prescription",
    ));
    await db.exec(`
      alter table storage.objects enable row level security;
      grant usage on schema storage, auth, dawanear_private to anon, authenticated;
      grant select, insert, update, delete on storage.objects to anon, authenticated;
      grant execute on function dawanear_private.dawanear_customer_can_insert_prescription(text)
        to authenticated;
      grant execute on function dawanear_private.dawanear_customer_can_delete_prescription(text)
        to authenticated;
      grant execute on function dawanear_private.dawanear_selected_pharmacy_can_read(text)
        to authenticated;
      create policy preexisting_broad_storage_policy
        on storage.objects for all to anon, authenticated
        using (true) with check (true);
    `);
    await db.exec(sqlRange(
      "drop policy if exists dawanear_prescriptions_owner_insert",
      "drop policy if exists dawanear_prescriptions_owner_select",
    ));
    await db.exec(sqlRange(
      "drop policy if exists dawanear_prescriptions_owner_select",
      "drop policy if exists dawanear_prescriptions_owner_delete",
    ));
    await db.exec(sqlRange(
      "drop policy if exists dawanear_prescriptions_owner_delete",
      "-- Restrictive policies make these invariants survive composition",
    ));
    await db.exec(sqlRange(
      "drop policy if exists dawanear_prescriptions_anon_insert_guard",
      "drop policy if exists dawanear_prescriptions_selected_pharmacy_select",
    ));
    await db.exec(sqlRange(
      "drop policy if exists dawanear_prescriptions_selected_pharmacy_select",
      "-- Explicit Data API grants",
    ));
    await db.query(`
      insert into storage.objects(bucket_id, name, owner_id)
      values ('dawanear-prescriptions', $1, $2)
    `, [`${userId}/active`, userId]);
    await db.query(`
      insert into public.dawanear_orders(user_id, status, prescription_path)
      values ($1::uuid, 'broadcast', $2)
    `, [userId, `${userId}/active`]);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");

    await assert.rejects(
      db.query(`
        insert into storage.objects(bucket_id, name, owner_id)
        values ('dawanear-prescriptions', $1, $2)
      `, [`${userId}/active`, userId]),
      /row-level security|policy/i,
    );
    await db.query(`
      insert into storage.objects(bucket_id, name, owner_id)
      values ('dawanear-prescriptions', $1, $2)
    `, [`${userId}/safe`, userId]);
    const ownerVisibleRows = (await db.query(`
      select name from storage.objects
      where bucket_id = 'dawanear-prescriptions'
      order by name
    `)).rows;
    assert.deepEqual(ownerVisibleRows, [
      { name: `${userId}/active` },
      { name: `${userId}/safe` },
    ]);
    const updatedTargetRows = (await db.query(`
      update storage.objects set owner_id = 'replaced'
      where bucket_id = 'dawanear-prescriptions' and name = $1
      returning name
    `, [`${userId}/safe`])).rows;
    assert.equal(updatedTargetRows.length, 0, "client UPDATE must not see or replace the object");
    const deletedActiveRows = (await db.query(`
      delete from storage.objects
      where bucket_id = 'dawanear-prescriptions' and name = $1
      returning name
    `, [`${userId}/active`])).rows;
    assert.equal(deletedActiveRows.length, 0, "a permissive policy must not bypass delete safety");
    const deletedSafeRows = (await db.query(`
      delete from storage.objects
      where bucket_id = 'dawanear-prescriptions' and name = $1
      returning name
    `, [`${userId}/safe`])).rows;
    assert.deepEqual(deletedSafeRows, [{ name: `${userId}/safe` }]);

    await db.query(`
      insert into storage.objects(bucket_id, name, owner_id)
      values ('unrelated-bucket', 'object', $1)
    `, [userId]);
    assert.deepEqual((await db.query(`
      select name from storage.objects where bucket_id = 'unrelated-bucket'
    `)).rows, [{ name: "object" }]);
    await db.exec(`
      update storage.objects set owner_id = owner_id
      where bucket_id = 'unrelated-bucket' and name = 'object';
      delete from storage.objects
      where bucket_id = 'unrelated-bucket' and name = 'object';
    `);

    const unrelatedUser = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [unrelatedUser]);
    assert.deepEqual((await db.query(`
      select name from storage.objects where bucket_id = 'dawanear-prescriptions'
    `)).rows, []);
    await db.query("select set_config('test.selected_pharmacy', 'true', false)");
    assert.deepEqual((await db.query(`
      select name from storage.objects where bucket_id = 'dawanear-prescriptions'
    `)).rows, [{ name: `${userId}/active` }]);
    await db.query("select set_config('test.selected_pharmacy', 'false', false)");

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");
    assert.deepEqual((await db.query(`
      select name from storage.objects where bucket_id = 'dawanear-prescriptions'
    `)).rows, []);
    await assert.rejects(
      db.query(`
        insert into storage.objects(bucket_id, name, owner_id)
        values ('dawanear-prescriptions', 'anonymous/object', null)
      `),
      /row-level security|policy/i,
    );
  } finally {
    await db.close();
  }
});
