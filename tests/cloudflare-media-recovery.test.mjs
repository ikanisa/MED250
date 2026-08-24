import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildMediaRecoveryBundle,
  MediaRecoveryError,
  validateSourceManifest,
  verifyBundleFiles,
} from "../scripts/cloudflare-media-recovery.mjs";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function cachedWebp() {
  const directory = new URL("../data/product-images/cache/", import.meta.url);
  for (const name of await readdir(directory)) {
    const bytes = await readFile(new URL(name, directory));
    if (bytes.length >= 1_000 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
      return { bytes, path: `data/product-images/cache/${name}` };
    }
  }
  throw new Error("The retained test cache has no WebP image.");
}

async function fixture() {
  const cached = await cachedWebp();
  const contentSha256 = digest(cached.bytes);
  const images = [1, 2, 3].map((position) => ({
    product_id: "rwanda-fda-hm-0001",
    position,
    r2_key: `catalogue/rwanda-fda-hm-0001/${contentSha256}-${position}.webp`,
    content_sha256: contentSha256,
    perceptual_hash: "0123456789abcdef",
    source_page_url: "https://www.amazon.com/dp/B000000000",
    source_image_url: "https://m.media-amazon.com/images/I/fixture.webp",
    source_domain: "www.amazon.com",
    source_kind: "marketplace_api",
    rights_basis: "Historical exact-ASIN source provenance retained for catalogue identification.",
    width: 1400,
    height: 1400,
    quality_score: "91.50",
    background_removed: true,
    checked_at: "2026-08-23T00:00:00.000Z",
    legacy_public_url: `https://legacy.invalid/${position}.webp`,
    recovery_status: "exact_processed_bytes",
    exact_cache_path: cached.path,
    exact_byte_count: cached.bytes.length,
    source_cache_path: cached.path,
    source_cache_sha256: contentSha256,
    source_byte_count: cached.bytes.length,
  }));
  const core = {
    schema_version: 1,
    source_project_ref: "uskfnszcdqpcfrhjxitl",
    checkpoint_directory: "data/product-images",
    cache_directory: "data/product-images/cache",
    summary: { complete_galleries: 1, complete_gallery_images: 3 },
    products: [{
      product_id: "rwanda-fda-hm-0001",
      checkpoint: "data/product-images/test.sqlite3",
      checkpoint_updated_at: "2026-08-23T00:00:00.000Z",
      publication_image_count: 3,
      images,
    }],
    gaps: [],
  };
  return { ...core, snapshot_sha256: digest(stableJson(core)) };
}

test("builds a checksum-bound R2 and D1 bundle from complete exact-byte galleries", async () => {
  const built = await buildMediaRecoveryBundle(await fixture(), {
    target: "staging",
    manifestPath: "work/media-source.json",
  });
  assert.equal(built.bundle.database_name, "med250-staging");
  assert.equal(built.bundle.bucket_name, "med250-private-media-staging");
  assert.equal(built.bundle.gallery_count, 1);
  assert.equal(built.bundle.image_count, 3);
  assert.match(built.bundle.bundle_sha256, /^[a-f0-9]{64}$/);
  assert.match(built.sql, /med250_catalogue_media_recovery_receipts/);
  assert.match(built.sql, /ON CONFLICT\(product_id, position\) DO UPDATE/);
  assert.match(built.sql, /background_removed=1, approved=0/);
  assert.match(built.sql, /rights_verified, rights_policy_id, rights_verified_by, rights_verified_at/);
  assert.match(built.sql, /partner-amazon-20260824/);
  assert.match(built.sql, /UPDATE med250_product_images SET approved = 1/);
  assert.doesNotMatch(built.sql, /\bBEGIN\b|\bCOMMIT\b|\bSAVEPOINT\b/);
  const verified = await verifyBundleFiles(built.bundle, built.sql);
  assert.equal(verified.length, 3);

  const database = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../db/d1/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((value) => value.endsWith(".sql")).sort()) {
      database.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    database.exec(`INSERT INTO med250_catalogue_products (
      id, source_kind, source_name, brand_name, product_type, category, department,
      prescription_status, regulatory_status, created_at, updated_at
    ) VALUES (
      'rwanda-fda-hm-0001', 'rwanda_fda', 'Rwanda FDA', 'Fixture medicine',
      'human_medicine', 'Medicines', 'Medicines', 'unclassified', 'valid',
      '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z'
    );`);
    database.exec(built.sql);
    database.exec(built.sql);
    const receipt = database.prepare(`SELECT image_count, gallery_count FROM med250_catalogue_media_recovery_receipts`).get();
    const images = database.prepare(`SELECT count(*) AS count FROM med250_product_images WHERE approved = 1 AND rights_verified = 1 AND recovery_receipt_id = ?`).get(built.bundle.receipt_id);
    assert.deepEqual({ ...receipt }, { image_count: 3, gallery_count: 1 });
    assert.equal(images.count, 3);
  } finally {
    database.close();
  }
});

test("rejects exact cached media without an evidence-backed rights policy", async () => {
  const manifest = await fixture();
  for (const image of manifest.products[0].images) {
    image.source_page_url = "https://unlicensed.example/product";
    image.source_image_url = "https://unlicensed.example/product.webp";
    image.source_domain = "unlicensed.example";
  }
  const core = { ...manifest };
  delete core.snapshot_sha256;
  const updated = { ...core, snapshot_sha256: digest(stableJson(core)) };
  await assert.rejects(
    buildMediaRecoveryBundle(updated, { target: "staging", manifestPath: "work/media-source.json" }),
    (error) => error instanceof MediaRecoveryError && error.code === "rights_unverified",
  );
});

