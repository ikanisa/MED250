import assert from "node:assert/strict";
import test from "node:test";

import { buildLegacyRedirect } from "../cloudflare/legacy-redirect/src/index.mjs";

test("redirects the historical hostname to the canonical origin with path and query intact", async () => {
  const response = buildLegacyRedirect(new Request(
    "https://med250.gikundiro.com/categories?search=paracetamol&view=list",
  ));

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://med-250.com/categories?search=paracetamol&view=list",
  );
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(await response.text(), "");
});

test("fails closed when invoked for any hostname outside the redirect-only contract", async () => {
  const response = buildLegacyRedirect(new Request("https://example.com/product/rwanda-fda-hm-0734"));

  assert.equal(response.status, 421);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("location"), null);
});
