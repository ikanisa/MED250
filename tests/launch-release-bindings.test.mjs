import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  recordedReleaseRevision,
  releaseRevisionForManifest,
  staleReleaseEvidenceGateNames,
} from "../scripts/launch-release-bindings.mjs";

const manifest = JSON.parse(await readFile(
  new URL("../data/launch-evidence.json", import.meta.url),
  "utf8",
));

test("uses the recorded production release instead of evidence-only checkout commits", async () => {
  assert.equal(recordedReleaseRevision(manifest), manifest.release_revision);
  assert.equal(releaseRevisionForManifest(manifest), manifest.release_revision);
  assert.deepEqual([...await staleReleaseEvidenceGateNames(manifest)], []);
});

test("detects revision-bound evidence that does not match the recorded production release", async () => {
  const stale = structuredClone(manifest);
  stale.release_revision = "a".repeat(40);
  assert.deepEqual(
    [...await staleReleaseEvidenceGateNames(stale)].sort(),
    [
      "MED250_GATE_DOMAIN_DNS_VERIFIED",
      "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
      "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
    ],
  );
});
