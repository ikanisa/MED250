import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

export const expectedLaunchGateNames = [
  "MED250_GATE_GPS_READY",
  "MED250_GATE_WHATSAPP_READY",
  "MED250_GATE_PHARMACY_OPERATIONS_APPROVED",
  "MED250_GATE_REGULATORY_APPROVED",
  "MED250_GATE_DATA_REUSE_APPROVED",
  "MED250_GATE_DUPLICATE_REGISTER_REVIEWED",
  "MED250_GATE_CREDENTIALS_ROTATED",
  "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
  "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
  "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
  "MED250_GATE_AUTH_RATE_LIMITS_APPROVED",
  "MED250_GATE_PRESCRIPTION_RETENTION_APPROVED",
  "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED",
  "MED250_GATE_DOMAIN_DNS_VERIFIED",
  "MED250_GATE_PHYSICAL_UAT_PASSED",
];

const allowedStatuses = new Set(["pending", "confirmed", "rejected"]);
const allowedEvidenceTypes = new Set([
  "account_verification",
  "deployment_receipt",
  "domain_verification",
  "operations_snapshot",
  "review_ledger",
  "signed_approval",
  "test_record",
]);
const secretLike = /(sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;

function validDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function safeEvidenceReference(reference, rootDir) {
  if (typeof reference !== "string" || !reference.trim()) return "is missing a reference";
  if (secretLike.test(reference)) return "contains secret-like material";
  if (reference.startsWith("https://")) {
    try {
      const parsed = new URL(reference);
      if (parsed.username || parsed.password) return "contains URL credentials";
      return "";
    } catch {
      return "is not a valid HTTPS URL";
    }
  }
  if (isAbsolute(reference) || reference.split(/[\\/]/).includes("..")) {
    return "must be a repository-relative path or HTTPS URL";
  }
  if (!existsSync(resolve(rootDir, reference))) return `does not exist at repository path ${reference}`;
  return "";
}

function isHttpsReference(reference) {
  return typeof reference === "string" && reference.startsWith("https://");
}

function repositoryEvidenceDigest(reference, rootDir) {
  return createHash("sha256").update(readFileSync(resolve(rootDir, reference))).digest("hex");
}

export function validateLaunchEvidence(manifest, {
  strict = false,
  rootDir = process.cwd(),
  now = new Date(),
} = {}) {
  const errors = [];
  const warnings = [];
  const gates = manifest?.gates && typeof manifest.gates === "object" && !Array.isArray(manifest.gates)
    ? manifest.gates
    : {};
  const names = Object.keys(gates).sort();
  const expected = [...expectedLaunchGateNames].sort();

  if (manifest?.schema_version !== "2") errors.push("launch evidence schema_version must be 2");
  if (manifest?.release !== "med250-production") errors.push("launch evidence release must be med250-production");
  for (const name of expected.filter((name) => !names.includes(name))) errors.push(`missing launch evidence gate ${name}`);
  for (const name of names.filter((name) => !expected.includes(name))) errors.push(`unexpected launch evidence gate ${name}`);

  const statusCounts = { pending: 0, confirmed: 0, rejected: 0, invalid: 0 };
  for (const name of expectedLaunchGateNames) {
    const gate = gates[name];
    if (!gate) continue;
    const status = typeof gate.status === "string" ? gate.status.trim().toLowerCase() : "";
    if (!allowedStatuses.has(status)) {
      statusCounts.invalid += 1;
      errors.push(`${name} has invalid status ${status || "missing"}`);
      continue;
    }
    statusCounts[status] += 1;
    if (typeof gate.title !== "string" || !gate.title.trim()) errors.push(`${name} is missing a title`);
    if (typeof gate.owner !== "string" || !gate.owner.trim()) errors.push(`${name} is missing an owner`);
    if (typeof gate.acceptance !== "string" || gate.acceptance.trim().length < 40) errors.push(`${name} needs a concrete acceptance criterion`);
    if (!Array.isArray(gate.evidence)) errors.push(`${name} evidence must be an array`);
    const requiredEvidenceTypes = Array.isArray(gate.required_evidence_types) ? gate.required_evidence_types : [];
    if (!requiredEvidenceTypes.length) errors.push(`${name} must declare required_evidence_types`);
    if (new Set(requiredEvidenceTypes).size !== requiredEvidenceTypes.length) errors.push(`${name} has duplicate required_evidence_types`);
    for (const evidenceType of requiredEvidenceTypes) {
      if (!allowedEvidenceTypes.has(evidenceType)) errors.push(`${name} requires invalid evidence type ${evidenceType}`);
    }

    for (const [index, evidence] of (Array.isArray(gate.evidence) ? gate.evidence : []).entries()) {
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
        errors.push(`${name} evidence ${index + 1} must be an object`);
        continue;
      }
      if (!allowedEvidenceTypes.has(evidence.type)) errors.push(`${name} evidence ${index + 1} has invalid type`);
      const referenceError = safeEvidenceReference(evidence.reference, rootDir);
      if (referenceError) errors.push(`${name} evidence ${index + 1} ${referenceError}`);
      const digest = String(evidence.sha256 ?? "").trim().toLowerCase();
      if (digest && !/^[a-f0-9]{64}$/.test(digest)) errors.push(`${name} evidence ${index + 1} has an invalid SHA-256 digest`);
      if (!referenceError && !isHttpsReference(evidence.reference)) {
        if (!evidence.reference.startsWith("docs/launch/evidence/") || !evidence.reference.endsWith(".json")) {
          errors.push(`${name} evidence ${index + 1} local evidence must be a JSON artifact under docs/launch/evidence/`);
        }
        if (!digest) {
          errors.push(`${name} evidence ${index + 1} needs a SHA-256 digest for repository evidence`);
        } else if (repositoryEvidenceDigest(evidence.reference, rootDir) !== digest) {
          errors.push(`${name} evidence ${index + 1} SHA-256 digest does not match ${evidence.reference}`);
        }
        if (evidence.reference.startsWith("docs/launch/evidence/") && evidence.reference.endsWith(".json")) {
          try {
            const artifact = JSON.parse(readFileSync(resolve(rootDir, evidence.reference), "utf8"));
            const artifactResult = validateLaunchEvidenceArtifact(artifact, {
              strict: true,
              expectedGate: name,
              expectedType: evidence.type,
              now,
            });
            for (const artifactError of artifactResult.errors) errors.push(`${name} evidence ${index + 1} artifact: ${artifactError}`);
            if (artifact.recorded_at !== evidence.recorded_at) errors.push(`${name} evidence ${index + 1} recorded_at does not match its artifact`);
          } catch (error) {
            errors.push(`${name} evidence ${index + 1} artifact is not valid JSON: ${error.message}`);
          }
        }
      } else if (!referenceError && isHttpsReference(evidence.reference)) {
        if (typeof evidence.remote_verified_by !== "string" || evidence.remote_verified_by.trim().length < 3) errors.push(`${name} evidence ${index + 1} remote evidence requires a named verifier`);
        if (typeof evidence.remote_verifier_role !== "string" || evidence.remote_verifier_role.trim().length < 3) errors.push(`${name} evidence ${index + 1} remote evidence requires a verifier role`);
        if (!validDate(evidence.remote_verified_at)) errors.push(`${name} evidence ${index + 1} remote evidence requires a timezone-qualified verification timestamp`);
        else if (Date.parse(evidence.remote_verified_at) > now.getTime() + 300_000) errors.push(`${name} evidence ${index + 1} remote verification timestamp is in the future`);
      }
      if (!validDate(evidence.recorded_at)) errors.push(`${name} evidence ${index + 1} needs a timezone-qualified recorded_at timestamp`);
      if (typeof evidence.summary !== "string" || evidence.summary.trim().length < 20) errors.push(`${name} evidence ${index + 1} needs a useful summary`);
      if (secretLike.test(String(evidence.summary ?? ""))) errors.push(`${name} evidence ${index + 1} summary contains secret-like material`);
    }

    if (status === "confirmed") {
      if (!Array.isArray(gate.evidence) || !gate.evidence.length) errors.push(`${name} is confirmed without evidence`);
      const suppliedEvidenceTypes = new Set((Array.isArray(gate.evidence) ? gate.evidence : []).map((evidence) => evidence?.type));
      for (const requiredType of requiredEvidenceTypes) {
        if (!suppliedEvidenceTypes.has(requiredType)) errors.push(`${name} is confirmed without required ${requiredType} evidence`);
      }
      if (typeof gate.approved_by !== "string" || !gate.approved_by.trim()) errors.push(`${name} is confirmed without a named approver`);
      if (typeof gate.approved_role !== "string" || gate.approved_role.trim().length < 3) errors.push(`${name} is confirmed without an approver role`);
      if (!validDate(gate.approved_at)) {
        errors.push(`${name} is confirmed without a timezone-qualified approved_at timestamp`);
      } else if (Date.parse(gate.approved_at) > now.getTime() + 300_000) {
        errors.push(`${name} approval timestamp is in the future`);
      }
    } else if (gate.approved_by || gate.approved_role || gate.approved_at) {
      warnings.push(`${name} is ${status} but still has approval fields; clear them until the gate is confirmed`);
    }
    if (strict && status !== "confirmed") errors.push(`${name} is ${status}; production requires confirmed evidence`);
  }

  return {
    valid: errors.length === 0,
    strict,
    gateCount: names.length,
    statusCounts,
    errors,
    warnings,
  };
}

function runCli() {
  const strict = process.argv.includes("--strict");
  const manifestPath = resolve("data/launch-evidence.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.error(JSON.stringify({ valid: false, strict, errors: [`Cannot read launch evidence: ${error.message}`] }, null, 2));
    process.exitCode = 1;
    return;
  }
  const result = validateLaunchEvidence(manifest, { strict });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
