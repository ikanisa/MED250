import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

const GATE = "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED";
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

function booleanTrue(result, field) {
  if (result?.[field] !== true) throw new Error(`${field} must be true.`);
}

function booleanFalse(result, field) {
  if (result?.[field] !== false) throw new Error(`${field} must be false.`);
}

function integerAtMost(result, field, maximum) {
  const value = result?.[field];
  if (!Number.isInteger(value) || value > maximum || value < 0) {
    throw new Error(`${field} must be an integer between 0 and ${maximum}.`);
  }
  return value;
}

function assertSafeText(value, label) {
  const text = named(value, label);
  if (secretLike.test(text)) throw new Error(`${label} contains secret-like material.`);
  if (prohibitedIdentifier.test(text)) throw new Error(`${label} contains a prohibited account, identity or precise-location identifier.`);
  return text;
}

function assertSafeResult(result) {
  const serialized = JSON.stringify(result);
  if (secretLike.test(serialized)) throw new Error("Cloudflare verification result contains secret-like material.");
  if (prohibitedIdentifier.test(serialized)) throw new Error("Cloudflare verification result contains a prohibited account, identity or precise-location identifier.");
}

function assertPassedVerificationResult(result) {
  if (result?.schema_version !== "1") throw new Error("verification result schema_version must be 1.");
  if (result?.verification_type !== "cloudflare_account_least_privilege") {
    throw new Error("verification_type must be cloudflare_account_least_privilege.");
  }
  if (result?.status !== "passed") throw new Error("Cloudflare verification result status must be passed.");

  booleanTrue(result, "accountVisible");
  booleanTrue(result, "singleAccountVisible");
  booleanTrue(result, "intendedAccountConfirmed");
  booleanTrue(result, "productionWorkerConfirmed");
  booleanTrue(result, "previewWorkerConfirmed");
  booleanTrue(result, "customDomainRouteConfirmed");
  booleanTrue(result, "workersDevDisabled");
  booleanTrue(result, "directWorkerOwnsHostname");
  booleanTrue(result, "noCompetingSitesOrWorkerRoute");
  booleanTrue(result, "protectedGitHubEnvironmentConfirmed");
  booleanTrue(result, "requiredSecretsConfigured");
  booleanTrue(result, "requiredVariablesConfigured");
  booleanTrue(result, "leastPrivilegeCredentialInstalled");
  booleanTrue(result, "credentialScopeLimitedToMed250Worker");
  booleanTrue(result, "routeScopeLimitedToMed250Hostname");
  booleanTrue(result, "assetsPermissionLimited");
  booleanTrue(result, "zoneInspectionReadOnly");
  booleanTrue(result, "oldBroadCredentialRemovedFromReleasePath");
  booleanTrue(result, "broadInteractiveCredentialCannotDeploy");
  booleanTrue(result, "deploymentDryRunPassed");
  booleanTrue(result, "deploymentVerificationPassed");
  booleanTrue(result, "rollbackAccessConfirmed");
  booleanFalse(result, "unrelatedAccountPermissionsDetected");
  booleanFalse(result, "identifiersEmitted");
  booleanFalse(result, "tokensEmitted");
  booleanFalse(result, "rawProviderResponsesEmitted");
  integerAtMost(result, "visibleAccountCount", 1);
  integerAtMost(result, "unrelatedWritePermissionCount", 0);
  integerAtMost(result, "competingRouteOwnerCount", 0);
  named(result.accountLabel, "accountLabel");
  named(result.productionWorkerLabel, "productionWorkerLabel");
  named(result.credentialLabel, "credentialLabel");
  named(result.routeLabel, "routeLabel");
  named(result.protectedEnvironmentLabel, "protectedEnvironmentLabel");
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
    accountOwnershipDecision: assertSafeText(options.accountOwnershipDecision, "account_ownership_decision"),
    credentialScopeDecision: assertSafeText(options.credentialScopeDecision, "credential_scope_decision"),
    releasePathDecision: assertSafeText(options.releasePathDecision, "release_path_decision"),
    environmentOwnershipDecision: assertSafeText(options.environmentOwnershipDecision, "environment_ownership_decision"),
    routingBoundaryDecision: assertSafeText(options.routingBoundaryDecision, "routing_boundary_decision"),
    rollbackDecision: assertSafeText(options.rollbackDecision, "rollback_decision"),
  };
}

