import assert from "node:assert/strict";
import test from "node:test";

import { isCatalogueIntentActive } from "../lib/marketplace-view-state.ts";

const landingState = {
  query: "",
  initialCategory: "All products",
  category: "All products",
  prescription: "all",
  form: "all",
  availability: "all",
  sort: "relevance",
  view: "grid",
};

test("keeps landing content only for the untouched catalogue", () => {
  assert.equal(isCatalogueIntentActive(landingState), false);
});

test("switches to task-first results for every search and filter control", () => {
  for (const [key, value] of [
    ["query", "omeprazole"],
    ["category", "Medicines"],
    ["prescription", "prescription"],
    ["form", "tablets"],
    ["availability", "orderable"],
    ["sort", "az"],
    ["view", "list"],
  ]) {
    assert.equal(isCatalogueIntentActive({ ...landingState, [key]: value }), true, key);
  }
});

test("ignores whitespace-only search input", () => {
  assert.equal(isCatalogueIntentActive({ ...landingState, query: "   " }), false);
});
