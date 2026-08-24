import { createHash } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { officialCatalogueTitle } from "../../lib/product-display.ts";

export const DEFAULT_DATASET_PATH = "outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json";
export const DEFAULT_REVIEW_PATH = "data/imports/product-content-review-pending-2026-07-18.json";

export const REVIEW_DECISIONS = Object.freeze({
  duplicate_title_group: Object.freeze([
    "pending",
    "distinct_registrations_confirmed",
    "source_duplicate_correction_required",
  ]),
  missing_medicine_generic: Object.freeze([
    "pending",
    "authoritative_generic_recorded",
    "approved_source_exception",
    "source_correction_required",
  ]),
  short_or_pack_like_title: Object.freeze([
    "pending",
    "approved_source_title",
    "corrected_authoritative_title",
    "source_correction_required",
  ]),
});

const BLOCKING_DECISIONS = new Set([
  "source_duplicate_correction_required",
  "source_correction_required",
]);

const REVIEW_FIELDS = Object.freeze([
  "decision",
  "reviewer",
  "reviewer_role",
  "reviewed_at",
  "evidence_url",
  "note",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTitle(value) {
  return officialCatalogueTitle(value ?? "")
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function officialTitle(row) {
  return officialCatalogueTitle(row.product_name || row.brand_name || "");
}

function stableText(value) {
  return officialCatalogueTitle(String(value ?? ""));
}

function rowEvidence(row) {
  const evidence = {
    id: stableText(row.id),
    source_serial: stableText(row.source_serial),
    registration_number: stableText(row.registration_number),
    official_title: officialTitle(row),
    generic_name: stableText(row.generic_name),
    strength: stableText(row.strength),
    dosage_form: stableText(row.dosage_form),
    pack_size: stableText(row.pack_size),
    manufacturer: stableText(row.manufacturer),
    marketing_authorization_holder: stableText(row.marketing_authorization_holder),
    registration_date: stableText(row.registration_date),
    expiry_date: stableText(row.expiry_date),
    regulatory_status: stableText(row.regulatory_status),
    is_orderable: Boolean(row.is_orderable),
    is_active: Boolean(row.is_active),
    source_name: stableText(row.source_name),
    source_url: stableText(row.source_url),
  };
  return { ...evidence, source_row_sha256: sha256(JSON.stringify(evidence)) };
}

function pendingReview() {
  return {
    decision: "pending",
    reviewer: null,
    reviewer_role: null,
    reviewed_at: null,
    evidence_url: null,
    note: null,
  };
}

function entryKey(kind, value) {
  return `${kind}:${value}`;
}

export function deriveProductContentReviewPopulation(dataset) {
  const medicines = Array.isArray(dataset.fda_medicines) ? dataset.fda_medicines : [];
  const consumers = Array.isArray(dataset.consumer_products) ? dataset.consumer_products : [];
  const rows = [...medicines, ...consumers];
  const titleGroups = new Map();
  for (const row of rows) {
    const normalized = normalizeTitle(officialTitle(row));
    if (!normalized) continue;
    titleGroups.set(normalized, [...(titleGroups.get(normalized) ?? []), row]);
  }

  const duplicateTitleGroups = [...titleGroups.entries()]
    .filter(([, group]) => group.length > 1 && group.every((row) => row.product_type === "human_medicine"))
    .map(([normalizedTitle, group]) => ({
      kind: "duplicate_title_group",
      key: entryKey("duplicate_title_group", normalizedTitle),
      normalized_title: normalizedTitle,
      source_rows: group.map(rowEvidence).toSorted((left, right) => left.id.localeCompare(right.id)),
      review: pendingReview(),
    }))
    .toSorted((left, right) => left.key.localeCompare(right.key));

  const missingMedicineGenerics = medicines
    .filter((row) => !stableText(row.generic_name))
    .map((row) => ({
      kind: "missing_medicine_generic",
      key: entryKey("missing_medicine_generic", stableText(row.id)),
      source_row: rowEvidence(row),
      review: pendingReview(),
    }))
    .toSorted((left, right) => left.key.localeCompare(right.key));

  const shortOrPackLikeTitles = rows
    .filter((row) => {
      const title = officialTitle(row);
      return title.length < 3 || /^\d+(?:\.\d+)?\s*(?:pcs?|pack|count|ct|ml|mg|g|oz)?$/i.test(title);
    })
    .map((row) => ({
      kind: "short_or_pack_like_title",
      key: entryKey("short_or_pack_like_title", stableText(row.id)),
      source_row: rowEvidence(row),
      review: pendingReview(),
    }))
    .toSorted((left, right) => left.key.localeCompare(right.key));

  return { duplicateTitleGroups, missingMedicineGenerics, shortOrPackLikeTitles };
}

export function buildProductContentReviewPacket(dataset, { sourcePath = DEFAULT_DATASET_PATH, sourceSha256 = "" } = {}) {
  const population = deriveProductContentReviewPopulation(dataset);
  const duplicateTitleRowCount = population.duplicateTitleGroups.reduce((sum, group) => sum + group.source_rows.length, 0);
  return {
    schema_version: "1",
    classification: "deterministic source-bound reviewer context; contains no clinical inference, correction, approval, or merge recommendation",
    source: {
      path: sourcePath,
      sha256: sourceSha256,
      research_as_of: dataset.research_as_of ?? null,
      generated_at: dataset.generated_at ?? null,
    },
    summary: {
      review_entry_count: population.duplicateTitleGroups.length + population.missingMedicineGenerics.length + population.shortOrPackLikeTitles.length,
      duplicate_title_group_count: population.duplicateTitleGroups.length,
      duplicate_title_row_count: duplicateTitleRowCount,
      missing_medicine_generic_count: population.missingMedicineGenerics.length,
      short_or_pack_like_title_count: population.shortOrPackLikeTitles.length,
      pending_count: population.duplicateTitleGroups.length + population.missingMedicineGenerics.length + population.shortOrPackLikeTitles.length,
      blocking_correction_count: 0,
    },
    review_contract: {
      decisions: REVIEW_DECISIONS,
      rules: [
        "Use the authoritative Rwanda FDA record and a named regulatory or clinical data reviewer.",
        "Do not infer an ingredient from a brand, strength, dosage form, manufacturer, or similarly named product.",
        "Do not merge registrations merely because their normalized customer-facing titles match.",
        "Every completed decision requires a named reviewer, role, timezone-qualified timestamp, authoritative HTTPS evidence, and substantive rationale.",
        "A correction-required decision keeps strict verification blocked until the corrected source snapshot is imported and this packet is regenerated.",
      ],
    },
    duplicate_title_groups: population.duplicateTitleGroups,
    missing_medicine_generics: population.missingMedicineGenerics,
    short_or_pack_like_titles: population.shortOrPackLikeTitles,
  };
}

function validTimestamp(value, now) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.valueOf() <= now.valueOf() + 5 * 60 * 1_000;
}

function authoritativeEvidenceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "rwandafda.gov.rw" || url.hostname.endsWith(".rwandafda.gov.rw"));
  } catch {
    return false;
  }
}

