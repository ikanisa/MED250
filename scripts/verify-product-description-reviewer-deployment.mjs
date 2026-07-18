import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expectedBackendContractVersion } from "./backend-contract-invariants.mjs";
import { verifyBackendContract } from "./verify-backend-contract.mjs";

export const expectedReviewerContractVersion = "product-description-reviewer-2026-07-18.1";

const productIdPattern = /^(?:rwanda-fda-hm-[0-9]{4}|AMZ-[A-Z0-9]{10})$/;
const timezoneTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readArguments(values) {
  const result = { productId: "", expectedUpdatedAt: "", evidenceOutput: "" };
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--product-id") result.productId = value;
    else if (flag === "--expected-updated-at") result.expectedUpdatedAt = value;
    else if (flag === "--evidence-output") result.evidenceOutput = value;
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!productIdPattern.test(result.productId)) {
    throw new Error("--product-id must be one governed MED+250 product ID.");
  }
  if (!timezoneTimestampPattern.test(result.expectedUpdatedAt) || !Number.isFinite(Date.parse(result.expectedUpdatedAt))) {
    throw new Error("--expected-updated-at must be the exact timezone-qualified timestamp returned by inspect.");
  }
  return result;
}

export function resolveReviewerVerificationEndpoint(environment = process.env) {
  const rawUrl = String(environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!rawUrl) throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required.");
  let base;
  try { base = new URL(rawUrl); }
  catch { throw new Error("The Supabase URL must be an HTTPS *.supabase.co origin."); }
  if (
    base.protocol !== "https:"
    || !base.hostname.endsWith(".supabase.co")
    || base.username
    || base.password
    || base.search
    || base.hash
    || !new Set(["", "/"]).has(base.pathname)
  ) {
    throw new Error("The Supabase URL must be an HTTPS *.supabase.co origin.");
  }
  return new URL("/functions/v1/review-product-descriptions", base);
}

function reviewerHeaders(response) {
  return {
    backendContract: response.headers.get("x-med250-backend-contract"),
    reviewerContract: response.headers.get("x-med250-reviewer-contract"),
    cacheControl: response.headers.get("cache-control"),
  };
}

function assessHeaders(headers, label, errors) {
  if (headers.backendContract !== expectedBackendContractVersion) {
    errors.push(`${label}: reviewer backend-contract header does not match ${expectedBackendContractVersion}`);
  }
  if (headers.reviewerContract !== expectedReviewerContractVersion) {
    errors.push(`${label}: reviewer contract header does not match ${expectedReviewerContractVersion}`);
  }
  if (!headers.cacheControl?.toLowerCase().includes("no-store")) {
    errors.push(`${label}: reviewer response is not marked no-store`);
  }
}

async function cancelBody(response) {
  try { await response.body?.cancel(); }
  catch { /* Best-effort disposal; no response content is retained. */ }
}

async function boundedJson(response, limit = 256 * 1024) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) throw new Error("Authenticated inspect response exceeded the verification limit.");
  const raw = await response.text();
  const bytes = Buffer.byteLength(raw);
  if (bytes > limit) throw new Error("Authenticated inspect response exceeded the verification limit.");
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error("Authenticated inspect response was not valid JSON."); }
  return { value, bytes };
}

function requestOptions(payload, adminToken = "") {
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(adminToken ? { "X-MED250-Admin-Token": adminToken } : {}),
    },
    body: payload,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  };
}

