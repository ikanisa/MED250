import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  refreshDomainLaunchEvidence,
  writeDomainLaunchEvidenceRefresh,
} from "../scripts/refresh-domain-launch-evidence.mjs";
import { validateLaunchEvidence } from "../scripts/validate-launch-evidence.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/launch-evidence.json", import.meta.url), "utf8"));
const releaseRevision = "6845e358122881e8fa0470f437289afbf888e3e4";
const capturedAt = "2026-08-28T10:00:00Z";

function deploymentReceipt(overrides = {}) {
  return {
    schemaVersion: "1.0",
    capturedAt,
    status: "passed",
    origin: "https://med-250.com",
    mode: "live",
    observedReleaseRevision: releaseRevision,
    expectedReleaseRevision: releaseRevision,
    releaseRevisionExpectation: "matched",
    routeCount: 10,
    routes: Array.from({ length: 10 }, (_, index) => ({
      route: index === 0 ? "/" : `/route-${index}`,
      status: 200,
      finalOrigin: "https://med-250.com",
      headers: index < 7 ? { "x-med250-release-revision": releaseRevision } : {},
      bodyBytes: 100 + index,
      bodySha256: String(index).repeat(64).slice(0, 64).replaceAll(/[^0-9]/g, "a"),
    })),
    errors: [],
    verifier: { path: "scripts/verify-deployed-site.mjs", sha256: "a".repeat(64) },
    ...overrides,
  };
}

async function copyExistingEvidence(root) {
  for (const gate of Object.values(manifest.gates)) {
    for (const evidence of gate.evidence ?? []) {
      if (!evidence.reference?.startsWith("docs/launch/evidence/")) continue;
      const source = await readFile(new URL(`../${evidence.reference}`, import.meta.url), "utf8");
      const target = join(root, evidence.reference);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source, "utf8");
    }
  }
}

test("refreshes domain launch artifacts only from an exact-revision live receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "med250-domain-refresh-"));
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data", "launch-evidence.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await copyExistingEvidence(root);

  const result = await refreshDomainLaunchEvidence({
    manifest,
    deploymentReceipt: deploymentReceipt(),
    expectedRevision: releaseRevision,
    artifactDate: "2026-08-28",
    now: new Date("2026-08-28T12:00:00Z"),
  });
  await writeDomainLaunchEvidenceRefresh({
    manifestPath: "data/launch-evidence.json",
    result,
    rootDir: root,
    now: new Date("2026-08-28T12:00:00Z"),
  });

  const updatedManifest = JSON.parse(await readFile(join(root, "data", "launch-evidence.json"), "utf8"));
  const domainGate = updatedManifest.gates.MED250_GATE_DOMAIN_DNS_VERIFIED;
  assert.equal(updatedManifest.release_revision, releaseRevision);
  assert.equal(domainGate.status, "pending");
  assert.equal(domainGate.approved_by, null);
  const domainEvidence = domainGate.evidence.find((entry) => entry.type === "domain_verification");
  const testEvidence = domainGate.evidence.find((entry) => entry.type === "test_record");
  assert.equal(domainEvidence.reference, "docs/launch/evidence/domain-verification-2026-08-28.json");
  assert.equal(testEvidence.reference, "docs/launch/evidence/domain-deployment-test-2026-08-28.json");

  for (const entry of [domainEvidence, testEvidence]) {
    const source = await readFile(join(root, entry.reference), "utf8");
    const artifact = JSON.parse(source);
    assert.equal(artifact.expected_release_revision, releaseRevision);
    assert.equal(artifact.observed_release_revision, releaseRevision);
    assert.equal(artifact.release_revision_expectation, "matched");
    assert.equal(entry.sha256, createHash("sha256").update(source).digest("hex"));
  }

  const validation = validateLaunchEvidence(updatedManifest, {
    rootDir: root,
    now: new Date("2026-08-28T12:00:00Z"),
  });
  assert.equal(validation.valid, true, validation.errors.join("; "));
  await rm(root, { recursive: true, force: true });
});

test("rejects stale or mismatched domain deployment receipts", async () => {
  await assert.rejects(
    () => refreshDomainLaunchEvidence({
      manifest,
      deploymentReceipt: deploymentReceipt({
        observedReleaseRevision: "37d8c1c0e0c8ac2d15eea436d2f9037c20e2814c",
        releaseRevisionExpectation: "mismatched",
      }),
      expectedRevision: releaseRevision,
      artifactDate: "2026-08-28",
      now: new Date("2026-08-28T12:00:00Z"),
    }),
    /observedReleaseRevision does not match|releaseRevisionExpectation must be matched/,
  );
});
