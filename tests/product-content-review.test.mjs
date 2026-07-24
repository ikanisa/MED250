import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_DATASET_PATH,
  DEFAULT_RECOVERED_VALIDATION_DATASET_PATH,
  applyProductContentReviewDecision,
  assessCurrentProductContentReview,
  assessProductContentReview,
  buildProductContentReviewPacket,
  deriveProductContentReviewPopulation,
  nextPendingProductContentReview,
} from "../scripts/import-data/product-content-review.mjs";

let datasetPath = DEFAULT_DATASET_PATH;
let datasetSource;
try {
  datasetSource = await readFile(new URL(`../${DEFAULT_DATASET_PATH}`, import.meta.url), "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  datasetPath = DEFAULT_RECOVERED_VALIDATION_DATASET_PATH;
  datasetSource = await readFile(
    new URL(`../${DEFAULT_RECOVERED_VALIDATION_DATASET_PATH}`, import.meta.url),
    "utf8",
  );
}
const dataset = JSON.parse(datasetSource);
const datasetBoundExpected = buildProductContentReviewPacket(dataset, {
  sourcePath: datasetPath,
  sourceSha256: createHash("sha256").update(datasetSource).digest("hex"),
});
const committed = JSON.parse(await readFile(
  new URL("../data/imports/product-content-review-pending-2026-07-18.json", import.meta.url),
  "utf8",
));
const expected = structuredClone(datasetBoundExpected);
if (datasetPath === DEFAULT_RECOVERED_VALIDATION_DATASET_PATH) {
  expected.source = structuredClone(committed.source);
}

test("builds the complete source-bound product-content review population", () => {
  const population = deriveProductContentReviewPopulation(dataset);
  assert.equal(population.duplicateTitleGroups.length, 40);
  assert.equal(population.duplicateTitleGroups.reduce((sum, group) => sum + group.source_rows.length, 0), 88);
  assert.equal(population.missingMedicineGenerics.length, 24);
  assert.equal(population.shortOrPackLikeTitles.length, 8);
  assert.equal(expected.summary.review_entry_count, 72);
  assert.match(expected.classification, /no clinical inference/);
  assert.ok(expected.duplicate_title_groups.every((group) => group.source_rows.every((row) => /^https:\/\//.test(row.source_url))));
});

test("keeps the committed owner packet synchronized and pending without inventing decisions", () => {
  const result = assessProductContentReview(expected, committed);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.expectedEntryCount, 72);
  assert.equal(result.pendingCount, 72);
  assert.equal(result.blockingCorrectionCount, 0);
  assert.equal(result.decisionCounts.pending, 72);
  assert.equal(JSON.stringify(committed).includes('"recommendation"'), false);
});

test("keeps the current 72-entry review in the strict production-readiness result", async () => {
  const result = await assessCurrentProductContentReview({
    strict: true,
    now: new Date("2026-07-24T12:00:00+02:00"),
  });
  assert.equal(result.valid, false);
  assert.equal(result.pendingCount, 72);
  assert.equal(result.blockingCorrectionCount, 0);
  assert.equal(result.errors.filter((error) => /still pending/.test(error)).length, 72);
  assert.equal(result.originalSourceRetentionSatisfied, false);
});

test("fails strict review until every owner decision is complete", () => {
  const result = assessProductContentReview(expected, committed, { strict: true });
  assert.equal(result.valid, false);
  assert.equal(result.errors.filter((error) => /still pending/.test(error)).length, 72);
});

test("detects source tampering and accepts only complete accountable decisions", () => {
  const tampered = structuredClone(committed);
  tampered.missing_medicine_generics[0].source_row.generic_name = "Invented ingredient";
  assert.equal(assessProductContentReview(expected, tampered).valid, false);

  const completed = structuredClone(expected);
  const entries = [
    ...completed.duplicate_title_groups,
    ...completed.missing_medicine_generics,
    ...completed.short_or_pack_like_titles,
  ];
  for (const entry of entries) {
    const decision = entry.kind === "duplicate_title_group"
      ? "distinct_registrations_confirmed"
      : entry.kind === "missing_medicine_generic"
        ? "approved_source_exception"
        : "approved_source_title";
    entry.review = {
      decision,
      reviewer: "Accountable reviewer",
      reviewer_role: "Regulatory data reviewer",
      reviewed_at: "2026-07-18T12:00:00+02:00",
      evidence_url: "https://rwandafda.gov.rw/register/monitoring_preview_register",
      note: "Checked the exact registration evidence and recorded the governed source outcome.",
    };
  }
  completed.summary.pending_count = 0;
  assert.equal(assessProductContentReview(expected, completed, { strict: true, now: new Date("2026-07-19T00:00:00Z") }).valid, true);

  completed.missing_medicine_generics[0].review.decision = "source_correction_required";
  completed.summary.blocking_correction_count = 1;
  assert.equal(assessProductContentReview(expected, completed, { strict: true, now: new Date("2026-07-19T00:00:00Z") }).valid, false);
});

test("applies exactly one accountable decision and protects completed reviews from accidental overwrite", () => {
  const key = committed.missing_medicine_generics[0].key;
  const result = applyProductContentReviewDecision(expected, committed, {
    key,
    decision: "approved_source_exception",
    reviewer: "Accountable reviewer",
    reviewerRole: "Regulatory data reviewer",
    reviewedAt: "2026-07-18T12:00:00+02:00",
    evidenceUrl: "https://rwandafda.gov.rw/register/monitoring_preview_register",
    note: "Checked the exact registration record and approved the documented source exception.",
    now: new Date("2026-07-19T00:00:00Z"),
  });
  assert.equal(result.entry.key, key);
  assert.equal(result.packet.summary.pending_count, 71);
  assert.equal(result.assessment.valid, true);
  assert.throws(() => applyProductContentReviewDecision(expected, result.packet, {
    key,
    decision: "source_correction_required",
    reviewer: "Accountable reviewer",
    reviewerRole: "Regulatory data reviewer",
    reviewedAt: "2026-07-18T12:30:00+02:00",
    evidenceUrl: "https://rwandafda.gov.rw/register/monitoring_preview_register",
    note: "Rechecked the exact registration record and found that the source requires correction.",
    now: new Date("2026-07-19T00:00:00Z"),
  }), /already has decision/);
  const replaced = applyProductContentReviewDecision(expected, result.packet, {
    key,
    decision: "source_correction_required",
    reviewer: "Accountable reviewer",
    reviewerRole: "Regulatory data reviewer",
    reviewedAt: "2026-07-18T12:30:00+02:00",
    evidenceUrl: "https://rwandafda.gov.rw/register/monitoring_preview_register",
    note: "Rechecked the exact registration record and found that the source requires correction.",
    replace: true,
    now: new Date("2026-07-19T00:00:00Z"),
  });
  assert.equal(replaced.packet.summary.pending_count, 71);
  assert.equal(replaced.packet.summary.blocking_correction_count, 1);
  assert.throws(() => applyProductContentReviewDecision(expected, committed, {
    key,
    decision: "approved_source_exception",
    reviewer: "Accountable reviewer",
    reviewerRole: "Regulatory data reviewer",
    reviewedAt: "2026-07-18T12:00:00+02:00",
    evidenceUrl: "https://example.com/not-authoritative",
    note: "This note is long enough but the evidence origin is not authoritative.",
    now: new Date("2026-07-19T00:00:00Z"),
  }), /authoritative Rwanda FDA HTTPS URL/);
});

test("presents one pending source-bound review with only its allowed owner decisions", () => {
  const next = nextPendingProductContentReview(expected, committed, { now: new Date("2026-07-19T00:00:00Z") });
  assert.equal(next.pending_count, 72);
  assert.equal(next.entry.key, committed.duplicate_title_groups[0].key);
  assert.deepEqual(next.allowed_decisions, ["distinct_registrations_confirmed", "source_duplicate_correction_required"]);
  assert.equal(JSON.stringify(next).includes('"recommendation"'), false);
});

test("the owner CLI updates one record atomically and leaves no lock or temporary file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "med250-product-content-review-"));
  const output = join(directory, "review.json");
  await writeFile(output, `${JSON.stringify(datasetBoundExpected, null, 2)}\n`, "utf8");
  const key = datasetBoundExpected.short_or_pack_like_titles[0].key;
  const result = spawnSync(process.execPath, [
    "scripts/import-data/product-content-review.mjs",
    "decide",
    "--dataset", datasetPath,
    "--output", output,
    "--key", key,
    "--decision", "approved_source_title",
    "--reviewer", "Accountable reviewer",
    "--reviewer-role", "Regulatory data reviewer",
    "--reviewed-at", "2026-07-18T08:00:00+02:00",
    "--evidence-url", "https://rwandafda.gov.rw/register/monitoring_preview_register",
    "--note", "Checked the exact registration record and approved the existing source title.",
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const updated = JSON.parse(await readFile(output, "utf8"));
  assert.equal(updated.summary.pending_count, 71);
  assert.equal(updated.short_or_pack_like_titles.find((entry) => entry.key === key).review.decision, "approved_source_title");
  await assert.rejects(access(`${output}.lock`));
  assert.deepEqual(await readdir(directory), ["review.json"]);
  await rm(directory, { recursive: true, force: true });
});
