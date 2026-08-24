import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildRetentionBundle,
  bundleDigest,
  validateRetentionSpec,
  verifyRetentionBundle,
} from "../scripts/source-retention-bundle.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fixtureSpec(source, content) {
  return {
    schema_version: "1",
    bundle_id: "med250-test-retention",
    classification: "controlled_private_source_evidence",
    default_output: "unused",
    artifacts: [
      {
        id: "source_json",
        role: "raw_source",
        source_kind: "local",
        source,
        bundle_path: "raw/source.json",
        media_type: "application/json",
        expected_bytes: content.byteLength,
        expected_sha256: sha256(content),
        semantic_check: { type: "json" },
      },
    ],
  };
}

test("builds and verifies a checksum-bound controlled source bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "med250-source-root-"));
  const destination = await mkdtemp(join(tmpdir(), "med250-source-bundle-parent-"));
  const source = Buffer.from('{"rows":[1,2,3]}\n');
  await writeFile(join(root, "source.json"), source);
  const bundle = join(destination, "bundle");
  const spec = fixtureSpec("source.json", source);
  const result = await buildRetentionBundle({
    spec,
    output: bundle,
    rootDir: root,
    now: new Date("2026-07-16T13:30:00Z"),
  });
  assert.equal(result.status, "passed");
  assert.equal(result.artifact_count, 1);
  const verified = await verifyRetentionBundle(bundle, { spec });
  assert.equal(verified.status, "passed");
  assert.equal(verified.approved_durable_storage, false);
  const manifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8"));
  assert.equal(manifest.bundle_digest, bundleDigest(manifest.artifacts));
  await rm(root, { recursive: true, force: true });
  await rm(destination, { recursive: true, force: true });
});

test("fails verification when retained source bytes are changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "med250-source-root-"));
  const destination = await mkdtemp(join(tmpdir(), "med250-source-bundle-parent-"));
  const source = Buffer.from('{"rows":[1]}\n');
  await writeFile(join(root, "source.json"), source);
  const bundle = join(destination, "bundle");
  const spec = fixtureSpec("source.json", source);
  await buildRetentionBundle({ spec, output: bundle, rootDir: root });
  await writeFile(join(bundle, "raw/source.json"), '{"rows":[2]}\n');
  await assert.rejects(() => verifyRetentionBundle(bundle, { spec }), /SHA-256 changed/);
  await rm(root, { recursive: true, force: true });
  await rm(destination, { recursive: true, force: true });
});

test("rejects duplicate paths, weak digests, source traversal and non-HTTPS remote sources", () => {
  const content = Buffer.from("{}");
  const spec = fixtureSpec("source.json", content);
  spec.artifacts.push({ ...spec.artifacts[0], id: "second_source" });
  assert.throws(() => validateRetentionSpec(spec), /Duplicate bundle path/);
  spec.artifacts[1].bundle_path = "raw/second.json";
  spec.artifacts[1].expected_sha256 = "weak";
  assert.throws(() => validateRetentionSpec(spec), /lowercase SHA-256/);
  spec.artifacts[1].expected_sha256 = sha256(content);
  spec.artifacts[1].source = "../outside.json";
  assert.throws(() => validateRetentionSpec(spec), /must stay inside the source root/);
  spec.artifacts[1].source_kind = "remote";
  spec.artifacts[1].source = "http://example.com/source.json";
  assert.throws(() => validateRetentionSpec(spec), /must use HTTPS/);
});

test("rejects a self-consistent tampered bundle when it differs from the committed spec", async () => {
  const root = await mkdtemp(join(tmpdir(), "med250-source-root-"));
  const destination = await mkdtemp(join(tmpdir(), "med250-source-bundle-parent-"));
  const source = Buffer.from('{"rows":[1]}\n');
  const spec = fixtureSpec("source.json", source);
  await writeFile(join(root, "source.json"), source);
  const bundle = join(destination, "bundle");
  await buildRetentionBundle({ spec, output: bundle, rootDir: root });
  const changed = Buffer.from('{"rows":[2]}\n');
  await writeFile(join(bundle, "raw/source.json"), changed);
  const manifestPath = join(bundle, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.artifacts[0].sha256 = sha256(changed);
  manifest.bundle_digest = bundleDigest(manifest.artifacts);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(() => verifyRetentionBundle(bundle, { spec }), /does not match the retention spec/);
  await rm(root, { recursive: true, force: true });
  await rm(destination, { recursive: true, force: true });
});