export async function verifyProductDescriptionReviewerDeployment({
  productId,
  expectedUpdatedAt,
  environment = process.env,
  fetchImpl = fetch,
  backendVerifier = verifyBackendContract,
} = {}) {
  if (!productIdPattern.test(String(productId ?? ""))) throw new Error("A governed product ID is required.");
  if (!timezoneTimestampPattern.test(String(expectedUpdatedAt ?? "")) || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    throw new Error("The exact timezone-qualified product updated_at value is required.");
  }
  const adminToken = String(environment.MED250_ADMIN_TOKEN || environment.DAWANEAR_ADMIN_TOKEN || "").trim();
  if (!adminToken) throw new Error("MED250_ADMIN_TOKEN is required in the process environment.");
  const secretKey = String(environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required in the process environment.");

  const endpoint = resolveReviewerVerificationEndpoint(environment);
  const backend = await backendVerifier({ environment, fetchImpl });
  const errors = [];
  if (backend.status !== "passed" || backend.failures.length) {
    errors.push(`Database contract failed ${backend.failures.length} invariant(s).`);
  }

  const payload = JSON.stringify({ action: "inspect", product_id: productId });
  const unauthenticated = await fetchImpl(endpoint, requestOptions(payload));
  const unauthenticatedHeaders = reviewerHeaders(unauthenticated);
  if (unauthenticated.status !== 403) {
    errors.push(`Unauthenticated inspect expected HTTP 403, received ${unauthenticated.status}.`);
  }
  assessHeaders(unauthenticatedHeaders, "Unauthenticated inspect", errors);
  await cancelBody(unauthenticated);

  const authenticated = await fetchImpl(endpoint, requestOptions(payload, adminToken));
  const authenticatedHeaders = reviewerHeaders(authenticated);
  assessHeaders(authenticatedHeaders, "Authenticated inspect", errors);
  let observedUpdatedAt = null;
  let authenticatedBodyBytes = 0;
  if (authenticated.status !== 200) {
    errors.push(`Authenticated inspect expected HTTP 200, received ${authenticated.status}.`);
    await cancelBody(authenticated);
  } else {
    try {
      const parsed = await boundedJson(authenticated);
      authenticatedBodyBytes = parsed.bytes;
      const product = parsed.value?.product;
      observedUpdatedAt = typeof product?.updated_at === "string" ? product.updated_at : null;
      if (product?.id !== productId) errors.push("Authenticated inspect returned a different product.");
      if (observedUpdatedAt !== expectedUpdatedAt) errors.push("Authenticated inspect returned an unexpected product version.");
      if (!Array.isArray(parsed.value?.reviews)) errors.push("Authenticated inspect did not return the governed review history shape.");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Authenticated inspect could not be verified.");
    }
  }

  const observedBackendContractVersion = backend.observedVersion ?? backend.contract?.contract_version ?? null;
  if (observedBackendContractVersion !== expectedBackendContractVersion) {
    errors.push(`Database contract version does not match ${expectedBackendContractVersion}.`);
  }
  if (authenticatedHeaders.backendContract !== observedBackendContractVersion) {
    errors.push("Authenticated reviewer and database contract versions do not match.");
  }

  return {
    status: errors.length ? "failed" : "passed",
    supabaseOrigin: endpoint.origin,
    productIdSha256: sha256(productId),
    expectedProductUpdatedAt: expectedUpdatedAt,
    observedProductUpdatedAt: observedUpdatedAt,
    expectedBackendContractVersion,
    observedBackendContractVersion,
    expectedReviewerContractVersion,
    unauthenticated: {
      status: unauthenticated.status,
      ...unauthenticatedHeaders,
    },
    authenticated: {
      status: authenticated.status,
      bodyBytes: authenticatedBodyBytes,
      ...authenticatedHeaders,
    },
    errors,
  };
}

export function buildProductDescriptionReviewerEvidence({ result, capturedAt, verifierSha256 }) {
  return {
    schemaVersion: "1.0",
    capturedAt,
    status: result.status,
    supabaseOrigin: result.supabaseOrigin,
    probeAction: "inspect",
    productIdSha256: result.productIdSha256,
    expectedProductUpdatedAt: result.expectedProductUpdatedAt,
    observedProductUpdatedAt: result.observedProductUpdatedAt,
    databaseContract: {
      expected: result.expectedBackendContractVersion,
      observed: result.observedBackendContractVersion,
    },
    reviewerContract: {
      expected: result.expectedReviewerContractVersion,
      unauthenticatedObserved: result.unauthenticated.reviewerContract,
      authenticatedObserved: result.authenticated.reviewerContract,
    },
    probes: {
      unauthenticatedStatus: result.unauthenticated.status,
      authenticatedStatus: result.authenticated.status,
      authenticatedBodyBytes: result.authenticated.bodyBytes,
      noStore: result.unauthenticated.cacheControl?.toLowerCase().includes("no-store") === true
        && result.authenticated.cacheControl?.toLowerCase().includes("no-store") === true,
    },
    errors: result.errors,
    responseBodiesRetained: false,
    verifier: {
      path: "scripts/verify-product-description-reviewer-deployment.mjs",
      sha256: verifierSha256,
    },
  };
}

async function writeEvidence(outputPath, evidence) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, absolutePath);
}

async function main() {
  try {
    const args = readArguments(process.argv.slice(2));
    const result = await verifyProductDescriptionReviewerDeployment({
      productId: args.productId,
      expectedUpdatedAt: args.expectedUpdatedAt,
    });
    if (args.evidenceOutput) {
      const verifierSource = await readFile(new URL(import.meta.url), "utf8");
      const evidence = buildProductDescriptionReviewerEvidence({
        result,
        capturedAt: new Date().toISOString(),
        verifierSha256: sha256(verifierSource),
      });
      await writeEvidence(args.evidenceOutput, evidence);
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      status: "configuration_error",
      error: error instanceof Error ? error.message : "Reviewer deployment verification failed.",
    }, null, 2));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
