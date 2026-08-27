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
    approvalPending: 3,
    preparedEvidencePending: 8,
    missingEvidence: 0,
    staleReleaseEvidence: 0,
  });
  assert.match(report.sourceControl.currentReleaseRevision, /^[a-f0-9]{40}$/);
  assert.match(report.sourceControl.currentCheckoutRevision, /^[a-f0-9]{40}$/);
  const domain = report.gates.find((gate) => gate.name === "MED250_GATE_DOMAIN_DNS_VERIFIED");
  assert.equal(domain.readiness, "approval_pending");
  assert.equal(domain.staleReleaseEvidence, false);
  assert.ok(domain.releaseRevisionBindings.every((binding) => binding.matchesCurrentRevision));
  assert.equal(report.duplicateRegister.decisionCounts.pending, 51);
  assert.equal(report.physicalUat.statusCounts.pending, 12);
  assert.equal(report.handoff.preparedPendingArtifactCount, 11);
  assert.equal(report.handoff.unpreparedEvidenceArtifactCount, 0);
});