function packetEntries(packet) {
  return [
    ...(Array.isArray(packet.duplicate_title_groups) ? packet.duplicate_title_groups : []),
    ...(Array.isArray(packet.missing_medicine_generics) ? packet.missing_medicine_generics : []),
    ...(Array.isArray(packet.short_or_pack_like_titles) ? packet.short_or_pack_like_titles : []),
  ];
}

function sourceEvidence(entry) {
  return entry.kind === "duplicate_title_group"
    ? { normalized_title: entry.normalized_title, source_rows: entry.source_rows }
    : { source_row: entry.source_row };
}

export function assessProductContentReview(expectedPacket, actualPacket, { strict = false, now = new Date() } = {}) {
  const errors = [];
  if (actualPacket?.schema_version !== "1") errors.push("schema_version must be 1");
  if (actualPacket?.classification !== expectedPacket.classification) errors.push("classification does not match the governed contract");
  if (JSON.stringify(actualPacket?.source) !== JSON.stringify(expectedPacket.source)) errors.push("source binding does not match the current dataset");
  if (JSON.stringify(actualPacket?.review_contract) !== JSON.stringify(expectedPacket.review_contract)) errors.push("review contract does not match the governed contract");

  const expectedEntries = new Map(packetEntries(expectedPacket).map((entry) => [entry.key, entry]));
  const actualEntries = packetEntries(actualPacket);
  const seen = new Set();
  const decisionCounts = {};
  let pendingCount = 0;
  let blockingCorrectionCount = 0;

  for (const entry of actualEntries) {
    const key = stableText(entry?.key);
    if (!key) {
      errors.push("review entry is missing a key");
      continue;
    }
    if (seen.has(key)) {
      errors.push(`duplicate review entry ${key}`);
      continue;
    }
    seen.add(key);
    const expected = expectedEntries.get(key);
    if (!expected) {
      errors.push(`${key} is not in the current review population`);
      continue;
    }
    if (entry.kind !== expected.kind) errors.push(`${key}: kind does not match the current review population`);
    if (JSON.stringify(sourceEvidence(entry)) !== JSON.stringify(sourceEvidence(expected))) {
      errors.push(`${key}: source evidence does not match the current dataset`);
    }

    const review = entry.review ?? {};
    const extraFields = Object.keys(review).filter((field) => !REVIEW_FIELDS.includes(field));
    const missingFields = REVIEW_FIELDS.filter((field) => !Object.hasOwn(review, field));
    if (extraFields.length) errors.push(`${key}: unsupported review fields ${extraFields.join(", ")}`);
    if (missingFields.length) errors.push(`${key}: missing review fields ${missingFields.join(", ")}`);
    const decision = stableText(review.decision);
    const allowed = REVIEW_DECISIONS[entry.kind] ?? [];
    if (!allowed.includes(decision)) {
      errors.push(`${key}: decision must be one of ${allowed.join(", ")}`);
      continue;
    }
    decisionCounts[decision] = (decisionCounts[decision] ?? 0) + 1;
    const reviewer = stableText(review.reviewer);
    const reviewerRole = stableText(review.reviewer_role);
    const reviewedAt = stableText(review.reviewed_at);
    const evidenceUrl = stableText(review.evidence_url);
    const note = stableText(review.note);
    if (decision === "pending") {
      pendingCount += 1;
      if (reviewer || reviewerRole || reviewedAt || evidenceUrl || note) errors.push(`${key}: pending review cannot contain completion metadata`);
      if (strict) errors.push(`${key}: review is still pending`);
      continue;
    }
    if (!reviewer) errors.push(`${key}: reviewer is required`);
    if (!reviewerRole) errors.push(`${key}: reviewer_role is required`);
    if (!validTimestamp(reviewedAt, now)) errors.push(`${key}: reviewed_at must be a valid non-future ISO 8601 timestamp with timezone`);
    if (!authoritativeEvidenceUrl(evidenceUrl)) errors.push(`${key}: evidence_url must be an authoritative Rwanda FDA HTTPS URL`);
    if (note.length < 20) errors.push(`${key}: note must contain a substantive rationale of at least 20 characters`);
    if (BLOCKING_DECISIONS.has(decision)) {
      blockingCorrectionCount += 1;
      if (strict) errors.push(`${key}: source correction remains required`);
    }
  }

  for (const key of expectedEntries.keys()) if (!seen.has(key)) errors.push(`missing review entry ${key}`);
  const expectedSummary = {
    ...expectedPacket.summary,
    pending_count: pendingCount,
    blocking_correction_count: blockingCorrectionCount,
  };
  if (JSON.stringify(actualPacket?.summary) !== JSON.stringify(expectedSummary)) {
    errors.push("summary does not reconcile with the current source population and review decisions");
  }

  return {
    valid: errors.length === 0,
    strict,
    expectedEntryCount: expectedEntries.size,
    reviewedEntryCount: actualEntries.length,
    pendingCount,
    blockingCorrectionCount,
    decisionCounts,
    errors,
  };
}

