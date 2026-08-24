import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const database = new PGlite({ extensions: { pg_trgm } });

await database.exec(`
  create schema extensions;
  create role anon;
  create role authenticated;
  create table public.dawanear_products (
    id text primary key,
    registration_number text,
    brand_name text not null,
    generic_name text,
    strength text,
    dosage_form text,
    pack_size text,
    product_type text not null default 'human_medicine',
    category text not null default 'Medicines',
    prescription_status text not null default 'unclassified',
    regulatory_status text not null default 'valid',
    manufacturer text,
    manufacturer_country text,
    expiry_date date,
    image_url text,
    is_orderable boolean not null default true,
    is_active boolean not null default true,
    source_name text not null default 'Rwanda FDA',
    source_url text
  );
  create table public.dawanear_pharmacy_prices (
    id bigint generated always as identity primary key,
    product_id text not null references public.dawanear_products(id),
    price_rwf integer not null,
    is_current boolean not null default true
  );
`);

const migration = await readFile(
  new URL("../supabase/migrations/20260713175533_server_catalogue_search.sql", import.meta.url),
  "utf8",
);
await database.exec(migration);
await database.exec(`
  insert into public.dawanear_products (
    id, registration_number, brand_name, generic_name, strength,
    dosage_form, pack_size, category, prescription_status, is_orderable
  ) values
    ('p1', 'FDA-1', 'Panadol', 'Paracetamol', '500 mg', 'Tablet', '20 tablets', 'Medicines', 'non_prescription', true),
    ('p2', 'FDA-2', 'Brinzotim', 'Brinzolamide / Timolol', '10 mg/mL / 5 mg/mL', 'Eye drops solution', '5 mL', 'Medicines', 'prescription', true),
    ('p3', 'FDA-3', 'Omecare', 'Omeprazole', '20 mg', 'Capsule', '14 capsules', 'Medicines', 'non_prescription', true),
    ('p4', 'FDA-4', 'Gentle Skin Lotion', 'Emollient lotion', null, 'Lotion', '250 mL', 'Medicines', 'non_prescription', false),
    ('p5', 'FDA-5', 'Novorapid Flexpen', 'Insulin aspart', '100U/mL', 'Injection', '5 pens', 'Medicines', 'prescription', true);
  insert into public.dawanear_pharmacy_prices (product_id, price_rwf) values
    ('p1', 1000), ('p1', 1500), ('p3', 3000);
`);

after(async () => database.close());

test("legacy server search still ranks exact active ingredients", async () => {
  const result = await database.query(`
    select id, match_explanation, total_count
    from public.dawanear_search_catalogue('paracetamol')
  `);
  assert.deepEqual(result.rows, [{
    id: "p1",
    match_explanation: "Exact active ingredient",
    total_count: 1,
  }]);
});

test("server search supports typo and multilingual common-use recovery", async () => {
  const typo = await database.query(`
    select id, match_explanation from public.dawanear_search_catalogue('brinzolamde')
  `);
  const kinyarwanda = await database.query(`
    select id, match_explanation from public.dawanear_search_catalogue('ububabare')
  `);
  const headache = await database.query(`
    select id, match_explanation from public.dawanear_search_catalogue('umutwe', 'All products', 'all', 'all', 'all', 'relevance', 1, 0)
  `);
  assert.deepEqual(typo.rows, [{ id: "p2", match_explanation: "Close spelling match" }]);
  assert.equal(kinyarwanda.rows[0]?.id, "p1");
  assert.equal(kinyarwanda.rows[0]?.match_explanation, "Related medicine or use");
  assert.deepEqual(headache.rows, [{ id: "p1", match_explanation: "Related medicine or use" }]);
});

test("server search applies category, form and requestability filters", async () => {
  const personalCare = await database.query(`
    select id, category from public.dawanear_search_catalogue('', 'Personal care')
  `);
  const requestableTablets = await database.query(`
    select id from public.dawanear_search_catalogue('', 'All products', 'all', 'tablets', 'orderable')
    order by id
  `);
  const orderablePersonalCare = await database.query(`
    select id from public.dawanear_search_catalogue('', 'Personal care', 'all', 'all', 'orderable')
  `);
  assert.deepEqual(personalCare.rows, [{ id: "p4", category: "Personal care" }]);
  assert.deepEqual(requestableTablets.rows, [{ id: "p1" }, { id: "p3" }]);
  assert.deepEqual(orderablePersonalCare.rows, []);
});

test("server search returns a stable total across paginated results", async () => {
  const firstPage = await database.query(`
    select id, total_count from public.dawanear_search_catalogue('', 'All products', 'all', 'all', 'all', 'az', 2, 0)
  `);
  const secondPage = await database.query(`
    select id, total_count from public.dawanear_search_catalogue('', 'All products', 'all', 'all', 'all', 'az', 2, 2)
  `);
  assert.equal(firstPage.rows.length, 2);
  assert.equal(secondPage.rows.length, 2);
  assert.ok(firstPage.rows.every((row) => row.total_count === 5));
  assert.ok(secondPage.rows.every((row) => row.total_count === 5));
  assert.notDeepEqual(firstPage.rows.map((row) => row.id), secondPage.rows.map((row) => row.id));
});
