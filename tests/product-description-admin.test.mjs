import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildProductDescriptionReviewPayload,
  resolveProductDescriptionReviewEndpoint,
  runProductDescriptionAdmin,
} from "../scripts/product-description-admin.mjs";

const productId = "rwanda-fda-hm-0001";
const expectedUpdatedAt = "2026-07-18T12:00:00.000Z";
const reviewedAt = "2026-07-18T13:00:00+02:00";
const description = "A source-reviewed product description with bounded, customer-relevant information.";
const sourceBytes = Buffer.from("Exact reviewed source bytes for the owner-approved public description.\n", "utf8");

const shared = [
  "--product-id", productId,
  "--expected-updated-at", expectedUpdatedAt,
  "--reviewed-by", "Named reviewer",
  "--reviewed-role", "Clinical and rights reviewer",
  "--reviewed-at", reviewedAt,
  "--review-note", "Checked the exact source wording, rights evidence, and public-use boundary.",
];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "med250-description-review-"));
  const descriptionFile = join(directory, "description.txt");
  const sourceFile = join(directory, "source.txt");
  await writeFile(descriptionFile, description, "utf8");
  await writeFile(sourceFile, sourceBytes);
  return { directory, descriptionFile, sourceFile };
}

function approvalArgs(files) {
  return [
    "approve", ...shared,
    "--description-file", files.descriptionFile,
    "--source-file", files.sourceFile,
    "--source-name", "Rwanda FDA product record",
    "--source-url", "https://rwandafda.gov.rw/product/1",
    "--rights-basis", "Written reuse approval for the exact reviewed source text.",
    "--rights-reference", "approval:description:1:2026-07-18",
    "--rights-verified", "yes",
    "--clinical-review-status", "approved",
  ];
}

test("builds one approval from exact local source bytes and computes its SHA-256", async () => {
  const files = await fixture();
  try {
    const payload = await buildProductDescriptionReviewPayload(approvalArgs(files));
    assert.equal(payload.action, "approve");
    assert.equal(payload.product_id, productId);
    assert.equal(payload.description, description);
    assert.equal(payload.source_sha256, createHash("sha256").update(sourceBytes).digest("hex"));
    assert.equal(payload.rights_verified, true);
    assert.equal(payload.clinical_review_status, "approved");
    assert.equal(Object.hasOwn(payload, "description_file"), false);
    assert.equal(Object.hasOwn(payload, "source_file"), false);
  } finally {
    await rm(files.directory, { recursive: true, force: true });
  }
});

test("builds a bounded withdrawal and rejects incomplete or silently assumed approval evidence", async () => {
  const withdrawal = await buildProductDescriptionReviewPayload(["withdraw", ...shared]);
  assert.deepEqual(withdrawal, {
    action: "withdraw",
    product_id: productId,
    expected_updated_at: expectedUpdatedAt,
    reviewed_by: "Named reviewer",
    reviewed_role: "Clinical and rights reviewer",
    reviewed_at: reviewedAt,
    review_note: "Checked the exact source wording, rights evidence, and public-use boundary.",
  });

  const files = await fixture();
  try {
    const missingRights = approvalArgs(files);
    missingRights[missingRights.indexOf("yes")] = "no";
    await assert.rejects(buildProductDescriptionReviewPayload(missingRights), /rights-verified must be yes/);
    await writeFile(files.descriptionFile, `${description}\n`, "utf8");
    await assert.rejects(buildProductDescriptionReviewPayload(approvalArgs(files)), /trimmed characters without control/);
  } finally {
    await rm(files.directory, { recursive: true, force: true });
  }
});

test("keeps the admin token process-only and sends one protected review request", async () => {
  const environment = {
    MED250_OPERATOR_ORIGIN: "https://staging.med-250.com",
    MED250_ADMIN_TOKEN: "test-description-admin-token-32!!",
  };
  let captured;
  const result = await runProductDescriptionAdmin(["inspect", "--product-id", productId], {
    environment,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ product: { id: productId } }), { status: 200 });
    },
  });
  assert.equal(result.product.id, productId);
  assert.equal(captured.url, "https://staging.med-250.com/api/internal/operator/descriptions");
  assert.equal(captured.init.headers.Authorization, `Bearer ${environment.MED250_ADMIN_TOKEN}`);
  assert.deepEqual(JSON.parse(captured.init.body), { action: "inspect", product_id: productId });
  await assert.rejects(
    runProductDescriptionAdmin(["inspect", "--product-id", productId], { environment: { MED250_OPERATOR_ORIGIN: environment.MED250_OPERATOR_ORIGIN } }),
    /MED250_ADMIN_TOKEN/,
  );
  assert.throws(
    () => resolveProductDescriptionReviewEndpoint({ MED250_OPERATOR_ORIGIN: "http://localhost:8787" }),
    /HTTPS origin/,
  );
});

test("protects the Edge reviewer and prohibits batch publication", async () => {
  const [edge, config, migration] = await Promise.all([
    readFile(new URL("../supabase/functions/review-product-descriptions/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260718143000_govern_product_description_reviews.sql", import.meta.url), "utf8"),
  ]);
  assert.match(edge, /secretMatches/);
  assert.match(edge, /MED250_ADMIN_TOKEN/);
  assert.match(edge, /X-MED250-Admin-Token/);
  assert.match(edge, /X-MED250-Backend-Contract/);
  assert.match(edge, /X-MED250-Reviewer-Contract/);
  assert.match(edge, /product-description-reviewer-2026-07-18\.1/);
  assert.match(edge, /Cache-Control.*no-store/s);
  assert.match(edge, /dawanear_review_product_description/);
  assert.match(edge, /p_product_id: productId/);
  assert.doesNotMatch(edge, /batch.*approve/i);
  assert.match(config, /\[functions\.review-product-descriptions\][\s\S]*verify_jwt = false/);
  assert.match(migration, /dawanear_product_description_reviews_immutable/);
  assert.match(migration, /dawanear_products_description_audit_required/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (anon|authenticated)/i);
});
