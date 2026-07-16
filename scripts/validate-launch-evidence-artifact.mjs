import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const allowedEvidenceTypes = new Set([
  "account_verification",
  "deployment_receipt",
  "domain_verification",
  "operations_snapshot",
  "review_ledger",
  "signed_approval",
  "test_record",
]);

const secretLike = /(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;
const prohibitedIdentifier = /(?:\b(?:\+?250)?7\d{8}\b|\bOTP\s*[:=]?\s*\d{6}\b|@[a-z0-9.-]+\.[a-z]{2,}|-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,})/i;

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function named(value) {
  return typeof value === "string" && value.trim().length >= 3;
}

function requireNamed(errors, artifact, fields) {
  for (const [field, label] of fields) if (!named(artifact?.[field])) errors.push(`${label} is required`);
}

function requireTimestamp(errors, artifact, field, label) {
  if (!validTimestamp(artifact?.[field])) errors.push(`${label} requires a timezone-qualified timestamp`);
}

export function validateLaunchEvidenceArtifact(artifact, {
  strict = true,
  expectedGate = "",
  expectedType = "",
  now = new Date(),
} = {}) {
  const errors = [];
  const warnings = [];
  if (artifact?.schema_version !== "1") errors.push("artifact schema_version must be 1");
  if (artifact?.release !== "med250-production") errors.push("artifact release must be med250-production");
  if (!named(artifact?.gate)) errors.push("artifact gate is required");
  if (expectedGate && artifact?.gate !== expectedGate) errors.push(`artifact gate must be ${expectedGate}`);
  if (!allowedEvidenceTypes.has(artifact?.evidence_type)) errors.push("artifact evidence_type is invalid");
  if (expectedType && artifact?.evidence_type !== expectedType) errors.push(`artifact evidence_type must be ${expectedType}`);
  if (!new Set(["pending", "complete", "rejected"]).has(artifact?.status)) errors.push("artifact status is invalid");
  if (strict && artifact?.status !== "complete") errors.push("artifact status must be complete");
  if (!named(artifact?.title) || artifact.title.trim().length < 20) errors.push("artifact title must be concrete");
  if (!named(artifact?.summary) || artifact.summary.trim().length < 30) errors.push("artifact summary must be useful");
  if (!validTimestamp(artifact?.recorded_at)) errors.push("artifact recorded_at requires a timezone-qualified timestamp");
  if (validTimestamp(artifact?.recorded_at) && Date.parse(artifact.recorded_at) > now.getTime() + 300_000) errors.push("artifact recorded_at is in the future");
  requireNamed(errors, artifact, [["recorded_by", "artifact recorder"], ["recorded_role", "artifact recorder role"]]);
  if (artifact?.redactions_confirmed !== true) errors.push("artifact redactions_confirmed must be true");
  const serialized = JSON.stringify(artifact);
  if (secretLike.test(serialized)) errors.push("artifact contains secret-like material");
  if (prohibitedIdentifier.test(serialized)) errors.push("artifact contains a prohibited personal or precise-location identifier");
  if (!Array.isArray(artifact?.checks) || artifact.checks.length === 0) {
    errors.push("artifact requires at least one verification check");
  } else {
    for (const [index, check] of artifact.checks.entries()) {
      if (!named(check?.name)) errors.push(`artifact check ${index + 1} requires a name`);
      if (!new Set(["pending", "passed", "failed", "blocked"]).has(check?.status)) errors.push(`artifact check ${index + 1} has invalid status`);
      if (strict && check?.status !== "passed") errors.push(`artifact check ${index + 1} must be passed`);
      if (!named(check?.detail) || check.detail.trim().length < 20) errors.push(`artifact check ${index + 1} requires a useful redacted detail`);
    }
  }

  if (strict || artifact?.status === "complete") {
    switch (artifact?.evidence_type) {
      case "signed_approval":
        if (artifact?.decision !== "approved") errors.push("signed approval decision must be approved");
        requireNamed(errors, artifact, [["approved_by", "approval signer"], ["approved_role", "approval signer role"]]);
        requireTimestamp(errors, artifact, "approved_at", "signed approval");
        break;
      case "test_record":
        requireNamed(errors, artifact, [["executed_by", "test executor"], ["executor_role", "test executor role"]]);
        requireTimestamp(errors, artifact, "started_at", "test record started_at");
        requireTimestamp(errors, artifact, "completed_at", "test record completed_at");
        if (validTimestamp(artifact?.started_at) && validTimestamp(artifact?.completed_at) && Date.parse(artifact.completed_at) < Date.parse(artifact.started_at)) errors.push("test record completed_at precedes started_at");
        break;
      case "review_ledger":
        requireNamed(errors, artifact, [["reviewed_by", "ledger reviewer"], ["reviewer_role", "ledger reviewer role"]]);
        requireTimestamp(errors, artifact, "reviewed_at", "review ledger");
        if (!Number.isInteger(artifact?.total_records) || artifact.total_records < 1) errors.push("review ledger total_records must be positive");
        if (artifact?.pending_records !== 0) errors.push("review ledger pending_records must be zero");
        if (artifact?.blocked_records !== 0) errors.push("review ledger blocked_records must be zero");
        if (!artifact?.source_digests || typeof artifact.source_digests !== "object" || !Object.keys(artifact.source_digests).length) errors.push("review ledger requires source_digests");
        else if (Object.values(artifact.source_digests).some((digest) => !/^[a-f0-9]{64}$/.test(String(digest)))) errors.push("review ledger source_digests must be lowercase SHA-256 values");
        break;
      case "deployment_receipt":
        requireNamed(errors, artifact, [["deployed_by", "deployment operator"], ["deployer_role", "deployment operator role"], ["environment", "deployment environment"], ["release_identifier", "deployment release identifier"]]);
        requireTimestamp(errors, artifact, "deployed_at", "deployment receipt");
        break;
      case "account_verification":
        requireNamed(errors, artifact, [["verified_by", "account verifier"], ["verifier_role", "account verifier role"], ["account_label", "redacted account label"]]);
        requireTimestamp(errors, artifact, "verified_at", "account verification");
        if (artifact?.least_privilege_confirmed !== true) errors.push("account verification must confirm least privilege");
        break;
      case "domain_verification":
        requireNamed(errors, artifact, [["verified_by", "domain verifier"], ["verifier_role", "domain verifier role"]]);
        requireTimestamp(errors, artifact, "verified_at", "domain verification");
        for (const hostname of ["med250.gikundiro.com"]) if (!Array.isArray(artifact?.hostnames) || !artifact.hostnames.includes(hostname)) errors.push(`domain verification must include ${hostname}`);
        for (const field of ["dns_passed", "tls_passed", "routes_passed"]) if (artifact?.[field] !== true) errors.push(`domain verification ${field} must be true`);
        break;
      case "operations_snapshot":
        requireNamed(errors, artifact, [["captured_by", "operations snapshot operator"], ["capturer_role", "operations snapshot operator role"]]);
        requireTimestamp(errors, artifact, "captured_at", "operations snapshot");
        if (artifact?.critical_count !== 0) errors.push("operations snapshot critical_count must be zero");
        if (!artifact?.metrics || typeof artifact.metrics !== "object" || !Object.keys(artifact.metrics).length) errors.push("operations snapshot requires aggregate metrics");
        break;
      default:
        break;
    }
  } else {
    warnings.push("artifact is a pending template and cannot satisfy a production gate");
  }

  return { valid: errors.length === 0, strict, errors, warnings };
}

function main() {
  const values = process.argv.slice(2);
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("Use --file <path> --gate <gate-name> --type <evidence-type>.");
    args[flag.slice(2)] = value;
  }
  if (!args.file || !args.gate || !args.type) throw new Error("Use --file <path> --gate <gate-name> --type <evidence-type>.");
  const artifact = JSON.parse(readFileSync(resolve(args.file), "utf8"));
  const result = validateLaunchEvidenceArtifact(artifact, { expectedGate: args.gate, expectedType: args.type });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
