import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidence } from "./validate-launch-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function validApprovalTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function normalizeReference(artifactPath, rootDir) {
  const absoluteRoot = resolve(rootDir);
  const absoluteArtifact = resolve(rootDir, artifactPath);
  if (isAbsolute(artifactPath) && !absoluteArtifact.startsWith(`${absoluteRoot}/`)) {
    throw new Error("Evidence artifact must be inside the repository root.");
  }
  const reference = relative(absoluteRoot, absoluteArtifact).replaceAll("\\", "/");
  if (!reference || reference.startsWith("../") || reference.split("/").includes("..")) {
    throw new Error("Evidence artifact must resolve to a repository-relative path.");
  }
  if (!reference.startsWith("docs/launch/evidence/") || !reference.endsWith(".json")) {
    throw new Error("Evidence artifact must be a JSON file under docs/launch/evidence/.");
  }
  return { absoluteArtifact, reference };
}

function requireApprovalFields({ approvedBy, approvedRole, approvedAt }) {
  const errors = [];
  if (typeof approvedBy !== "string" || approvedBy.trim().length < 3) errors.push("--approved-by is required when confirming a gate");
  if (typeof approvedRole !== "string" || approvedRole.trim().length < 3) errors.push("--approved-role is required when confirming a gate");
  if (!validApprovalTimestamp(approvedAt)) errors.push("--approved-at must be a timezone-qualified ISO 8601 timestamp when confirming a gate");
  if (errors.length) throw new Error(errors.join("; "));
}

export async function recordLaunchEvidence({
  manifest,
  artifactPath,
  rootDir = process.cwd(),
  confirm = false,
  approvedBy = "",
  approvedRole = "",
  approvedAt = "",
  replace = false,
  now = new Date(),
}) {
  const { absoluteArtifact, reference } = normalizeReference(artifactPath, rootDir);
  const source = await readFile(absoluteArtifact, "utf8");
  const artifact = JSON.parse(source);
  const gateName = artifact.gate;
  const evidenceType = artifact.evidence_type;
  const gate = manifest?.gates?.[gateName];
  if (!gate) throw new Error(`Unknown launch gate ${gateName}.`);
  if (!gate.required_evidence_types?.includes(evidenceType)) {
    throw new Error(`${evidenceType} is not required by ${gateName}.`);
  }

  const artifactValidation = validateLaunchEvidenceArtifact(artifact, {
    strict: true,
    expectedGate: gateName,
    expectedType: evidenceType,
    now,
  });
  if (!artifactValidation.valid) {
    throw new Error(`Evidence artifact is not complete: ${artifactValidation.errors.join("; ")}`);
  }

  const nextManifest = structuredClone(manifest);
  const nextGate = nextManifest.gates[gateName];
  nextGate.evidence ??= [];
  const existingIndex = nextGate.evidence.findIndex((entry) => entry?.type === evidenceType);
  if (existingIndex >= 0 && !replace) {
    throw new Error(`${gateName} already has ${evidenceType} evidence; pass --replace to overwrite it.`);
  }

  const entry = {
    type: evidenceType,
    reference,
    sha256: sha256(source),
    recorded_at: artifact.recorded_at,
    summary: artifact.summary,
  };
  if (existingIndex >= 0) nextGate.evidence[existingIndex] = entry;
  else nextGate.evidence.push(entry);

  if (confirm) {
    requireApprovalFields({ approvedBy, approvedRole, approvedAt });
    nextGate.status = "confirmed";
    nextGate.approved_by = approvedBy.trim();
    nextGate.approved_role = approvedRole.trim();
    nextGate.approved_at = approvedAt.trim();
  } else if ([approvedBy, approvedRole, approvedAt].some((value) => String(value ?? "").trim())) {
    throw new Error("Approval metadata may be recorded only with --confirm.");
  }

  const validation = validateLaunchEvidence(nextManifest, { rootDir, now });
  if (!validation.valid) {
    throw new Error(`Updated launch evidence would be invalid: ${validation.errors.join("; ")}`);
  }

  return {
    manifest: nextManifest,
    recorded: {
      gate: gateName,
      evidenceType,
      reference,
      sha256: entry.sha256,
      replaced: existingIndex >= 0,
      confirmed: confirm,
      status: nextGate.status,
      missingEvidenceTypes: nextGate.required_evidence_types.filter((type) => (
        !new Set(nextGate.evidence.map((evidence) => evidence.type)).has(type)
      )),
    },
  };
}

function parseArgs(values) {
  const args = {
    manifestPath: "data/launch-evidence.json",
    artifactPath: "",
    outputPath: "",
    confirm: false,
    replace: false,
    approvedBy: "",
    approvedRole: "",
    approvedAt: "",
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--confirm") args.confirm = true;
    else if (flag === "--replace") args.replace = true;
    else if (flag === "--manifest") args.manifestPath = values[++index] ?? "";
    else if (flag === "--artifact") args.artifactPath = values[++index] ?? "";
    else if (flag === "--output") args.outputPath = values[++index] ?? "";
    else if (flag === "--approved-by") args.approvedBy = values[++index] ?? "";
    else if (flag === "--approved-role") args.approvedRole = values[++index] ?? "";
    else if (flag === "--approved-at") args.approvedAt = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.manifestPath) throw new Error("--manifest requires a path.");
  if (!args.artifactPath) throw new Error("--artifact is required.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(args.manifestPath);
  const rootDir = process.cwd();
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const result = await recordLaunchEvidence({
    manifest,
    artifactPath: args.artifactPath,
    rootDir,
    confirm: args.confirm,
    approvedBy: args.approvedBy,
    approvedRole: args.approvedRole,
    approvedAt: args.approvedAt,
    replace: args.replace,
  });
  const outputPath = args.outputPath ? resolve(args.outputPath) : manifestPath;
  await writeFile(outputPath, `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: "recorded", output: outputPath, ...result.recorded }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
