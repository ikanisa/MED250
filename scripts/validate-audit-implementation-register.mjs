import { createHash } from "node:crypto";
import {
  access,
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const expectedAuditSourceRevision = "ALtnJHwQWBgt5JycfaOGftvKWVHBOLMKzbI9tuf-JrxPmecFrmDaMt1VqSxxxAxyOZIqpkTkcapZA8VcxqQNLq9OMDzTgjApfiO0tloLkak";

const expectedFindingIds = Object.freeze([
  "P0-1", "P0-2", "P0-3", "P0-4", "P0-5",
  "P1-1", "P1-2", "P1-3", "P1-4", "P1-5",
  "P2-1", "P2-2", "P2-3", "P2-4", "P2-5",
  "P3-1", "P3-2",
]);
const expectedStrategicIds = Object.freeze(["S4-1", "S4-2", "S4-3"]);
const expectedSourceCoverageIds = Object.freeze({
  scorecard_categories: Object.freeze(["SC-1", "SC-2", "SC-3", "SC-4", "SC-5", "SC-6", "SC-7", "SC-8", "SC-9"]),
  preservation_invariants: Object.freeze(["W-1", "W-2", "W-3", "W-4", "W-5"]),
  benchmark_capabilities: Object.freeze(["B-1", "B-2", "B-3", "B-4", "B-5", "B-6", "B-7", "B-8", "B-9", "B-10", "B-11"]),
  roadmap_actions: Object.freeze(["R1-1", "R1-2", "R1-3", "R1-4", "R2-1", "R2-2", "R2-3", "R2-4", "R3-1", "R3-2", "R3-3", "R3-4", "R4-1", "R4-2", "R4-3"]),
  verification_limits: Object.freeze(["V-1", "V-2", "V-3", "V-4"]),
  audited_surfaces: Object.freeze(["A-1", "A-2", "A-3", "A-4", "A-5", "A-6", "A-7", "A-8", "A-9", "A-10", "A-11", "A-12"]),
});
const allowedBenchmarkDispositions = new Set([
  "remediate",
  "govern_then_expand",
  "model_appropriate_signal",
  "verify_and_preserve",
  "verify_separately",
]);
const allowedStatuses = new Set(["partial", "external_gate", "owner_declined", "complete"]);
const allowedClosureEvidenceTypes = new Set([
  "browser_test",
  "data_review",
  "deployment_receipt",
  "device_test",
  "operations_observation",
  "owner_decision",
  "regulatory_approval",
  "rights_approval",
  "search_console",
  "service_receipt",
  "translation_approval",
]);
const secretLike = /(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;
const prohibitedIdentity = /(?:\b(?:\+?250)?7\d{8}\b|\b\d{6}\b|@[a-z0-9.-]+\.[a-z]{2,}|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}|\b(?:latitude|longitude|otp|prescription contents?|order id|phone number)\b\s*[:=])/i;

function nonEmptyStrings(value, minimum = 1) {
  return Array.isArray(value) && value.length >= minimum && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeText(value) {
  const text = String(value ?? "");
  return !secretLike.test(text) && !prohibitedIdentity.test(text);
}

function validateSourceCoverageRecords(records, expectedIds, label, validItemIds, errors, {
  requireItems = false,
} = {}) {
  const entries = Array.isArray(records) ? records : [];
  const ids = entries.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    errors.push(`${label} must contain every source row once, in canonical order`);
  }
  if (new Set(ids).size !== ids.length) errors.push(`${label} IDs must be unique`);
  for (const entry of entries) {
    const prefix = entry?.id ?? `unknown ${label} entry`;
    if (typeof entry?.title !== "string" || entry.title.trim().length < 8) errors.push(`${prefix}: a useful source title is required`);
    if (!Array.isArray(entry?.goals)
      || !entry.goals.length
      || new Set(entry.goals).size !== entry.goals.length
      || entry.goals.some((goal) => !Number.isInteger(goal) || goal < 0 || goal > 11)) {
      errors.push(`${prefix}: unique Goal 0-11 mappings are required`);
    }
    if (!Array.isArray(entry?.items)
      || new Set(entry.items).size !== entry.items.length
      || entry.items.some((item) => !validItemIds.has(item))) {
      errors.push(`${prefix}: audit-item mappings must be unique and valid`);
    } else if (requireItems && entry.items.length === 0) {
      errors.push(`${prefix}: at least one governed audit-item mapping is required`);
    }
  }
  return entries;
}

async function validateLocalClosureEvidence(evidence, item, register, { rootDir }, errors, label) {
  const reference = evidence?.reference;
  if (typeof reference !== "string"
    || !reference.startsWith("docs/audit/closure-evidence/")
    || !reference.endsWith(".json")
    || isAbsolute(reference)
    || reference.split(/[\\/]/).includes("..")) {
    errors.push(`${label}: local evidence must be a repository-relative JSON artifact under docs/audit/closure-evidence/`);
    return;
  }
  const root = await realpath(rootDir);
  const absolute = resolve(root, reference);
  try {
    if ((await lstat(absolute)).isSymbolicLink()) {
      errors.push(`${label}: local evidence cannot be a symbolic link`);
      return;
    }
    const resolved = await realpath(absolute);
    if (relative(root, resolved).startsWith("..")) {
      errors.push(`${label}: local evidence resolves outside the repository`);
      return;
    }
    const bytes = await readFile(resolved);
    const digest = String(evidence.sha256 ?? "");
    if (!/^[a-f0-9]{64}$/.test(digest) || sha256(bytes) !== digest) {
      errors.push(`${label}: local evidence SHA-256 does not match`);
    }
    let artifact;
    try {
      artifact = JSON.parse(bytes.toString("utf8"));
    } catch {
      errors.push(`${label}: local evidence is not valid JSON`);
      return;
    }
    if (artifact.schema_version !== "1"
      || artifact.status !== "passed"
      || artifact.item_id !== item.id
      || artifact.audit_source_revision !== register.audit.source_revision
      || artifact.recorded_at !== evidence.recorded_at
      || !allowedClosureEvidenceTypes.has(artifact.evidence_type)
      || !Array.isArray(artifact.errors)
      || artifact.errors.length !== 0
      || artifact.contains_personal_data !== false
      || artifact.contains_secrets !== false
      || !safeText(JSON.stringify(artifact))) {
      errors.push(`${label}: local evidence is not a passing, privacy-safe audit closure artifact for ${item.id}`);
    }
  } catch {
    errors.push(`${label}: local evidence does not exist at ${reference}`);
  }
}

async function validateCompletionClosure(item, criteria, register, options, errors) {
  const label = `${item.id} closure`;
  const closure = item.closure;
  if (!closure || typeof closure !== "object" || Array.isArray(closure)) {
    errors.push(`${label}: complete work requires a closure object`);
    return;
  }
  if (closure.audit_source_revision !== register.audit.source_revision) {
    errors.push(`${label}: closure is not bound to the current audit source revision`);
  }
  if (typeof closure.approved_by !== "string" || closure.approved_by.trim().length < 3) {
    errors.push(`${label}: a named approver is required`);
  }
  if (typeof closure.approved_role !== "string" || closure.approved_role.trim().length < 3) {
    errors.push(`${label}: an approver role is required`);
  }
  if (!validTimestamp(closure.approved_at)) {
    errors.push(`${label}: approved_at must include a timezone`);
  } else if (Date.parse(closure.approved_at) > options.now.getTime() + 300_000) {
    errors.push(`${label}: approved_at is in the future`);
  }
  if (!safeText(closure.approved_by) || !safeText(closure.approved_role)) {
    errors.push(`${label}: approval metadata contains prohibited identity or secret material`);
  }

  const evidenceItems = Array.isArray(closure.evidence) ? closure.evidence : [];
  if (!evidenceItems.length) errors.push(`${label}: at least one closure evidence item is required`);
  const covered = new Set();
  for (const [index, evidence] of evidenceItems.entries()) {
    const evidenceLabel = `${label} evidence ${index + 1}`;
    const covers = Array.isArray(evidence?.covers) ? evidence.covers : [];
    if (!covers.length
      || new Set(covers).size !== covers.length
      || covers.some((value) => !Number.isInteger(value) || value < 0 || value >= criteria.length)) {
      errors.push(`${evidenceLabel}: covers must name unique valid acceptance indexes`);
    } else {
      covers.forEach((value) => covered.add(value));
    }
    if (!validTimestamp(evidence?.recorded_at)) {
      errors.push(`${evidenceLabel}: recorded_at must include a timezone`);
    } else {
      if (Date.parse(evidence.recorded_at) > options.now.getTime() + 300_000) errors.push(`${evidenceLabel}: recorded_at is in the future`);
      if (validTimestamp(closure.approved_at) && Date.parse(evidence.recorded_at) > Date.parse(closure.approved_at)) {
        errors.push(`${evidenceLabel}: evidence was recorded after approval`);
      }
    }
    if (typeof evidence?.summary !== "string" || evidence.summary.trim().length < 20) {
      errors.push(`${evidenceLabel}: a useful summary is required`);
    } else if (!safeText(evidence.summary)) {
      errors.push(`${evidenceLabel}: summary contains prohibited identity or secret material`);
    }
    if (typeof evidence?.reference !== "string" || !evidence.reference.trim()) {
      errors.push(`${evidenceLabel}: reference is required`);
    } else if (evidence.reference.startsWith("https://")) {
      try {
        const url = new URL(evidence.reference);
        if (url.username || url.password) errors.push(`${evidenceLabel}: remote reference contains URL credentials`);
      } catch {
        errors.push(`${evidenceLabel}: remote reference is not valid HTTPS`);
      }
      if (typeof evidence.remote_verified_by !== "string" || evidence.remote_verified_by.trim().length < 3) {
        errors.push(`${evidenceLabel}: remote evidence requires a named verifier`);
      }
      if (typeof evidence.remote_verifier_role !== "string" || evidence.remote_verifier_role.trim().length < 3) {
        errors.push(`${evidenceLabel}: remote evidence requires a verifier role`);
      }
      if (!safeText(evidence.remote_verified_by) || !safeText(evidence.remote_verifier_role)) {
        errors.push(`${evidenceLabel}: remote verification metadata contains prohibited identity or secret material`);
      }
      if (!validTimestamp(evidence.remote_verified_at)) {
        errors.push(`${evidenceLabel}: remote evidence requires a timezone-qualified verification timestamp`);
      } else if (Date.parse(evidence.remote_verified_at) > options.now.getTime() + 300_000) {
        errors.push(`${evidenceLabel}: remote verification timestamp is in the future`);
      }
    } else {
      await validateLocalClosureEvidence(evidence, item, register, options, errors, evidenceLabel);
    }
  }
  for (const index of criteria.keys()) {
    if (!covered.has(index)) errors.push(`${label}: acceptance index ${index} has no closure evidence`);
  }
}

export async function validateAuditImplementationRegister(register, {
  verifyEvidence = true,
  strict = false,
  rootDir = process.cwd(),
  now = new Date(),
} = {}) {
  const errors = [];
  if (register?.schema_version !== 1) errors.push("schema_version must be 1");
  if (register?.audit?.source_revision !== expectedAuditSourceRevision || !register?.audit?.source_url) errors.push("audit source URL and exact current revision are required");
  for (const status of allowedStatuses) {
    if (typeof register?.status_definitions?.[status] !== "string" || register.status_definitions[status].trim().length < 20) {
      errors.push(`status_definitions must define ${status}`);
    }
  }
  const options = { rootDir, now };
  const findings = Array.isArray(register?.findings) ? register.findings : [];
  const ids = findings.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedFindingIds)) errors.push("findings must contain every P0-P3 audit item once, in canonical order");
  if (new Set(ids).size !== ids.length) errors.push("finding IDs must be unique");

  for (const finding of findings) {
    const prefix = finding?.id ?? "unknown finding";
    if (finding.priority !== prefix.slice(0, 2)) errors.push(`${prefix}: priority does not match ID`);
    if (typeof finding.title !== "string" || !finding.title.trim()) errors.push(`${prefix}: title is required`);
    if (!Array.isArray(finding.goals) || !finding.goals.length || finding.goals.some((goal) => !Number.isInteger(goal) || goal < 0 || goal > 11)) errors.push(`${prefix}: one or more Goal 0-11 mappings are required`);
    if (!allowedStatuses.has(finding.status)) errors.push(`${prefix}: unsupported status ${finding.status}`);
    if (typeof finding.owner !== "string" || !finding.owner.trim()) errors.push(`${prefix}: accountable owner is required`);
    if (!nonEmptyStrings(finding.acceptance, 2)) errors.push(`${prefix}: at least two acceptance conditions are required`);
    if (!nonEmptyStrings(finding.evidence)) errors.push(`${prefix}: at least one evidence reference is required`);
    if (!Array.isArray(finding.dependencies) || !Array.isArray(finding.remaining)) errors.push(`${prefix}: dependencies and remaining work must be arrays`);
    if (finding.status === "owner_declined") {
      if (!finding.decision?.decided_by || !/^\d{4}-\d{2}-\d{2}$/.test(finding.decision?.decided_at ?? "") || !finding.decision?.rationale) errors.push(`${prefix}: owner-declined work requires a dated accountable decision and rationale`);
      if (finding.remaining.length) errors.push(`${prefix}: owner-declined work cannot retain implementation tasks`);
      if (finding.closure != null) errors.push(`${prefix}: owner-declined work uses its decision record, not a completion closure`);
    } else if (finding.status === "complete") {
      if (finding.remaining.length) errors.push(`${prefix}: complete work cannot retain remaining tasks`);
      await validateCompletionClosure(finding, finding.acceptance, register, options, errors);
    } else if (!nonEmptyStrings(finding.remaining)) {
      errors.push(`${prefix}: open work must name at least one remaining closure`);
    } else if (finding.closure != null) {
      errors.push(`${prefix}: open work cannot carry completion approval metadata`);
    }
    if (strict && !["complete", "owner_declined"].includes(finding.status)) errors.push(`${prefix}: strict audit closure requires complete or owner_declined status`);
    if (verifyEvidence) {
      for (const reference of finding.evidence ?? []) {
        if (/^https:\/\//.test(reference)) continue;
        try {
          await access(resolve(rootDir, reference));
        } catch {
          errors.push(`${prefix}: evidence does not exist: ${reference}`);
        }
      }
    }
  }

  const strategicItems = Array.isArray(register?.strategic_items) ? register.strategic_items : [];
  if (JSON.stringify(strategicItems.map(({ id }) => id)) !== JSON.stringify(expectedStrategicIds)) errors.push("strategic_items must contain all Phase 4 decisions once, in canonical order");
  for (const item of strategicItems) {
    if (item.goal !== 11 || !allowedStatuses.has(item.status) || !item.owner || !nonEmptyStrings(item.entry_criteria, 3)) errors.push(`${item.id ?? "unknown strategic item"}: Goal 11, owner, supported status, and three entry criteria are required`);
    if (item.status === "complete") {
      await validateCompletionClosure(item, item.entry_criteria, register, options, errors);
    } else if (item.status === "owner_declined") {
      if (!item.decision?.decided_by || !/^\d{4}-\d{2}-\d{2}$/.test(item.decision?.decided_at ?? "") || !item.decision?.rationale) {
        errors.push(`${item.id}: an owner-declined strategic decision requires a dated accountable decision and rationale`);
      }
      if (item.closure != null) errors.push(`${item.id}: owner-declined work uses its decision record, not a completion closure`);
    } else if (item.closure != null) {
      errors.push(`${item.id}: open strategic work cannot carry completion approval metadata`);
    }
    if (strict && !["complete", "owner_declined"].includes(item.status)) errors.push(`${item.id}: strict audit closure requires a terminal accountable decision`);
  }

  const validItemIds = new Set([...expectedFindingIds, ...expectedStrategicIds]);
  const sourceCoverage = register?.source_coverage ?? {};
  const scorecards = validateSourceCoverageRecords(
    sourceCoverage.scorecard_categories,
    expectedSourceCoverageIds.scorecard_categories,
    "scorecard_categories",
    validItemIds,
    errors,
    { requireItems: true },
  );
  const benchmarks = validateSourceCoverageRecords(
    sourceCoverage.benchmark_capabilities,
    expectedSourceCoverageIds.benchmark_capabilities,
    "benchmark_capabilities",
    validItemIds,
    errors,
  );
  const roadmap = validateSourceCoverageRecords(
    sourceCoverage.roadmap_actions,
    expectedSourceCoverageIds.roadmap_actions,
    "roadmap_actions",
    validItemIds,
    errors,
    { requireItems: true },
  );
  const limits = validateSourceCoverageRecords(
    sourceCoverage.verification_limits,
    expectedSourceCoverageIds.verification_limits,
    "verification_limits",
    validItemIds,
    errors,
  );
  const surfaces = validateSourceCoverageRecords(
    sourceCoverage.audited_surfaces,
    expectedSourceCoverageIds.audited_surfaces,
    "audited_surfaces",
    validItemIds,
    errors,
  );

  for (const benchmark of benchmarks) {
    if (!allowedBenchmarkDispositions.has(benchmark.disposition)) {
      errors.push(`${benchmark.id}: unsupported benchmark disposition ${benchmark.disposition}`);
    }
    if (benchmark.disposition !== "verify_separately" && benchmark.items.length === 0) {
      errors.push(`${benchmark.id}: at least one governed audit-item mapping is required`);
    }
  }
  const expectedPhaseByRoadmapId = new Map(expectedSourceCoverageIds.roadmap_actions.map((id) => [id, Number(id[1])]));
  for (const action of roadmap) {
    if (action.phase !== expectedPhaseByRoadmapId.get(action.id)) errors.push(`${action.id}: roadmap phase does not match ID`);
  }
  const declinedRoadmap = roadmap.find(({ id }) => id === "R3-2");
  if (JSON.stringify(declinedRoadmap?.items) !== JSON.stringify(["P2-2"])) {
    errors.push("R3-2: the owner-declined recommendation must map only to P2-2");
  }

  const preservation = Array.isArray(sourceCoverage.preservation_invariants) ? sourceCoverage.preservation_invariants : [];
  if (JSON.stringify(preservation.map(({ id }) => id)) !== JSON.stringify(expectedSourceCoverageIds.preservation_invariants)) {
    errors.push("preservation_invariants must contain every working-well directive once, in canonical order");
  }
  if (new Set(preservation.map(({ id }) => id)).size !== preservation.length) errors.push("preservation_invariant IDs must be unique");
  for (const invariant of preservation) {
    const prefix = invariant?.id ?? "unknown preservation invariant";
    if (typeof invariant?.title !== "string" || invariant.title.trim().length < 8) errors.push(`${prefix}: a useful preservation title is required`);
    if (!nonEmptyStrings(invariant?.acceptance, 2)) errors.push(`${prefix}: at least two preservation acceptance conditions are required`);
    if (!nonEmptyStrings(invariant?.evidence)) errors.push(`${prefix}: preservation evidence is required`);
    if (typeof invariant?.owner !== "string" || invariant.owner.trim().length < 3) errors.push(`${prefix}: an accountable preservation owner is required`);
    if (!Array.isArray(invariant?.goals)
      || !invariant.goals.length
      || new Set(invariant.goals).size !== invariant.goals.length
      || invariant.goals.some((goal) => !Number.isInteger(goal) || goal < 0 || goal > 11)) {
      errors.push(`${prefix}: unique Goal 0-11 mappings are required`);
    }
    if (verifyEvidence) {
      for (const reference of invariant.evidence ?? []) {
        try {
          await access(resolve(rootDir, reference));
        } catch {
          errors.push(`${prefix}: preservation evidence does not exist: ${reference}`);
        }
      }
    }
  }

  const sourceCoverageCounts = {
    findingCount: findings.length,
    scorecardCategoryCount: scorecards.length,
    preservationInvariantCount: preservation.length,
    benchmarkCapabilityCount: benchmarks.length,
    roadmapActionCount: roadmap.length,
    verificationLimitCount: limits.length,
    auditedSurfaceCount: surfaces.length,
  };
  const sourceUnitCount = Object.values(sourceCoverageCounts).reduce((total, count) => total + count, 0);

  return {
    valid: errors.length === 0,
    strict,
    findingCount: findings.length,
    strategicItemCount: strategicItems.length,
    sourceCoverageCounts,
    sourceUnitCount,
    statusCounts: findings.reduce((counts, { status }) => ({ ...counts, [status]: (counts[status] ?? 0) + 1 }), {}),
    errors,
  };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--strict");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  const register = JSON.parse(await readFile(new URL("../data/audit-implementation-register.json", import.meta.url), "utf8"));
  const result = await validateAuditImplementationRegister(register, { strict });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ valid: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
