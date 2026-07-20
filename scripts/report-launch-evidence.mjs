import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function buildLaunchEvidenceReport(manifest) {
  const gates = Object.entries(manifest?.gates ?? {}).map(([name, gate]) => {
    const suppliedTypes = new Set((gate.evidence ?? []).map((evidence) => evidence?.type).filter(Boolean));
    const requiredTypes = Array.isArray(gate.required_evidence_types) ? gate.required_evidence_types : [];
    return {
      name,
      title: String(gate.title ?? ""),
      owner: String(gate.owner ?? ""),
      status: String(gate.status ?? "invalid"),
      requiredEvidenceTypes: requiredTypes,
      missingEvidenceTypes: requiredTypes.filter((type) => !suppliedTypes.has(type)),
      evidenceCount: Array.isArray(gate.evidence) ? gate.evidence.length : 0,
      approvalComplete: Boolean(gate.approved_by && gate.approved_role && gate.approved_at),
      acceptance: String(gate.acceptance ?? ""),
    };
  });
  const statusCounts = gates.reduce((counts, gate) => {
    counts[gate.status] = (counts[gate.status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: String(manifest?.schema_version ?? ""),
    release: String(manifest?.release ?? ""),
    gateCount: gates.length,
    statusCounts,
    productionReady: gates.length === 11 && gates.every((gate) => (
      gate.status === "confirmed"
      && gate.missingEvidenceTypes.length === 0
      && gate.approvalComplete
    )),
    gates,
  };
}

function printText(report) {
  console.log(`MED+250 launch evidence — ${report.gateCount} gates`);
  console.log(`Production ready: ${report.productionReady ? "yes" : "no"}`);
  for (const gate of report.gates) {
    const missing = gate.missingEvidenceTypes.length ? gate.missingEvidenceTypes.join(", ") : "none";
    console.log(`\n${gate.name} — ${gate.status}`);
    console.log(`  Owner: ${gate.owner}`);
    console.log(`  Missing evidence: ${missing}`);
    console.log(`  Approval complete: ${gate.approvalComplete ? "yes" : "no"}`);
    console.log(`  Acceptance: ${gate.acceptance}`);
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--json");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  const manifest = JSON.parse(await readFile("data/launch-evidence.json", "utf8"));
  const report = buildLaunchEvidenceReport(manifest);
  if (json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
