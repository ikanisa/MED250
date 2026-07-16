import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildContactReviewPayload,
  resolveContactReviewEndpoint,
  runContactReviewAdmin,
} from "../scripts/pharmacy-contact-admin.mjs";

const requestId = "22222222-2222-4222-8222-222222222222";
const environment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://uskfnszcdqpcfrhjxitl.supabase.co",
  DAWANEAR_ADMIN_TOKEN: "test-admin-token",
};

test("builds bounded list and single-request contact reviews", () => {
  assert.deepEqual(buildContactReviewPayload(["list", "--limit", "50"]), { action: "list", limit: 50 });
  assert.deepEqual(buildContactReviewPayload(["inspect", "--request-id", requestId]), { action: "inspect", request_id: requestId });
  assert.deepEqual(buildContactReviewPayload([
    "approve", "--request-id", requestId, "--reviewed-by", "Operations reviewer",
    "--review-note", "Verified directly with the licensed pharmacy manager.",
  ]), {
    action: "approve",
    request_id: requestId,
    reviewed_by: "Operations reviewer",
    review_note: "Verified directly with the licensed pharmacy manager.",
  });
  assert.throws(() => buildContactReviewPayload(["list", "--limit", "51"]), /1 to 50/);
  assert.throws(() => buildContactReviewPayload(["approve", "--request-id", requestId, "--limit", "2"]), /Unsupported option/);
});

test("keeps the contact-review admin token process-only", async () => {
  let captured;
  await runContactReviewAdmin(["inspect", "--request-id", requestId], {
    environment,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ request: { id: requestId } }), { status: 200 });
    },
  });
  assert.equal(captured.url, "https://uskfnszcdqpcfrhjxitl.supabase.co/functions/v1/review-pharmacy-contacts");
  assert.equal(captured.init.headers["X-DawaNear-Admin-Token"], environment.DAWANEAR_ADMIN_TOKEN);
  assert.equal(JSON.parse(captured.init.body).request_id, requestId);
  await assert.rejects(
    runContactReviewAdmin(["inspect", "--request-id", requestId], { environment: { NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL } }),
    /DAWANEAR_ADMIN_TOKEN/,
  );
  assert.throws(() => resolveContactReviewEndpoint({ SUPABASE_URL: "http://localhost:54321" }), /HTTPS \*\.supabase\.co/);
});

test("keeps contact-review Edge access custom-token protected and one-request-at-a-time", async () => {
  const [edge, config] = await Promise.all([
    readFile(new URL("../supabase/functions/review-pharmacy-contacts/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  assert.match(edge, /secretMatches/);
  assert.match(edge, /DAWANEAR_ADMIN_TOKEN/);
  assert.match(edge, /Action must be list, inspect, approve, or reject/);
  assert.match(edge, /dawanear_review_pharmacy_contact_edit/);
  assert.match(edge, /p_request_id: requestId/);
  assert.doesNotMatch(edge, /batch.*approve/i);
  assert.match(config, /\[functions\.review-pharmacy-contacts\][\s\S]*verify_jwt = false/);
});
