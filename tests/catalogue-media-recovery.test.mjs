import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const script = path.join(root, "scripts", "inventory-catalogue-media-recovery.py");

function run(args = []) {
  return spawnSync("python3", [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
}

test("catalogue media recovery inventory is provider-read-only and output constrained", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /mode=ro/);
  assert.match(source, /git-ignored work\/ directory/);
  assert.match(source, /SOURCE_PROJECT_REF = "uskfnszcdqpcfrhjxitl"/);
  assert.doesNotMatch(source, /\b(?:requests|httpx|urllib\.request|subprocess)\b/);

  const rejected = run(["--output=/tmp/med250-catalogue-media.json"]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /--output must be inside/);
});

test("retained checkpoints produce a deterministic hash-only recovery inventory", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.event, "catalogue_media_recovery_inventory");
  assert.equal(receipt.output_written, false);
  assert.equal(receipt.checkpoint_files, 446);
  assert.equal(receipt.latest_product_publications, 4_639);
  assert.equal(receipt.complete_galleries, 3_690);
  assert.equal(receipt.complete_gallery_images, 19_117);
  assert.equal(receipt.source_cache_complete_galleries, 3_690);
  assert.equal(receipt.exact_processed_cache_images, 2_108);
  assert.equal(receipt.generated_or_incomplete_metadata_galleries, 949);
  assert.match(receipt.snapshot_sha256, /^[a-f0-9]{64}$/);
});
