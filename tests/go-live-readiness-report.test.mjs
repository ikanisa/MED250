import assert from "node:assert/strict";
import test from "node:test";

import { buildGoLiveReadinessReport } from "../scripts/report-go-live-readiness.mjs";

test("reports go-live readiness without promoting pending gates", async () => {
  const report = await buildGoLiveReadinessReport();

  assert.equal(report.productionReady, false);
  assert.equal(report.launchEvidence.valid, true);
  assert.equal(report.launchEvidence.strictValid, false);
  assert.equal(report.launchEvidence.gateCount, 11);
  assert.deepEqual(report.launchEvidence.statusCounts, {
    pending: 11,
    confirmed: 0,
    rejected: 0,
    invalid: 0,
  });
  assert.deepEqual(report.gateReadiness, {
    confirmed: 0,
    approvalPending: 2,
    preparedEvidencePending: 8,
    missingEvidence: 0,
    staleReleaseEvidence: 1,
  });
  assert.match(report.sourceControl.currentReleaseRevision, /^[a-f0-9]{40}$/);
  const domain = report.gates.find((gate) => gate.name === "MED250_GATE_DOMAIN_DNS_VERIFIED");
  assert.equal(domain.readiness, "stale_release_evidence");
  assert.equal(domain.staleReleaseEvidence, true);
  assert.ok(domain.releaseRevisionBindings.every((binding) => binding.observedReleaseRevision === "37d8c1c0e0c8ac2d15eea436d2f9037c20e2814c"));
  assert.equal(report.duplicateRegister.decisionCounts.pending, 51);
  assert.equal(report.physicalUat.statusCounts.pending, 12);
  assert.equal(report.handoff.preparedPendingArtifactCount, 11);
  assert.equal(report.handoff.unpreparedEvidenceArtifactCount, 0);
});