export function applyProductContentReviewDecision(expectedPacket, actualPacket, {
  key,
  decision,
  reviewer,
  reviewerRole,
  reviewedAt,
  evidenceUrl,
  note,
  replace = false,
  now = new Date(),
} = {}) {
  const currentAssessment = assessProductContentReview(expectedPacket, actualPacket, { now });
  if (!currentAssessment.valid) {
    throw new Error(`Current review packet is invalid: ${currentAssessment.errors.join("; ")}`);
  }

  const normalizedKey = stableText(key);
  const nextPacket = structuredClone(actualPacket);
  const entry = packetEntries(nextPacket).find((candidate) => candidate.key === normalizedKey);
  if (!entry) throw new Error(`Unknown review key ${normalizedKey || "(empty)"}`);
  const currentDecision = stableText(entry.review?.decision);
  if (currentDecision !== "pending" && !replace) {
    throw new Error(`${normalizedKey} already has decision ${currentDecision}; pass --replace only after rechecking the exact evidence`);
  }
  const normalizedDecision = stableText(decision);
  if (normalizedDecision === "pending") throw new Error("The owner workflow cannot write a pending decision");
  if (!(REVIEW_DECISIONS[entry.kind] ?? []).includes(normalizedDecision)) {
    throw new Error(`${normalizedKey}: decision must be one of ${(REVIEW_DECISIONS[entry.kind] ?? []).filter((value) => value !== "pending").join(", ")}`);
  }

  entry.review = {
    decision: normalizedDecision,
    reviewer: stableText(reviewer),
    reviewer_role: stableText(reviewerRole),
    reviewed_at: stableText(reviewedAt),
    evidence_url: stableText(evidenceUrl),
    note: stableText(note),
  };
  const entries = packetEntries(nextPacket);
  nextPacket.summary.pending_count = entries.filter((candidate) => candidate.review?.decision === "pending").length;
  nextPacket.summary.blocking_correction_count = entries.filter((candidate) => BLOCKING_DECISIONS.has(candidate.review?.decision)).length;

  const nextAssessment = assessProductContentReview(expectedPacket, nextPacket, { now });
  if (!nextAssessment.valid) throw new Error(`Decision rejected: ${nextAssessment.errors.join("; ")}`);
  return { packet: nextPacket, assessment: nextAssessment, entry: structuredClone(entry) };
}

