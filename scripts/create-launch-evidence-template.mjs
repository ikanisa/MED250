import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

export function createLaunchEvidenceTemplate(gateName, evidenceType) {
  const base = {
    schema_version: "1",
    release: "med250-production",
    gate: gateName,
    evidence_type: evidenceType,
    status: "pending",
    title: "Replace with the exact evidence title",
    summary: "Replace with a redacted summary of the evidence and acceptance result.",
    recorded_at: null,
    recorded_by: null,
    recorded_role: null,
    redactions_confirmed: false,
    checks: [{ name: "Replace with check name", status: "pending", detail: "Replace with a redacted verification result." }],
  };
  const extensions = {
    signed_approval: { decision: null, approved_by: null, approved_role: null, approved_at: null },
    test_record: { executed_by: null, executor_role: null, started_at: null, completed_at: null },
    review_ledger: { reviewed_by: null, reviewer_role: null, reviewed_at: null, total_records: null, pending_records: null, blocked_records: null, source_digests: {} },
    deployment_receipt: { deployed_by: null, deployer_role: null, deployed_at: null, environment: null, release_identifier: null },
    account_verification: { verified_by: null, verifier_role: null, verified_at: null, account_label: null, least_privilege_confirmed: false },
    domain_verification: { verified_by: null, verifier_role: null, verified_at: null, hostnames: ["med250.gikundiro.com"], dns_passed: false, tls_passed: false, routes_passed: false },
    operations_snapshot: { captured_by: null, capturer_role: null, captured_at: null, critical_count: null, metrics: {} },
  };
  if (!extensions[evidenceType]) throw new Error(`Unsupported evidence type ${evidenceType}.`);
  return { ...base, ...extensions[evidenceType] };
}

function preparedArtifactKey(gate, type) {
  return `${gate}\0${type}`;
}

