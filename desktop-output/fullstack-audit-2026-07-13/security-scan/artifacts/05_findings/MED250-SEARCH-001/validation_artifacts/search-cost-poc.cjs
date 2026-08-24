const { readFile } = require("node:fs/promises");
const { performance } = require("node:perf_hooks");
const { PGlite } = require("/Volumes/PRO-G40/MED250/node_modules/@electric-sql/pglite/dist/index.cjs");
const { pg_trgm } = require("/Volumes/PRO-G40/MED250/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.cjs");

(async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    create schema extensions;
    create role anon;
    create role authenticated;
    create table public.dawanear_products (
      id text primary key, registration_number text, brand_name text not null,
      generic_name text, strength text, dosage_form text, pack_size text,
      product_type text not null default 'human_medicine',
      category text not null default 'Medicines',
      prescription_status text not null default 'unclassified',
      regulatory_status text not null default 'valid',
      manufacturer text, manufacturer_country text, expiry_date date,
      image_url text, is_orderable boolean not null default true,
      is_active boolean not null default true,
      source_name text not null default 'Rwanda FDA', source_url text
    );
    create table public.dawanear_pharmacy_prices (
      id bigint generated always as identity primary key,
      product_id text not null references public.dawanear_products(id),
      price_rwf integer not null, is_current boolean not null default true
    );
  `);
  await db.exec(await readFile(
    "/Volumes/PRO-G40/MED250/supabase/migrations/20260713184500_server_catalogue_search.sql",
    "utf8",
  ));
  await db.exec(`
    insert into public.dawanear_products (
      id, registration_number, brand_name, generic_name, strength, dosage_form, pack_size
    )
    select 'p' || g, 'FDA-' || g, 'Product ' || g,
      case when g % 11 = 0 then 'paracetamol' else 'generic ' || g end,
      '500 mg', 'Tablet', '20 tablets'
    from generate_series(1, 2459) as g;
    insert into public.dawanear_pharmacy_prices (product_id, price_rwf)
    select 'p' || g, 1000 + g from generate_series(1, 2459) as g;
  `);
  for (const query of ["", "paracetamol", "zzzzzzzzzzzzzzzzzzzz"]) {
    const started = performance.now();
    const result = await db.query(
      "select count(*) as n, max(total_count) as total from public.dawanear_search_catalogue($1)",
      [query],
    );
    console.log(JSON.stringify({
      query,
      milliseconds: Number((performance.now() - started).toFixed(1)),
      result: result.rows[0],
    }));
  }
  await db.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
