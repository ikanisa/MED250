import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

const GATE = "MED250_GATE_PRESCRIPTION_RETENTION_APPROVED";
const DEFAULT_POLICY_PATH = "docs/launch/PRESCRIPTION_RETENTION_POLICY.md";
const DEFAULT_TEST_PATH = "docs/launch/evidence/prescription-retention-test-2026-07-16.json";
const DEFAULT_OUTPUT_DIR = "docs/launch/evidence";

const secretLike = /(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;
const prohibitedIdentifier = /(?:\b(?:\+?250)?7\d{8}\b|\bOTP\s*[:=]?\s*\d{6}\b|@[a-z0-9.-]+\.[a-z]{2,}|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,})/i;

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function named(value, label) {
  const text = String(value ?? "").trim();
  if (text.length < 3) throw new Error(`${label} is required.`);
  return text;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function requiredTimestamp(value, label) {
  const text = String(value ?? "").trim();
  if (!validTimestamp(text)) throw new Error(`${label} must be a timezone-qualified ISO 8601 timestamp.`);
  return text;
}

function dateStamp(value) {
  const stamp = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) throw new Error("--date must use YYYY-MM-DD.");
  return stamp;
}

function evidenceOutputDir(value) {
  const outputDir = String(value ?? "").trim().replaceAll("\\", "/");
  if (!outputDir) throw new Error("--output-dir requires a path.");
  if (isAbsolute(outputDir) || outputDir.split("/").includes("..")) {
    throw new Error("--output-dir must be a repository-relative path.");
  }
  if (!outputDir.startsWith("docs/launch/evidence")) {
    throw new Error("--output-dir must be under docs/launch/evidence.");
  }
  return outputDir.replace(/\/+$/, "");
}

function assertSafeText(value, label) {
  const text = named(value, label);
  if (secretLike.test(text)) throw new Error(`${label} contains secret-like material.`);
  if (prohibitedIdentifier.test(text)) throw new Error(`${label} contains a prohibited personal, identity or precise-location identifier.`);
  return text;
}

function assertRequiredPolicySections(policySource) {
  const required = [
    "## Access boundary",
    "## Retention periods",
    "## Cleanup schedule and safety controls",
    "## Pharmacy handling",
    "## Incident procedure",
    "## Monitoring and evidence",
    "## Approval checklist",
  ];
  for (const heading of required) {
    if (!policySource.includes(heading)) throw new Error(`policy is missing required section ${heading}.`);
  }
}

function assertStrictTestArtifact(testArtifact, now) {
  const result = validateLaunchEvidenceArtifact(testArtifact, {
    expectedGate: GATE,
    expectedType: "test_record",
    now,
  });
  if (!result.valid) {
    throw new Error(`prescription retention test artifact is not complete: ${result.errors.join("; ")}`);
  }
}

export function buildPrescriptionRetentionApprovalEvidence({
  policySource,
  policyPath = DEFAULT_POLICY_PATH,
  testArtifact,
  testPath = DEFAULT_TEST_PATH,
  testSha256 = "",
  approvedBy,
  approvedRole,
  approvedAt,
  nextReviewAt,
  legalBasisDecision,
  controllerProcessorDecision,
  transferDecision,
  notificationDecision,
  incidentContactsDecision,
  retentionDecision,
  pharmacyHandlingDecision,
  reviewConditions,
  now = new Date(),
}) {
  assertRequiredPolicySections(policySource);
  assertStrictTestArtifact(testArtifact, now);
  const approvedTimestamp = requiredTimestamp(approvedAt, "approved_at");
  const reviewTimestamp = requiredTimestamp(nextReviewAt, "next_review_at");
  if (Date.parse(approvedTimestamp) > now.getTime() + 300_000) throw new Error("approved_at is in the future.");
  if (Date.parse(reviewTimestamp) <= Date.parse(approvedTimestamp)) throw new Error("next_review_at must be after approved_at.");
  if (!/^[a-f0-9]{64}$/.test(String(testSha256))) throw new Error("testSha256 must be a lowercase SHA-256 digest.");

  const decisions = {
    legal_basis_decision: assertSafeText(legalBasisDecision, "legal_basis_decision"),
    controller_processor_decision: assertSafeText(controllerProcessorDecision, "controller_processor_decision"),
    transfer_decision: assertSafeText(transferDecision, "transfer_decision"),
    notification_decision: assertSafeText(notificationDecision, "notification_decision"),
    incident_contacts_decision: assertSafeText(incidentContactsDecision, "incident_contacts_decision"),
    retention_decision: assertSafeText(retentionDecision, "retention_decision"),
    pharmacy_handling_decision: assertSafeText(pharmacyHandlingDecision, "pharmacy_handling_decision"),
    review_conditions: assertSafeText(reviewConditions, "review_conditions"),
  };

  const artifact = {
    schema_version: "1",
    release: "med250-production",
    gate: GATE,
    evidence_type: "signed_approval",
    status: "complete",
    title: "MED+250 prescription access and retention privacy-owner approval",
    summary: "The privacy owner approved the implemented prescription access boundary, retention periods, cleanup schedule, pharmacy handling expectations, incident route and privacy-safe evidence limits after reviewing the completed cleanup test.",
    recorded_at: approvedTimestamp,
    recorded_by: named(approvedBy, "approved_by"),
    recorded_role: named(approvedRole, "approved_role"),
    redactions_confirmed: true,
    checks: [
      {
        name: "Private access boundary accepted",
        status: "passed",
        detail: "The privacy owner accepted customer and selected-pharmacy access boundaries, unrelated-recipient exclusion and short-lived signed-link limits.",
      },
      {
        name: "Retention periods accepted",
        status: "passed",
        detail: "The privacy owner accepted the 24-hour orphan rule, 24-hour selected-pharmacy access window and 30-day completed-request deletion rule.",
      },
      {
        name: "Cleanup controls accepted",
        status: "passed",
        detail: "The privacy owner accepted the protected six-hour cleanup schedule, lease, retry, reference-proof and deletion-before-reference-clearing controls.",
      },
      {
        name: "Controlled technical test reviewed",
        status: "passed",
        detail: "The completed redacted cleanup test artifact passed strict validation and remains bound by exact SHA-256 digest.",
      },
      {
        name: "Legal and role decisions recorded",
        status: "passed",
        detail: "The approval records privacy-safe legal-basis, controller, processor, transfer and notification decisions without storing identifiers.",
      },
      {
        name: "Incident and pharmacy handling accepted",
        status: "passed",
        detail: "The approval records incident-contact accountability and selected-pharmacy handling expectations in redacted form.",
      },
    ],
    decision: "approved",
    approved_by: named(approvedBy, "approved_by"),
    approved_role: named(approvedRole, "approved_role"),
    approved_at: approvedTimestamp,
    next_review_at: reviewTimestamp,
    policy_reference: policyPath,
    policy_sha256: sha256(policySource),
    test_reference: testPath,
    test_sha256: testSha256,
    ...decisions,
  };

  const validation = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: GATE,
    expectedType: "signed_approval",
    now,
  });
  if (!validation.valid) {
    throw new Error(`prescription retention approval artifact is invalid: ${validation.errors.join("; ")}`);
  }
  return artifact;
}

