import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const [migration, enforcementMigration] = await Promise.all([
  readFile(
    new URL(
      "../supabase/migrations/20260716162000_reconcile_marketplace_quality_audits_and_contract.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/migrations/20260716163000_enforce_marketplace_publication_audits.sql",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("reconciles imported-product audits and counts only approved live catalogue rows", async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema dawanear_private;

    create table public.dawanear_marketplace_products (
      id text primary key,
      asin text not null unique,
      publication_status text not null,
      reviewed_by_label text,
      compliance_evidence_url text,
      updated_at timestamptz not null default now(),
      approved_at timestamptz,
      reviewed_at timestamptz,
      compliance_status text not null,
      is_active boolean not null,
      is_orderable boolean not null,
      category text not null,
      subcategory text not null
    );

    create table public.dawanear_marketplace_product_reviews (
      id uuid primary key default gen_random_uuid(),
      product_id text not null references public.dawanear_marketplace_products(id),
      decision text not null,
      reviewed_by_label text not null,
      evidence_note text not null,
      compliance_evidence_url text,
      expected_product_updated_at timestamptz not null,
      previous_state jsonb not null,
      resulting_state jsonb not null,
      created_at timestamptz not null default now()
    );

    create function public.dawanear_backend_contract()
    returns jsonb
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select '{
        "contract_version":"test",
        "marketplace_catalogue":{},
        "marketplace_moderation":{}
      }'::jsonb
    $$;

    insert into public.dawanear_marketplace_products (
      id, asin, publication_status, reviewed_by_label,
      compliance_evidence_url, approved_at, reviewed_at,
      compliance_status, is_active, is_orderable, category, subcategory
    ) values
      (
        'AMZ-AAAAAAAAAA', 'AAAAAAAAAA', 'approved', 'Source review',
        'https://amazon.com/a', now(), now(),
        'approved', true, true, 'Baby', 'Feeding'
      ),
      (
        'AMZ-BBBBBBBBBB', 'BBBBBBBBBB', 'approved', 'Source review',
        'https://amazon.com/b', now(), now(),
        'approved', true, true, 'Health & Household', 'Oral Care'
      ),
      (
        'AMZ-CCCCCCCCCC', 'CCCCCCCCCC', 'rejected', null,
        null, null, now(),
        'rejected', false, false, 'Baby', 'Feeding'
      );
  `);

  await db.exec(migration);
  await db.exec(enforcementMigration);

  const result = await db.query("select public.dawanear_backend_contract() as value");
  const contract = result.rows[0].value;
  assert.equal(contract.contract_version, "2026-07-16.7");
  assert.equal(contract.marketplace_catalogue.candidate_count, 3);
  assert.equal(contract.marketplace_catalogue.product_count, 2);
  assert.equal(contract.marketplace_catalogue.rejected_candidate_count, 1);
  assert.equal(contract.marketplace_catalogue.taxonomy_pair_count, 2);
  assert.equal(contract.marketplace_catalogue.minimum_taxonomy_pair_count, 1);
  assert.equal(contract.marketplace_catalogue.minimum_required_per_pair, 50);
  assert.equal(contract.marketplace_moderation.approved_without_audit_count, 0);
  assert.equal(contract.marketplace_moderation.rejected_without_audit_count, 0);
  assert.equal(contract.marketplace_moderation.audit_reconciliation_complete, true);
  assert.equal(contract.marketplace_moderation.publication_audit_constraint_trigger, true);

  const audits = await db.query(`
    select decision, count(*)::integer as count
    from public.dawanear_marketplace_product_reviews
    group by decision
    order by decision
  `);
  assert.deepEqual(audits.rows, [
    { decision: "approve", count: 2 },
    { decision: "reject", count: 1 },
  ]);

  await db.exec(`
    insert into public.dawanear_marketplace_products (
      id, asin, publication_status, compliance_status,
      is_active, is_orderable, category, subcategory
    ) values (
      'AMZ-DDDDDDDDDD', 'DDDDDDDDDD', 'research_candidate', 'pending',
      false, false, 'Baby', 'Feeding'
    );
  `);
  await assert.rejects(
    db.exec(`
      update public.dawanear_marketplace_products
      set publication_status = 'rejected', compliance_status = 'rejected'
      where id = 'AMZ-DDDDDDDDDD';
    `),
    /matching immutable audit event/,
  );
  await db.close();
});
