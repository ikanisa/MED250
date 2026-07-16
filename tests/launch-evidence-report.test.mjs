import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildLaunchEvidenceReport } from "../scripts/report-launch-evidence.mjs";

const manifest = JSON.parse(await readFile(
  new URL("../data/launch-evidence.json", import.meta.url),
  "utf8",
));

test("reports every pending gate and its exact missing evidence categories", () => {
  const report = buildLaunchEvidenceReport(manifest);
  assert.equal(report.gateCount, 15);
  assert.equal(report.productionReady, false);
  assert.equal(report.statusCounts.pending, 15);
  assert.ok(report.gates.every((gate) => gate.missingEvidenceTypes.length > 0));
  assert.ok(report.gates.every((gate) => gate.approvalComplete === false));
  assert.deepEqual(
    report.gates.find((gate) => gate.name === "MED250_GATE_DOMAIN_DNS_VERIFIED").missingEvidenceTypes,
    ["domain_verification", "test_record"],
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
