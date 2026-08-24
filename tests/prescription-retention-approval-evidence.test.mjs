import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPrescriptionRetentionApprovalEvidence } from "../scripts/create-prescription-retention-approval-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";

const policySource = await readFile(new URL("../docs/launch/PRESCRIPTION_RETENTION_POLICY.md", import.meta.url), "utf8");
const testSource = await readFile(new URL("../docs/launch/evidence/prescription-retention-test-2026-07-16.json", import.meta.url), "utf8");
const testArtifact = JSON.parse(testSource);

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function build(overrides = {}) {
  return buildPrescriptionRetentionApprovalEvidence({
    policySource,
    policyPath: "docs/launch/PRESCRIPTION_RETENTION_POLICY.md",
    testArtifact,
    testPath: "docs/launch/evidence/prescription-retention-test-2026-07-16.json",
    testSha256: sha256(testSource),
    approvedBy: "Named privacy owner",
    approvedRole: "Privacy owner",
    approvedAt: "2026-07-22T11:00:00+02:00",
    nextReviewAt: "2026-10-22T11:00:00+02:00",
    legalBasisDecision: "Prescription files are processed only for customer-requested pharmacy availability and fulfilment support.",
    controllerProcessorDecision: "MED plus retains accountable platform controls while selected pharmacy staff handle prescription review for the selected request.",
    transferDecision: "No launch evidence stores prescription contents, object paths, phone values, request identifiers, or exact locations.",
    notificationDecision: "Any notification assessment follows the approved incident procedure before closure.",
    incidentContactsDecision: "The controlled staff register identifies accountable privacy and security incident roles before launch.",
    retentionDecision: "The 24 hour orphan and selected access rules plus 30 day completed request deletion rule are accepted.",
    pharmacyHandlingDecision: "Selected pharmacy staff must restrict prescription access to authorized request handling and avoid onward copying.",
    reviewConditions: "Review is required after material workflow, storage, retention, incident, or legal-obligation changes.",
    now: new Date("2026-07-22T12:00:00+02:00"),
    ...overrides,
  });
}

test("builds a strict prescription retention privacy-owner approval artifact", () => {
  const artifact = build();
  assert.equal(artifact.gate, "MED250_GATE_PRESCRIPTION_RETENTION_APPROVED");
  assert.equal(artifact.evidence_type, "signed_approval");
  assert.equal(artifact.status, "complete");
  assert.equal(artifact.decision, "approved");
  assert.equal(artifact.policy_sha256, sha256(policySource));
  assert.equal(artifact.test_sha256, sha256(testSource));
  assert.equal(artifact.checks.length, 6);

  const validation = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: "MED250_GATE_PRESCRIPTION_RETENTION_APPROVED",
    expectedType: "signed_approval",
    now: new Date("2026-07-22T12:00:00+02:00"),
  });
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("rejects prescription retention approval without strict completed test evidence", () => {
  const incompleteTest = structuredClone(testArtifact);
  incompleteTest.status = "pending";
  assert.throws(
    () => build({ testArtifact: incompleteTest }),
    /test artifact is not complete/,
  );
});

test("rejects prescription retention approval with stale review timing or missing decisions", () => {
  assert.throws(
    () => build({ nextReviewAt: "2026-07-22T10:00:00+02:00" }),
    /next_review_at must be after approved_at/,
  );
  assert.throws(
    () => build({ legalBasisDecision: "" }),
    /legal_basis_decision is required/,
  );
});

test("rejects prescription retention approval that leaks identifiers or secrets", () => {
  assert.throws(
    () => build({ reviewConditions: "Escalation access_token=unsafe must be retained." }),
    /secret-like material/,
  );
  assert.throws(
    () => build({ incidentContactsDecision: "Call +250788123456 for incidents." }),
    /prohibited personal/,
  );
});
