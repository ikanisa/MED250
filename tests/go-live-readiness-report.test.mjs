import assert from "node:assert/strict";
import test from "node:test";

import { buildGoLiveReadinessReport } from "../scripts/report-go-live-readiness.mjs";

test("reports go-live readiness without promoting pending gates", async () => {
  const report = await buildGoLiveReadinessReport();

  assert.equal(report.productionReady, false);
  assert.deepEqual(report.sourceAuthority, {
    valid: false,
    productionAuthorized: false,
    status: "pending",
    decision: "pending",
    originalAvailable: false,
    replacementAvailable: true,
    durableStorageApproved: false,
    errorCount: 1,
  });
  assert.deepEqual(report.productContentReview, {
    valid: false,
    expectedEntryCount: 72,
    reviewedEntryCount: 72,
    pendingCount: 72,
    blockingCorrectionCount: 0,
    decisionCounts: { pending: 72 },
    recoveredValidation: true,
    originalSourceRetentionSatisfied: false,
    reviewSourcePath: "outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json",
    reviewSourceSha256: "5000580eb85403a58de8e604bdd055b25b22958ae5755206913a070bcae31383",
    errorCount: 72,
  });
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
    approvalPending: 0,
    preparedEvidencePending: 10,
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
  assert.deepEqual(report.renderedProductionAudit, {
    valid: false,
    status: "pending",
    executionStatus: "completed_awaiting_approval",
    origin: "https://med250.gikundiro.com",
    canonicalOrigin: "https://med-250.com",
    releaseRevision: "5ef50a296941056bd17e614dff7b35290742f50a",
    currentReleaseRevision: report.sourceControl.currentReleaseRevision,
    releaseRevisionCurrent: false,
    scenarioCount: 16,
    captureCount: 56,
    statusCounts: {
      pending: 0,
      passed: 16,
      failed: 0,
      blocked: 0,
      invalid: 0,
    },
    errorCount: 6,
  });
  assert.equal(report.handoff.preparedPendingArtifactCount, 15);
  assert.equal(report.handoff.unpreparedEvidenceArtifactCount, 0);
});
