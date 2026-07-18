import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../supabase/migrations/20260718133000_govern_public_product_descriptions.sql", import.meta.url),
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
      indicative_price_rwf integer,
      indicative_price_basis text,
      indicative_price_source_url text,
      indicative_price_updated_at timestamptz
    );

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
        "api_surface":{"function_count":30,"expected_function_count":30},
        "table_surface":{"table_count":23,"expected_table_count":23}
      }'::jsonb
    $$;
  `);
  await db.exec(migration);
  return db;
}

async function insertMedicine(db, id) {
  await db.exec(`
    insert into public.dawanear_products(id) values ('${id}');
    insert into public.dawanear_product_catalog(
      id, brand_name, product_type, category, prescription_status,
      regulatory_status, source_name, source_url
    ) values (
      '${id}', 'Evidence-bound product', 'human_medicine', 'Medicines',
      'prescription', 'valid', 'Rwanda FDA', 'https://rwandafda.gov.rw/'
    );
  `);
}

async function approveDescription(db, id) {
  await db.exec(`
    update public.dawanear_products
    set description = 'A source-reviewed product description with enough detail for customers.',
        description_source_name = 'Rwanda FDA product record',
        description_source_url = 'https://rwandafda.gov.rw/product/${id}',
        description_source_sha256 = '${"a".repeat(64)}',
        description_rights_basis = 'Written reuse approval for the exact reviewed source text.',
        description_rights_reference = 'approval:description:${id}:2026-07-18',
        description_rights_verified = true,
        description_clinical_review_status = 'approved',
        description_review_note = 'Checked the exact source wording and approved this bounded public use.',
        description_reviewed_by = 'Named reviewer',
        description_reviewed_role = 'Clinical and rights reviewer',
        description_reviewed_at = '2026-07-18T13:00:00+02:00',
        description_approved = true
    where id = '${id}';
  `);
}

test("publishes only a complete source-, rights-, and review-bound description", async () => {
  const db = await database();
  await insertMedicine(db, "p1");
  await approveDescription(db, "p1");

  const catalogue = await db.query(`
    select description, description_source_name, description_source_url
    from public.dawanear_all_product_catalog where id = 'p1'
  `);
  assert.equal(catalogue.rows[0].description, "A source-reviewed product description with enough detail for customers.");
  assert.equal(catalogue.rows[0].description_source_name, "Rwanda FDA product record");
  assert.equal(catalogue.rows[0].description_source_url, "https://rwandafda.gov.rw/product/p1");

  const contract = await db.query("select public.dawanear_backend_contract() as value");
  assert.equal(contract.rows[0].value.contract_version, "2026-07-18.2");
  assert.equal(contract.rows[0].value.product_descriptions.columns_complete, true);
  assert.equal(contract.rows[0].value.product_descriptions.approved_description_count, 1);
  assert.equal(contract.rows[0].value.product_descriptions.approved_without_complete_evidence_count, 0);
  assert.equal(contract.rows[0].value.product_descriptions.public_projection_leak_count, 0);
});

test("grants public catalogue callers only the governed source columns required by the security-invoker view", async () => {
  const db = await database();
  const privileges = await db.query(`
    select
      has_table_privilege('anon', 'public.dawanear_products', 'select') as broad_table_select,
      has_column_privilege('anon', 'public.dawanear_products', 'description', 'select') as public_description_select,
      has_column_privilege('authenticated', 'public.dawanear_products', 'indicative_price_rwf', 'select') as price_select,
      has_column_privilege('anon', 'public.dawanear_products', 'description_review_note', 'select') as private_review_note_select,
      has_column_privilege('authenticated', 'public.dawanear_products', 'description_source_sha256', 'select') as private_source_digest_select
  `);

  assert.equal(privileges.rows[0].broad_table_select, false);
  assert.equal(privileges.rows[0].public_description_select, true);
  assert.equal(privileges.rows[0].price_select, true);
  assert.equal(privileges.rows[0].private_review_note_select, false);
  assert.equal(privileges.rows[0].private_source_digest_select, false);
  assert.doesNotMatch(
    migration,
    /grant\s+select\s+on\s+table\s+public\.dawanear_products/i,
    "the migration must never grant broad SELECT on the governed product table",
  );
});

test("rejects approval when source, rights, clinical, or named-review evidence is incomplete", async () => {
  const db = await database();
  await insertMedicine(db, "p2");
  await assert.rejects(
    db.exec(`
      update public.dawanear_products
      set description = 'A plausible description that has not been governed or approved.',
          description_approved = true
      where id = 'p2';
    `),
    /dawanear_products_approved_description_evidence/,
  );
});

test("rejects prohibited marketplace references in description text or evidence", async () => {
  const db = await database();
  await insertMedicine(db, "p-prohibited");
  await assert.rejects(
    db.exec(`
      update public.dawanear_products
      set description = 'A product description copied from Amazon marketplace content.'
      where id = 'p-prohibited';
    `),
    /dawanear_products_description_no_prohibited_reference/,
  );
  await assert.rejects(
    db.exec(`
      update public.dawanear_products
      set description_source_name = 'Amazon product page'
      where id = 'p-prohibited';
    `),
    /dawanear_products_description_no_prohibited_reference/,
  );
});

test("requires a newer accountable review when approved wording or evidence changes", async () => {
  const db = await database();
  await insertMedicine(db, "p3");
  await approveDescription(db, "p3");
  await assert.rejects(
    db.exec(`
      update public.dawanear_products
      set description = 'Changed public wording that still needs a new accountable review.'
      where id = 'p3';
    `),
    /requires a newer accountable review/,
  );
});

test("keeps drafts private and removes a withdrawn description from the public projection", async () => {
  const db = await database();
  await insertMedicine(db, "p4");
  await db.exec(`
    update public.dawanear_products
    set description = 'A private draft description retained for later accountable review.'
    where id = 'p4';
  `);
  let catalogue = await db.query("select description from public.dawanear_all_product_catalog where id = 'p4'");
  assert.equal(catalogue.rows[0].description, null);

  await approveDescription(db, "p4");
  await db.exec("update public.dawanear_products set description_approved = false where id = 'p4';");
  catalogue = await db.query("select description from public.dawanear_all_product_catalog where id = 'p4'");
  assert.equal(catalogue.rows[0].description, null);
});