export function buildCloudflareAccountLaunchEvidence({
  verificationResult,
  verificationResultSha256 = "",
  verificationResultReference = "",
  verifiedBy,
  verifierRole,
  verifiedAt,
  approvedBy,
  approvedRole,
  approvedAt,
  nextReviewAt,
  accountOwnershipDecision,
  credentialScopeDecision,
  releasePathDecision,
  environmentOwnershipDecision,
  routingBoundaryDecision,
  rollbackDecision,
  now = new Date(),
}) {
  assertSafeResult(verificationResult);
  assertPassedVerificationResult(verificationResult);
  if (!/^[a-f0-9]{64}$/.test(String(verificationResultSha256))) {
    throw new Error("verificationResultSha256 must be a lowercase SHA-256 digest.");
  }
  const verifiedTimestamp = requiredTimestamp(verifiedAt, "verified_at");
  if (Date.parse(verifiedTimestamp) > now.getTime() + 300_000) throw new Error("verified_at is in the future.");
  const approval = approvalOptions({
    approvedBy,
    approvedRole,
    approvedAt,
    nextReviewAt,
    accountOwnershipDecision,
    credentialScopeDecision,
    releasePathDecision,
    environmentOwnershipDecision,
    routingBoundaryDecision,
    rollbackDecision,
  }, now);

  const common = {
    schema_version: "1",
    release: "med250-production",
    gate: GATE,
    status: "complete",
    recorded_at: verifiedTimestamp,
    recorded_by: named(verifiedBy, "verified_by"),
    recorded_role: named(verifierRole, "verifier_role"),
    redactions_confirmed: true,
    cloudflare_verification_result_reference: verificationResultReference || null,
    cloudflare_verification_result_sha256: verificationResultSha256,
    account_label: verificationResult.accountLabel,
    production_worker_label: verificationResult.productionWorkerLabel,
    credential_label: verificationResult.credentialLabel,
    route_label: verificationResult.routeLabel,
    protected_environment_label: verificationResult.protectedEnvironmentLabel,
  };

  const accountVerification = {
    ...common,
    evidence_type: "account_verification",
    title: "MED+250 Cloudflare least-privilege account verification",
    summary: "The intended Cloudflare account, MED+250 Workers, protected environments, production custom-domain route and replacement least-privilege deployment credential were verified without retaining account identifiers or tokens.",
    checks: [
      {
        name: "Intended account and Workers confirmed",
        status: "passed",
        detail: "The verifier confirmed the single visible intended account plus the MED+250 production and preview Workers using redacted labels only.",
      },
      {
        name: "Production route ownership confirmed",
        status: "passed",
        detail: "The verifier confirmed the production hostname is owned by the intended direct Worker route, workers.dev is disabled and no competing Sites or Worker route owns it.",
      },
      {
        name: "Least-privilege credential installed",
        status: "passed",
        detail: "The replacement release credential is limited to the MED+250 Worker, required route and assets, with zone inspection constrained to read-only access.",
      },
      {
        name: "Broad release-path access removed",
        status: "passed",
        detail: "The verifier confirmed broad interactive credentials are removed from the release path and cannot authorize production deployment.",
      },
      {
        name: "Protected environments verified",
        status: "passed",
        detail: "The verifier confirmed protected deployment environments, required secret and variable ownership, approval boundaries and rollback access.",
      },
      {
        name: "Redacted provider output retained",
        status: "passed",
        detail: "The retained verification result declares that no account identifiers, tokens, operator identities or raw Cloudflare provider responses were emitted.",
      },
    ],
    verified_by: named(verifiedBy, "verified_by"),
    verifier_role: named(verifierRole, "verifier_role"),
    verified_at: verifiedTimestamp,
    least_privilege_confirmed: true,
  };

  const signedApproval = {
    ...common,
    evidence_type: "signed_approval",
    title: "MED+250 Cloudflare account and deployment-control approval",
    summary: "The infrastructure owner approved the intended Cloudflare account, Worker ownership, protected release environments, least-privilege credential scope, routing boundary, old-access removal and rollback authority.",
    recorded_at: approval.approvedAt,
    recorded_by: approval.approvedBy,
    recorded_role: approval.approvedRole,
    checks: [
      {
        name: "Completed account verification reviewed",
        status: "passed",
        detail: "The infrastructure owner reviewed the completed account-verification artifact and accepted its least-privilege conclusion.",
      },
      {
        name: "Intended account and Worker ownership approved",
        status: "passed",
        detail: "The approval records the redacted intended account, production Worker, preview Worker and protected release ownership decisions.",
      },
      {
        name: "Least-privilege credential scope approved",
        status: "passed",
        detail: "The approval accepts a credential limited to MED+250 deployment needs and read-only zone inspection.",
      },
      {
        name: "Old broad access removal approved",
        status: "passed",
        detail: "The approval records that broad interactive release-path access was removed and no longer authorizes production deployment.",
      },
      {
        name: "Routing boundary approved",
        status: "passed",
        detail: "The approval accepts the direct Worker route as the only active production hostname owner with no competing Sites or Worker route.",
      },
      {
        name: "Rollback and review ownership approved",
        status: "passed",
        detail: "The approval records rollback authority, protected-environment ownership and the next infrastructure review timestamp.",
      },
    ],
    decision: "approved",
    approved_by: approval.approvedBy,
    approved_role: approval.approvedRole,
    approved_at: approval.approvedAt,
    next_review_at: approval.nextReviewAt,
    account_ownership_decision: approval.accountOwnershipDecision,
    credential_scope_decision: approval.credentialScopeDecision,
    release_path_decision: approval.releasePathDecision,
    environment_ownership_decision: approval.environmentOwnershipDecision,
    routing_boundary_decision: approval.routingBoundaryDecision,
    rollback_decision: approval.rollbackDecision,
    account_verification_reference: null,
  };

  for (const artifact of [accountVerification, signedApproval]) {
    const validation = validateLaunchEvidenceArtifact(artifact, {
      expectedGate: GATE,
      expectedType: artifact.evidence_type,
      now,
    });
    if (!validation.valid) {
      throw new Error(`${artifact.evidence_type} artifact is invalid: ${validation.errors.join("; ")}`);
    }
  }

  return { accountVerification, signedApproval };
}

