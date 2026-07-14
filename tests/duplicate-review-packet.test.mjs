import assert from "node:assert/strict";
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
});

test("preserves exact source values and identifies meaningful row differences", () => {
  const group = packet.groups.find((candidate) => candidate.normalized_identifier === "NPC/A0035");
  assert.ok(group);
  assert.ok(group.differing_fields.includes("name"));
  assert.ok(group.differing_fields.includes("province"));
  assert.equal(group.comparison.name.values.length, 2);
  assert.deepEqual(group.source_references, ["retail:547", "retail:641"]);
});
