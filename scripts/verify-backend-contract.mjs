import { pathToFileURL } from "node:url";

import {
  assessBackendContract,
  expectedBackendContractVersion,
} from "./backend-contract-invariants.mjs";

export function resolveBackendContractEndpoint(environment = process.env) {
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
  return new URL("/rest/v1/rpc/dawanear_backend_contract", base);
}

export async function verifyBackendContract({
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const secretKey = String(environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required in the process environment.");
  const response = await fetchImpl(resolveBackendContractEndpoint(environment), {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Backend contract RPC returned HTTP ${response.status}.`);
  let contract;
  try { contract = await response.json(); }
  catch { throw new Error("Backend contract RPC did not return valid JSON."); }
  const failures = assessBackendContract(contract);
  return {
    status: failures.length ? "failed" : "passed",
    expectedVersion: expectedBackendContractVersion,
    observedVersion: contract?.contract_version ?? null,
    generatedAt: contract?.generated_at ?? null,
    failures,
    contract,
  };
}

async function main() {
  try {
    const result = await verifyBackendContract();
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      status: "configuration_error",
      error: error instanceof Error ? error.message : "Backend verification failed.",
    }, null, 2));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
