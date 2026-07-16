import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";


const migration = await readFile(
  new URL("../supabase/migrations/20260716140000_product_image_gallery.sql", import.meta.url),
  "utf8",
);
const optionalCoverageMigration = await readFile(
  new URL(
    "../supabase/migrations/20260716161000_make_verified_product_images_optional.sql",
    import.meta.url,
  ),
  "utf8",
);
const verifiedRightsMigration = await readFile(
  new URL(
    "../supabase/migrations/20260716170000_enforce_verified_product_image_rights.sql",
    import.meta.url,
  ),
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema dawanear_private;
    create schema storage;

    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );

    create table public.dawanear_products (
      id text primary key,
      is_active boolean not null default true,
      image_url text,
      image_source text
    );

    create table public.dawanear_marketplace_products (
      id text primary key references public.dawanear_products(id),
      image_url text,
      image_source text
    );

    create view public.dawanear_all_product_catalog as
    select id from public.dawanear_products where is_active;

    create function public.dawanear_backend_contract()
    returns jsonb
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select '{
        "contract_version":"test",
        "api_surface":{"function_count":29,"expected_function_count":28},
        "table_surface":{
          "table_count":22,
          "expected_table_count":21,
          "anonymous_select_count":1,
          "unexpected_authenticated_select_count":1,
          "missing_authenticated_select_count":1,
          "unexpected_deny_by_default_count":1
        }
      }'::jsonb
    $$;
  `);
  await db.exec(migration);
  await db.exec(optionalCoverageMigration);
  await db.exec(verifiedRightsMigration);
  return db;
}

function image(position) {
  const digit = String(position);
  return {
    public_url: `https://project.supabase.co/storage/v1/object/public/product-images/v1/p1/${digit.repeat(64)}-${position}.webp`,
    storage_path: `v1/p1/${digit.repeat(64)}-${position}.webp`,
    source_page_url: `https://manufacturer.example/product/p1?view=${position}`,
    source_image_url: `https://manufacturer.example/images/p1-${position}.jpg`,
    source_domain: "manufacturer.example",
    source_kind: "manufacturer",
    rights_basis: "Manufacturer product page approved for MED+250 catalogue use.",
    rights_verified: true,
    width: 1400,
    height: 1400,
    quality_score: 95 - position,
    content_sha256: digit.repeat(64),
    perceptual_hash: digit.repeat(16),
    background_removed: true,
    checked_at: "2026-07-16T08:00:00Z",
  };
}

test("publishes exactly three distinct images and links the primary catalogue image", async () => {
  const db = await database();
  await db.exec(`
    insert into public.dawanear_products(id) values ('p1');
    insert into public.dawanear_marketplace_products(id) values ('p1');
  `);
  const payload = JSON.stringify([image(1), image(2), image(3)]).replaceAll("'", "''");
  await db.exec(
    `select public.dawanear_publish_product_images('p1', '${payload}'::jsonb);`,
  );
  const gallery = await db.query(`
    select position, public_url, background_removed, rights_verified, approved
    from public.dawanear_product_images
    where product_id = 'p1'
    order by position
  `);
  assert.equal(gallery.rows.length, 3);
  assert.deepEqual(gallery.rows.map((row) => row.position), [1, 2, 3]);
  assert.ok(gallery.rows.every((row) => row.background_removed));
  assert.ok(gallery.rows.every((row) => row.rights_verified && row.approved));

  const product = await db.query(
    "select image_url, image_source from public.dawanear_products where id = 'p1'",
  );
  assert.equal(product.rows[0].image_url, image(1).public_url);
  assert.match(product.rows[0].image_source, /verified product-image pipeline/);

  const contract = await db.query("select public.dawanear_backend_contract() as value");
  assert.equal(contract.rows[0].value.contract_version, "2026-07-16.8");
  assert.equal(contract.rows[0].value.api_surface.expected_function_count, 29);
  assert.equal(contract.rows[0].value.table_surface.expected_table_count, 22);
  assert.equal(contract.rows[0].value.product_images.complete_product_count, 1);
  assert.equal(contract.rows[0].value.product_images.missing_product_count, 0);
  assert.equal(contract.rows[0].value.product_images.coverage_required, false);
  assert.equal(contract.rows[0].value.product_images.missing_images_hidden, true);
  assert.equal(contract.rows[0].value.product_images.generated_placeholders_allowed, false);
  assert.equal(contract.rows[0].value.product_images.rights_verified_required, true);
  assert.equal(contract.rows[0].value.product_images.rights_verified_column_exists, true);
  assert.equal(
    contract.rows[0].value.product_images.approved_rights_constraint_validated,
    true,
  );
  assert.equal(
    contract.rows[0].value.product_images.public_policy_requires_verified,
    true,
  );
  assert.equal(contract.rows[0].value.product_images.partial_product_count, 0);
});

test("rejects publication unless exactly three images are supplied", async () => {
  const db = await database();
  await db.exec("insert into public.dawanear_products(id) values ('p1');");
  const payload = JSON.stringify([image(1), image(2)]).replaceAll("'", "''");
  await assert.rejects(
    db.exec(`select public.dawanear_publish_product_images('p1', '${payload}'::jsonb);`),
    /Exactly three product images are required/,
  );
});

test("rejects galleries without explicit verified reuse rights", async () => {
  const db = await database();
  await db.exec("insert into public.dawanear_products(id) values ('p1');");
  const images = [image(1), image(2), image(3)];
  delete images[1].rights_verified;
  const payload = JSON.stringify(images).replaceAll("'", "''");
  await assert.rejects(
    db.exec(`select public.dawanear_publish_product_images('p1', '${payload}'::jsonb);`),
    /Every product image requires explicit verified reuse rights/,
  );
});

test("no migration re-enables automated publication without verified rights", async () => {
  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const sql = await readFile(new URL(filename, migrationDirectory), "utf8");
    assert.doesNotMatch(
      sql,
      /drop constraint(?: if exists)? dawanear_product_images_approved_rights_verified/i,
      `${filename} removes the product-image rights constraint`,
    );
    assert.doesNotMatch(
      sql,
      /set approved = background_removed/i,
      `${filename} republishes images without a rights decision`,
    );
    assert.doesNotMatch(
      sql,
      /MED\+250 automated product-image pipeline/i,
      `${filename} restores ungoverned automated image publication`,
    );
  }
});
