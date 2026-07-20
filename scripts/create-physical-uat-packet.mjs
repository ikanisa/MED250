import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expectedPhysicalUatScenarios, validatePhysicalUat } from "./validate-physical-uat.mjs";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function buildPhysicalUatPacket(ledger, { ledgerPath = "data/physical-device-uat.json", ledgerSha256 = "" } = {}) {
  const validation = validatePhysicalUat(ledger);
  return {
    schema_version: "1",
    release: "med250-production",
    classification: "controlled physical-device UAT execution packet; contains no phone numbers, OTPs, order identifiers, prescription contents or exact coordinates",
    source_ledger: {
      path: ledgerPath,
      sha256: ledgerSha256,
      scenario_count: validation.scenarioCount,
      status_counts: validation.statusCounts,
      pending_valid: validation.valid,
    },
    execution_rules: [
      "Use only approved opaque customer, pharmacy and unrelated-pharmacy test identity labels.",
      "Do not record phone numbers, OTPs, order IDs, prescription contents, exact customer coordinates, credentials or bearer tokens.",
      "Every passed scenario must have a repository-relative or access-controlled HTTPS evidence reference and a useful redacted note.",
      "No unintended pharmacy may receive a request, OTP, message, prescription or notification during the controlled run.",
      "Set the authoritative ledger in data/physical-device-uat.json only after the real device evidence exists.",
      "Run npm run uat:verify:live before completing the launch evidence test record or QA approval.",
    ],
    required_run_metadata: [
      "customer_identity_label",
      "pharmacy_identity_label",
      "unrelated_pharmacy_identity_label",
      "executed_by",
      "started_at",
      "completed_at",
      "approved_by",
      "approved_role",
      "approved_at",
    ],
    scenarios: expectedPhysicalUatScenarios.map((id, index) => {
      const scenario = ledger.scenarios?.[id] ?? {};
      return {
        sequence: index + 1,
        id,
        title: scenario.title,
        current_status: scenario.status ?? "missing",
        required_completion_fields: ["status=passed", "evidence_reference", "redacted_note"],
        prohibited_evidence: [
          "phone number",
          "OTP",
          "order identifier",
          "prescription contents",
          "exact customer coordinates",
          "credential or token",
        ],
      };
    }),
  };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
  const known = new Set(outputIndex >= 0 ? ["--output", outputPath] : []);
  const unknown = process.argv.slice(2).filter((argument) => !known.has(argument));
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path.");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);

  const ledgerPath = "data/physical-device-uat.json";
  const source = await readFile(ledgerPath, "utf8");
  const packet = buildPhysicalUatPacket(JSON.parse(source), {
    ledgerPath,
    ledgerSha256: sha256(source),
  });
  const serialized = `${JSON.stringify(packet, null, 2)}\n`;
  if (outputPath) {
    const resolvedOutput = resolve(outputPath);
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, serialized, "utf8");
    console.log(JSON.stringify({
      status: "written",
      output: outputPath,
      scenario_count: packet.source_ledger.scenario_count,
      pending_scenarios: packet.source_ledger.status_counts.pending,
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
