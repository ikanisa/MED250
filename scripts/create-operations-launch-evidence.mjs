import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

const gateConfig = Object.freeze({
  MED250_GATE_GPS_READY: {
    reviewType: "gps_readiness",
    title: "MED+250 authoritative pharmacy GPS readiness completed review ledger",
    outputPrefix: "gps-readiness-review-ledger",
    summary: "The operations owner completed the redacted authoritative pharmacy GPS readiness review with every active pharmacy either approved for authoritative premises GPS or explicitly excluded from GPS-ready production scope.",
    requiredMetrics: Object.freeze(["approved_records", "excluded_records"]),
    checks: Object.freeze([
      ["Authoritative registry population", "The redacted review result covers the active Rwanda FDA retail pharmacy population used for production routing."],
      ["Authoritative premises evidence reviewed", "Every GPS-ready pharmacy has named-review evidence for premises identity, locality and accuracy without storing coordinates in the launch artifact."],
      ["No fabricated proximity", "Unresolved or excluded pharmacies are not assigned generated coordinates, fabricated distances or unapproved proximity claims."],
      ["Production scope reconciled", "The intended GPS-ready production scope is reconciled with customer presentation and dispatch routing."],
    ]),
  },
  MED250_GATE_WHATSAPP_READY: {
    reviewType: "whatsapp_readiness",
    title: "MED+250 pharmacy-authorised WhatsApp readiness completed review ledger",
    outputPrefix: "whatsapp-readiness-review-ledger",
    summary: "The operations owner completed the redacted pharmacy WhatsApp readiness review with every active pharmacy either approved for authorised WhatsApp response/login coverage or explicitly excluded from responder scope.",
    requiredMetrics: Object.freeze(["approved_pharmacies", "approved_login_contacts", "excluded_records"]),
    checks: Object.freeze([
      ["Authoritative registry population", "The redacted review result covers the active Rwanda FDA retail pharmacy population used for production routing."],
      ["Authorised WhatsApp evidence reviewed", "Every WhatsApp-ready pharmacy has named-review evidence for authorised business contact authority without storing phone numbers in the launch artifact."],
      ["No inferred WhatsApp authority", "No ordinary public phone, map listing, shared number or browser-observation candidate is promoted without direct or authoritative-source verification."],
      ["Responder scope reconciled", "The intended WhatsApp responder scope is reconciled with routing, portal login and customer handoff behavior."],
    ]),
  },
});

const secretLike = /(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;
const prohibitedOperationalDetail = /(?:\b(?:\+?250)?7\d{8}\b|(?:phone|whatsapp|otp|latitude|longitude|coordinate|location)\s*[:=]|-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,})/i;

function named(value, label) {
  const text = String(value ?? "").trim();
  if (text.length < 3) throw new Error(`${label} is required.`);
  return text;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function dateStamp(value) {
  const stamp = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) throw new Error("--date must use YYYY-MM-DD.");
  return stamp;
}

function evidenceOutputDir(value) {
  const outputDir = String(value ?? "").trim().replaceAll("\\", "/");
  if (!outputDir) throw new Error("--output-dir requires a path.");
  if (isAbsolute(outputDir) || outputDir.split("/").includes("..")) {
    throw new Error("--output-dir must be a repository-relative path.");
  }
  if (!outputDir.startsWith("docs/launch/evidence")) {
    throw new Error("--output-dir must be under docs/launch/evidence.");
  }
  return outputDir.replace(/\/+$/, "");
}

