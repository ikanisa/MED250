import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

const GATE = "MED250_GATE_AUTH_RATE_LIMITS_APPROVED";
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

function positiveInteger(result, field, { minimum = 1 } = {}) {
  const value = result?.[field];
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${field} must be an integer >= ${minimum}.`);
  return value;
}

function booleanTrue(result, field) {
  if (result?.[field] !== true) throw new Error(`${field} must be true.`);
}

function booleanFalse(result, field) {
  if (result?.[field] !== false) throw new Error(`${field} must be false.`);
}

function assertSafeResult(result) {
  const serialized = JSON.stringify(result);
  if (secretLike.test(serialized)) throw new Error("rate-limit test result contains secret-like material.");
  if (prohibitedIdentifier.test(serialized)) throw new Error("rate-limit test result contains a prohibited personal, provider, identity or precise-location identifier.");
}

function assertPassedRateLimitResult(result) {
  if (result?.schema_version !== "1") throw new Error("rate-limit test result schema_version must be 1.");
  if (result?.test_type !== "anonymous_auth_rate_limit") throw new Error("test_type must be anonymous_auth_rate_limit.");
  if (result?.status !== "passed") throw new Error("rate-limit test result status must be passed.");
  booleanTrue(result, "anonymousAuthEnabled");
  booleanTrue(result, "serverSideTurnstileEnabled");
  booleanTrue(result, "sharedProjectOwnersApproved");
  booleanTrue(result, "maintenanceWindowApproved");
  booleanTrue(result, "intendedCustomerSessionCreated");
  booleanTrue(result, "intendedCustomerFlowReached");
  booleanTrue(result, "approvedThresholdExercised");
  booleanTrue(result, "excessAttemptsRateLimited");
  booleanTrue(result, "captchaRejectionDistinct");
  booleanTrue(result, "allDisposableSessionsRevoked");
  booleanTrue(result, "allDisposableUsersDeleted");
  booleanTrue(result, "aggregateUserCountRestored");
  booleanTrue(result, "privacySafeMonitoringReviewed");
  booleanTrue(result, "monitoringSignalsRedacted");
  booleanFalse(result, "marketplaceRowsCreated");
  booleanFalse(result, "sharedApplicationRegressionDetected");
  booleanFalse(result, "identifiersEmitted");
  booleanFalse(result, "tokensEmitted");
  booleanFalse(result, "networkIdentifiersEmitted");
  booleanFalse(result, "rawProviderResponsesEmitted");

  const selectedLimit = positiveInteger(result, "selectedAnonymousUserLimit");
  const exercisedThreshold = positiveInteger(result, "approvedCreationThreshold");
  const attemptedCreations = positiveInteger(result, "attemptedCreations", { minimum: exercisedThreshold + 1 });
  const rateLimitedAttempts = positiveInteger(result, "rateLimitedAttempts");
  const disposableCreated = positiveInteger(result, "disposableAnonymousUsersCreated", { minimum: exercisedThreshold });
  const sessionsRevoked = positiveInteger(result, "disposableSessionsRevoked", { minimum: disposableCreated });
  const usersDeleted = positiveInteger(result, "disposableUsersDeleted", { minimum: disposableCreated });
  if (selectedLimit < exercisedThreshold) throw new Error("selectedAnonymousUserLimit cannot be lower than approvedCreationThreshold.");
  if (rateLimitedAttempts > attemptedCreations) throw new Error("rateLimitedAttempts cannot exceed attemptedCreations.");
  if (sessionsRevoked < disposableCreated) throw new Error("disposableSessionsRevoked must cover every disposable anonymous user.");
  if (usersDeleted < disposableCreated) throw new Error("disposableUsersDeleted must cover every disposable anonymous user.");
  const preCount = positiveInteger(result, "preTestAuthUserCount", { minimum: 0 });
  const postCount = positiveInteger(result, "postCleanupAuthUserCount", { minimum: 0 });
  if (preCount !== postCount) throw new Error("postCleanupAuthUserCount must equal preTestAuthUserCount.");
  named(result.timeWindow, "timeWindow");
  named(result.sharedProjectImpactSummary, "sharedProjectImpactSummary");
  named(result.monitoringSummary, "monitoringSummary");
  named(result.rollbackSummary, "rollbackSummary");
}

function approvalOptions(options, now) {
  const approvedAt = requiredTimestamp(options.approvedAt, "approved_at");
  const nextReviewAt = requiredTimestamp(options.nextReviewAt, "next_review_at");
  if (Date.parse(approvedAt) > now.getTime() + 300_000) throw new Error("approved_at is in the future.");
  if (Date.parse(nextReviewAt) <= Date.parse(approvedAt)) throw new Error("next_review_at must be after approved_at.");
  return {
    approvedBy: named(options.approvedBy, "approved_by"),
    approvedRole: named(options.approvedRole, "approved_role"),
    approvedAt,
    nextReviewAt,
    changeAuthority: named(options.changeAuthority, "change_authority"),
    rollbackCriteria: named(options.rollbackCriteria, "rollback_criteria"),
    legitimatePeakProfile: named(options.legitimatePeakProfile, "legitimate_peak_profile"),
    abuseRiskDecision: named(options.abuseRiskDecision, "abuse_risk_decision"),
    monitoringDecision: named(options.monitoringDecision, "monitoring_decision"),
  };
}

export function buildAuthRateLimitLaunchEvidence({
  rateLimitResult,
  rateLimitResultSha256 = "",
  rateLimitResultReference = "",
  executedBy,
  executorRole,
  startedAt,
  completedAt,
  approvedBy,
  approvedRole,
  approvedAt,
  nextReviewAt,
  changeAuthority,
  rollbackCriteria,
  legitimatePeakProfile,
  abuseRiskDecision,
  monitoringDecision,
  now = new Date(),
}) {
  assertSafeResult(rateLimitResult);
  assertPassedRateLimitResult(rateLimitResult);
  if (!/^[a-f0-9]{64}$/.test(String(rateLimitResultSha256))) {
    throw new Error("rateLimitResultSha256 must be a lowercase SHA-256 digest.");
  }
  const started = requiredTimestamp(startedAt, "started_at");
  const completed = requiredTimestamp(completedAt, "completed_at");
  if (Date.parse(completed) < Date.parse(started)) throw new Error("completed_at cannot precede started_at.");
  if (Date.parse(completed) > now.getTime() + 300_000) throw new Error("completed_at is in the future.");
  const approval = approvalOptions({
    approvedBy,
    approvedRole,
    approvedAt,
    nextReviewAt,
    changeAuthority,
    rollbackCriteria,
    legitimatePeakProfile,
    abuseRiskDecision,
    monitoringDecision,
  }, now);

  const common = {
    schema_version: "1",
    release: "med250-production",
    gate: GATE,
    status: "complete",
    recorded_at: completed,
    recorded_by: named(executedBy, "executed_by"),
    recorded_role: named(executorRole, "executor_role"),
    redactions_confirmed: true,
    rate_limit_result_reference: rateLimitResultReference || null,
    rate_limit_result_sha256: rateLimitResultSha256,
    selected_anonymous_user_limit: rateLimitResult.selectedAnonymousUserLimit,
    selected_time_window: rateLimitResult.timeWindow,
    approved_creation_threshold: rateLimitResult.approvedCreationThreshold,
    attempted_creations: rateLimitResult.attemptedCreations,
    rate_limited_attempts: rateLimitResult.rateLimitedAttempts,
  };

  const testRecord = {
    ...common,
    evidence_type: "test_record",
    title: "MED+250 anonymous-auth rate-limit completed controlled test",
    summary: "A controlled production anonymous-auth rate-limit test proved intended customer access, excess-attempt rejection, complete cleanup, shared-project safety and privacy-safe monitoring without retaining tokens or identifiers.",
    checks: [
      {
        name: "Shared-project window approved",
        status: "passed",
        detail: "The test ran only after the shared Supabase Auth project owners approved the maintenance window and disposable identity volume.",
      },
      {
        name: "Intended anonymous customer access passed",
        status: "passed",
        detail: "A customer using a fresh production Turnstile response obtained one anonymous session and reached the governed MED+250 customer flow.",
      },
      {
        name: "Approved threshold exercised",
        status: "passed",
        detail: "Fresh approved disposable browser clients exercised the agreed anonymous identity creation threshold for legitimate demand.",
      },
      {
        name: "Excess attempts rate limited",
        status: "passed",
        detail: "Creation attempts above the approved threshold received the expected rate-limit rejection without weakening server-side Turnstile enforcement.",
      },
      {
        name: "Disposable identities removed",
        status: "passed",
        detail: "Every disposable anonymous session was revoked, every disposable identity was deleted, and the aggregate Auth user count returned to its pre-test value.",
      },
      {
        name: "No marketplace or shared-app harm",
        status: "passed",
        detail: "The test created no MED+250 marketplace rows and the operator found no shared-application regression in the privacy-safe monitoring window.",
      },
      {
        name: "Redacted monitoring retained",
        status: "passed",
        detail: "The retained rate-limit result declares that no tokens, identities, network identifiers or raw provider responses were emitted.",
      },
    ],
    executed_by: named(executedBy, "executed_by"),
    executor_role: named(executorRole, "executor_role"),
    started_at: started,
    completed_at: completed,
    shared_project_impact_summary: rateLimitResult.sharedProjectImpactSummary,
    monitoring_summary: rateLimitResult.monitoringSummary,
    rollback_summary: rateLimitResult.rollbackSummary,
  };

  const signedApproval = {
    ...common,
    evidence_type: "signed_approval",
    title: "MED+250 anonymous-auth rate-limit security-owner approval",
    summary: "The security owner approved the selected project-wide anonymous-auth rate limit, time window, shared-project impact, monitoring conditions, rollback criteria and Turnstile dependency after the controlled test passed.",
    recorded_at: approval.approvedAt,
    recorded_by: approval.approvedBy,
    recorded_role: approval.approvedRole,
    checks: [
      {
        name: "Controlled rate-limit test passed",
        status: "passed",
        detail: "The paired test record passed intended access, threshold, excess-attempt rejection, cleanup and redaction checks.",
      },
      {
        name: "Shared-project impact accepted",
        status: "passed",
        detail: "The security owner accepted the selected limit for MED+250 and the other applications sharing the same Auth project.",
      },
      {
        name: "Legitimate demand and abuse risk balanced",
        status: "passed",
        detail: "The approval records the legitimate peak anonymous-session profile, abuse risk and selected threshold without storing sensitive provider data.",
      },
      {
        name: "Monitoring and rollback approved",
        status: "passed",
        detail: "Alert expectations, change authority, rollback criteria and next review timing are recorded in privacy-safe form.",
      },
      {
        name: "Turnstile dependency accepted",
        status: "passed",
        detail: "The approval assumes server-side production Turnstile remains enabled; weakening CAPTCHA is not an allowed capacity response.",
      },
      {
        name: "Named security-owner signature recorded",
        status: "passed",
        detail: "The accountable security owner recorded an approval decision, role, timestamp and next review date.",
      },
    ],
    decision: "approved",
    approved_by: approval.approvedBy,
    approved_role: approval.approvedRole,
    approved_at: approval.approvedAt,
    next_review_at: approval.nextReviewAt,
    change_authority: approval.changeAuthority,
    rollback_criteria: approval.rollbackCriteria,
    legitimate_peak_profile: approval.legitimatePeakProfile,
    abuse_risk_decision: approval.abuseRiskDecision,
    monitoring_decision: approval.monitoringDecision,
    test_reference: null,
  };

  for (const artifact of [testRecord, signedApproval]) {
    const validation = validateLaunchEvidenceArtifact(artifact, {
      expectedGate: GATE,
      expectedType: artifact.evidence_type,
      now,
    });
    if (!validation.valid) {
      throw new Error(`${artifact.evidence_type} artifact is invalid: ${validation.errors.join("; ")}`);
    }
  }

  return { testRecord, signedApproval };
}

function parseArgs(values) {
  const args = {
    input: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    date: new Date().toISOString().slice(0, 10),
    executedBy: "",
    executorRole: "",
    startedAt: "",
    completedAt: "",
    approvedBy: "",
    approvedRole: "",
    approvedAt: "",
    nextReviewAt: "",
    changeAuthority: "",
    rollbackCriteria: "",
    legitimatePeakProfile: "",
    abuseRiskDecision: "",
    monitoringDecision: "",
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--input") args.input = values[++index] ?? "";
    else if (flag === "--output-dir") args.outputDir = values[++index] ?? "";
    else if (flag === "--date") args.date = values[++index] ?? "";
    else if (flag === "--executed-by") args.executedBy = values[++index] ?? "";
    else if (flag === "--executor-role") args.executorRole = values[++index] ?? "";
    else if (flag === "--started-at") args.startedAt = values[++index] ?? "";
    else if (flag === "--completed-at") args.completedAt = values[++index] ?? "";
    else if (flag === "--approved-by") args.approvedBy = values[++index] ?? "";
    else if (flag === "--approved-role") args.approvedRole = values[++index] ?? "";
    else if (flag === "--approved-at") args.approvedAt = values[++index] ?? "";
    else if (flag === "--next-review-at") args.nextReviewAt = values[++index] ?? "";
    else if (flag === "--change-authority") args.changeAuthority = values[++index] ?? "";
    else if (flag === "--rollback-criteria") args.rollbackCriteria = values[++index] ?? "";
    else if (flag === "--legitimate-peak-profile") args.legitimatePeakProfile = values[++index] ?? "";
    else if (flag === "--abuse-risk-decision") args.abuseRiskDecision = values[++index] ?? "";
    else if (flag === "--monitoring-decision") args.monitoringDecision = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.input) throw new Error("--input requires a redacted auth rate-limit test result JSON path.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = evidenceOutputDir(args.outputDir);
  const stamp = dateStamp(args.date);
  const source = await readFile(args.input, "utf8");
  const testReference = join(outputDir, `auth-rate-limit-test-${stamp}.json`).replaceAll("\\", "/");
  const approvalReference = join(outputDir, `auth-rate-limit-approval-${stamp}.json`).replaceAll("\\", "/");
  const artifacts = buildAuthRateLimitLaunchEvidence({
    rateLimitResult: JSON.parse(source),
    rateLimitResultSha256: sha256(source),
    rateLimitResultReference: args.input,
    executedBy: args.executedBy,
    executorRole: args.executorRole,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    approvedBy: args.approvedBy,
    approvedRole: args.approvedRole,
    approvedAt: args.approvedAt,
    nextReviewAt: args.nextReviewAt,
    changeAuthority: args.changeAuthority,
    rollbackCriteria: args.rollbackCriteria,
    legitimatePeakProfile: args.legitimatePeakProfile,
    abuseRiskDecision: args.abuseRiskDecision,
    monitoringDecision: args.monitoringDecision,
  });
  artifacts.signedApproval.test_reference = testReference;

  for (const [reference, artifact] of [
    [testReference, artifacts.testRecord],
    [approvalReference, artifacts.signedApproval],
  ]) {
    const outputPath = resolve(reference);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    status: "written",
    outputs: {
      test_record: testReference,
      signed_approval: approvalReference,
    },
    next_commands: [
      `npm run launch:evidence:record -- --artifact ${testReference} --replace`,
      `npm run launch:evidence:record -- --artifact ${approvalReference} --replace --confirm --approved-by "${artifacts.signedApproval.approved_by}" --approved-role "${artifacts.signedApproval.approved_role}" --approved-at "${artifacts.signedApproval.approved_at}"`,
    ],
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message, identifiersEmitted: false, tokensEmitted: false }, null, 2));
  process.exitCode = 1;
});
