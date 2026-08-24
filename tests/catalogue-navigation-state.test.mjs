import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogueFilterStateKey,
  parseCatalogueNavigationState,
  serializeCatalogueNavigationState,
  withCatalogueReturnPosition,
} from "../lib/catalogue-navigation-state.ts";

const defaults = {
  initialCategory: "All products",
  initialProductCount: 24,
  maxRestoredProductCount: 5000,
};

test("round-trips every catalogue control, loaded depth, and return position", () => {
  const state = {
    search: "  zinc  ",
    category: "Health & Household / Vitamins",
    prescription: "non_prescription",
    form: "tablets",
    availability: "priced",
    sort: "price",
    view: "list",
    shown: 312,
    position: "AMZ-B000052XCI",
  };
  const serialized = serializeCatalogueNavigationState("?campaign=health", state, defaults);
  const restored = parseCatalogueNavigationState(`?${serialized}`, defaults);
  assert.deepEqual(restored, { ...state, search: "zinc" });
  assert.equal(new URLSearchParams(serialized).get("campaign"), "health");
});

test("normalizes hostile or stale URL state without losing unrelated deep links", () => {
  const overlongCategory = "x".repeat(200);
  const restored = parseCatalogueNavigationState(`?category=${overlongCategory}&prescription=invalid&form=invalid&availability=invalid&sort=invalid&view=invalid&shown=999999&position=${"p".repeat(300)}&request=order-1`, defaults);
  assert.equal(restored.category.length, 120);
  assert.equal(restored.prescription, "all");
  assert.equal(restored.form, "all");
  assert.equal(restored.availability, "all");
  assert.equal(restored.sort, "relevance");
  assert.equal(restored.view, "grid");
  assert.equal(restored.shown, 5000);
  assert.equal(restored.position?.length, 160);

  const serialized = serializeCatalogueNavigationState("?request=order-1", restored, defaults);
  assert.equal(new URLSearchParams(serialized).get("request"), "order-1");
});

test("records the selected product and loaded depth before product navigation", () => {
  const remembered = withCatalogueReturnPosition("?search=omeprazole&shown=120", "rwanda-fda-hm-0839", 264);
  const parameters = new URLSearchParams(remembered);
  assert.equal(parameters.get("search"), "omeprazole");
  assert.equal(parameters.get("shown"), "264");
  assert.equal(parameters.get("position"), "rwanda-fda-hm-0839");
});

test("filter identity excludes loaded depth and focus but changes for every result control", () => {
  const base = parseCatalogueNavigationState("?search=zinc&shown=120&position=p1", defaults);
  const sameResults = parseCatalogueNavigationState("?search=zinc&shown=480&position=p9", defaults);
  assert.equal(catalogueFilterStateKey(base), catalogueFilterStateKey(sameResults));

  for (const [key, value] of [
    ["search", "omeprazole"],
    ["category", "Medicines"],
    ["prescription", "prescription"],
    ["form", "liquids"],
    ["availability", "orderable"],
    ["sort", "az"],
    ["view", "list"],
  ]) {
    assert.notEqual(catalogueFilterStateKey(base), catalogueFilterStateKey({ ...base, [key]: value }), key);
  }
});
