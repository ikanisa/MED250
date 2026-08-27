import assert from "node:assert/strict";
import test from "node:test";

import { boundedSeoText, productMetadataDescription, productMetadataTitle, verifiedAggregateOffer } from "../lib/seo-content.ts";

const baseProduct = {
  brand: "AN EXCESSIVELY LONG PRODUCT NAME WITH A TRAILING PIPE |",
  generic: "example ingredient",
  strength: "500 mg",
  form: "tablet",
  packSize: "20",
  subcategory: "Pain relief",
  isOrderable: true,
};

test("keeps generated metadata bounded and free of broken truncation markers", () => {
  const title = productMetadataTitle(baseProduct);
  const description = productMetadataDescription(baseProduct);
  assert.ok(title.length <= 65);
  assert.ok(description.length <= 160);
  assert.doesNotMatch(`${title}${description}`, /[\u2026\uFFFD]/u);
  assert.doesNotMatch(title, /[|,;:–—-]\s*$/u);
  assert.equal(boundedSeoText("Word ".repeat(100), 65).endsWith("…"), false);
});

test("never turns an indicative catalogue price into offer schema", () => {
  assert.equal(verifiedAggregateOffer({
    ...baseProduct,
    indicativePriceRwf: 2500,
    priceIsIndicative: true,
  }, new Date("2026-08-27T12:00:00Z")), null);
});

test("emits AggregateOffer only for a fresh positive pharmacy-backed record", () => {
  assert.deepEqual(verifiedAggregateOffer({
    ...baseProduct,
    verifiedOfferCount: 3,
    verifiedOfferMinRwf: 2200,
    verifiedOfferMaxRwf: 2700,
    verifiedOfferUpdatedAt: "2026-08-27T10:00:00Z",
  }, new Date("2026-08-27T12:00:00Z")), {
    "@type": "AggregateOffer",
    priceCurrency: "RWF",
    lowPrice: 2200,
    highPrice: 2700,
    offerCount: 3,
    availability: "https://schema.org/InStock",
  });
  assert.equal(verifiedAggregateOffer({
    ...baseProduct,
    verifiedOfferCount: 1,
    verifiedOfferMinRwf: 2200,
    verifiedOfferMaxRwf: 2200,
    verifiedOfferUpdatedAt: "2026-08-25T10:00:00Z",
  }, new Date("2026-08-27T12:00:00Z")), null);
});
