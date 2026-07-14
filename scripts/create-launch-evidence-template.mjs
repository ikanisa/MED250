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
    domain_verification: { verified_by: null, verifier_role: null, verified_at: null, hostnames: ["med250.rw", "www.med250.rw"], dns_passed: false, tls_passed: false, routes_passed: false },
    operations_snapshot: { captured_by: null, capturer_role: null, captured_at: null, critical_count: null, metrics: {} },
  };
  if (!extensions[evidenceType]) throw new Error(`Unsupported evidence type ${evidenceType}.`);
  return { ...base, ...extensions[evidenceType] };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
    return pairs;
  }, []));
  if (!args.gate || !args.type) throw new Error("Use --gate <gate-name> --type <evidence-type>.");
  const manifest = JSON.parse(await readFile("data/launch-evidence.json", "utf8"));
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
