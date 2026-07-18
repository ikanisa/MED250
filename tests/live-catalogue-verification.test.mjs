import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  assessLiveCatalogueEvidence,
  validateSupabaseOrigin,
} from "../scripts/verify-live-catalogue.mjs";

function row(id, total, brand = id, generic = "") {
  return { id, total_count: total, brand_name: brand, generic_name: generic };
}

function completeEvidence() {
  const sourceIds = Array.from({ length: 121 }, (_, index) => `p${String(index + 1).padStart(3, "0")}`);
  const pages = [0, 50, 100].map((offset) => ({
    offset,
    rows: sourceIds.slice(offset, offset + 50).map((id) => row(id, sourceIds.length)),
  }));
  const departments = ["Medicines", "Beauty & Personal Care", "Baby", "Health & Household"]
    .map((department) => ({ department, total: 1 }));
  const tokens = {
    paracetamol: "Paracetamol",
    zinc: "Zinc",
    omeprazole: "Omeprazole",
    typo: "Brinzolamide",
    french: "Paracetamol",
    kinyarwanda: "Paracetamol",
  };
  const searches = Object.entries(tokens).map(([id, generic]) => ({
    id,
    total: 1,
    sample: [{ id: `${id}-1`, brand: "Example", generic }],
  }));
  return { sourceIds, pages, pageSize: 50, departments, searches };
}

test("proves complete, duplicate-free live pagination and required search reach", () => {
  const result = assessLiveCatalogueEvidence(completeEvidence());
  assert.deepEqual(result.errors, []);
  assert.equal(result.status, "passed");
  assert.equal(result.boundaryProducts.product25, "p025");
  assert.equal(result.boundaryProducts.product120, "p120");
  assert.equal(result.boundaryProducts.finalProduct, "p121");
});

test("fails on source drift, duplicate pages, empty departments, and missing multilingual search", () => {
  const evidence = completeEvidence();
  evidence.pages[1].rows[0].id = "p001";
  evidence.departments.find(({ department }) => department === "Baby").total = 0;
  evidence.searches.find(({ id }) => id === "kinyarwanda").sample = [];
  evidence.searches.find(({ id }) => id === "kinyarwanda").total = 0;
  const result = assessLiveCatalogueEvidence(evidence);
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("duplicate product IDs")));
  assert.ok(result.errors.some((error) => error.includes("outside the governed source index") || error.includes("missing")));
  assert.ok(result.errors.some((error) => error.includes("Baby")));
  assert.ok(result.errors.some((error) => error.includes("kinyarwanda")));
});

test("restricts live catalogue verification to a clean Supabase project origin", () => {
  const origin = "https://uskfnszcdqpcfrhjxitl.supabase.co";
  assert.equal(validateSupabaseOrigin(origin), origin);
  assert.throws(() => validateSupabaseOrigin("http://uskfnszcdqpcfrhjxitl.supabase.co"), /requires HTTPS/);
  assert.throws(() => validateSupabaseOrigin(`${origin}/rest/v1`), /without a path/);
  assert.throws(() => validateSupabaseOrigin("https://example.com"), /Supabase project origin/);
});

test("restores approved French and Kinyarwanda queries on both public search contracts", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create role anon;
      create role authenticated;
      create table public.catalogue_fixture (
        id text primary key,
        registration_number text,
        brand_name text,
        generic_name text,
        strength text,
        dosage_form text,
        pack_size text,
        product_type text,
        category text,
        department text,
        subcategory text,
        prescription_status text,
        regulatory_status text,
        manufacturer text,
        manufacturer_country text,
        expiry_date date,
        image_url text,
        is_orderable boolean,
        source_name text,
        source_url text,
        price_min_rwf integer,
        price_max_rwf integer,
        price_contributors bigint,
        amazon_product_url text,
        indicative_price_rwf integer,
        price_is_indicative boolean,
        indicative_price_basis text,
        indicative_price_source_url text,
        indicative_price_updated_at timestamptz
      );
      insert into public.catalogue_fixture (
        id, brand_name, generic_name, product_type, category, department,
        prescription_status, regulatory_status, is_orderable, source_name
      ) values
        ('p1', 'Panadol', 'Paracetamol', 'medicine', 'Medicines', 'Medicines', 'non_prescription', 'valid', true, 'Rwanda FDA'),
        ('p2', 'Brinzox', 'Brinzolamide', 'medicine', 'Medicines', 'Medicines', 'prescription', 'valid', true, 'Rwanda FDA');

      create function public.dawanear_search_marketplace_catalogue(
        p_query text default '', p_category text default 'All products',
        p_prescription_status text default 'all', p_form_group text default 'all',
        p_availability text default 'all', p_sort text default 'relevance',
        p_limit integer default 24, p_offset integer default 0
      )
      returns table(
        id text, registration_number text, brand_name text, generic_name text,
        strength text, dosage_form text, pack_size text, product_type text,
        category text, department text, subcategory text, prescription_status text,
        regulatory_status text, manufacturer text, manufacturer_country text,
        expiry_date date, image_url text, is_orderable boolean, source_name text,
        source_url text, price_min_rwf integer, price_max_rwf integer,
        price_contributors bigint, amazon_product_url text, indicative_price_rwf integer,
        price_is_indicative boolean, indicative_price_basis text,
        indicative_price_source_url text, indicative_price_updated_at timestamptz,
        match_score double precision, match_explanation text, total_count bigint
      ) language sql stable set search_path = '' as $$
        select fixture.*, 1000::double precision, 'Exact active ingredient'::text, count(*) over ()
        from public.catalogue_fixture as fixture
        where lower(coalesce(fixture.brand_name, '') || ' ' || coalesce(fixture.generic_name, ''))
          like '%' || lower(trim(coalesce(p_query, ''))) || '%'
        order by fixture.id
        limit p_limit offset p_offset
      $$;
    `);
    const migration = await readFile(new URL("../supabase/migrations/20260718121000_restore_multilingual_marketplace_search.sql", import.meta.url), "utf8");
    await database.exec(migration);
    const french = await database.query("select id from public.dawanear_search_marketplace_catalogue('douleur')");
    const kinyarwanda = await database.query("select id from public.dawanear_search_marketplace_catalogue('ububabare')");
    const legacy = await database.query("select id from public.dawanear_search_catalogue('douleur')");
    assert.deepEqual(french.rows, [{ id: "p1" }]);
    assert.deepEqual(kinyarwanda.rows, [{ id: "p1" }]);
    assert.deepEqual(legacy.rows, [{ id: "p1" }]);
  } finally {
    await database.close();
  }
});

test("never prints the public key or accepts it as a command-line argument", async () => {
  const source = await readFile(new URL("../scripts/verify-live-catalogue.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /--publishable-key/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*publishableKey/);
});
