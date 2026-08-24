import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const descriptionMigration = await readFile(
  new URL("../supabase/migrations/20260718133000_govern_public_product_descriptions.sql", import.meta.url),
  "utf8",
);
const workflowMigration = await readFile(
  new URL("../supabase/migrations/20260718143000_govern_product_description_reviews.sql", import.meta.url),
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema dawanear_private;

    create table public.dawanear_products (
      id text primary key,
      brand_name text not null default 'Evidence-bound product',
      generic_name text,
      strength text,
      dosage_form text,
      pack_size text,
      product_type text not null default 'human_medicine',
      category text not null default 'Medicines',
      source_name text not null default 'Rwanda FDA',
      source_url text not null default 'https://rwandafda.gov.rw/',
      indicative_price_rwf integer,
      indicative_price_basis text,
      indicative_price_source_url text,
      indicative_price_updated_at timestamptz,
      updated_at timestamptz not null default now()
    );

    create function dawanear_private.dawanear_touch_updated_at()
    returns trigger language plpgsql set search_path = '' as $$
    begin new.updated_at := clock_timestamp(); return new; end;
    $$;
    create trigger dawanear_products_touch before update on public.dawanear_products
    for each row execute function dawanear_private.dawanear_touch_updated_at();

    create table public.dawanear_marketplace_products (
      id text primary key references public.dawanear_products(id),
      registration_number text,
      product_name text not null,
      generic_name text,
      strength text,
      dosage_form text,
      pack_size text,
      product_type text not null,
      category text not null,
      subcategory text,
      manufacturer text,
      manufacturer_country text,
      expiry_date date,
      image_url text,
      is_orderable boolean not null default false,
      is_active boolean not null default false,
      source_name text not null,
      source_url text not null,
      amazon_product_url text,
      publication_status text not null default 'research_candidate'
    );

    create table public.dawanear_product_catalog (
      id text primary key,
      registration_number text,
      brand_name text not null,
      generic_name text,
      strength text,
      dosage_form text,
      pack_size text,
      product_type text not null,
      category text not null,
      prescription_status text not null,
      regulatory_status text not null,
      manufacturer text,
      manufacturer_country text,
      expiry_date date,
      image_url text,
      is_orderable boolean not null default true,
      source_name text not null,
      source_url text not null,
      price_min_rwf integer,
      price_max_rwf integer,
      price_contributors bigint not null default 0,
      indicative_price_rwf integer,
      price_is_indicative boolean not null default false,
      indicative_price_basis text,
      indicative_price_source_url text,
      indicative_price_updated_at timestamptz
    );

    create view public.dawanear_all_product_catalog as
    select
      catalogue.id, catalogue.registration_number, catalogue.brand_name,
      catalogue.generic_name, catalogue.strength, catalogue.dosage_form,
      catalogue.pack_size, catalogue.product_type, catalogue.category,
      catalogue.category as department, null::text as subcategory,
      catalogue.prescription_status, catalogue.regulatory_status,
      catalogue.manufacturer, catalogue.manufacturer_country,
      catalogue.expiry_date, catalogue.image_url, catalogue.is_orderable,
      catalogue.source_name, catalogue.source_url,
      catalogue.price_min_rwf, catalogue.price_max_rwf,
      catalogue.price_contributors, null::text as amazon_product_url,
      catalogue.indicative_price_rwf, catalogue.price_is_indicative,
      catalogue.indicative_price_basis, catalogue.indicative_price_source_url,
      catalogue.indicative_price_updated_at
    from public.dawanear_product_catalog as catalogue;

    create function public.dawanear_backend_contract()
    returns jsonb language sql stable security definer set search_path = ''
    as $$
      select '{
        "contract_version":"test",
        "api_surface":{"function_count":31,"expected_function_count":30},
        "table_surface":{"table_count":24,"expected_table_count":23,"unexpected_deny_by_default_count":1}
      }'::jsonb
    $$;
  `);
  await db.exec(descriptionMigration);
  await db.exec(workflowMigration);
  return db;
}

async function insertMedicine(db, id = "rwanda-fda-hm-0001") {
  await db.query("insert into public.dawanear_products(id) values ($1)", [id]);
  await db.query(`
    insert into public.dawanear_product_catalog(
      id, brand_name, product_type, category, prescription_status,
      regulatory_status, source_name, source_url
    ) values ($1, 'Evidence-bound product', 'human_medicine', 'Medicines',
      'prescription', 'valid', 'Rwanda FDA', 'https://rwandafda.gov.rw/')
  `, [id]);
  const result = await db.query("select updated_at from public.dawanear_products where id = $1", [id]);
  return result.rows[0].updated_at;
}

const description = "A source-reviewed product description with bounded, customer-relevant information.";
const sourceDigest = "a".repeat(64);

async function decide(db, { id = "rwanda-fda-hm-0001", decision = "approve", expectedUpdatedAt, reviewedAt = "2026-07-18T10:00:00+02:00" }) {
  return db.query(`
    select public.dawanear_review_product_description(
      $1, $2, $3, 'Named reviewer', 'Clinical and rights reviewer', $4,
      'Checked the exact source wording, rights evidence, and public-use boundary.',
      $5, 'Rwanda FDA product record', 'https://rwandafda.gov.rw/product/1', $6,
      'Written reuse approval for the exact reviewed source text.',
      'approval:description:1:2026-07-18', true, 'approved'
    ) as value
  `, [id, decision, expectedUpdatedAt, reviewedAt, description, sourceDigest]);
}

test("approves exactly one description and records the complete immutable evidence event", async () => {
  const db = await database();
  const expectedUpdatedAt = await insertMedicine(db);
  const result = await decide(db, { expectedUpdatedAt });
  assert.equal(result.rows[0].value.approved, true);

  const catalogue = await db.query("select description from public.dawanear_all_product_catalog where id = 'rwanda-fda-hm-0001'");
  assert.equal(catalogue.rows[0].description, description);
  const reviews = await db.query("select * from public.dawanear_product_description_reviews");
  assert.equal(reviews.rows.length, 1);
  assert.equal(reviews.rows[0].decision, "approve");
  assert.equal(reviews.rows[0].source_sha256, sourceDigest);
  assert.equal(reviews.rows[0].resulting_state.description, description);

  const contract = await db.query("select public.dawanear_backend_contract() as value");
  assert.equal(contract.rows[0].value.contract_version, "2026-07-18.3");
  assert.equal(contract.rows[0].value.product_description_workflow.review_table_service_only, true);
  assert.equal(contract.rows[0].value.product_description_workflow.approved_without_current_audit_count, 0);
  assert.equal(contract.rows[0].value.api_surface.expected_function_count, 31);
  assert.equal(contract.rows[0].value.table_surface.expected_table_count, 24);
});

test("rejects stale decisions and direct publication outside the governed workflow", async () => {
  const db = await database();
  const expectedUpdatedAt = await insertMedicine(db);
  await db.exec("update public.dawanear_products set generic_name = 'Changed after inspection' where id = 'rwanda-fda-hm-0001'");
  await assert.rejects(decide(db, { expectedUpdatedAt }), /changed after inspection/i);

  const current = await db.query("select updated_at from public.dawanear_products where id = 'rwanda-fda-hm-0001'");
  await assert.rejects(db.query(`
    update public.dawanear_products set
      description = $1,
      description_source_name = 'Rwanda FDA product record',
      description_source_url = 'https://rwandafda.gov.rw/product/1',
      description_source_sha256 = $2,
      description_rights_basis = 'Written reuse approval for the exact reviewed source text.',
      description_rights_reference = 'approval:description:1:2026-07-18',
      description_rights_verified = true,
      description_clinical_review_status = 'approved',
      description_review_note = 'Checked the exact source wording and approved this bounded public use.',
      description_reviewed_by = 'Named reviewer',
      description_reviewed_role = 'Clinical and rights reviewer',
      description_reviewed_at = '2026-07-18T10:00:00+02:00',
      description_approved = true
    where id = 'rwanda-fda-hm-0001'
  `, [description, sourceDigest]), /governed review workflow/i);
  assert.ok(current.rows[0].updated_at);
});

test("withdrawal immediately hides public copy and preserves an immutable two-event history", async () => {
  const db = await database();
  const expectedUpdatedAt = await insertMedicine(db);
  const approved = await decide(db, { expectedUpdatedAt });
  const withdrawn = await decide(db, {
    decision: "withdraw",
    expectedUpdatedAt: approved.rows[0].value.updated_at,
    reviewedAt: "2026-07-18T10:30:00+02:00",
  });
  assert.equal(withdrawn.rows[0].value.approved, false);
  const catalogue = await db.query("select description from public.dawanear_all_product_catalog where id = 'rwanda-fda-hm-0001'");
  assert.equal(catalogue.rows[0].description, null);
  const reviews = await db.query("select decision from public.dawanear_product_description_reviews order by created_at, id");
  assert.deepEqual(reviews.rows.map(({ decision }) => decision).toSorted(), ["approve", "withdraw"]);
  await assert.rejects(
    db.exec("delete from public.dawanear_product_description_reviews"),
    /audit records are immutable/i,
  );
});

test("keeps the review function service-only and the audit table deny-by-default", async () => {
  const db = await database();
  const signature = "public.dawanear_review_product_description(text,text,timestamptz,text,text,timestamptz,text,text,text,text,text,text,text,boolean,text)";
  const privileges = await db.query(`
    select
      has_function_privilege('service_role', $1, 'execute') as service_execute,
      has_function_privilege('anon', $1, 'execute') as anon_execute,
      has_function_privilege('authenticated', $1, 'execute') as authenticated_execute,
      has_table_privilege('service_role', 'public.dawanear_product_description_reviews', 'select,insert') as service_table,
      has_table_privilege('anon', 'public.dawanear_product_description_reviews', 'select') as anon_table
  `, [signature]);
  assert.deepEqual(privileges.rows[0], {
    service_execute: true,
    anon_execute: false,
    authenticated_execute: false,
    service_table: true,
    anon_table: false,
  });
});