function parseArgs(values) {
  const args = {
    policy: DEFAULT_POLICY_PATH,
    test: DEFAULT_TEST_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    date: new Date().toISOString().slice(0, 10),
    approvedBy: "",
    approvedRole: "",
    approvedAt: "",
    nextReviewAt: "",
    legalBasisDecision: "",
    controllerProcessorDecision: "",
    transferDecision: "",
    notificationDecision: "",
    incidentContactsDecision: "",
    retentionDecision: "",
    pharmacyHandlingDecision: "",
    reviewConditions: "",
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--policy") args.policy = values[++index] ?? "";
    else if (flag === "--test") args.test = values[++index] ?? "";
    else if (flag === "--output-dir") args.outputDir = values[++index] ?? "";
    else if (flag === "--date") args.date = values[++index] ?? "";
    else if (flag === "--approved-by") args.approvedBy = values[++index] ?? "";
    else if (flag === "--approved-role") args.approvedRole = values[++index] ?? "";
    else if (flag === "--approved-at") args.approvedAt = values[++index] ?? "";
    else if (flag === "--next-review-at") args.nextReviewAt = values[++index] ?? "";
    else if (flag === "--legal-basis-decision") args.legalBasisDecision = values[++index] ?? "";
    else if (flag === "--controller-processor-decision") args.controllerProcessorDecision = values[++index] ?? "";
    else if (flag === "--transfer-decision") args.transferDecision = values[++index] ?? "";
    else if (flag === "--notification-decision") args.notificationDecision = values[++index] ?? "";
    else if (flag === "--incident-contacts-decision") args.incidentContactsDecision = values[++index] ?? "";
    else if (flag === "--retention-decision") args.retentionDecision = values[++index] ?? "";
    else if (flag === "--pharmacy-handling-decision") args.pharmacyHandlingDecision = values[++index] ?? "";
    else if (flag === "--review-conditions") args.reviewConditions = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.policy) throw new Error("--policy requires a policy path.");
  if (!args.test) throw new Error("--test requires a completed retention test artifact path.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = evidenceOutputDir(args.outputDir);
  const stamp = dateStamp(args.date);
  const policySource = await readFile(args.policy, "utf8");
  const testSource = await readFile(args.test, "utf8");
  const artifact = buildPrescriptionRetentionApprovalEvidence({
    policySource,
    policyPath: args.policy,
    testArtifact: JSON.parse(testSource),
    testPath: args.test,
    testSha256: sha256(testSource),
    approvedBy: args.approvedBy,
    approvedRole: args.approvedRole,
    approvedAt: args.approvedAt,
    nextReviewAt: args.nextReviewAt,
    legalBasisDecision: args.legalBasisDecision,
    controllerProcessorDecision: args.controllerProcessorDecision,
    transferDecision: args.transferDecision,
    notificationDecision: args.notificationDecision,
    incidentContactsDecision: args.incidentContactsDecision,
    retentionDecision: args.retentionDecision,
    pharmacyHandlingDecision: args.pharmacyHandlingDecision,
    reviewConditions: args.reviewConditions,
  });
  const outputReference = join(outputDir, `prescription-retention-approval-${stamp}.json`).replaceAll("\\", "/");
  const outputPath = resolve(outputReference);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "written",
    output: outputReference,
    gate: artifact.gate,
    next_commands: [
      `npm run launch:evidence:record -- --artifact ${outputReference} --replace --confirm --approved-by "${artifact.approved_by}" --approved-role "${artifact.approved_role}" --approved-at "${artifact.approved_at}"`,
    ],
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
