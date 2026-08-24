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
  "20260716190000_reassert_verified_product_image_governance.sql",
  "20260716201536_support_23977_automated_product_images.sql",
];
const migrations = await Promise.all(
  migrationFiles.map((filename) =>
    readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"),
  ),
);
const workerScript = await readFile(
  new URL("../scripts/run_product_image_worker.zsh", import.meta.url),
  "utf8",
);
const monitorScript = await readFile(
  new URL("../scripts/monitor_product_image_pipeline.zsh", import.meta.url),
  "utf8",
);

function image(position) {
  const digit = String(position);
  return {
    public_url: `https://project.supabase.co/storage/v1/object/public/product-images/v1/p1/${digit.repeat(64)}-${position}.webp`,
    storage_path: `v1/p1/${digit.repeat(64)}-${position}.webp`,
    source_page_url: `https://retailer.example/product/p1?view=${position}`,
    source_image_url: `https://retailer.example/images/p1-${position}.jpg`,
    source_domain: "retailer.example",
    source_kind: "specialist_retailer",
    rights_basis:
      "Public product listing discovered automatically; source URLs retained.",
    rights_verified: false,
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
      select id, image_url from public.dawanear_products where is_active;
    create function public.dawanear_backend_contract()
    returns jsonb language sql stable security definer set search_path = ''
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

test("publishes five or six unverified-provenance images without manual approval", async () => {
  const db = await database();
  await db.exec(`
    insert into public.dawanear_products(id) values ('p1');
    insert into public.dawanear_marketplace_products(id) values ('p1');
  `);
  const five = JSON.stringify([1, 2, 3, 4, 5].map(image)).replaceAll("'", "''");
  await db.exec(
    `select public.dawanear_publish_product_images('p1', '${five}'::jsonb);`,
  );
  let gallery = await db.query(`
    select position, approved, background_removed, rights_verified
    from public.dawanear_product_images order by position
  `);
  assert.equal(gallery.rows.length, 5);
  assert.ok(gallery.rows.every((row) => row.approved && row.background_removed));
  assert.ok(gallery.rows.every((row) => !row.rights_verified));

  const six = JSON.stringify([1, 2, 3, 4, 5, 6].map(image)).replaceAll("'", "''");
  await db.exec(
    `select public.dawanear_publish_product_images('p1', '${six}'::jsonb);`,
  );
  gallery = await db.query(
    "select position from public.dawanear_product_images order by position",
  );
  assert.deepEqual(gallery.rows.map((row) => row.position), [1, 2, 3, 4, 5, 6]);

  const contract = await db.query(
    "select public.dawanear_backend_contract() as value",
  );
  assert.equal(contract.rows[0].value.contract_version, "2026-07-16.11");
  assert.equal(
    contract.rows[0].value.product_images.publication_mode,
    "automated_provenance",
  );
  assert.equal(contract.rows[0].value.product_images.target_image_count, 23977);
  assert.equal(contract.rows[0].value.product_images.approved_image_count, 6);
});

test("rejects galleries outside the three-to-six range", async () => {
  const db = await database();
  await db.exec("insert into public.dawanear_products(id) values ('p1');");
  for (const positions of [[1, 2], [1, 2, 3, 4, 5, 6, 7]]) {
    const payload = JSON.stringify(positions.map(image)).replaceAll("'", "''");
    await assert.rejects(
      db.exec(
        `select public.dawanear_publish_product_images('p1', '${payload}'::jsonb);`,
      ),
      /Between three and six product images are required/,
    );
  }
});

test("DDL guard protects the automated background-removal contract", async () => {
  const db = await database();
  await assert.rejects(
    db.exec(`
      alter table public.dawanear_product_images
        drop constraint dawanear_product_images_approved_background_removed;
    `),
    /automated product-image governance DDL is protected/,
  );
});

test("workers avoid redundant contract repairs and retry transient Supabase errors", () => {
  assert.match(workerScript, /CONTRACT_CACHE_SECONDS=600/);
  assert.match(workerScript, /contract_cache_is_fresh/);
  assert.match(workerScript, /mkdir "\$CONTRACT_LOCK"/);
  assert.match(workerScript, /if \(\( contract_state == 1 \)\); then/);
  assert.match(
    workerScript,
    /contract endpoint is temporarily unavailable; retrying in 20 seconds/,
  );
  assert.doesNotMatch(
    workerScript,
    /if ! contract_is_current && ! repair_contract; then/,
  );
  assert.match(workerScript, /--retry 4/);
  assert.match(workerScript, /--retry-all-errors/);
  assert.match(monitorScript, /--retry 4/);
  assert.match(monitorScript, /--retry-all-errors/);
});