export function nextPendingProductContentReview(expectedPacket, actualPacket, { now = new Date() } = {}) {
  const assessment = assessProductContentReview(expectedPacket, actualPacket, { now });
  if (!assessment.valid) throw new Error(`Current review packet is invalid: ${assessment.errors.join("; ")}`);
  const entry = packetEntries(actualPacket).find((candidate) => candidate.review?.decision === "pending") ?? null;
  return {
    pending_count: assessment.pendingCount,
    blocking_correction_count: assessment.blockingCorrectionCount,
    entry: entry ? structuredClone(entry) : null,
    allowed_decisions: entry ? REVIEW_DECISIONS[entry.kind].filter((decision) => decision !== "pending") : [],
  };
}

async function updateReviewPacketAtomically(outputPath, update) {
  const destination = resolve(outputPath);
  const lockPath = `${destination}.lock`;
  const temporaryPath = resolve(dirname(destination), `.${basename(destination)}.${process.pid}.${Date.now()}.tmp`);
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${outputPath} is already being reviewed; inspect the lock before retrying`);
    throw error;
  }
  try {
    const source = await readFile(destination, "utf8");
    const currentPacket = JSON.parse(source);
    const nextPacket = await update(currentPacket);
    await writeFile(temporaryPath, `${JSON.stringify(nextPacket, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, destination);
    return nextPacket;
  } finally {
    let cleanupError = null;
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (error?.code !== "ENOENT") cleanupError = error;
    }
    try {
      await lock.close();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await unlink(lockPath);
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }
}

