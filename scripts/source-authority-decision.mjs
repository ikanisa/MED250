import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyRetentionBundle } from "./source-retention-bundle.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDecisionPath = "data/source-authority-decision.json";
const defaultReceiptPath = "docs/launch/evidence/source-retention-bundle-2026-07-16.json";
const defaultSpecPath = "data/source-retention-spec.json";
const defaultReplacementPath = "outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23/recovered-public-marketplace-catalogue.json";
const originalCorrectedDatasetSha256 = "5000580eb85403a58de8e604bdd055b25b22958ae5755206913a070bcae31383";
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const secretPattern = /(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;
const prohibitedIdentifierPattern = /(?:\b(?:\+?250)?7\d{8}\b|\bOTP\s*[:=]?\s*\d{6}\b|@[a-z0-9.-]+\.[a-z]{2,})/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactObject(actual, expected, label, errors) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) errors.push(`${label}.${key} must match the committed source evidence.`);
  }
}

function meaningful(value, label, errors, minimum = 12) {
  const text = String(value ?? "").trim();
  if (text.length < minimum) errors.push(`${label} must contain at least ${minimum} characters.`);
  if (secretPattern.test(text)) errors.push(`${label} contains secret-like material.`);
  if (prohibitedIdentifierPattern.test(text)) errors.push(`${label} contains a prohibited personal identifier.`);
  return text;
}

function named(value, label, errors) {
  return meaningful(value, label, errors, 3);
}