function checkStatusCounts(checks) {
  return (Array.isArray(checks) ? checks : []).reduce((counts, check) => {
    const status = String(check?.status ?? "invalid");
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

export async function discoverPreparedLaunchEvidence(directory = "docs/launch/evidence") {
  const directoryPath = directory instanceof URL ? fileURLToPath(directory) : directory;
  const prepared = [];
  for (const name of (await readdir(directoryPath)).filter((candidate) => candidate.endsWith(".json")).sort()) {
    const reference = join(directoryPath, name).replaceAll("\\", "/");
    const artifact = JSON.parse(await readFile(reference, "utf8"));
    if (artifact?.status !== "pending") continue;
    prepared.push({ reference, artifact });
  }
  return prepared;
}

export function createLaunchEvidenceHandoff(manifest, preparedArtifacts = []) {
  const preparedByKey = new Map();
  for (const candidate of preparedArtifacts) {
    const artifact = candidate?.artifact ?? candidate;
    const reference = candidate?.reference ?? null;
    if (artifact?.status !== "pending" || !artifact?.gate || !artifact?.evidence_type) continue;
    const key = preparedArtifactKey(artifact.gate, artifact.evidence_type);
    if (preparedByKey.has(key)) throw new Error(`Duplicate prepared evidence for ${artifact.gate} ${artifact.evidence_type}.`);
    const validation = validateLaunchEvidenceArtifact(artifact, {
      strict: false,
      expectedGate: artifact.gate,
      expectedType: artifact.evidence_type,
    });
    preparedByKey.set(key, {
      reference,
      status: artifact.status,
      recorded_at: artifact.recorded_at ?? null,
      template_valid: validation.valid,
      template_errors: validation.errors,
      check_status_counts: checkStatusCounts(artifact.checks),
      unresolved_checks: (artifact.checks ?? [])
        .filter((check) => check?.status !== "passed")
        .map((check) => ({
          name: check.name,
          status: check.status,
          detail: check.detail,
        })),
      completion_instructions: Array.isArray(artifact.completion_instructions)
        ? artifact.completion_instructions
        : [],
    });
  }
  const gates = [];
  for (const [gateName, gate] of Object.entries(manifest?.gates ?? {})) {
    if (gate.status === "confirmed") continue;
    const recordedTypes = new Set((gate.evidence ?? []).map((entry) => entry.type));
    const missingTypes = gate.required_evidence_types.filter((type) => !recordedTypes.has(type));
    const preparedEvidence = Object.fromEntries(missingTypes.flatMap((type) => {
      const prepared = preparedByKey.get(preparedArtifactKey(gateName, type));
      return prepared ? [[type, prepared]] : [];
    }));
    const unpreparedTypes = missingTypes.filter((type) => !preparedEvidence[type]);
    gates.push({
      gate: gateName,
      title: gate.title,
      owner: gate.owner,
      acceptance: gate.acceptance,
      current_status: gate.status,
      approval_required: {
        approved_by: gate.approved_by,
        approved_role: gate.approved_role,
        approved_at: gate.approved_at,
      },
      missing_evidence_types: missingTypes,
      prepared_pending_evidence: preparedEvidence,
      unprepared_evidence_types: unpreparedTypes,
      suggested_filenames: Object.fromEntries(
        missingTypes.map((type) => [
          type,
          preparedEvidence[type]?.reference
            ?? `docs/launch/evidence/${gateName.toLowerCase().replace(/^med250_gate_/, "").replaceAll("_", "-")}-${type.replaceAll("_", "-")}.json`,
        ]),
      ),
      evidence_templates: Object.fromEntries(
        unpreparedTypes.map((type) => [type, createLaunchEvidenceTemplate(gateName, type)]),
      ),
    });
  }
  const missingArtifactCount = gates.reduce((total, gate) => total + gate.missing_evidence_types.length, 0);
  const preparedArtifactCount = gates.reduce(
    (total, gate) => total + Object.keys(gate.prepared_pending_evidence).length,
    0,
  );
  return {
    schema_version: "1",
    release: manifest?.release ?? "med250-production",
    instructions: [
      "Complete only evidence produced by the accountable owner or named executor.",
      "Never store credentials, tokens, phone numbers, OTPs, customer identifiers, prescription contents, email addresses, or precise customer coordinates.",
      "Use a prepared_pending_evidence file when one is listed; it already contains the scoped checks and completion instructions for that gate.",
      "Validate each completed artifact before adding its SHA-256 digest and approval metadata to data/launch-evidence.json.",
      "Do not mark a gate confirmed until every required evidence type and the named gate approval are complete.",
    ],
    gate_count: gates.length,
    missing_evidence_artifact_count: missingArtifactCount,
    prepared_pending_artifact_count: preparedArtifactCount,
    unprepared_evidence_artifact_count: missingArtifactCount - preparedArtifactCount,
    gates,
  };
}

async function main() {
  const manifest = JSON.parse(await readFile("data/launch-evidence.json", "utf8"));
  const values = process.argv.slice(2);
  if (values.includes("--all-missing")) {
    const prepared = await discoverPreparedLaunchEvidence();
    process.stdout.write(`${JSON.stringify(createLaunchEvidenceHandoff(manifest, prepared), null, 2)}\n`);
    return;
  }
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("Use --gate <gate-name> --type <evidence-type>, or --all-missing.");
    args[flag.slice(2)] = value;
  }
  if (!args.gate || !args.type) throw new Error("Use --gate <gate-name> --type <evidence-type>, or --all-missing.");
  const gate = manifest.gates?.[args.gate];
  if (!gate) throw new Error(`Unknown launch gate ${args.gate}.`);
  if (!gate.required_evidence_types.includes(args.type)) throw new Error(`${args.type} is not required by ${args.gate}.`);
  process.stdout.write(`${JSON.stringify(createLaunchEvidenceTemplate(args.gate, args.type), null, 2)}\n`);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
