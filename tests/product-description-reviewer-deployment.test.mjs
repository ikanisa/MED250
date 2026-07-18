import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildProductDescriptionReviewerEvidence,
  expectedReviewerContractVersion,
  resolveReviewerVerificationEndpoint,
  verifyProductDescriptionReviewerDeployment,
} from "../scripts/verify-product-description-reviewer-deployment.mjs";
import { expectedBackendContractVersion } from "../scripts/backend-contract-invariants.mjs";

const productId = "rwanda-fda-hm-0001";
const expectedUpdatedAt = "2026-07-18T12:00:00.000Z";
const environment = {
  SUPABASE_URL: "https://uskfnszcdqpcfrhjxitl.supabase.co",
  SUPABASE_SECRET_KEY: "private-service-key",
  MED250_ADMIN_TOKEN: "private-admin-token",
};
const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json",
  "x-med250-backend-contract": expectedBackendContractVersion,
  "x-med250-reviewer-contract": expectedReviewerContractVersion,
};

function backendPassed() {
  return {
    status: "passed",
    expectedVersion: expectedBackendContractVersion,
    observedVersion: expectedBackendContractVersion,
    failures: [],
    contract: { contract_version: expectedBackendContractVersion },
  };
}

function reviewerFetch({
  unauthenticatedStatus = 403,
  authenticatedStatus = 200,
  product = { id: productId, updated_at: expectedUpdatedAt },
  headers = responseHeaders,
} = {}) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      if (!init.headers["X-MED250-Admin-Token"]) {
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
    backendVerifier: async () => backendPassed(),
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(result.errors, []);
  assert.equal(result.unauthenticated.status, 403);
  assert.equal(result.authenticated.status, 200);
  assert.equal(result.observedBackendContractVersion, expectedBackendContractVersion);
  assert.equal(result.authenticated.reviewerContract, expectedReviewerContractVersion);
  assert.equal(probe.requests.length, 2);
  assert.equal(probe.requests[0].url, "https://uskfnszcdqpcfrhjxitl.supabase.co/functions/v1/review-product-descriptions");
  assert.equal(probe.requests[0].init.headers["X-MED250-Admin-Token"], undefined);
  assert.equal(probe.requests[1].init.headers["X-MED250-Admin-Token"], environment.MED250_ADMIN_TOKEN);
  assert.deepEqual(JSON.parse(probe.requests[1].init.body), { action: "inspect", product_id: productId });
});

test("fails closed on unauthenticated access, contract drift, or a different product version", async () => {
  const probe = reviewerFetch({
    unauthenticatedStatus: 200,
    product: { id: "rwanda-fda-hm-0002", updated_at: "2026-07-18T12:01:00.000Z" },
    headers: {
      ...responseHeaders,
      "x-med250-reviewer-contract": "stale-reviewer-contract",
    },
  });
  const result = await verifyProductDescriptionReviewerDeployment({
    productId,
    expectedUpdatedAt,
    environment,
    fetchImpl: probe.fetchImpl,
    backendVerifier: async () => backendPassed(),
  });

  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("expected HTTP 403")));
  assert.ok(result.errors.some((error) => error.includes("reviewer contract header")));
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
    backendVerifier: async () => backendPassed(),
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
    backendVerifier: async () => backendPassed(),
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
  assert.doesNotMatch(serialized, /private-service-key|private-admin-token/);
  assert.doesNotMatch(serialized, /Sensitive draft|Sensitive reviewer note/);
});

test("accepts only a clean Supabase origin and process-only credentials", async () => {
  assert.equal(
    resolveReviewerVerificationEndpoint(environment).href,
    "https://uskfnszcdqpcfrhjxitl.supabase.co/functions/v1/review-product-descriptions",
  );
  assert.throws(
    () => resolveReviewerVerificationEndpoint({ SUPABASE_URL: "https://uskfnszcdqpcfrhjxitl.supabase.co/path?token=secret" }),
    /HTTPS \*\.supabase\.co origin/,
  );
  await assert.rejects(
    verifyProductDescriptionReviewerDeployment({
      productId,
      expectedUpdatedAt,
      environment: { SUPABASE_URL: environment.SUPABASE_URL, SUPABASE_SECRET_KEY: environment.SUPABASE_SECRET_KEY },
    }),
    /MED250_ADMIN_TOKEN/,
  );

  const source = await readFile(new URL("../scripts/verify-product-description-reviewer-deployment.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /--(?:admin-token|service-key)/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:adminToken|secretKey)/);
});
