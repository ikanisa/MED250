import assert from "node:assert/strict";
import test from "node:test";

import {
  customerProductTitle,
  officialCatalogueTitle,
  removeProhibitedMarketplaceReference,
} from "../lib/product-display.ts";

test("sentence-cases all-capital catalogue titles while preserving controlled acronyms", () => {
  assert.equal(customerProductTitle("IBUPAR CAPLETS 400mg/325mg"), "Ibupar caplets 400mg/325mg");
  assert.equal(customerProductTitle("0.9% SODIUM CHLORIDE INJECTION BP"), "0.9% Sodium chloride injection BP");
  assert.equal(customerProductTitle("ORS SACHETS"), "ORS sachets");
  assert.equal(customerProductTitle("RL"), "RL");
});

test("does not rewrite mixed-case source titles and keeps an exact normalized official value", () => {
  assert.equal(customerProductTitle("Aveeno Baby Daily Care"), "Aveeno Baby Daily Care");
  assert.equal(officialCatalogueTitle("  IBUPAR   CAPLETS  "), "IBUPAR CAPLETS");
});

test("uses a concise customer title while keeping the full official source title available", () => {
  const official = "Aveeno Baby Daily Moisture Gentle Baby Body Wash and Shampoo with Oat Extract, 2-in-1 Baby Wash and Hair Shampoo, Tear-Free, Paraben-Free for Sensitive Skin and Hair, Lightly Scented, 18 Fl Oz";
  assert.equal(customerProductTitle(official), "Aveeno Baby Daily Moisture Gentle Baby Body Wash and Shampoo with Oat Extract");
  assert.equal(officialCatalogueTitle(official), official);
});

test("removes broken terminal separators and replacement characters without adding ellipses", () => {
  assert.equal(customerProductTitle("IBUPAR TABLETS |"), "Ibupar tablets");
  assert.equal(customerProductTitle("Vitamin C \uFFFD |"), "Vitamin C");
  assert.doesNotMatch(customerProductTitle("A very long product title ".repeat(12)), /…/u);
});

test("removes prohibited marketplace references from every product-title form", () => {
  assert.equal(
    removeProhibitedMarketplaceReference("Amazon Basics Digital Thermometer"),
    "Basics Digital Thermometer",
  );
  assert.equal(
    officialCatalogueTitle("Sensodyne Toothpaste, Amazon Exclusive, Cool Mint"),
    "Sensodyne Toothpaste, Exclusive, Cool Mint",
  );
  assert.equal(
    customerProductTitle("Atralia Amazonas Avalanche Perfume"),
    "Atralia Avalanche Perfume",
  );
  assert.doesNotMatch(customerProductTitle("Amazon Essentials Nursing Top"), /amazon/i);
});
