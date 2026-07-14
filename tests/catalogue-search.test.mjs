import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(new URL("../lib/catalogue-search.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const search = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function product(overrides = {}) {
  return {
    id: "product-1",
    brand: "Panadol",
    generic: "Paracetamol",
    strength: "500 mg",
    form: "Tablet",
    packSize: "20 tablets",
    category: "Pain & fever",
    productType: "human_medicine",
    prescriptionStatus: "non_prescription",
    regulatoryStatus: "valid",
    min: 0,
    max: 0,
    priceContributors: 0,
    imageUrl: null,
    isOrderable: true,
    ...overrides,
  };
}

test("ranks exact active ingredients above related catalogue terms", () => {
  const exact = search.searchCatalogueProduct(
    search.indexCatalogueProduct(product()),
    "paracetamol",
  );
  const related = search.searchCatalogueProduct(
    search.indexCatalogueProduct(product({ id: "product-2", brand: "Pain relief pack", generic: "Ibuprofen" })),
    "paracetamol",
  );

  assert.equal(exact?.explanation, "Exact active ingredient");
  assert.ok(exact && (!related || exact.score > related.score));
});

test("understands Kinyarwanda and French common-use aliases", () => {
  const indexed = search.indexCatalogueProduct(product());
  const kinyarwanda = search.searchCatalogueProduct(indexed, "ububabare");
  const french = search.searchCatalogueProduct(indexed, "douleur");

  assert.ok(kinyarwanda, "Kinyarwanda pain query should find paracetamol");
  assert.ok(french, "French pain query should find paracetamol");
  assert.equal(kinyarwanda.explanation, "Related term match");
});

test("ranks an exact multilingual intent alias above an unrelated spelling match", () => {
  const painMedicine = search.searchCatalogueProduct(
    search.indexCatalogueProduct(product()),
    "umutwe",
  );
  const spellingDecoy = search.searchCatalogueProduct(
    search.indexCatalogueProduct(product({
      id: "product-decoy",
      brand: "Novorapid Flexpen",
      generic: "Insulin aspart",
      category: "Diabetes care",
    })),
    "umutwe",
  );

  assert.ok(painMedicine, "Kinyarwanda headache intent should find paracetamol");
  assert.ok(!spellingDecoy || painMedicine.score > spellingDecoy.score);
});

test("recovers a clinically meaningful product typo without accepting noise", () => {
  const eyeDrops = search.indexCatalogueProduct(product({
    id: "product-3",
    brand: "Brinzotim",
    generic: "Brinzolamide / Timolol",
    strength: "10 mg/mL / 5 mg/mL",
    form: "Eye drops solution",
    category: "Medicines",
  }));

  const typo = search.searchCatalogueProduct(eyeDrops, "brinzolamde");
  const noise = search.searchCatalogueProduct(eyeDrops, "banana cereal");
  assert.ok(typo);
  assert.equal(typo.explanation, "Close spelling match");
  assert.equal(noise, null);
});

test("groups dosage forms for the marketplace filters", () => {
  assert.equal(search.catalogueFormGroup(product()), "tablets");
  assert.equal(search.catalogueFormGroup(product({ form: "Oral suspension" })), "liquids");
  assert.equal(search.catalogueFormGroup(product({ form: "Cream for topical use" })), "topical");
  assert.equal(search.catalogueFormGroup(product({ form: "Metered dose inhaler" })), "devices");
});
