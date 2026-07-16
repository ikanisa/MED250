import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMarketplaceProductPayload,
  resolveMarketplaceProductEndpoint,
  runMarketplaceProductAdmin,
} from "../scripts/marketplace-product-admin.mjs";

const id = "AMZ-B004L5JCZ4";
const updatedAt = "2026-07-15T18:00:00.000Z";
const common = ["--product-id", id, "--expected-updated-at", updatedAt, "--reviewed-by", "Marketplace compliance", "--evidence-note", "Verified seller identity and product classification against the linked records."];

test("builds bounded single-product moderation payloads", () => {
  assert.deepEqual(buildMarketplaceProductPayload(["list", "--limit", "100"]), {
    action: "list", status: "research_candidate", category: "", limit: 100,
  });
  assert.deepEqual(buildMarketplaceProductPayload(["inspect", "--product-id", id]), { action: "inspect", product_id: id });
  assert.equal(buildMarketplaceProductPayload(["start-review", ...common]).action, "start_review");
  const approval = buildMarketplaceProductPayload([
    "approve", ...common,
    "--seller-evidence-url", "https://evidence.example/seller/1",
    "--compliance-evidence-url", "https://evidence.example/compliance/1",
  ]);
  assert.equal(approval.product_id, id);
  assert.equal(approval.action, "approve");
  assert.throws(() => buildMarketplaceProductPayload(["approve", ...common]), /seller-evidence-url/);
  assert.throws(() => buildMarketplaceProductPayload(["list", "--limit", "101"]), /1 to 100/);
});

test("keeps the marketplace admin token process-only", async () => {
  const environment = { NEXT_PUBLIC_SUPABASE_URL: "https://uskfnszcdqpcfrhjxitl.supabase.co", MED250_ADMIN_TOKEN: "test-admin-token" };
  let captured;
  await runMarketplaceProductAdmin(["inspect", "--product-id", id], {
    environment,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ product: { id } }), { status: 200 });
    },
  });
  assert.equal(captured.url, "https://uskfnszcdqpcfrhjxitl.supabase.co/functions/v1/review-marketplace-products");
  assert.equal(captured.init.headers["X-MED250-Admin-Token"], environment.MED250_ADMIN_TOKEN);
  assert.equal(JSON.parse(captured.init.body).product_id, id);
  await assert.rejects(runMarketplaceProductAdmin(["inspect", "--product-id", id], { environment: { NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL } }), /MED250_ADMIN_TOKEN/);
  assert.throws(() => resolveMarketplaceProductEndpoint({ SUPABASE_URL: "http://localhost:54321" }), /HTTPS \*\.supabase\.co/);
});

test("protects the Edge reviewer and prohibits batch approval", async () => {
  const [edge, config, migration] = await Promise.all([
    readFile(new URL("../supabase/functions/review-marketplace-products/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715192936_govern_marketplace_product_reviews.sql", import.meta.url), "utf8"),
  ]);
  assert.match(edge, /secretMatches/);
  assert.match(edge, /MED250_ADMIN_TOKEN/);
  assert.match(edge, /X-MED250-Admin-Token/);
  assert.match(edge, /dawanear_review_marketplace_product/);
  assert.match(edge, /p_product_id: productId/);
  assert.doesNotMatch(edge, /batch.*approve/i);
  assert.match(config, /\[functions\.review-marketplace-products\][\s\S]*verify_jwt = false/);
  assert.match(migration, /dawanear_marketplace_product_reviews_immutable/);
  assert.match(migration, /p_expected_updated_at/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (anon|authenticated)/i);
});
