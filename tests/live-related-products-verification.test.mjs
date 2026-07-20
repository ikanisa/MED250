import assert from "node:assert/strict";
import test from "node:test";

import { assessLiveRelatedProductEvidence } from "../scripts/verify-live-related-products.mjs";

const record = (id, overrides = {}) => ({
  id,
  kind: "consumer",
  brand: id,
  generic: "",
  strength: "",
  form: "",
  packSize: "",
  manufacturer: "",
  manufacturerCountry: "",
  registrationNumber: "",
  category: "Baby",
  subcategory: "Care",
  productType: "consumer_product",
  prescriptionStatus: "not_applicable",
  regulatoryStatus: "verification_pending",
  isRequestable: true,
  recommendable: true,
  ...overrides,
});

function fixture() {
  const relatedIndex = [
    record("p1"),
    record("p2"),
    record("suppressed-1", { recommendable: false }),
    record("suppressed-2", { recommendable: false }),
  ];
  const liveRows = [{ id: "p1" }, { id: "p2" }];
  const liveIdSha256 = "b98d848751a3c1557a6b378fb3cc331ca8fa3ec54f8e6ab124e70ac897050b13";
  return {
    relatedIndex,
    liveRows,
    deploymentReceipt: {
      status: "passed",
      observedReleaseRevision: "a".repeat(40),
      expectedReleaseRevision: "a".repeat(40),
    },
    catalogueReceipt: { status: "passed", observedTotal: 2, expectedTotal: 2, observedIdSha256: liveIdSha256 },
    releaseRevision: "a".repeat(40),
    expectedLiveTotal: 2,
    expectedIndexTotal: 4,
    suppressedIds: ["suppressed-1", "suppressed-2"],
  };
}

test("reconciles every recommendable record to the exact live release", () => {
  const result = assessLiveRelatedProductEvidence(fixture());
  assert.equal(result.status, "passed");
  assert.equal(result.liveProductCount, 2);
  assert.equal(result.recommendableCount, 2);
  assert.equal(result.totalEdges, 2);
  assert.equal(result.unsafeEdgeCount, 0);
  assert.equal(result.missingLiveCount, 0);
  assert.equal(result.unexpectedLiveCount, 0);
});

test("fails on release drift, population drift, or unsafe recommendation candidates", () => {
  const value = fixture();
  value.deploymentReceipt.observedReleaseRevision = "b".repeat(40);
  value.catalogueReceipt.observedIdSha256 = "0".repeat(64);
  value.liveRows[1] = { id: "unexpected" };
  const result = assessLiveRelatedProductEvidence(value);
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("release revision")));
  assert.ok(result.errors.some((error) => error.includes("missing")));
  assert.ok(result.errors.some((error) => error.includes("outside")));
  assert.ok(result.errors.some((error) => error.includes("digest")));
});