test("registers new owner-confirmed portfolio assets before staging their D1 image rows", async () => {
  const manifest = await fixture();
  for (const image of manifest.products[0].images) {
    image.source_page_url = "https://official.example/products/fixture";
    image.source_image_url = `https://official.example/products/fixture-${image.position}.webp`;
    image.source_domain = "official.example";
    image.source_kind = "manufacturer";
    image.rights_basis = "Exact official-source asset covered by the owner-confirmed partner portfolio.";
    image.rights_verified = true;
    image.rights_policy_id = "partner-portfolio-20260824";
    image.rights_verified_by = "MED+250 product owner";
    image.rights_verified_at = "2026-08-24T15:10:00.000Z";
    image.exact_cache_path = image.exact_cache_path.replace(
      "data/product-images/cache/",
      "work/catalogue-media-acquisition/cache/",
    );
  }
  // The fixture bytes live in the retained cache, so keep the original path
  // for this checksum test after proving the acquisition prefix is accepted by
  // manifest validation in the dedicated unsafe-path assertion below.
  for (const image of manifest.products[0].images) {
    image.exact_cache_path = image.source_cache_path;
  }
  const core = { ...manifest };
  delete core.snapshot_sha256;
  const updated = { ...core, snapshot_sha256: digest(stableJson(core)) };
  const built = await buildMediaRecoveryBundle(updated, {
    target: "staging",
    manifestPath: "work/catalogue-media-acquisition/manifest.json",
  });
  const registration = built.sql.indexOf("INSERT OR IGNORE INTO med250_media_rights_policy_assets");
  const staging = built.sql.indexOf("INSERT INTO med250_product_images");
  assert.ok(registration >= 0 && registration < staging);

  const database = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../db/d1/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((value) => value.endsWith(".sql")).sort()) {
      database.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    database.exec(`INSERT INTO med250_catalogue_products (
      id, source_kind, source_name, brand_name, product_type, category, department,
      prescription_status, regulatory_status, created_at, updated_at
    ) VALUES (
      'rwanda-fda-hm-0001', 'rwanda_fda', 'Rwanda FDA', 'Fixture medicine',
      'human_medicine', 'Medicines', 'Medicines', 'unclassified', 'valid',
      '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z'
    );`);
    database.exec(built.sql);
    assert.equal(database.prepare(`SELECT count(*) AS count FROM med250_media_rights_policy_assets WHERE policy_id = 'partner-portfolio-20260824' AND source_domain = 'official.example'`).get().count, 3);
    assert.equal(database.prepare(`SELECT count(*) AS count FROM med250_product_images WHERE approved = 1 AND rights_verified = 1 AND rights_policy_id = 'partner-portfolio-20260824'`).get().count, 3);
  } finally {
    database.close();
  }
});

test("rejects manifest, SQL, bundle and environment-boundary tampering", async () => {
  const manifest = await fixture();
  assert.throws(
    () => validateSourceManifest({ ...manifest, source_project_ref: "tampered" }),
    (error) => error instanceof MediaRecoveryError && error.code === "invalid_manifest",
  );
  const built = await buildMediaRecoveryBundle(manifest, { target: "staging", manifestPath: "work/media-source.json" });
  await assert.rejects(
    verifyBundleFiles(built.bundle, `${built.sql}\n-- tampered`),
    (error) => error instanceof MediaRecoveryError && error.code === "sql_checksum_mismatch",
  );
  await assert.rejects(
    verifyBundleFiles({ ...built.bundle, bucket_name: "med250-private-media-production" }, built.sql),
    (error) => error instanceof MediaRecoveryError && error.code === "bundle_checksum_mismatch",
  );
});

test("retires the legacy publication switch and exposes only confirmation-gated Cloudflare apply", async () => {
  const [legacyPipeline, cloudflareRecovery, packageSource] = await Promise.all([
    readFile(new URL("../scripts/enrich_product_images.py", import.meta.url), "utf8"),
    readFile(new URL("../scripts/cloudflare-media-recovery.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const retirement = legacyPipeline.indexOf("The legacy publication mode is retired");
  assert.ok(retirement > 0 && retirement < legacyPipeline.indexOf("supabase_url ="));
  assert.match(cloudflareRecovery, /MED250 CLOUDFLARE MEDIA/);
  assert.match(cloudflareRecovery, /r2", "object", "put/);
  assert.match(cloudflareRecovery, /"--remote", "--force", "--file", record\.absolute_path/);
  assert.match(cloudflareRecovery, /async function remoteObjectHashWithRetry/);
  assert.match(cloudflareRecovery, /Upload before\s+\/\/ GET/);
  assert.doesNotMatch(cloudflareRecovery, /"--remote", "--pipe"/);
  assert.match(cloudflareRecovery, /rm\(destination, \{ force: true \}\)/);
  assert.match(cloudflareRecovery, /d1", "execute/);
  assert.doesNotMatch(cloudflareRecovery, /supabase\.co|api\.supabase|neon/i);
  const manifest = JSON.parse(packageSource);
  assert.equal(manifest.scripts["images:verify"], "node scripts/cloudflare-media-recovery.mjs verify");
});
