import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function evaluateOperationalHealth(health) {
  const critical = [];
  const warnings = [];

  if (!health?.privacy?.aggregate_only) critical.push("The health response is missing its aggregate-only privacy declaration.");
  if (Number(health?.pharmacies?.gps_ready ?? 0) < 1) critical.push("No active pharmacy has an approved GPS location.");
  if (Number(health?.pharmacies?.dispatch_ready ?? 0) < 1) critical.push("No pharmacy currently satisfies the dispatch eligibility rules.");
  if (Number(health?.pharmacies?.login_enabled_whatsapp_contacts ?? 0) < 1) critical.push("No pharmacy WhatsApp login contact is enabled.");
  if (health?.prescription_cleanup?.stale) critical.push("Prescription cleanup has no successful recent health signal.");
  if (Number(health?.prescription_cleanup?.expired_claims ?? 0) > 0) warnings.push("Expired prescription cleanup leases require recovery.");
  if (Number(health?.orders?.waiting_without_confirmation_over_30m ?? 0) > 0) warnings.push("Some dispatched orders have waited more than 30 minutes without a complete confirmation.");
  if (Number(health?.pharmacy_auth?.otp_failed_24h ?? 0) > 0) warnings.push("WhatsApp OTP delivery failures occurred in the last 24 hours.");
  if (Number(health?.catalogue?.products_with_central_indicative_prices ?? 0) < 1) warnings.push("No catalogue product has a central indicative price.");
  if (Number(health?.catalogue?.pharmacy_specific_price_records_in_use ?? 0) > 0) critical.push("Operational health reports pharmacy-specific catalogue prices in use.");

  return {
    status: critical.length ? "critical" : warnings.length ? "degraded" : "healthy",
    generatedAt: health?.generated_at ?? null,
    critical,
    warnings,
    health,
  };
}

function configurationError(message) {
  console.error(JSON.stringify({ status: "configuration_error", error: message }, null, 2));
  process.exitCode = 2;
}

async function runCli() {
  const strict = process.argv.includes("--strict");
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl) return configurationError("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required.");
  if (!secretKey) return configurationError("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required in the process environment.");

  let rpcUrl;
  try {
    const base = new URL(supabaseUrl);
    if (base.protocol !== "https:" || !base.hostname.endsWith(".supabase.co")) throw new Error("invalid Supabase host");
    rpcUrl = new URL("/rest/v1/rpc/dawanear_operational_health", base);
  } catch {
    return configurationError("The Supabase URL must be an HTTPS *.supabase.co origin.");
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) return configurationError(`Operational health RPC returned HTTP ${response.status}.`);

  const result = evaluateOperationalHealth(await response.json());
  console.log(JSON.stringify(result, null, 2));
  if (strict && result.critical.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runCli();
