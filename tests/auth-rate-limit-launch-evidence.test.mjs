import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildAuthRateLimitLaunchEvidence } from "../scripts/create-auth-rate-limit-launch-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";

function digest(source) {
  return createHash("sha256").update(source).digest("hex");
}

function completeRateLimitResult(overrides = {}) {
  return {
    schema_version: "1",
    test_type: "anonymous_auth_rate_limit",
    status: "passed",
    anonymousAuthEnabled: true,
    serverSideTurnstileEnabled: true,
    sharedProjectOwnersApproved: true,
    maintenanceWindowApproved: true,
    intendedCustomerSessionCreated: true,
    intendedCustomerFlowReached: true,
    approvedThresholdExercised: true,
    excessAttemptsRateLimited: true,
    captchaRejectionDistinct: true,
    allDisposableSessionsRevoked: true,
    allDisposableUsersDeleted: true,
    aggregateUserCountRestored: true,
    privacySafeMonitoringReviewed: true,
    monitoringSignalsRedacted: true,
    marketplaceRowsCreated: false,
    sharedApplicationRegressionDetected: false,
    identifiersEmitted: false,
    tokensEmitted: false,
    networkIdentifiersEmitted: false,
    rawProviderResponsesEmitted: false,
    selectedAnonymousUserLimit: 30,
    timeWindow: "one hour rolling anonymous identity creation window",
    approvedCreationThreshold: 3,
    attemptedCreations: 5,
    rateLimitedAttempts: 2,
    disposableAnonymousUsersCreated: 3,
    disposableSessionsRevoked: 3,
    disposableUsersDeleted: 3,
    preTestAuthUserCount: 42,
    postCleanupAuthUserCount: 42,
    sharedProjectImpactSummary: "MED plus shared applications accepted the controlled window and observed no regression in aggregate health.",
    monitoringSummary: "Privacy-safe aggregate Auth and Worker health signals were reviewed after the test window.",
    rollbackSummary: "Rollback is to restore the previous project setting and recheck aggregate Auth health before reopening launch approval.",
    ...overrides,
  };
}

function build(overrides = {}, optionOverrides = {}) {
  const result = completeRateLimitResult(overrides);
  const source = `${JSON.stringify(result, null, 2)}\n`;
  return buildAuthRateLimitLaunchEvidence({
    rateLimitResult: result,
    rateLimitResultSha256: digest(source),
    rateLimitResultReference: "desktop-output/goal-progress-2026-07-22/auth-rate-limit-result.json",
    executedBy: "Named security tester",
    executorRole: "Security owner",
    startedAt: "2026-07-22T10:00:00+02:00",
    completedAt: "2026-07-22T10:30:00+02:00",
    approvedBy: "Named security owner",
    approvedRole: "Security owner",
    approvedAt: "2026-07-22T11:00:00+02:00",
    nextReviewAt: "2026-08-22T11:00:00+02:00",
    changeAuthority: "Named security owner with shared-project owner notice",
    rollbackCriteria: "Rollback on customer session regression, excessive rejected legitimate sessions, or aggregate Auth health degradation.",
    legitimatePeakProfile: "Expected peak launch demand remains below the approved creation threshold during a one hour window.",
    abuseRiskDecision: "The selected limit balances legitimate anonymous customer access with automated abuse resistance.",
    monitoringDecision: "Aggregate Auth and Worker health alerts remain active through launch and the first review window.",
    now: new Date("2026-07-22T12:00:00+02:00"),
    ...optionOverrides,
  });
}

test("builds complete auth rate-limit test and approval launch evidence", () => {
  const artifacts = build();
  artifacts.signedApproval.test_reference = "docs/launch/evidence/auth-rate-limit-test-2026-07-22.json";

  assert.equal(artifacts.testRecord.gate, "MED250_GATE_AUTH_RATE_LIMITS_APPROVED");
  assert.equal(artifacts.testRecord.evidence_type, "test_record");
  assert.equal(artifacts.testRecord.checks.length, 7);
  assert.equal(artifacts.signedApproval.evidence_type, "signed_approval");
  assert.equal(artifacts.signedApproval.decision, "approved");

  for (const artifact of [artifacts.testRecord, artifacts.signedApproval]) {
    const validation = validateLaunchEvidenceArtifact(artifact, {
      expectedGate: "MED250_GATE_AUTH_RATE_LIMITS_APPROVED",
      expectedType: artifact.evidence_type,
      now: new Date("2026-07-22T12:00:00+02:00"),
    });
    assert.equal(validation.valid, true, validation.errors.join("; "));
  }
});

test("rejects auth rate-limit evidence without a passing controlled run", () => {
  assert.throws(
    () => build({ status: "pending" }),
    /status must be passed/,
  );
  assert.throws(
    () => build({ postCleanupAuthUserCount: 45 }),
    /postCleanupAuthUserCount must equal preTestAuthUserCount/,
  );
  assert.throws(
    () => build({ excessAttemptsRateLimited: false }),
    /excessAttemptsRateLimited must be true/,
  );
});

test("rejects auth rate-limit evidence with leaked secrets or identifiers", () => {
  assert.throws(
    () => build({ monitoringSummary: "Retained provider output contained access_token=unsafe." }),
    /secret-like material/,
  );
  assert.throws(
    () => build({ sharedProjectImpactSummary: "Operator contact was +250788123456." }),
    /prohibited personal/,
  );
});

test("rejects auth rate-limit approval without explicit security-owner decisions", () => {
  assert.throws(
    () => build({}, { approvedBy: "" }),
    /approved_by is required/,
  );
  assert.throws(
    () => build({}, { nextReviewAt: "2026-07-22T10:00:00+02:00" }),
    /next_review_at must be after approved_at/,
  );
});
