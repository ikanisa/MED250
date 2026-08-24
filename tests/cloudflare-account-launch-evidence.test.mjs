import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildCloudflareAccountLaunchEvidence } from "../scripts/create-cloudflare-account-launch-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function completeVerificationResult(overrides = {}) {
  return {
    schema_version: "1",
    verification_type: "cloudflare_account_least_privilege",
    status: "passed",
    accountVisible: true,
    singleAccountVisible: true,
    intendedAccountConfirmed: true,
    productionWorkerConfirmed: true,
    previewWorkerConfirmed: true,
    customDomainRouteConfirmed: true,
    workersDevDisabled: true,
    directWorkerOwnsHostname: true,
    noCompetingSitesOrWorkerRoute: true,
    protectedGitHubEnvironmentConfirmed: true,
    requiredSecretsConfigured: true,
    requiredVariablesConfigured: true,
    leastPrivilegeCredentialInstalled: true,
    credentialScopeLimitedToMed250Worker: true,
    routeScopeLimitedToMed250Hostname: true,
    assetsPermissionLimited: true,
    zoneInspectionReadOnly: true,
    oldBroadCredentialRemovedFromReleasePath: true,
    broadInteractiveCredentialCannotDeploy: true,
    deploymentDryRunPassed: true,
    deploymentVerificationPassed: true,
    rollbackAccessConfirmed: true,
    unrelatedAccountPermissionsDetected: false,
    identifiersEmitted: false,
    tokensEmitted: false,
    rawProviderResponsesEmitted: false,
    visibleAccountCount: 1,
    unrelatedWritePermissionCount: 0,
    competingRouteOwnerCount: 0,
    accountLabel: "MED plus production Cloudflare account redacted",
    productionWorkerLabel: "MED plus production Worker redacted",
    credentialLabel: "MED plus least privilege release credential redacted",
    routeLabel: "MED plus production hostname route redacted",
    protectedEnvironmentLabel: "MED plus protected production release environment",
    ...overrides,
  };
}

function build(overrides = {}, optionOverrides = {}) {
  const result = completeVerificationResult(overrides);
  const source = `${JSON.stringify(result, null, 2)}\n`;
  return buildCloudflareAccountLaunchEvidence({
    verificationResult: result,
    verificationResultSha256: sha256(source),
    verificationResultReference: "desktop-output/goal-progress-2026-07-22/cloudflare-account-result.json",
    verifiedBy: "Named infrastructure verifier",
    verifierRole: "Infrastructure owner",
    verifiedAt: "2026-07-22T10:30:00+02:00",
    approvedBy: "Named infrastructure owner",
    approvedRole: "Infrastructure owner",
    approvedAt: "2026-07-22T11:00:00+02:00",
    nextReviewAt: "2026-08-22T11:00:00+02:00",
    accountOwnershipDecision: "The redacted Cloudflare account, production Worker and preview Worker are the intended MED plus release assets.",
    credentialScopeDecision: "The release credential is limited to MED plus deployment needs and read only zone inspection.",
    releasePathDecision: "Broad interactive access is removed from the release path and cannot deploy production.",
    environmentOwnershipDecision: "Protected production and preview environments have named ownership, approval rules, secrets and variables.",
    routingBoundaryDecision: "The direct production Worker route is the sole active owner of the production hostname.",
    rollbackDecision: "Rollback authority and emergency release access are assigned to the infrastructure owner group.",
    now: new Date("2026-07-22T12:00:00+02:00"),
    ...optionOverrides,
  });
}

test("builds complete Cloudflare account verification and approval evidence", () => {
  const artifacts = build();
  artifacts.signedApproval.account_verification_reference = "docs/launch/evidence/cloudflare-account-verification-2026-07-22.json";

  assert.equal(artifacts.accountVerification.gate, "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED");
  assert.equal(artifacts.accountVerification.evidence_type, "account_verification");
  assert.equal(artifacts.accountVerification.least_privilege_confirmed, true);
  assert.equal(artifacts.accountVerification.checks.length, 6);
  assert.equal(artifacts.signedApproval.evidence_type, "signed_approval");
  assert.equal(artifacts.signedApproval.decision, "approved");

  for (const artifact of [artifacts.accountVerification, artifacts.signedApproval]) {
    const validation = validateLaunchEvidenceArtifact(artifact, {
      expectedGate: "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED",
      expectedType: artifact.evidence_type,
      now: new Date("2026-07-22T12:00:00+02:00"),
    });
    assert.equal(validation.valid, true, validation.errors.join("; "));
  }
});

test("rejects Cloudflare account evidence without least privilege and route ownership", () => {
  assert.throws(
    () => build({ leastPrivilegeCredentialInstalled: false }),
    /leastPrivilegeCredentialInstalled must be true/,
  );
  assert.throws(
    () => build({ unrelatedWritePermissionCount: 1 }),
    /unrelatedWritePermissionCount must be an integer between 0 and 0/,
  );
  assert.throws(
    () => build({ competingRouteOwnerCount: 1 }),
    /competingRouteOwnerCount must be an integer between 0 and 0/,
  );
});

test("rejects Cloudflare account evidence with leaked provider material", () => {
  assert.throws(
    () => build({ credentialLabel: "Retained access_token=unsafe for release." }),
    /secret-like material/,
  );
  assert.throws(
    () => build({ accountLabel: "Account id 123e4567-e89b-12d3-a456-426614174000" }),
    /prohibited account/,
  );
});

test("rejects Cloudflare account approval without explicit owner decisions", () => {
  assert.throws(
    () => build({}, { approvedBy: "" }),
    /approved_by is required/,
  );
  assert.throws(
    () => build({}, { nextReviewAt: "2026-07-22T10:00:00+02:00" }),
    /next_review_at must be after approved_at/,
  );
  assert.throws(
    () => build({}, { routingBoundaryDecision: "" }),
    /routing_boundary_decision is required/,
  );
});
