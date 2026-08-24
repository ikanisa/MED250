import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { staleReleaseEvidenceGateNames } from "./launch-release-bindings.mjs";
import { validateLaunchEvidence } from "./validate-launch-evidence.mjs";

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function named(value, label) {
  const text = String(value ?? "").trim();
  if (text.length < 3) throw new Error(`${label} is required.`);
  if (/(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i.test(text)) {
    throw new Error(`${label} contains secret-like material.`);
  }
  if (/(?:\b(?:\+?250)?7\d{8}\b|\bOTP\s*[:=]?\s*\d{6}\b|@[a-z0-9.-]+\.[a-z]{2,}|-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,})/i.test(text)) {
    throw new Error(`${label} contains a prohibited personal or precise-location identifier.`);
  }
  return text;
}

function evidenceTypes(gate) {
  return new Set((gate.evidence ?? []).map((entry) => entry?.type));
}

export async function approveLaunchGate({
  manifest,
  gateName,
  approvedBy,
  approvedRole,
  approvedAt,
  rootDir = process.cwd(),
  now = new Date(),
}) {
  const gate = manifest?.gates?.[gateName];
  if (!gate) throw new Error(`Unknown launch gate ${gateName}.`);
  if (gate.status === "confirmed") throw new Error(`${gateName} is already confirmed.`);
  const supplied = evidenceTypes(gate);
  const missingEvidenceTypes = (gate.required_evidence_types ?? []).filter((type) => !supplied.has(type));
  if (missingEvidenceTypes.length) {
    throw new Error(`${gateName} cannot be approved; missing evidence: ${missingEvidenceTypes.join(", ")}.`);
  }

  const baselineValidation = validateLaunchEvidence(manifest, { rootDir, now });
  if (!baselineValidation.valid) {
    throw new Error(`Launch evidence is not valid before approval: ${baselineValidation.errors.join("; ")}`);
  }

  const staleGateNames = await staleReleaseEvidenceGateNames(manifest, { rootDir });
  if (staleGateNames.has(gateName)) {
    throw new Error(`Cannot approve ${gateName}: release-bound evidence is stale against the current repository checkout.`);
  }

  const approval = {
    approved_by: named(approvedBy, "approved_by"),
    approved_role: named(approvedRole, "approved_role"),
    approved_at: String(approvedAt ?? "").trim(),
  };
  if (!validTimestamp(approval.approved_at)) throw new Error("approved_at must be a timezone-qualified ISO 8601 timestamp.");
  if (Date.parse(approval.approved_at) > now.getTime() + 300_000) throw new Error("approved_at is in the future.");

  const nextManifest = structuredClone(manifest);
  Object.assign(nextManifest.gates[gateName], {
    status: "confirmed",
    ...approval,
  });
  const finalValidation = validateLaunchEvidence(nextManifest, { rootDir, now });
  if (!finalValidation.valid) {
    throw new Error(`Approved launch evidence would be invalid: ${finalValidation.errors.join("; ")}`);
  }

  return {
    manifest: nextManifest,
    approved: {
      gate: gateName,
      approvedBy: approval.approved_by,
      approvedRole: approval.approved_role,
      approvedAt: approval.approved_at,
      evidenceTypes: [...supplied].sort(),
    },
  };
}

function parseArgs(values) {
  const args = {
    manifestPath: "data/launch-evidence.json",
    outputPath: "",
    gateName: "",
    approvedBy: "",
    approvedRole: "",
    approvedAt: "",
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--manifest") args.manifestPath = values[++index] ?? "";
    else if (flag === "--output") args.outputPath = values[++index] ?? "";
    else if (flag === "--gate") args.gateName = values[++index] ?? "";
    else if (flag === "--approved-by") args.approvedBy = values[++index] ?? "";
    else if (flag === "--approved-role") args.approvedRole = values[++index] ?? "";
    else if (flag === "--approved-at") args.approvedAt = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.manifestPath) throw new Error("--manifest requires a path.");
  if (!args.gateName) throw new Error("--gate is required.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(args.manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const result = await approveLaunchGate({
    manifest,
    gateName: args.gateName,
    approvedBy: args.approvedBy,
    approvedRole: args.approvedRole,
    approvedAt: args.approvedAt,
    rootDir: process.cwd(),
  });
  const outputPath = args.outputPath ? resolve(args.outputPath) : manifestPath;
  await writeFile(outputPath, `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: "approved", output: outputPath, ...result.approved }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
