import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "../validate-launch-evidence-artifact.mjs";
import {
  assessDuplicateReview,
  deriveDuplicateGroups,
  parseCsv,
  REVIEW_COLUMNS,
} from "./verify-duplicate-register-review.mjs";

const GATE = "MED250_GATE_DUPLICATE_REGISTER_REVIEWED";
const DEFAULT_PATHS = Object.freeze({
  products: "data/imports/rwanda-fda-products-july-2026.csv",
  retail: "data/imports/rwanda-fda-retail-pharmacies-may-2026.csv",
  online: "data/imports/rwanda-fda-online-pharmacies-may-2026.csv",
  review: "data/imports/duplicate-register-review.csv",
  packet: "desktop-output/goal-progress-2026-07-20/duplicate-register-review-packet-2026-07-20.json",
});

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function named(value, label) {
  const text = String(value ?? "").trim();
  if (text.length < 3) throw new Error(`${label} is required.`);
  return text;
}

function dateStamp(value) {
  const stamp = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) throw new Error("--date must use YYYY-MM-DD.");
  return stamp;
}

function validApprovalTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
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

function assertReviewHeaders(review, reviewPath) {
  if (JSON.stringify(review.headers) !== JSON.stringify(REVIEW_COLUMNS)) {
    throw new Error(`${reviewPath}: headers must be exactly ${REVIEW_COLUMNS.join(",")}.`);
  }
}

export function buildDuplicateRegisterLaunchEvidence({
  productsSource,
  retailSource,
  onlineSource,
  reviewSource,
  reviewPacketSource,
  paths = DEFAULT_PATHS,
  reviewedBy,
  reviewerRole,
  reviewedAt,
  recordedBy = reviewedBy,
  recordedRole = reviewerRole,
  now = new Date(),
}) {
  const reviewer = named(reviewedBy, "reviewed_by");
  const role = named(reviewerRole, "reviewer_role");
  const approvalTime = String(reviewedAt ?? "").trim();
  if (!validApprovalTimestamp(approvalTime)) throw new Error("reviewed_at must be a timezone-qualified ISO 8601 timestamp.");

  const productRows = parseCsv(productsSource, paths.products).rows;
  const retailRows = parseCsv(retailSource, paths.retail).rows;
  const onlineRows = parseCsv(onlineSource, paths.online).rows;
  const review = parseCsv(reviewSource, paths.review);
  assertReviewHeaders(review, paths.review);
  const expectedGroups = deriveDuplicateGroups(productRows, retailRows, onlineRows);
  const assessment = assessDuplicateReview(expectedGroups, review.rows, { strict: true, now });
  if (!assessment.valid) {
    throw new Error(`Duplicate-register review is not production-ready: ${assessment.errors.join("; ")}`);
  }

  const artifact = {
    schema_version: "1",
    release: "med250-production",
    gate: GATE,
    evidence_type: "review_ledger",
    status: "complete",
    title: "Rwanda FDA duplicate-register review completed ledger",
    summary: `Strict duplicate-register review passed for all ${assessment.expectedGroupCount} synchronized product and pharmacy duplicate groups with named reviewer decisions.`,
    recorded_at: approvalTime,
    recorded_by: named(recordedBy, "recorded_by"),
    recorded_role: named(recordedRole, "recorded_role"),
    redactions_confirmed: true,
    checks: [
      {
        name: "Synchronized review population",
        status: "passed",
        detail: `The governed review CSV contains exactly ${assessment.expectedGroupCount} rows matching the current product, retail-pharmacy and online-pharmacy source releases.`,
      },
      {
        name: "Strict duplicate review passed",
        status: "passed",
        detail: "Every synchronized duplicate group has a non-pending reviewer decision, timezone-qualified timestamp and substantive rationale.",
      },
      {
        name: "No blocked source correction remains",
        status: "passed",
        detail: "The strict verifier found zero pending decisions and zero blocked source-correction decisions for production launch.",
      },
      {
        name: "Source-comparison packet retained",
        status: "passed",
        detail: "The redacted deterministic reviewer packet and all source release inputs are bound by SHA-256 digests.",
      },
    ],
    reviewed_by: reviewer,
    reviewer_role: role,
    reviewed_at: approvalTime,
    total_records: assessment.expectedGroupCount,
    pending_records: assessment.decisionCounts.pending,
    blocked_records: assessment.decisionCounts.blocked_source_correction,
    decision_counts: assessment.decisionCounts,
    review_csv_reference: paths.review,
    review_packet_reference: paths.packet,
    source_digests: {
      review_csv: sha256(reviewSource),
      review_packet: sha256(reviewPacketSource),
      rwanda_fda_products: sha256(productsSource),
      rwanda_fda_retail_pharmacies: sha256(retailSource),
      rwanda_fda_online_pharmacies: sha256(onlineSource),
    },
  };

  const validation = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: GATE,
    expectedType: "review_ledger",
    now,
  });
  if (!validation.valid) {
    throw new Error(`duplicate-register review ledger artifact is invalid: ${validation.errors.join("; ")}`);
  }
  return artifact;
}

function parseArgs(values) {
  const args = {
    ...DEFAULT_PATHS,
    outputDir: "docs/launch/evidence",
    date: new Date().toISOString().slice(0, 10),
    reviewedBy: "",
    reviewerRole: "",
    reviewedAt: "",
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--products") args.products = values[++index] ?? "";
    else if (flag === "--retail") args.retail = values[++index] ?? "";
    else if (flag === "--online") args.online = values[++index] ?? "";
    else if (flag === "--review") args.review = values[++index] ?? "";
    else if (flag === "--packet") args.packet = values[++index] ?? "";
    else if (flag === "--output-dir") args.outputDir = values[++index] ?? "";
    else if (flag === "--date") args.date = values[++index] ?? "";
    else if (flag === "--reviewed-by") args.reviewedBy = values[++index] ?? "";
    else if (flag === "--reviewer-role") args.reviewerRole = values[++index] ?? "";
    else if (flag === "--reviewed-at") args.reviewedAt = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  for (const field of ["products", "retail", "online", "review", "packet"]) {
    if (!args[field]) throw new Error(`--${field} requires a path.`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = evidenceOutputDir(args.outputDir);
  const stamp = dateStamp(args.date);
  const outputReference = join(outputDir, `duplicate-register-review-ledger-${stamp}.json`).replaceAll("\\", "/");
  const [productsSource, retailSource, onlineSource, reviewSource, reviewPacketSource] = await Promise.all([
    readFile(args.products, "utf8"),
    readFile(args.retail, "utf8"),
    readFile(args.online, "utf8"),
    readFile(args.review, "utf8"),
    readFile(args.packet, "utf8"),
  ]);
  const artifact = buildDuplicateRegisterLaunchEvidence({
    productsSource,
    retailSource,
    onlineSource,
    reviewSource,
    reviewPacketSource,
    paths: {
      products: args.products,
      retail: args.retail,
      online: args.online,
      review: args.review,
      packet: args.packet,
    },
    reviewedBy: args.reviewedBy,
    reviewerRole: args.reviewerRole,
    reviewedAt: args.reviewedAt,
  });
  const outputPath = resolve(outputReference);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "written",
    output: outputReference,
    total_records: artifact.total_records,
    decision_counts: artifact.decision_counts,
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
