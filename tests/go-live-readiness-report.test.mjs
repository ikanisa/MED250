import assert from "node:assert/strict";
import test from "node:test";

import { buildGoLiveReadinessReport } from "../scripts/report-go-live-readiness.mjs";

test("separates production engineering readiness from genuine transaction blockers", async () => {
  const report = await buildGoLiveReadinessReport();

  assert.equal(report.productionReady, false);
  assert.equal(report.siteProductionReady, true);
  assert.equal(report.marketplaceTransactionReady, false);
  assert.deepEqual(report.transactionBlockers.map(({ gate }) => gate), [
    "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
    "MED250_GATE_PHYSICAL_UAT_PASSED",
  ]);
  assert.ok(report.nonBlockingFollowUp.some(({ area, count }) => area === "source_authority" && count === undefined));
  assert.ok(report.nonBlockingFollowUp.some(({ area, count }) => area === "duplicate_register" && count === 51));
  assert.ok(report.nonBlockingFollowUp.some(({ area, count }) => area === "product_content" && count === 72));
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
    preparedEvidencePending: 7,
    missingEvidence: 0,
    staleReleaseEvidence: 1,
    machineVerified: 2,
    runtimeVerificationRequired: 1,
    superseded: 1,
  });
  assert.match(report.sourceControl.currentReleaseRevision, /^[a-f0-9]{40}$/);
  const domain = report.gates.find((gate) => gate.name === "MED250_GATE_DOMAIN_DNS_VERIFIED");
  assert.equal(domain.readiness, "runtime_verification_required");
  assert.equal(domain.staleReleaseEvidence, true);
  assert.equal(domain.disposition, "runtime_verification_required");
  assert.equal(report.gates.find((gate) => gate.name === "MED250_GATE_SECURITY_HARDENING_DEPLOYED").disposition, "closed_by_machine_evidence");
  assert.equal(report.gates.find((gate) => gate.name === "MED250_GATE_WHATSAPP_READY").disposition, "superseded_by_dispatch_portal_separation");
  assert.ok(domain.releaseRevisionBindings.every((binding) => /^[a-f0-9]{40}$/.test(binding.observedReleaseRevision)));
  assert.ok(domain.releaseRevisionBindings.every((binding) => binding.observedReleaseRevision !== report.sourceControl.currentReleaseRevision));
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
  assert.equal(report.legacyDomainRedirect.valid, true);
  assert.equal(report.legacyDomainRedirect.status, "passed");
  assert.equal(report.legacyDomainRedirect.legacyOrigin, "https://med250.gikundiro.com");
  assert.equal(report.legacyDomainRedirect.canonicalOrigin, "https://med-250.com");
  assert.match(report.legacyDomainRedirect.capturedAt, /^2026-07-29T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(report.legacyDomainRedirect.verifierCurrent, true);
  assert.equal(report.legacyDomainRedirect.probeCount, 5);
  assert.equal(report.legacyDomainRedirect.passedProbeCount, 5);
  assert.equal(report.legacyDomainRedirect.errorCount, 0);
  assert.equal(report.handoff.preparedPendingArtifactCount, report.handoff.missingEvidenceArtifactCount);
  assert.equal(report.handoff.unpreparedEvidenceArtifactCount, 0);
});