function validTimestamp(value, label, errors, now, { allowFuture = false } = {}) {
  const text = String(value ?? "").trim();
  if (!timestampPattern.test(text) || !Number.isFinite(Date.parse(text))) {
    errors.push(`${label} must be a timezone-qualified ISO 8601 timestamp.`);
    return null;
  }
  const time = Date.parse(text);
  if (!allowFuture && time > now.getTime() + 300_000) errors.push(`${label} cannot be in the future.`);
  if (allowFuture && time <= now.getTime()) errors.push(`${label} must be in the future.`);
  return time;
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadSourceAuthorityContext({ rootDir = repoRoot } = {}) {
  const [receiptSource, specSource, replacementSource] = await Promise.all([
    readFile(resolve(rootDir, defaultReceiptPath)),
    readFile(resolve(rootDir, defaultSpecPath)),
    readOptional(resolve(rootDir, defaultReplacementPath)),
  ]);
  const receipt = JSON.parse(receiptSource.toString("utf8"));
  const spec = JSON.parse(specSource.toString("utf8"));
  const replacement = replacementSource ? JSON.parse(replacementSource.toString("utf8")) : null;
  const originalEvidence = {
    bundle_id: receipt.bundle_id,
    classification: receipt.classification,
    artifact_count: receipt.artifact_count,
    total_bytes: receipt.total_bytes,
    bundle_digest: receipt.bundle_digest,
    manifest_sha256: receipt.manifest_sha256,
    source_spec_sha256: receipt.source_spec_sha256,
  };
  const replacementCandidate = {
    classification: "reconstructed_public_catalogue_evidence",
    path: defaultReplacementPath,
    sha256: "5cad7067c8d904454f66f7e8a2d7bc276d72ac645bc2acdb30fc8a52642a6395",
    original_corrected_dataset_sha256: originalCorrectedDatasetSha256,
    is_original: false,
  };
  const errors = [];
  if (receipt.status !== "complete") errors.push("The committed source-retention receipt is not complete.");
  if (receipt.approved_durable_storage !== false) errors.push("The historical receipt must preserve its unapproved durable-storage fact.");
  if (sha256(specSource) !== receipt.source_spec_sha256) errors.push("The source-retention spec digest no longer matches the committed receipt.");
  if (spec.bundle_id !== receipt.bundle_id || spec.classification !== receipt.classification) {
    errors.push("The source-retention spec identity no longer matches the committed receipt.");
  }
  if (replacementSource) {
    if (sha256(replacementSource) !== replacementCandidate.sha256) errors.push("The replacement candidate SHA-256 does not match its recorded digest.");
    if (replacement?.classification !== replacementCandidate.classification) errors.push("The replacement candidate classification is invalid.");
    if (!replacement?.limitations?.some((value) => /not the missing corrected Amazon research dataset/i.test(value))) {
      errors.push("The replacement candidate must state that it is not the missing corrected source.");
    }
  }
  return {
    receipt,
    spec,
    originalEvidence,
    replacementCandidate,
    replacementAvailable: Boolean(replacementSource),
    errors,
  };
}

export function buildPendingSourceAuthorityDecision(context) {
  return {
    schema_version: "1",
    release: "med250-production",
    classification: "accountable source-authority decision; not original source evidence",
    status: "pending",
    decision: "pending",
    original_evidence: {
      ...context.originalEvidence,
      availability: "missing",
    },
    replacement_candidate: {
      ...context.replacementCandidate,
      limitations_acknowledged: false,
    },
    durable_storage: {
      approved: false,
      label: null,
      verification_reference: null,
    },
    replacement_scope: {
      permitted_uses: null,
      prohibited_uses: null,
      retention_and_review: null,
      correction_process: null,
      future_provenance_rules: null,
    },
    authority: {
      decided_by: null,
      role: null,
      decided_at: null,
      next_review_at: null,
      rationale: null,
      evidence_reference: null,
    },
  };
}

function validateDecisionFacts(decision, context, errors) {
  if (decision?.schema_version !== "1") errors.push("schema_version must be 1.");
  if (decision?.release !== "med250-production") errors.push("release must be med250-production.");
  if (decision?.classification !== "accountable source-authority decision; not original source evidence") {
    errors.push("classification must preserve the source-authority boundary.");
  }
  exactObject(decision?.original_evidence, context.originalEvidence, "original_evidence", errors);
  exactObject(decision?.replacement_candidate, context.replacementCandidate, "replacement_candidate", errors);
  if (decision?.replacement_candidate?.is_original !== false) errors.push("The replacement candidate must never be labelled as the original.");
  const serialized = JSON.stringify(decision);
  if (secretPattern.test(serialized)) errors.push("The source-authority decision contains secret-like material.");
  if (prohibitedIdentifierPattern.test(serialized)) errors.push("The source-authority decision contains a prohibited personal identifier.");
}

function validateOwnerApproval(decision, errors, now) {
  const authority = decision?.authority ?? {};
  named(authority.decided_by, "authority.decided_by", errors);
  named(authority.role, "authority.role", errors);
  const decidedAt = validTimestamp(authority.decided_at, "authority.decided_at", errors, now);
  const nextReviewAt = validTimestamp(
    authority.next_review_at,
    "authority.next_review_at",
    errors,
    now,
    { allowFuture: true },
  );
  if (decidedAt !== null && nextReviewAt !== null && nextReviewAt <= decidedAt) {
    errors.push("authority.next_review_at must be later than authority.decided_at.");
  }
  meaningful(authority.rationale, "authority.rationale", errors, 24);
  meaningful(authority.evidence_reference, "authority.evidence_reference", errors, 12);
}

function validateDurableStorage(decision, errors) {
  if (decision?.durable_storage?.approved !== true) errors.push("durable_storage.approved must be true.");
  meaningful(decision?.durable_storage?.label, "durable_storage.label", errors, 8);
  meaningful(decision?.durable_storage?.verification_reference, "durable_storage.verification_reference", errors, 12);
}

function validateReplacementScope(decision, errors) {
  if (decision?.replacement_candidate?.limitations_acknowledged !== true) {
    errors.push("replacement_candidate.limitations_acknowledged must be true.");
  }
  for (const field of [
    "permitted_uses",
    "prohibited_uses",
    "retention_and_review",
    "correction_process",
    "future_provenance_rules",
  ]) {
    meaningful(decision?.replacement_scope?.[field], `replacement_scope.${field}`, errors, 24);
  }
}

export async function assessSourceAuthorityDecision(decision, {
  rootDir = repoRoot,
  bundlePath = "",
  strict = false,
  now = new Date(),
  verifyBundle = verifyRetentionBundle,
} = {}) {
  const context = await loadSourceAuthorityContext({ rootDir });
  const errors = [...context.errors];
  const warnings = [];
  validateDecisionFacts(decision, context, errors);
  const allowedStatuses = new Set(["pending", "approved", "rejected"]);
  const allowedDecisions = new Set(["pending", "restore_original", "approve_replacement", "reject"]);
  if (!allowedStatuses.has(decision?.status)) errors.push("status is invalid.");
  if (!allowedDecisions.has(decision?.decision)) errors.push("decision is invalid.");

  let productionAuthorized = false;
  let bundleVerification = null;
  if (decision?.status === "pending" || decision?.decision === "pending") {
    if (decision?.status !== "pending" || decision?.decision !== "pending") {
      errors.push("A pending source-authority record must use status and decision pending together.");
    }
    if (decision?.durable_storage?.approved !== false) errors.push("A pending record cannot approve durable storage.");
    if (decision?.original_evidence?.availability !== "missing") errors.push("A pending record must preserve the original bundle as missing.");
    if (decision?.replacement_candidate?.limitations_acknowledged !== false) errors.push("A pending record cannot acknowledge replacement limitations on an owner's behalf.");
    if (Object.values(decision?.authority ?? {}).some((value) => value !== null)) errors.push("A pending record cannot contain owner decision metadata.");
    if (Object.values(decision?.replacement_scope ?? {}).some((value) => value !== null)) errors.push("A pending record cannot contain an approved replacement scope.");
    warnings.push("A named data owner must restore the exact original bundle, approve a bounded replacement, or reject production use.");
  } else if (decision?.decision === "restore_original") {
    if (decision.status !== "approved") errors.push("restore_original requires status approved.");
    if (decision?.original_evidence?.availability !== "restored_and_verified") {
      errors.push("restore_original requires original_evidence.availability restored_and_verified.");
    }
    validateOwnerApproval(decision, errors, now);
    validateDurableStorage(decision, errors);
    if (!bundlePath) {
      errors.push("Strict original restoration verification requires --bundle with the private restored bundle path.");
    } else {
      try {
        bundleVerification = await verifyBundle(resolve(rootDir, bundlePath), { spec: context.spec });
        exactObject(bundleVerification, {
          artifact_count: context.originalEvidence.artifact_count,
          total_bytes: context.originalEvidence.total_bytes,
          bundle_digest: context.originalEvidence.bundle_digest,
          manifest_sha256: context.originalEvidence.manifest_sha256,
        }, "restored_bundle", errors);
      } catch (error) {
        errors.push(`Restored original bundle verification failed: ${error.message}`);
      }
    }
    productionAuthorized = errors.length === 0;
  } else if (decision?.decision === "approve_replacement") {
    if (decision.status !== "approved") errors.push("approve_replacement requires status approved.");
    if (decision?.original_evidence?.availability !== "missing") {
      errors.push("A replacement decision must preserve original_evidence.availability as missing.");
    }
    validateOwnerApproval(decision, errors, now);
    validateDurableStorage(decision, errors);
    validateReplacementScope(decision, errors);
    if (!context.replacementAvailable) errors.push("The exact replacement candidate is unavailable for checksum verification.");
    productionAuthorized = errors.length === 0;
  } else if (decision?.decision === "reject") {
    if (decision.status !== "rejected") errors.push("reject requires status rejected.");
    if (decision?.durable_storage?.approved !== false) errors.push("A rejected source decision cannot approve durable storage.");
    if (decision?.original_evidence?.availability !== "missing") errors.push("A rejected decision must preserve the original bundle as missing.");
    validateOwnerApproval(decision, errors, now);
    warnings.push("The accountable data owner rejected production source authority.");
  }

  if (strict && !productionAuthorized) errors.push("Source authority is not approved for production.");
  return {
    valid: errors.length === 0,
    strict,
    productionAuthorized,
    status: decision?.status ?? null,
    decision: decision?.decision ?? null,
    originalAvailable: decision?.original_evidence?.availability === "restored_and_verified",
    replacementAvailable: context.replacementAvailable,
    durableStorageApproved: decision?.durable_storage?.approved === true,
    bundleVerification,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

function parseArguments(values) {
  const options = {
    command: values[0] ?? "",
    decisionPath: defaultDecisionPath,
    output: defaultDecisionPath,
    bundle: process.env.MED250_SOURCE_RETENTION_BUNDLE ?? "",
    strict: false,
    confirm: false,
    replace: false,
  };
  for (let index = 1; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--strict") options.strict = true;
    else if (flag === "--confirm") options.confirm = true;
    else if (flag === "--replace") options.replace = true;
    else if (flag === "--decision-file") options.decisionPath = values[++index] ?? "";
    else if (flag === "--output") options.output = values[++index] ?? "";
    else if (flag === "--bundle") options.bundle = values[++index] ?? "";
    else if (flag === "--decision") options.decision = values[++index] ?? "";
    else if (flag === "--decided-by") options.decidedBy = values[++index] ?? "";
    else if (flag === "--role") options.role = values[++index] ?? "";
    else if (flag === "--decided-at") options.decidedAt = values[++index] ?? "";
    else if (flag === "--next-review-at") options.nextReviewAt = values[++index] ?? "";
    else if (flag === "--rationale") options.rationale = values[++index] ?? "";
    else if (flag === "--evidence-reference") options.evidenceReference = values[++index] ?? "";
    else if (flag === "--storage-label") options.storageLabel = values[++index] ?? "";
    else if (flag === "--storage-verification-reference") options.storageVerificationReference = values[++index] ?? "";
    else if (flag === "--permitted-uses") options.permittedUses = values[++index] ?? "";
    else if (flag === "--prohibited-uses") options.prohibitedUses = values[++index] ?? "";
    else if (flag === "--retention-and-review") options.retentionAndReview = values[++index] ?? "";
    else if (flag === "--correction-process") options.correctionProcess = values[++index] ?? "";
    else if (flag === "--future-provenance-rules") options.futureProvenanceRules = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  return options;
}

async function buildRecordedDecision(options, context) {
  if (!options.confirm) throw new Error("record requires --confirm after the accountable owner has made the decision.");
  const allowed = new Set(["restore_original", "approve_replacement", "reject"]);
  if (!allowed.has(options.decision)) throw new Error("record requires --decision restore_original, approve_replacement, or reject.");
  const decision = buildPendingSourceAuthorityDecision(context);
  decision.status = options.decision === "reject" ? "rejected" : "approved";
  decision.decision = options.decision;
  decision.authority = {
    decided_by: options.decidedBy ?? null,
    role: options.role ?? null,
    decided_at: options.decidedAt ?? null,
    next_review_at: options.nextReviewAt ?? null,
    rationale: options.rationale ?? null,
    evidence_reference: options.evidenceReference ?? null,
  };
  if (options.decision !== "reject") {
    decision.durable_storage = {
      approved: true,
      label: options.storageLabel ?? null,
      verification_reference: options.storageVerificationReference ?? null,
    };
  }
  if (options.decision === "restore_original") {
    decision.original_evidence.availability = "restored_and_verified";
  }
  if (options.decision === "approve_replacement") {
    decision.replacement_candidate.limitations_acknowledged = true;
    decision.replacement_scope = {
      permitted_uses: options.permittedUses ?? null,
      prohibited_uses: options.prohibitedUses ?? null,
      retention_and_review: options.retentionAndReview ?? null,
      correction_process: options.correctionProcess ?? null,
      future_provenance_rules: options.futureProvenanceRules ?? null,
    };
  }
  return decision;
}

async function writeDecision(path, decision, { replace = false } = {}) {
  const output = resolve(repoRoot, path);
  const existing = await readOptional(output);
  if (existing && !replace) {
    const current = JSON.parse(existing.toString("utf8"));
    if (current.status !== "pending") throw new Error(`${path} already contains a terminal decision; use --replace only for an accountable superseding decision.`);
  }
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(decision, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, output);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === "verify") {
    const decision = JSON.parse(await readFile(resolve(repoRoot, options.decisionPath), "utf8"));
    const result = await assessSourceAuthorityDecision(decision, {
      rootDir: repoRoot,
      bundlePath: options.bundle,
      strict: options.strict,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (options.command === "record") {
    if (options.strict) throw new Error("--strict is only valid with verify.");
    const context = await loadSourceAuthorityContext({ rootDir: repoRoot });
    if (context.errors.length) throw new Error(context.errors.join("; "));
    const decision = await buildRecordedDecision(options, context);
    const result = await assessSourceAuthorityDecision(decision, {
      rootDir: repoRoot,
      bundlePath: options.bundle,
      strict: options.decision !== "reject",
    });
    if (!result.valid) throw new Error(result.errors.join("; "));
    await writeDecision(options.output, decision, { replace: options.replace });
    console.log(JSON.stringify({
      status: "recorded",
      output: options.output,
      decision: decision.decision,
      productionAuthorized: result.productionAuthorized,
    }, null, 2));
    return;
  }
  throw new Error("Use verify [--strict] [--decision-file path] [--bundle private-path] or record with explicit owner decision metadata and --confirm.");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
