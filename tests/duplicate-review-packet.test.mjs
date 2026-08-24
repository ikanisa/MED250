import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildDuplicateReviewPacket } from "../scripts/import-data/generate-duplicate-review-packet.mjs";
import { parseCsv } from "../scripts/import-data/verify-duplicate-register-review.mjs";

const [products, retail, online] = await Promise.all([
  readFile(new URL("../data/imports/rwanda-fda-products-july-2026.csv", import.meta.url), "utf8"),
  readFile(new URL("../data/imports/rwanda-fda-retail-pharmacies-may-2026.csv", import.meta.url), "utf8"),
  readFile(new URL("../data/imports/rwanda-fda-online-pharmacies-may-2026.csv", import.meta.url), "utf8"),
]);

const packet = buildDuplicateReviewPacket({
  productRows: parseCsv(products).rows,
  retailRows: parseCsv(retail).rows,
  onlineRows: parseCsv(online).rows,
  sourceDigests: { products: { sha256: "a".repeat(64) } },
});
const [reviewCsvFile, reviewPacketFile, reviewLedger] = await Promise.all([
  readFile(new URL("../data/imports/duplicate-register-review.csv", import.meta.url)),
  readFile(new URL("../desktop-output/goal-progress-2026-07-20/duplicate-register-review-packet-2026-07-20.json", import.meta.url)),
  readFile(new URL("../docs/launch/evidence/duplicate-register-review-ledger-pending-2026-07-16.json", import.meta.url), "utf8")
    .then((source) => JSON.parse(source)),
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("builds a complete deterministic packet for all current duplicate groups", () => {
  assert.equal(packet.summary.group_count, 51);
  assert.equal(packet.summary.product_registration_groups, 6);
  assert.equal(packet.summary.pharmacy_professional_registration_groups, 45);
  assert.equal(packet.groups.length, 51);
  assert.ok(packet.groups.every((group) => group.source_references.length === group.source_row_count));
  assert.ok(packet.groups.every((group) => group.differing_fields.length + group.identical_fields.length > 0));
});

test("contains source comparisons but no inferred review decision or recommendation", () => {
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /"decision"\s*:/i);
  assert.doesNotMatch(serialized, /"recommendation"\s*:/i);
  assert.match(packet.classification, /no regulatory decision or recommendation/);
  assert.ok(packet.review_rules.some((rule) => /register data reviewer/.test(rule)));
});

test("preserves exact source values and identifies meaningful row differences", () => {
  const group = packet.groups.find((candidate) => candidate.normalized_identifier === "NPC/A0035");
  assert.ok(group);
  assert.ok(group.differing_fields.includes("name"));
  assert.ok(group.differing_fields.includes("province"));
  assert.equal(group.comparison.name.values.length, 2);
  assert.deepEqual(group.source_references, ["retail:547", "retail:641"]);
});

test("binds the pending launch ledger to the synchronized duplicate review inputs", () => {
  assert.equal(reviewLedger.total_records, 51);
  assert.equal(reviewLedger.pending_records, 51);
  assert.equal(reviewLedger.blocked_records, 0);
  assert.deepEqual(reviewLedger.decision_counts, {
    pending: 51,
    accepted_source_duplicate: 0,
    blocked_source_correction: 0,
  });
  assert.equal(reviewLedger.source_digests.review_csv, sha256(reviewCsvFile));
  assert.equal(reviewLedger.source_digests.review_packet, sha256(reviewPacketFile));
  assert.ok(reviewLedger.checks.some((check) => check.name === "Strict duplicate review" && check.status === "blocked"));
});
