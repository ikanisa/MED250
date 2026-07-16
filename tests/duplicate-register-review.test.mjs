import assert from "node:assert/strict";
import test from "node:test";

import {
  assessDuplicateReview,
  createPendingReviewCsv,
  deriveDuplicateGroups,
  parseCsv,
} from "../scripts/import-data/verify-duplicate-register-review.mjs";

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
