import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationFiles = [
  "20260716140000_product_image_gallery.sql",
  "20260716161000_make_verified_product_images_optional.sql",
  "20260716170000_enforce_verified_product_image_rights.sql",
  "20260716173000_enforce_runtime_product_image_publication_guard.sql",
  "20260716175000_protect_product_image_governance_ddl.sql",
];
const migrations = await Promise.all(
  migrationFiles.map((filename) =>
    readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"),
  ),
);
const rejectedRegression = await readFile(
  new URL(
    "../supabase/rejected-migrations/20260716180000_restore_automated_product_image_publication.sql.rejected",
    import.meta.url,
  ),
  "utf8",
);
const repairMigration = await readFile(
  new URL(
    "../supabase/migrations/20260716190000_reassert_verified_product_image_governance.sql",
    import.meta.url,
  ),
  "utf8",
);

function image(position, rightsVerified = false) {
  const digit = String(position);
  return {
    public_url: `https://project.supabase.co/storage/v1/object/public/product-images/v1/p1/${digit.repeat(64)}-${position}.webp`,
    storage_path: `v1/p1/${digit.repeat(64)}-${position}.webp`,
    source_page_url: `https://manufacturer.example/product/p1?view=${position}`,
    source_image_url: `https://manufacturer.example/images/p1-${position}.jpg`,
    source_domain: "manufacturer.example",
    source_kind: "manufacturer",
    rights_basis: rightsVerified
      ? "Signed manufacturer catalogue licence dated 2026-07-10."
      : "Automated public listing discovery; reuse rights not independently verified.",
    rights_verified: rightsVerified,
    width: 1400,
    height: 1400,
    quality_score: 95 - position,
    content_sha256: digit.repeat(64),
    perceptual_hash: digit.repeat(16),
    background_removed: true,
    checked_at: "2026-07-16T08:00:00Z",
  };
}

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
  for (const migration of migrations) await db.exec(migration);
  return db;
}

test("forward repair de-publishes unverified galleries and restores every governance layer", async () => {
  const db = await database();
  await db.exec(`
    insert into public.dawanear_products(id) values ('p1');
    insert into public.dawanear_marketplace_products(id) values ('p1');
  `);

  await db.exec(rejectedRegression);

  const unsafePayload = JSON.stringify([
    image(1),
    image(2),
    image(3),
  ]).replaceAll("'", "''");
  await db.exec(
    `select public.dawanear_publish_product_images('p1', '${unsafePayload}'::jsonb);`,
  );

  const unsafe = await db.query(`
    select count(*)::integer as count
    from public.dawanear_product_images
    where approved and not rights_verified
  `);
  assert.equal(unsafe.rows[0].count, 3);

  await db.exec(repairMigration);

  const repaired = await db.query(`
    select
      count(*) filter (where approved)::integer as approved,
      count(*) filter (where not rights_verified)::integer as retained_unverified
    from public.dawanear_product_images
  `);
  assert.equal(repaired.rows[0].approved, 0);
  assert.equal(repaired.rows[0].retained_unverified, 3);

  const product = await db.query(`
    select image_url, image_source
    from public.dawanear_products
    where id = 'p1'
  `);
  assert.equal(product.rows[0].image_url, null);
  assert.equal(product.rows[0].image_source, null);

  const contract = await db.query(
    "select public.dawanear_backend_contract() as value",
  );
  assert.equal(
    contract.rows[0].value.product_images.approved_rights_constraint_validated,
    true,
  );
  assert.equal(
    contract.rows[0].value.product_images.public_policy_requires_verified,
    true,
  );
  assert.equal(
    contract.rows[0].value.product_images.publication_guard_trigger_exists,
    true,
  );
  assert.equal(
    contract.rows[0].value.product_images.ddl_guard_event_trigger_exists,
    true,
  );
  assert.equal(contract.rows[0].value.product_images.partial_product_count, 0);
  assert.equal(contract.rows[0].value.product_images.unsafe_image_count, 0);

  await assert.rejects(
    db.exec(
      `select public.dawanear_publish_product_images('p1', '${unsafePayload}'::jsonb);`,
    ),
    /explicit verified reuse rights and a durable rights basis/,
  );

  await assert.rejects(
    db.exec(`
      alter table public.dawanear_product_images
        drop constraint dawanear_product_images_approved_rights_verified;
    `),
    /MED\+250 product-image governance DDL is protected/,
  );
});
