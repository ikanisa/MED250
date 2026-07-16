import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

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

export function createLaunchEvidenceHandoff(manifest) {
  const gates = [];
  for (const [gateName, gate] of Object.entries(manifest?.gates ?? {})) {
    if (gate.status === "confirmed") continue;
    const recordedTypes = new Set((gate.evidence ?? []).map((entry) => entry.type));
    const missingTypes = gate.required_evidence_types.filter((type) => !recordedTypes.has(type));
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
      suggested_filenames: Object.fromEntries(
        missingTypes.map((type) => [
          type,
          `docs/launch/evidence/${gateName.toLowerCase().replace(/^med250_gate_/, "").replaceAll("_", "-")}-${type.replaceAll("_", "-")}.json`,
        ]),
      ),
      evidence_templates: Object.fromEntries(
        missingTypes.map((type) => [type, createLaunchEvidenceTemplate(gateName, type)]),
      ),
    });
  }
  return {
    schema_version: "1",
    release: manifest?.release ?? "med250-production",
    instructions: [
      "Complete only evidence produced by the accountable owner or named executor.",
      "Never store credentials, tokens, phone numbers, OTPs, customer identifiers, prescription contents, email addresses, or precise customer coordinates.",
      "Validate each completed artifact before adding its SHA-256 digest and approval metadata to data/launch-evidence.json.",
      "Do not mark a gate confirmed until every required evidence type and the named gate approval are complete.",
    ],
    gate_count: gates.length,
    missing_evidence_artifact_count: gates.reduce((total, gate) => total + gate.missing_evidence_types.length, 0),
    gates,
  };
}

async function main() {
  const manifest = JSON.parse(await readFile("data/launch-evidence.json", "utf8"));
  const values = process.argv.slice(2);
  if (values.includes("--all-missing")) {
    process.stdout.write(`${JSON.stringify(createLaunchEvidenceHandoff(manifest), null, 2)}\n`);
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
