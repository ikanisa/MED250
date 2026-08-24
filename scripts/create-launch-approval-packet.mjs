import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildGoLiveReadinessReport } from "./report-go-live-readiness.mjs";

function evidenceTypes(gate) {
  return new Set((gate.evidence ?? []).map((entry) => entry?.type));
}

function approvalComplete(gate) {
  return Boolean(
    typeof gate?.approved_by === "string" && gate.approved_by.trim()
    && typeof gate?.approved_role === "string" && gate.approved_role.trim()
    && typeof gate?.approved_at === "string" && gate.approved_at.trim(),
  );
}

export function buildLaunchApprovalPacket(manifest, readinessReport = null) {
  const readinessByGate = new Map((readinessReport?.gates ?? []).map((gate) => [gate.name, gate]));
  const blockedApprovals = [];
  const gates = Object.entries(manifest?.gates ?? {}).flatMap(([gateName, gate]) => {
    const supplied = evidenceTypes(gate);
    const missingEvidenceTypes = (gate.required_evidence_types ?? []).filter((type) => !supplied.has(type));
    if (gate.status === "confirmed" || approvalComplete(gate) || missingEvidenceTypes.length) return [];
    const readiness = readinessByGate.get(gateName);
    if (readiness?.staleReleaseEvidence) {
      blockedApprovals.push({
        gate: gateName,
        title: gate.title,
        owner: gate.owner,
        reason: "release-bound evidence is stale against the current repository checkout",
        required_action: "Rerun exact-revision live verification, refresh the domain artifacts and registry digests, then regenerate this approval packet.",
        release_revision_bindings: readiness.releaseRevisionBindings,
      });
      return [];
    }
    return [{
      gate: gateName,
      title: gate.title,
      owner: gate.owner,
      acceptance: gate.acceptance,
      status: gate.status,
      required_evidence_types: gate.required_evidence_types,
      evidence: gate.evidence,
      review_checks: [
        "Confirm every evidence artifact is complete, redacted, source-bound and still current for the intended production release.",
        "Confirm the acceptance criterion is satisfied by the referenced evidence.",
        "Confirm no credential, token, phone number, OTP, customer identifier, prescription content or precise coordinate is present.",
        "Confirm the accountable owner name, role and timezone-qualified approval timestamp are real.",
      ],
      confirmation_command: [
        "npm run launch:gate:approve --",
        `  --gate ${gateName}`,
        "  --approved-by \"Named owner\"",
        "  --approved-role \"Accountable role\"",
        "  --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
      ],
    }];
  });

  return {
    schema_version: "1",
    release: manifest?.release ?? "med250-production",
    classification: "owner approval packet for evidence-complete launch gates; not an approval artifact",
    instructions: [
      "This packet lists only gates with all required evidence already present and gate-level approval still missing.",
      "Do not approve a gate if any referenced evidence is stale, incomplete, unredacted, mismatched, or no longer satisfies the acceptance criterion.",
      "Use the confirmation command only after the accountable owner has reviewed and approved the gate.",
      "After recording approval, run npm run launch:evidence:verify and npm run launch:go-live:status.",
    ],
    approval_pending_gate_count: gates.length,
    blocked_approval_gate_count: blockedApprovals.length,
    blocked_approvals: blockedApprovals,
    gates,
  };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
  const known = new Set(outputIndex >= 0 ? ["--output", outputPath] : []);
  const unknown = process.argv.slice(2).filter((argument) => !known.has(argument));
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path.");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);

  const [manifest, readinessReport] = await Promise.all([
    readFile("data/launch-evidence.json", "utf8").then(JSON.parse),
    buildGoLiveReadinessReport(),
  ]);
  const packet = buildLaunchApprovalPacket(manifest, readinessReport);
  const serialized = `${JSON.stringify(packet, null, 2)}\n`;
  if (outputPath) {
    const resolvedOutput = resolve(outputPath);
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, serialized, "utf8");
    console.log(JSON.stringify({
      status: "written",
      output: outputPath,
      approval_pending_gate_count: packet.approval_pending_gate_count,
      blocked_approval_gate_count: packet.blocked_approval_gate_count,
    }, null, 2));
  } else {
    process.stdout.write(serialized);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
