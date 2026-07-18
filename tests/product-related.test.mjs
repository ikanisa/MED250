import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectRelatedCatalogueRecords } from "../lib/product-related.ts";

const index = JSON.parse(await readFile(new URL("../data/product-related-index.json", import.meta.url), "utf8"));

const record = (overrides = {}) => ({
  id: "candidate",
  kind: "consumer",
  brand: "Candidate",
  generic: "",
  strength: "",
  form: "",
  packSize: "",
  manufacturer: "",
  manufacturerCountry: "",
  registrationNumber: "",
  category: "Baby",
  subcategory: "Baby Care",
  productType: "Baby Wash",
  prescriptionStatus: "not_applicable",
  regulatoryStatus: "verification_pending",
  isRequestable: true,
  recommendable: true,
  ...overrides,
});

test("publishes the complete requestable recommendation population", () => {
  assert.equal(index.length, 4_659);
  assert.equal(new Set(index.map(({ id }) => id)).size, 4_659);
  assert.equal(index.filter(({ kind }) => kind === "medicine").length, 2_459);
  assert.equal(index.filter(({ kind }) => kind === "consumer").length, 2_200);
  assert.ok(index.every(({ isRequestable, brand, category }) => isRequestable === true && brand && category));
  assert.ok(index.every(({ brand, generic }) => !/amazon/i.test(`${brand} ${generic}`)));
  assert.deepEqual(index.filter(({ recommendable }) => !recommendable).map(({ id }) => id), ["AMZ-032380909X", "AMZ-B01K1S6AHM"]);
});

test("consumer similarity stays inside the governed category and subcategory", () => {
  const seed = record({ id: "seed", brand: "Seed", kind: "consumer" });
  const matches = selectRelatedCatalogueRecords(seed, [
    record({ id: "same-product", brand: "Seed" }),
    record({ id: "same-taxonomy", brand: "Other" }),
    record({ id: "wrong-subcategory", brand: "Other 2", subcategory: "Feeding" }),
    record({ id: "wrong-kind", brand: "Other 3", kind: "medicine" }),
    record({ id: "not-requestable", brand: "Other 4", isRequestable: false }),
  ]);
  assert.deepEqual(matches.map(({ id }) => id), ["same-taxonomy"]);
});

test("medicine similarity requires recorded ingredient, form and dose compatibility", () => {
  const seed = record({
    id: "medicine-seed",
    kind: "medicine",
    brand: "Brand A",
    generic: "Paracetamol 500 mg",
    strength: "500 mg",
    form: "Tablet",
    category: "Medicines",
    subcategory: "",
    productType: "human_medicine",
    prescriptionStatus: "non_prescription",
  });
  const matches = selectRelatedCatalogueRecords(seed, [
    record({ ...seed, id: "exact", brand: "Brand B" }),
    record({ ...seed, id: "different-strength", brand: "Brand C", generic: "Paracetamol 250 mg", strength: "250 mg" }),
    record({ ...seed, id: "different-form", brand: "Brand D", form: "Syrup" }),
    record({ ...seed, id: "prescription-conflict", brand: "Brand E", prescriptionStatus: "prescription" }),
    record({ ...seed, id: "non-requestable", brand: "Brand F", isRequestable: false }),
  ]);
  assert.deepEqual(matches.map(({ id }) => id), ["exact"]);
});

test("medicine similarity fails closed when dosage evidence is absent", () => {
  const seed = record({ id: "seed", kind: "medicine", category: "Medicines", subcategory: "", productType: "human_medicine", generic: "Paracetamol", form: "Tablet" });
  assert.deepEqual(selectRelatedCatalogueRecords(seed, [record({ ...seed, id: "candidate", brand: "Other" })]), []);
});

test("known non-product source exceptions never seed or enter recommendations", () => {
  const seed = record({ id: "suppressed-seed", recommendable: false });
  assert.deepEqual(selectRelatedCatalogueRecords(seed, [record({ id: "otherwise-related" })]), []);
  const allowedSeed = record({ id: "allowed-seed", brand: "Allowed" });
  assert.deepEqual(selectRelatedCatalogueRecords(allowedSeed, [record({ id: "suppressed-candidate", brand: "Suppressed", recommendable: false })]), []);
});

test("the server integration uses the full governed index and conservative selector", async () => {
  const source = await readFile(new URL("../lib/product-seo.ts", import.meta.url), "utf8");
  assert.match(source, /product-related-index\.json/);
  assert.match(source, /selectRelatedCatalogueRecords/);
  assert.doesNotMatch(source, /candidate\.category === product\.category/);
});
