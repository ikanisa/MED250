import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const migrations = new URL("../db/d1/migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((value) => value.endsWith(".sql")).sort()) {
    database.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  return database;
}

function seedProductAndReceipt(database) {
  const at = "2026-08-24T00:00:00.000Z";
  database.exec(`
    INSERT INTO med250_catalogue_products (
      id, source_kind, source_name, brand_name, product_type, category, department,
      prescription_status, regulatory_status, publication_status, is_orderable,
      is_active, created_at, updated_at
    ) VALUES (
      'AMZ-B000000000', 'governed_consumer_catalogue', 'Amazon partner fixture',
      'Rights fixture', 'consumer', 'Health', 'Health', 'not_applicable', 'not_applicable',
      'approved', 1, 1, '${at}', '${at}'
    );
    INSERT INTO med250_catalogue_media_recovery_receipts (
      id, source_project_ref, source_snapshot_sha256, import_snapshot_sha256,
      source_manifest, gallery_count, image_count, byte_count, target, imported_at
    ) VALUES (
      'rights-fixture-receipt', 'uskfnszcdqpcfrhjxitl', '${"a".repeat(64)}',
      '${"b".repeat(64)}', '{}', 1, 3, 3000, 'staging', '${at}'
    );
  `);
}

function imageInsert(overrides = {}) {
  const values = {
    position: 1,
    domain: "www.amazon.com",
    hash: "c".repeat(64),
    key: `catalogue/AMZ-B000000000/${"c".repeat(64)}-1.webp`,
    rightsVerified: 1,
    rightsPolicy: "partner-amazon-20260824",
    rightsVerifiedBy: "MED+250 product owner",
    rightsVerifiedAt: "2026-08-24T00:00:00.000Z",
    approved: 1,
    ...overrides,
  };
  const quoted = (value) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
  return `INSERT INTO med250_product_images (
    product_id, position, r2_key, legacy_public_url, source_page_url, source_image_url,
    source_domain, source_kind, rights_basis, rights_verified, rights_policy_id,
    rights_verified_by, rights_verified_at, width, height, quality_score,
    content_sha256, perceptual_hash, background_removed, approved, checked_at,
    recovery_receipt_id, created_at
  ) VALUES (
    'AMZ-B000000000', ${values.position}, ${quoted(values.key)}, 'https://legacy.invalid/image.webp',
    'https://${values.domain}/product', 'https://${values.domain}/image.webp', ${quoted(values.domain)},
    'marketplace_api', 'Evidence-backed partner image.', ${values.rightsVerified},
    ${quoted(values.rightsPolicy)}, ${quoted(values.rightsVerifiedBy)}, ${quoted(values.rightsVerifiedAt)},
    1200, 1200, 90, ${quoted(values.hash)}, '0123456789abcdef', 1, ${values.approved},
    '2026-08-24T00:00:00.000Z', 'rights-fixture-receipt', '2026-08-24T00:00:00.000Z'
  );`;
}

test("D1 rejects approved product images without verified reuse rights", async () => {
  const database = await migratedDatabase();
  try {
    seedProductAndReceipt(database);
    assert.throws(
      () => database.exec(imageInsert({
        rightsVerified: 0,
        rightsPolicy: null,
        rightsVerifiedBy: null,
        rightsVerifiedAt: null,
      })),
      /approved product images require verified reuse rights/,
    );
  } finally {
    database.close();
  }
});

test("D1 accepts only an active source-matching policy and withdraws it fail closed", async () => {
  const database = await migratedDatabase();
  try {
    seedProductAndReceipt(database);
    database.exec(imageInsert());
    const published = database.prepare(`
      SELECT image_r2_key FROM med250_public_catalogue_rows WHERE id = 'AMZ-B000000000'
    `).get();
    assert.equal(published.image_r2_key, `catalogue/AMZ-B000000000/${"c".repeat(64)}-1.webp`);

    assert.throws(
      () => database.exec(imageInsert({
        position: 2,
        domain: "unlicensed.example",
        hash: "d".repeat(64),
        key: `catalogue/AMZ-B000000000/${"d".repeat(64)}-2.webp`,
        approved: 0,
      })),
      /rights_verified requires an active matching evidence policy/,
    );

    database.exec(`UPDATE med250_media_rights_policies SET status = 'withdrawn', updated_at = '2026-08-24T01:00:00.000Z' WHERE id = 'partner-amazon-20260824';`);
    const image = database.prepare(`SELECT approved, rights_verified FROM med250_product_images WHERE product_id = 'AMZ-B000000000'`).get();
    assert.deepEqual({ ...image }, { approved: 0, rights_verified: 0 });
    assert.equal(database.prepare(`SELECT image_r2_key FROM med250_public_catalogue_rows WHERE id = 'AMZ-B000000000'`).get().image_r2_key, null);
  } finally {
    database.close();
  }
});

test("D1 accepts an owner-confirmed exact portfolio asset without opening a domain-wide bypass", async () => {
  const database = await migratedDatabase();
  try {
    seedProductAndReceipt(database);
    database.exec(`
      INSERT INTO med250_media_rights_policy_assets (
        policy_id, product_id, position, content_sha256, source_domain,
        registered_by, registered_at
      ) VALUES (
        'partner-portfolio-20260824', 'AMZ-B000000000', 1, '${"c".repeat(64)}',
        'covered-marketplace.example', 'MED+250 product owner', '2026-08-24T15:10:00.000Z'
      );
    `);
    database.exec(imageInsert({
      domain: "covered-marketplace.example",
      rightsPolicy: "partner-portfolio-20260824",
      rightsVerifiedAt: "2026-08-24T15:10:00.000Z",
    }));

    assert.throws(
      () => database.exec(`UPDATE med250_product_images SET content_sha256 = '${"d".repeat(64)}' WHERE product_id = 'AMZ-B000000000' AND position = 1;`),
      /rights_verified requires an active matching evidence policy/,
    );
    assert.throws(
      () => database.exec(imageInsert({
        position: 2,
        domain: "covered-marketplace.example",
        hash: "d".repeat(64),
        key: `catalogue/AMZ-B000000000/${"d".repeat(64)}-2.webp`,
        rightsPolicy: "partner-portfolio-20260824",
        rightsVerifiedAt: "2026-08-24T15:10:00.000Z",
        approved: 0,
      })),
      /rights_verified requires an active matching evidence policy/,
    );
  } finally {
    database.close();
  }
});

test("Worker public-image predicate requires approval, verified rights and an active policy", async () => {
  const [predicate, catalogue, orders] = await Promise.all([
    readFile(new URL("../worker/backend/product-image-rights.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/backend/catalogue-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/backend/order-repository.ts", import.meta.url), "utf8"),
  ]);
  assert.match(predicate, /image\.approved = 1/);
  assert.match(predicate, /image\.rights_verified = 1/);
  assert.match(predicate, /policy\.status = 'active'/);
  assert.match(catalogue, /ACTIVE_PUBLIC_PRODUCT_IMAGE_SQL/g);
  assert.match(orders, /ACTIVE_PUBLIC_PRODUCT_IMAGE_SQL/);
  assert.doesNotMatch(catalogue, /image\.approved = 1/);
  assert.doesNotMatch(orders, /image\.approved = 1/);
});
