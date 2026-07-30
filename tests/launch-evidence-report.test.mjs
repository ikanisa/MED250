import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildLaunchEvidenceReport } from "../scripts/report-launch-evidence.mjs";

const manifest = JSON.parse(await readFile(
  new URL("../data/launch-evidence.json", import.meta.url),
  "utf8",
));

test("reports pending and confirmed gates with exact missing evidence categories", () => {
  const report = buildLaunchEvidenceReport(manifest);
  assert.equal(report.gateCount, 11);
  assert.equal(report.productionReady, false);
  assert.equal(report.statusCounts.pending, 10);
  assert.equal(report.statusCounts.confirmed, 1);
  assert.equal(report.gates.filter((gate) => gate.approvalComplete).length, 1);
  assert.deepEqual(
    report.gates.find((gate) => gate.name === "MED250_GATE_DOMAIN_DNS_VERIFIED").missingEvidenceTypes,
    [],
  );
  assert.deepEqual(
    report.gates.find((gate) => gate.name === "MED250_GATE_GPS_READY").missingEvidenceTypes,
    ["review_ledger"],
  );
  assert.deepEqual(
    report.gates.find((gate) => gate.name === "MED250_GATE_SECURITY_HARDENING_DEPLOYED").missingEvidenceTypes,
    [],
  );
});

test("reports production ready only when evidence categories and approval metadata are complete", () => {
  const complete = structuredClone(manifest);
  for (const gate of Object.values(complete.gates)) {
    gate.status = "confirmed";
    gate.approved_by = "Named approver";
    gate.approved_role = "Gate owner";
    gate.approved_at = "2026-07-14T10:00:00Z";
    gate.evidence = gate.required_evidence_types.map((type) => ({ type }));
  }
  const report = buildLaunchEvidenceReport(complete);
  assert.equal(report.productionReady, true);
  assert.ok(report.gates.every((gate) => gate.missingEvidenceTypes.length === 0));
});