function integerMetric(result, field, { minimum = 0 } = {}) {
  const value = result?.[field];
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${field} must be an integer >= ${minimum}.`);
  return value;
}

function sourceDigests(result) {
  const digests = result?.source_digests;
  if (!digests || typeof digests !== "object" || Array.isArray(digests) || !Object.keys(digests).length) {
    throw new Error("source_digests is required.");
  }
  for (const [key, digest] of Object.entries(digests)) {
    if (!/^[a-f0-9]{64}$/.test(String(digest))) throw new Error(`source_digests.${key} must be a lowercase SHA-256 digest.`);
  }
  return digests;
}

function safeReviewResult(result) {
  const serialized = JSON.stringify(result);
  if (secretLike.test(serialized)) throw new Error("review result contains secret-like material.");
  if (prohibitedOperationalDetail.test(serialized)) {
    throw new Error("review result contains prohibited operational identifiers; keep coordinates, phone numbers and contact values in the controlled private ledger.");
  }
}

export function buildOperationsLaunchEvidence(result, { now = new Date() } = {}) {
  safeReviewResult(result);
  const gate = named(result?.gate, "gate");
  const config = gateConfig[gate];
  if (!config) throw new Error(`Unsupported operations launch gate ${gate}.`);
  if (result?.schema_version !== "1") throw new Error("review result schema_version must be 1.");
  if (result?.review_type !== config.reviewType) throw new Error(`review_type must be ${config.reviewType}.`);
  if (result?.status !== "complete") throw new Error("review result status must be complete.");
  const reviewedBy = named(result.reviewed_by, "reviewed_by");
  const reviewerRole = named(result.reviewer_role, "reviewer_role");
  const reviewedAt = String(result.reviewed_at ?? "").trim();
  if (!validTimestamp(reviewedAt)) throw new Error("reviewed_at must be a timezone-qualified ISO 8601 timestamp.");
  if (Date.parse(reviewedAt) > now.getTime() + 300_000) throw new Error("reviewed_at is in the future.");
  const totalRecords = integerMetric(result, "total_records", { minimum: 1 });
  const pendingRecords = integerMetric(result, "pending_records");
  const blockedRecords = integerMetric(result, "blocked_records");
  if (pendingRecords !== 0) throw new Error("pending_records must be zero.");
  if (blockedRecords !== 0) throw new Error("blocked_records must be zero.");
  const metrics = Object.fromEntries(config.requiredMetrics.map((field) => [field, integerMetric(result, field)]));
  if ((metrics.approved_records ?? metrics.approved_pharmacies ?? 0) < 1) {
    throw new Error("at least one record must be approved for the production-ready scope.");
  }

  const artifact = {
    schema_version: "1",
    release: "med250-production",
    gate,
    evidence_type: "review_ledger",
    status: "complete",
    title: config.title,
    summary: result.summary ?? config.summary,
    recorded_at: reviewedAt,
    recorded_by: reviewedBy,
    recorded_role: reviewerRole,
    redactions_confirmed: true,
    checks: config.checks.map(([name, detail]) => ({ name, status: "passed", detail })),
    reviewed_by: reviewedBy,
    reviewer_role: reviewerRole,
    reviewed_at: reviewedAt,
    total_records: totalRecords,
    pending_records: pendingRecords,
    blocked_records: blockedRecords,
    ...metrics,
    source_digests: sourceDigests(result),
    private_ledger_reference: named(result.private_ledger_reference, "private_ledger_reference"),
  };
  const validation = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: gate,
    expectedType: "review_ledger",
    now,
  });
  if (!validation.valid) {
    throw new Error(`operations review ledger artifact is invalid: ${validation.errors.join("; ")}`);
  }
  return artifact;
}

function parseArgs(values) {
  const args = {
    input: "",
    outputDir: "docs/launch/evidence",
    date: new Date().toISOString().slice(0, 10),
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--input") args.input = values[++index] ?? "";
    else if (flag === "--output-dir") args.outputDir = values[++index] ?? "";
    else if (flag === "--date") args.date = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.input) throw new Error("--input requires a redacted operations review result JSON path.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = evidenceOutputDir(args.outputDir);
  const stamp = dateStamp(args.date);
  const result = JSON.parse(await readFile(args.input, "utf8"));
  const artifact = buildOperationsLaunchEvidence(result);
  const outputReference = join(outputDir, `${gateConfig[artifact.gate].outputPrefix}-${stamp}.json`).replaceAll("\\", "/");
  const outputPath = resolve(outputReference);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "written",
    output: outputReference,
    gate: artifact.gate,
    total_records: artifact.total_records,
    next_commands: [
      `npm run launch:evidence:record -- --artifact ${outputReference} --replace --confirm --approved-by "${artifact.reviewed_by}" --approved-role "${artifact.reviewer_role}" --approved-at "${artifact.reviewed_at}"`,
    ],
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
