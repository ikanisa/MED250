import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { approveLaunchGate } from "../scripts/approve-launch-gate.mjs";
import { validateLaunchEvidence } from "../scripts/validate-launch-evidence.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/launch-evidence.json", import.meta.url), "utf8"));
const rootDir = new URL("..", import.meta.url).pathname;
const testNow = new Date("2026-07-30T12:00:00+02:00");
const testApprovalAt = "2026-07-30T11:00:00+02:00";

async function withCompleteFixtureEvidence(gateName, filenames) {
  const fixture = structuredClone(manifest);
  fixture.gates[gateName].evidence = await Promise.all(filenames.map(async (filename) => {
    const reference = `docs/launch/evidence/${filename}`;
    const source = await readFile(new URL(`../${reference}`, import.meta.url), "utf8");
    const artifact = JSON.parse(source);
    return {
      type: artifact.evidence_type,
      reference,
      recorded_at: artifact.recorded_at,
      sha256: createHash("sha256").update(source).digest("hex"),
      summary: artifact.summary,
    };
  }));
  return fixture;
}

test("approves an evidence-complete backend gate with named owner metadata", async () => {
  const result = await approveLaunchGate({
    manifest: await withCompleteFixtureEvidence("MED250_GATE_SECURITY_HARDENING_DEPLOYED", [
      "security-hardening-deployment-2026-07-18.json",
      "security-hardening-test-2026-07-18.json",
    ]),
    gateName: "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
    approvedBy: "Named backend owner",
    approvedRole: "Backend owner",
    approvedAt: testApprovalAt,
    rootDir,
    now: testNow,
  });

  const gate = result.manifest.gates.MED250_GATE_SECURITY_HARDENING_DEPLOYED;
  assert.equal(gate.status, "confirmed");
  assert.equal(gate.approved_by, "Named backend owner");
  assert.deepEqual(result.approved.evidenceTypes, ["deployment_receipt", "test_record"]);
  const validation = validateLaunchEvidence(result.manifest, {
    rootDir,
    now: testNow,
  });
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("rejects launch gate approval when evidence is incomplete", async () => {
  await assert.rejects(
    () => approveLaunchGate({
      manifest: structuredClone(manifest),
      gateName: "MED250_GATE_GPS_READY",
      approvedBy: "Named operations owner",
      approvedRole: "Operations owner",
      approvedAt: testApprovalAt,
      rootDir,
      now: testNow,
    }),
    /missing evidence: review_ledger/,
  );
});

test("rejects launch gate approval when release-bound evidence is stale", async () => {
  await assert.rejects(
    () => approveLaunchGate({
      manifest: structuredClone(manifest),
      gateName: "MED250_GATE_DOMAIN_DNS_VERIFIED",
      approvedBy: "Named infrastructure owner",
      approvedRole: "Infrastructure owner",
      approvedAt: testApprovalAt,
      rootDir,
      now: testNow,
    }),
    /release-bound evidence is stale/,
  );
});

test("rejects launch gate approval with unsafe or incomplete metadata", async () => {
  const evidenceCompleteManifest = await withCompleteFixtureEvidence("MED250_GATE_EDGE_FUNCTIONS_DEPLOYED", [
    "edge-functions-deployment-2026-07-18.json",
    "edge-functions-test-2026-07-18.json",
  ]);
  await assert.rejects(
    () => approveLaunchGate({
      manifest: structuredClone(evidenceCompleteManifest),
      gateName: "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
      approvedBy: "",
      approvedRole: "Backend owner",
      approvedAt: testApprovalAt,
      rootDir,
      now: testNow,
    }),
    /approved_by is required/,
  );
  await assert.rejects(
    () => approveLaunchGate({
      manifest: structuredClone(evidenceCompleteManifest),
      gateName: "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
      approvedBy: "Named backend owner",
      approvedRole: "Backend owner",
      approvedAt: "2026-07-22T11:00:00",
      rootDir,
      now: testNow,
    }),
    /timezone-qualified/,
  );
});
