import {
  assessBackendContract,
  expectedBackendContractVersion,
} from "./backend-contract-invariants.mjs";

const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function stop(message) {
  console.error(JSON.stringify({ status: "configuration_error", error: message }, null, 2));
  process.exit(2);
}

if (!supabaseUrl) stop("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required.");
if (!secretKey) stop("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required in the process environment.");

let endpoint;
try {
  const base = new URL(supabaseUrl);
  if (base.protocol !== "https:" || !base.hostname.endsWith(".supabase.co")) throw new Error("invalid Supabase host");
  endpoint = new URL("/rest/v1/rpc/dawanear_backend_contract", base);
} catch {
  stop("The Supabase URL must be an HTTPS *.supabase.co origin.");
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
if (!response.ok) stop(`Backend contract RPC returned HTTP ${response.status}.`);

const contract = await response.json();
const failures = assessBackendContract(contract);

console.log(JSON.stringify({
  status: failures.length ? "failed" : "passed",
  expectedVersion: expectedBackendContractVersion,
  observedVersion: contract?.contract_version ?? null,
  generatedAt: contract?.generated_at ?? null,
  failures,
  contract,
}, null, 2));
if (failures.length) process.exitCode = 1;
