import assert from "node:assert/strict";
import test from "node:test";

import {
  assessDuplicateReview,
  createPendingReviewCsv,
  deriveDuplicateGroups,
  parseCsv,
} from "../scripts/import-data/verify-duplicate-register-review.mjs";
import { buildDuplicateRegisterLaunchEvidence } from "../scripts/import-data/create-duplicate-register-launch-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";

const products = [
  { source_serial: "1", registration_number: "FDA-001" },
  { source_serial: "2", registration_number: " fda-001 " },
];
const retail = [
  { source_serial: "3", council_registration_number: "NPC/A1" },
  { source_serial: "4", council_registration_number: "npc/a1" },
];

test("derives deterministic product and pharmacy duplicate groups", () => {
  assert.deepEqual(deriveDuplicateGroups(products, retail, []), [
    {
      key: "pharmacy_professional_registration:NPC/A1",
      recordType: "pharmacy_professional_registration",
      identifier: "NPC/A1",
      references: ["retail:3", "retail:4"],
      rowCount: 2,
    },
    {
      key: "product_registration:FDA-001",
      recordType: "product_registration",
      identifier: "FDA-001",
      references: ["product:1", "product:2"],
      rowCount: 2,
    },
  ]);
});

test("keeps a synchronized pending ledger valid in preview and blocked in strict mode", () => {
  const groups = deriveDuplicateGroups(products, retail, []);
  const reviewRows = parseCsv(createPendingReviewCsv(groups)).rows;
  const preview = assessDuplicateReview(groups, reviewRows);
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.decisionCounts, {
    pending: 2,
    accepted_source_duplicate: 0,
    blocked_source_correction: 0,
  });

  const strict = assessDuplicateReview(groups, reviewRows, { strict: true });
  assert.equal(strict.valid, false);
  assert.equal(strict.errors.length, 2);
  assert.match(strict.errors[0], /still pending review/);
});

test("accepts governed duplicate decisions and rejects stale source references", () => {
  const groups = deriveDuplicateGroups(products, [], []);
  const approved = [{
    record_type: "product_registration",
    normalized_identifier: "FDA-001",
    source_references: "product:1;product:2",
    source_row_count: "2",
    decision: "accepted_source_duplicate",
    reviewer: "Regulatory reviewer",
    reviewed_at: "2026-07-13T12:00:00Z",
    note: "Both source rows were compared and intentionally retained.",
  }];
  assert.equal(assessDuplicateReview(groups, approved, {
    strict: true,
    now: new Date("2026-07-14T00:00:00Z"),
  }).valid, true);

  approved[0].source_references = "product:1;product:3";
  assert.match(
    assessDuplicateReview(groups, approved).errors[0],
    /source references do not match/,
  );
});

test("blocks production while a governed source correction remains open", () => {
  const groups = deriveDuplicateGroups(products, [], []);
  const blocked = [{
    record_type: "product_registration",
    normalized_identifier: "FDA-001",
    source_references: "product:1;product:2",
    source_row_count: "2",
    decision: "blocked_source_correction",
    reviewer: "Regulatory reviewer",
    reviewed_at: "2026-07-13T12:00:00Z",
    note: "Awaiting corrected register publication.",
  }];
  const result = assessDuplicateReview(groups, blocked, {
    strict: true,
    now: new Date("2026-07-14T00:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /remains blocked for source correction/);
});

test("builds duplicate-register launch evidence only after strict review passes", () => {
  const productsSource = [
    "source_serial,registration_number,brand_name",
    "1,FDA-001,Medicine One",
    "2,fda-001,Medicine One Duplicate",
    "",
  ].join("\n");
  const retailSource = [
    "source_serial,council_registration_number,name",
    "3,NPC/A1,Pharmacy One",
    "4,npc/a1,Pharmacy One Duplicate",
    "",
  ].join("\n");
  const onlineSource = [
    "source_serial,council_registration_number,name",
    "",
  ].join("\n");
  const pendingReview = createPendingReviewCsv(deriveDuplicateGroups(
    parseCsv(productsSource).rows,
    parseCsv(retailSource).rows,
    parseCsv(onlineSource).rows,
  ));

  assert.throws(
    () => buildDuplicateRegisterLaunchEvidence({
      productsSource,
      retailSource,
      onlineSource,
      reviewSource: pendingReview,
      reviewPacketSource: "{}\n",
      reviewedBy: "Named register reviewer",
      reviewerRole: "Register data reviewer",
      reviewedAt: "2026-07-14T09:00:00Z",
      now: new Date("2026-07-14T10:00:00Z"),
    }),
    /Duplicate-register review is not production-ready/,
  );

  const completedReview = [
    "record_type,normalized_identifier,source_references,source_row_count,decision,reviewer,reviewed_at,note",
    "pharmacy_professional_registration,NPC/A1,retail:3;retail:4,2,accepted_source_duplicate,Named register reviewer,2026-07-14T08:30:00Z,Both source rows were compared and intentionally retained.",
    "product_registration,FDA-001,product:1;product:2,2,accepted_source_duplicate,Named register reviewer,2026-07-14T08:45:00Z,Both source rows were compared and intentionally retained.",
    "",
  ].join("\n");
  const artifact = buildDuplicateRegisterLaunchEvidence({
    productsSource,
    retailSource,
    onlineSource,
    reviewSource: completedReview,
    reviewPacketSource: "{}\n",
    reviewedBy: "Named register reviewer",
    reviewerRole: "Register data reviewer",
    reviewedAt: "2026-07-14T09:00:00Z",
    now: new Date("2026-07-14T10:00:00Z"),
  });

  assert.equal(artifact.evidence_type, "review_ledger");
  assert.equal(artifact.total_records, 2);
  assert.equal(artifact.pending_records, 0);
  assert.equal(artifact.blocked_records, 0);
  assert.deepEqual(artifact.decision_counts, {
    pending: 0,
    accepted_source_duplicate: 2,
    blocked_source_correction: 0,
  });
  const validation = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: "MED250_GATE_DUPLICATE_REGISTER_REVIEWED",
    expectedType: "review_ledger",
    now: new Date("2026-07-14T10:00:00Z"),
  });
  assert.equal(validation.valid, true, validation.errors.join("; "));
});