function parseArgs(values) {
  const args = {
    input: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    date: new Date().toISOString().slice(0, 10),
    verifiedBy: "",
    verifierRole: "",
    verifiedAt: "",
    approvedBy: "",
    approvedRole: "",
    approvedAt: "",
    nextReviewAt: "",
    accountOwnershipDecision: "",
    credentialScopeDecision: "",
    releasePathDecision: "",
    environmentOwnershipDecision: "",
    routingBoundaryDecision: "",
    rollbackDecision: "",
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--input") args.input = values[++index] ?? "";
    else if (flag === "--output-dir") args.outputDir = values[++index] ?? "";
    else if (flag === "--date") args.date = values[++index] ?? "";
    else if (flag === "--verified-by") args.verifiedBy = values[++index] ?? "";
    else if (flag === "--verifier-role") args.verifierRole = values[++index] ?? "";
    else if (flag === "--verified-at") args.verifiedAt = values[++index] ?? "";
    else if (flag === "--approved-by") args.approvedBy = values[++index] ?? "";
    else if (flag === "--approved-role") args.approvedRole = values[++index] ?? "";
    else if (flag === "--approved-at") args.approvedAt = values[++index] ?? "";
    else if (flag === "--next-review-at") args.nextReviewAt = values[++index] ?? "";
    else if (flag === "--account-ownership-decision") args.accountOwnershipDecision = values[++index] ?? "";
    else if (flag === "--credential-scope-decision") args.credentialScopeDecision = values[++index] ?? "";
    else if (flag === "--release-path-decision") args.releasePathDecision = values[++index] ?? "";
    else if (flag === "--environment-ownership-decision") args.environmentOwnershipDecision = values[++index] ?? "";
    else if (flag === "--routing-boundary-decision") args.routingBoundaryDecision = values[++index] ?? "";
    else if (flag === "--rollback-decision") args.rollbackDecision = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.input) throw new Error("--input requires a redacted Cloudflare account verification result JSON path.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = evidenceOutputDir(args.outputDir);
  const stamp = dateStamp(args.date);
  const source = await readFile(args.input, "utf8");
  const verificationReference = join(outputDir, `cloudflare-account-verification-${stamp}.json`).replaceAll("\\", "/");
  const approvalReference = join(outputDir, `cloudflare-account-approval-${stamp}.json`).replaceAll("\\", "/");
  const artifacts = buildCloudflareAccountLaunchEvidence({
    verificationResult: JSON.parse(source),
    verificationResultSha256: sha256(source),
    verificationResultReference: args.input,
    verifiedBy: args.verifiedBy,
    verifierRole: args.verifierRole,
    verifiedAt: args.verifiedAt,
    approvedBy: args.approvedBy,
    approvedRole: args.approvedRole,
    approvedAt: args.approvedAt,
    nextReviewAt: args.nextReviewAt,
    accountOwnershipDecision: args.accountOwnershipDecision,
    credentialScopeDecision: args.credentialScopeDecision,
    releasePathDecision: args.releasePathDecision,
    environmentOwnershipDecision: args.environmentOwnershipDecision,
    routingBoundaryDecision: args.routingBoundaryDecision,
    rollbackDecision: args.rollbackDecision,
  });
  artifacts.signedApproval.account_verification_reference = verificationReference;

  for (const [reference, artifact] of [
    [verificationReference, artifacts.accountVerification],
    [approvalReference, artifacts.signedApproval],
  ]) {
    const outputPath = resolve(reference);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    status: "written",
    outputs: {
      account_verification: verificationReference,
      signed_approval: approvalReference,
    },
    next_commands: [
      `npm run launch:evidence:record -- --artifact ${verificationReference} --replace`,
      `npm run launch:evidence:record -- --artifact ${approvalReference} --replace --confirm --approved-by "${artifacts.signedApproval.approved_by}" --approved-role "${artifacts.signedApproval.approved_role}" --approved-at "${artifacts.signedApproval.approved_at}"`,
    ],
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message, identifiersEmitted: false, tokensEmitted: false }, null, 2));
  process.exitCode = 1;
});
