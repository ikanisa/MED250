import assert from "node:assert/strict";
import test from "node:test";

import {
  governPublicProductMedia,
  isPublicProductMediaHeld,
} from "../lib/product-media-governance.ts";

test("holds a known form-mismatched regulated product image fail-closed", () => {
  assert.equal(isPublicProductMediaHeld("rwanda-fda-hm-1594"), true);
  assert.deepEqual(
    governPublicProductMedia(
      "rwanda-fda-hm-1594",
      "https://example.test/wrong-primary.webp",
      ["https://example.test/wrong-primary.webp", "https://example.test/wrong-secondary.webp"],
    ),
    { imageUrl: null, imageUrls: [] },
  );
});

test("preserves media for products without a governed hold", () => {
  const imageUrls = ["https://example.test/approved.webp"];

  assert.equal(isPublicProductMediaHeld("rwanda-fda-hm-1593"), false);
  assert.deepEqual(
    governPublicProductMedia("rwanda-fda-hm-1593", imageUrls[0], imageUrls),
    { imageUrl: imageUrls[0], imageUrls },
  );
});
