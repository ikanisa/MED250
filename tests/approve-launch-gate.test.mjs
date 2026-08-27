import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { approveLaunchGate } from "../scripts/approve-launch-gate.mjs";
import { validateLaunchEvidence } from "../scripts/validate-launch-evidence.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/launch-evidence.json", import.meta.url), "utf8"));
const rootDir = new URL("..", import.meta.url).pathname;

test("approves an evidence-complete backend gate with named owner metadata", async () => {
  const result = await approveLaunchGate({
    manifest: structuredClone(manifest),
    gateName: "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
    approvedBy: "Named backend owner",
    approvedRole: "Backend owner",
    approvedAt: "2026-08-28T11:00:00+02:00",
    rootDir,
    now: new Date("2026-08-28T12:00:00+02:00"),
  });

  const gate = result.manifest.gates.MED250_GATE_SECURITY_HARDENING_DEPLOYED;
  assert.equal(gate.status, "confirmed");
  assert.equal(gate.approved_by, "Named backend owner");
  assert.deepEqual(result.approved.evidenceTypes, ["deployment_receipt", "test_record"]);
  const validation = validateLaunchEvidence(result.manifest, {
    rootDir,
    now: new Date("2026-08-28T12:00:00+02:00"),
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
      approvedAt: "2026-08-28T11:00:00+02:00",
      rootDir,
      now: new Date("2026-08-28T12:00:00+02:00"),
    }),
    /missing evidence: review_ledger/,
  );
});

test("rejects launch gate approval when release-bound evidence is stale", async () => {
  const stale = structuredClone(manifest);
  stale.release_revision = "a".repeat(40);
  await assert.rejects(
    () => approveLaunchGate({
      manifest: stale,
      gateName: "MED250_GATE_DOMAIN_DNS_VERIFIED",
      approvedBy: "Named infrastructure owner",
      approvedRole: "Infrastructure owner",
      approvedAt: "2026-08-28T11:00:00+02:00",
      rootDir,
      now: new Date("2026-08-28T12:00:00+02:00"),
    }),
    /release-bound evidence is stale/,
  );
});

test("rejects launch gate approval with unsafe or incomplete metadata", async () => {
  await assert.rejects(
    () => approveLaunchGate({
      manifest: structuredClone(manifest),
      gateName: "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
      approvedBy: "",
      approvedRole: "Backend owner",
      approvedAt: "2026-08-28T11:00:00+02:00",
      rootDir,
      now: new Date("2026-08-28T12:00:00+02:00"),
    }),
    /approved_by is required/,
  );
  await assert.rejects(
    () => approveLaunchGate({
      manifest: structuredClone(manifest),
      gateName: "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
      approvedBy: "Named backend owner",
      approvedRole: "Backend owner",
      approvedAt: "2026-08-28T11:00:00",
      rootDir,
      now: new Date("2026-08-28T12:00:00+02:00"),
    }),
    /timezone-qualified/,
  );
});
