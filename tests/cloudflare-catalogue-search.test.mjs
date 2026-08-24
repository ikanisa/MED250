import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { CatalogueRepository, rankFuzzyCatalogueCandidates } from "../worker/backend/catalogue-repository.ts";

function d1(database) {
  return {
    prepare(sql) {
      let bindings = [];
      const statement = {
        bind(...values) { bindings = values; return statement; },
        async all() { return { success: true, results: database.prepare(sql).all(...bindings) }; },
        async first() { return database.prepare(sql).get(...bindings) ?? null; },
      };
      return statement;
    },
  };
}

function input(overrides = {}) {
  return {
    query: "",
    category: "All products",
    prescriptionStatus: "all",
    formGroup: "all",
    availability: "all",
    sort: "relevance",
    limit: 24,
    offset: 0,
    ...overrides,
  };
}

test("ranks bounded close-spelling candidates deterministically", () => {
  const matches = rankFuzzyCatalogueCandidates([
    { id: "p1", brand_name: "Brinzox", generic_name: "Brinzolamide / Timolol", indicative_price_rwf: null },
    { id: "p2", brand_name: "Panadol", generic_name: "Paracetamol", indicative_price_rwf: 1000 },
  ], "brinzolamde", "relevance");
  assert.deepEqual(matches.map(({ id }) => id), ["p1"]);
});

test("restores D1 typo recovery while preserving visible and orderable catalogue boundaries", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../db/d1/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((value) => value.endsWith(".sql")).sort()) {
      database.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    const now = "2026-08-23T00:00:00.000Z";
    database.exec(`INSERT INTO med250_catalogue_products (
      id, source_kind, source_name, brand_name, generic_name, product_type, category,
      department, prescription_status, regulatory_status, publication_status,
      is_orderable, is_active, created_at, updated_at
    ) VALUES
      ('p1', 'local_governed_snapshot', 'Fixture', 'Brinzox', 'Brinzolamide / Timolol', 'medicine', 'Medicines', 'Medicines', 'prescription', 'valid', 'approved', 1, 1, '${now}', '${now}'),
      ('p2', 'local_governed_snapshot', 'Fixture', 'Panadol', 'Paracetamol', 'medicine', 'Medicines', 'Medicines', 'non_prescription', 'valid', 'approved', 1, 1, '${now}', '${now}'),
      ('p3', 'local_governed_snapshot', 'Fixture', 'Grace medicine', 'Example', 'medicine', 'Medicines', 'Medicines', 'unclassified', 'grace_period', 'approved', 0, 1, '${now}', '${now}');`);
    const repository = new CatalogueRepository(d1(database));
    const typo = await repository.search(input({ query: "brinzolamde", availability: "orderable" }));
    assert.equal(typo.total, 1);
    assert.equal(typo.products[0]?.id, "p1");
    assert.equal(typo.products[0]?.match_explanation, "Close spelling match");
    assert.equal((await repository.search(input({ availability: "all" }))).total, 3);
    assert.equal((await repository.search(input({ availability: "orderable" }))).total, 2);
  } finally {
    database.close();
  }
});
