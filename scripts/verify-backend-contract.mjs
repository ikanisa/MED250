import { pathToFileURL } from "node:url";

import { validateWorkerOrigin } from "./verify-live-catalogue.mjs";
import { evaluateWorkerD1Health } from "./verify-worker-d1-health.mjs";

const MAX_RESPONSE_BYTES = 64 * 1024;

function configuredOrigin(environment) {
  return String(
    environment.MED250_DEPLOYMENT_ORIGIN
    || environment.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN
    || environment.NEXT_PUBLIC_SITE_URL
    || "",
  ).trim();
}

export function resolveBackendContractEndpoint(environment = process.env) {
  const origin = configuredOrigin(environment);
  if (!origin) throw new Error("A MED250 Cloudflare Worker origin is required.");
  return new URL("/api/internal/health", validateWorkerOrigin(origin));
}

export async function verifyBackendContract({ environment = process.env, fetchImpl = fetch } = {}) {
  const healthToken = String(environment.MED250_HEALTH_PROBE_TOKEN || "").trim();
  if (healthToken.length < 32 || healthToken.length > 256) {
    throw new Error("MED250_HEALTH_PROBE_TOKEN must be a 32-256 byte process secret.");
  }
  const response = await fetchImpl(resolveBackendContractEndpoint(environment), {
    method: "GET",
    headers: { Authorization: `Bearer ${healthToken}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Worker-D1 health contract returned HTTP ${response.status}.`);
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Worker-D1 health contract exceeded the response size bound.");
  let snapshot;
  try { snapshot = JSON.parse(raw); }
  catch { throw new Error("Worker-D1 health contract did not return valid JSON."); }
  return evaluateWorkerD1Health(snapshot);
}

async function main() {
  try {
    const result = await verifyBackendContract();
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "healthy") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "configuration_error", error: error instanceof Error ? error.message : "Backend verification failed." }, null, 2));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
