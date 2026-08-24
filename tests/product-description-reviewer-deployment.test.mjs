import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildProductDescriptionReviewerEvidence,
  expectedReviewerContractVersion,
  resolveReviewerVerificationEndpoint,
  verifyProductDescriptionReviewerDeployment,
} from "../scripts/verify-product-description-reviewer-deployment.mjs";

const productId = "rwanda-fda-hm-0001";
const expectedUpdatedAt = "2026-07-18T12:00:00.000Z";
const environment = {
  MED250_DEPLOYMENT_ORIGIN: "https://med250-marketplace-staging.ikanisa.workers.dev",
  MED250_ADMIN_TOKEN: "private-admin-token-with-at-least-32-bytes",
};
const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json",
  "x-med250-operator-contract": expectedReviewerContractVersion,
};

function reviewerFetch({
  unauthenticatedStatus = 401,
  authenticatedStatus = 200,
  product = { id: productId, updated_at: expectedUpdatedAt },
  headers = responseHeaders,
} = {}) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      if (!init.headers.Authorization) {
        return new Response("Forbidden", { status: unauthenticatedStatus, headers });
      }
      if (authenticatedStatus !== 200) {
        return new Response("Sensitive upstream failure body.", { status: authenticatedStatus, headers });
      }
      return new Response(JSON.stringify({
        product: {
          ...product,
          description: "Sensitive draft description that must never enter verification output.",
        },
        reviews: [{ review_note: "Sensitive reviewer note that must never enter verification output." }],
      }), { status: 200, headers });
    },
  };
}

test("binds the protected read-only probe to the live database and reviewer contracts", async () => {
  const probe = reviewerFetch();
  const result = await verifyProductDescriptionReviewerDeployment({
    productId,
    expectedUpdatedAt,
    environment,
    fetchImpl: probe.fetchImpl,
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(result.errors, []);
  assert.equal(result.unauthenticated.status, 401);
  assert.equal(result.authenticated.status, 200);
  assert.equal(result.authenticated.operatorContract, expectedReviewerContractVersion);
  assert.equal(probe.requests.length, 2);
  assert.equal(probe.requests[0].url, "https://med250-marketplace-staging.ikanisa.workers.dev/api/internal/operator/descriptions");
  assert.equal(probe.requests[0].init.headers.Authorization, undefined);
  assert.equal(probe.requests[1].init.headers.Authorization, `Bearer ${environment.MED250_ADMIN_TOKEN}`);
  assert.deepEqual(JSON.parse(probe.requests[1].init.body), { action: "inspect", product_id: productId });
});

test("fails closed on unauthenticated access, contract drift, or a different product version", async () => {
  const probe = reviewerFetch({
    unauthenticatedStatus: 200,
    product: { id: "rwanda-fda-hm-0002", updated_at: "2026-07-18T12:01:00.000Z" },
    headers: {
      ...responseHeaders,
      "x-med250-operator-contract": "stale-operator-contract",
    },
  });
  const result = await verifyProductDescriptionReviewerDeployment({
    productId,
    expectedUpdatedAt,
    environment,
    fetchImpl: probe.fetchImpl,
  });

  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("expected HTTP 401")));
  assert.ok(result.errors.some((error) => error.includes("operator contract header")));
  assert.ok(result.errors.some((error) => error.includes("different product")));
  assert.ok(result.errors.some((error) => error.includes("unexpected product version")));
});

test("fails without retaining an authenticated reviewer error body", async () => {
  const probe = reviewerFetch({ authenticatedStatus: 503 });
  const result = await verifyProductDescriptionReviewerDeployment({
    productId,
    expectedUpdatedAt,
    environment,
    fetchImpl: probe.fetchImpl,
  });
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("expected HTTP 200, received 503")));
  assert.doesNotMatch(JSON.stringify(result), /Sensitive upstream failure body/);
});

test("builds a body-free receipt that cannot retain credentials or draft content", async () => {
  const probe = reviewerFetch();
  const result = await verifyProductDescriptionReviewerDeployment({
    productId,
    expectedUpdatedAt,
    environment,
    fetchImpl: probe.fetchImpl,
  });
  const evidence = buildProductDescriptionReviewerEvidence({
    result,
    capturedAt: "2026-07-18T14:00:00.000Z",
    verifierSha256: "a".repeat(64),
  });
  const serialized = JSON.stringify({ result, evidence });

  assert.equal(evidence.status, "passed");
  assert.equal(evidence.probeAction, "inspect");
  assert.equal(evidence.responseBodiesRetained, false);
  assert.equal(evidence.productIdSha256.length, 64);
  assert.equal(Object.hasOwn(evidence, "productId"), false);
  assert.doesNotMatch(serialized, /private-admin-token/);
  assert.doesNotMatch(serialized, /Sensitive draft|Sensitive reviewer note/);
});

test("accepts only a clean MED250 Worker origin and a process-only operator token", async () => {
  assert.equal(
    resolveReviewerVerificationEndpoint(environment).href,
    "https://med250-marketplace-staging.ikanisa.workers.dev/api/internal/operator/descriptions",
  );
  assert.throws(
    () => resolveReviewerVerificationEndpoint({ MED250_DEPLOYMENT_ORIGIN: "https://med-250.com/path?token=secret" }),
    /without a path|credentials/,
  );
  await assert.rejects(
    verifyProductDescriptionReviewerDeployment({
      productId,
      expectedUpdatedAt,
      environment: { MED250_DEPLOYMENT_ORIGIN: environment.MED250_DEPLOYMENT_ORIGIN },
    }),
    /MED250_ADMIN_TOKEN/,
  );

  const source = await readFile(new URL("../scripts/verify-product-description-reviewer-deployment.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /--admin-token/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*adminToken/);
  assert.doesNotMatch(source, /supabase|neon/i);
});