function parseArguments(values) {
  const command = values[0];
  if (!new Set(["generate", "verify", "next", "decide"]).has(command)) throw new Error("Usage: product-content-review.mjs <generate|verify|next|decide> [options]");
  const options = {
    command,
    strict: false,
    dataset: DEFAULT_DATASET_PATH,
    output: DEFAULT_REVIEW_PATH,
    force: false,
    replace: false,
    key: null,
    decision: null,
    reviewer: null,
    reviewerRole: null,
    reviewedAt: null,
    evidenceUrl: null,
    note: null,
  };
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--strict") options.strict = true;
    else if (value === "--force") options.force = true;
    else if (value === "--replace") options.replace = true;
    else if (value === "--dataset") options.dataset = values[++index];
    else if (value === "--output") options.output = values[++index];
    else if (value === "--key") options.key = values[++index];
    else if (value === "--decision") options.decision = values[++index];
    else if (value === "--reviewer") options.reviewer = values[++index];
    else if (value === "--reviewer-role") options.reviewerRole = values[++index];
    else if (value === "--reviewed-at") options.reviewedAt = values[++index];
    else if (value === "--evidence-url") options.evidenceUrl = values[++index];
    else if (value === "--note") options.note = values[++index];
    else throw new Error(`Unknown argument ${value}`);
  }
  if (command === "generate" && options.strict) throw new Error("--strict is only valid with verify");
  if (command === "verify" && options.force) throw new Error("--force is only valid with generate");
  if (command !== "generate" && options.force) throw new Error("--force is only valid with generate");
  if (command !== "decide" && options.replace) throw new Error("--replace is only valid with decide");
  if (command !== "decide" && ["key", "decision", "reviewer", "reviewerRole", "reviewedAt", "evidenceUrl", "note"].some((field) => stableText(options[field]))) {
    throw new Error("Decision metadata options are only valid with decide");
  }
  if (command === "decide") {
    if (options.strict || options.force) throw new Error("--strict and --force are not valid with decide");
    for (const field of ["key", "decision", "reviewer", "reviewerRole", "reviewedAt", "evidenceUrl", "note"]) {
      if (!stableText(options[field])) throw new Error(`decide requires --${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    }
  }
  if (command === "next" && (options.strict || options.force || options.replace)) {
    throw new Error("--strict, --force, and --replace are not valid with next");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const datasetSource = await readFile(options.dataset, "utf8");
  const dataset = JSON.parse(datasetSource);
  const expected = buildProductContentReviewPacket(dataset, {
    sourcePath: options.dataset,
    sourceSha256: sha256(datasetSource),
  });
  if (options.command === "generate") {
    if (!options.force) {
      try {
        await readFile(options.output, "utf8");
        throw new Error(`${options.output} already exists; use --force only when intentionally resetting every review decision`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await writeFile(resolve(options.output), `${JSON.stringify(expected, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ status: "written", output: options.output, ...expected.summary }, null, 2));
    return;
  }
  if (options.command === "decide") {
    let updateResult;
    await updateReviewPacketAtomically(options.output, async (actual) => {
      updateResult = applyProductContentReviewDecision(expected, actual, {
        key: options.key,
        decision: options.decision,
        reviewer: options.reviewer,
        reviewerRole: options.reviewerRole,
        reviewedAt: options.reviewedAt,
        evidenceUrl: options.evidenceUrl,
        note: options.note,
        replace: options.replace,
      });
      return updateResult.packet;
    });
    console.log(JSON.stringify({
      status: "updated",
      output: options.output,
      key: updateResult.entry.key,
      decision: updateResult.entry.review.decision,
      pending_count: updateResult.packet.summary.pending_count,
      blocking_correction_count: updateResult.packet.summary.blocking_correction_count,
    }, null, 2));
    return;
  }
  const actual = JSON.parse(await readFile(options.output, "utf8"));
  if (options.command === "next") {
    const next = nextPendingProductContentReview(expected, actual);
    console.log(JSON.stringify({ status: next.entry ? "pending_review" : "no_pending_review", ...next }, null, 2));
    return;
  }
  const result = assessProductContentReview(expected, actual, { strict: options.strict });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
