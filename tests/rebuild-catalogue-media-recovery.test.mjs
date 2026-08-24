import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cloudflare media rebuild is public-catalogue scoped, resumable and validation-gated", async () => {
  const source = await readFile(new URL("../scripts/rebuild_catalogue_media_recovery.py", import.meta.url), "utf8");
  assert.match(source, /public_catalogue_ids/);
  assert.match(source, /rebuild-checkpoint\.sqlite3/);
  assert.match(source, /pipeline\.normalize_image/);
  assert.match(source, /pipeline\.derive_catalogue_views/);
  assert.match(source, /validation_policy_version/);
  assert.match(source, /recovery_status.*exact_processed_bytes/s);
  assert.doesNotMatch(source, /approved\s*=\s*True|rights_verified\s*=\s*True/);
});

test("Cloudflare recovery accepts only its original cache or the governed rebuild cache", async () => {
  const source = await readFile(new URL("../scripts/cloudflare-media-recovery.mjs", import.meta.url), "utf8");
  assert.match(source, /data\/product-images\/cache\//);
  assert.match(source, /work\/catalogue-media-rebuild\//);
  assert.doesNotMatch(source, /work\/.*\*|startsWith\("work\/"\)/);
});

test("production shard application is checksum-bound, resumable and confirmation-gated", async () => {
  const source = await readFile(new URL("../scripts/apply_catalogue_media_shards.mjs", import.meta.url), "utf8");
  assert.match(source, /MED250 CLOUDFLARE MEDIA PRODUCTION/);
  assert.match(source, /receiptAlreadyVerified/);
  assert.match(source, /cloudflare_media_shard_retained/);
  assert.match(source, /snapshot_sha256/);
  assert.match(source, /catalogue-media-rebuild/);
  assert.doesNotMatch(source, /supabase|neon/i);
});
