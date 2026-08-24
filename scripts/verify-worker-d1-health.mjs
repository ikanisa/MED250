import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONTRACT = "med250-worker-d1-health-v1";
const MAX_RESPONSE_BYTES = 64 * 1024;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function evaluateWorkerD1Health(snapshot) {
  const critical = [];
  const warnings = [];
  if (!isObject(snapshot)) critical.push("The health response is not an object.");
  if (snapshot?.contract_version !== CONTRACT) critical.push("The health contract version is invalid.");
  if (
    snapshot?.privacy?.aggregate_only !== true
    || snapshot?.privacy?.contains_identifiers !== false
    || snapshot?.privacy?.contains_phone_numbers !== false
    || snapshot?.privacy?.contains_coordinates !== false
    || snapshot?.privacy?.contains_health_or_prescription_data !== false
  ) {
    critical.push("The health response is missing its aggregate-only privacy declaration.");
  }
  if (!snapshot?.database?.migrations_current) critical.push("Canonical D1 migrations are not current.");
  if (Number(snapshot?.pharmacies?.dispatch_ready ?? 0) < 1) critical.push("No pharmacy satisfies the dispatch controls.");
  if (Number(snapshot?.pharmacies?.verified_login_contacts ?? 0) < 1) critical.push("No verified pharmacy WhatsApp login contact is enabled.");
  if (Number(snapshot?.dispatch?.provider_send_unknown ?? 0) > 0) critical.push("A provider send has an unknown finality state.");
  if (Number(snapshot?.dispatch?.dead_letter ?? 0) > 0) critical.push("The dispatch outbox contains dead-letter work.");
  if (Number(snapshot?.dispatch?.stale_work ?? 0) > 0) critical.push("The dispatch outbox contains stale work.");
  if (Number(snapshot?.inbound?.stale_unprocessed ?? 0) > 0) critical.push("Inbound WhatsApp work is stale and unprocessed.");
  if (Number(snapshot?.private_media?.expired_not_deleted ?? 0) > 0) critical.push("Expired private medical media has not been deleted.");
  if (Number(snapshot?.private_media?.stale_processing ?? 0) > 0) critical.push("Private medical media is stuck in processing.");
  if (Number(snapshot?.dispatch?.failed_24h ?? 0) > 0) warnings.push("Dispatch failures occurred in the last 24 hours.");
  if (Number(snapshot?.dispatch?.retry ?? 0) > 0) warnings.push("The dispatch outbox contains retry work.");
  if (Number(snapshot?.dispatch?.provider_callback_failures_24h ?? 0) > 0) warnings.push("Provider callback failures occurred in the last 24 hours.");
  if (Number(snapshot?.orders?.waiting_without_confirmation_over_30m ?? 0) > 0) warnings.push("Orders have waited over 30 minutes without a pharmacy confirmation.");
  if (Number(snapshot?.private_media?.expired_active_grants ?? 0) > 0) warnings.push("Expired private-media grants await revocation cleanup.");

  const derivedStatus = critical.length ? "critical" : warnings.length ? "degraded" : "healthy";
  if (snapshot?.status !== derivedStatus) critical.push("The database health status disagrees with the verifier.");
  return {
    status: critical.length ? "critical" : warnings.length ? "degraded" : "healthy",
    generatedAt: typeof snapshot?.generated_at === "string" ? snapshot.generated_at : null,
    critical,
    warnings,
    health: snapshot,
  };
}

function configurationError(message) {
  console.error(JSON.stringify({ status: "configuration_error", error: message }, null, 2));
  process.exitCode = 2;
}

function argumentValue(name) {
  const exact = process.argv.indexOf(name);
  if (exact >= 0) return process.argv[exact + 1] ?? "";
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? "";
}

function probeUrl() {
  const configured = argumentValue("--url") || process.env.MED250_HEALTH_PROBE_URL || "";
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("MED250_HEALTH_PROBE_URL or --url must be a valid URL.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.search
    || parsed.pathname !== "/api/internal/health"
  ) throw new Error("The health probe must use the exact same-origin HTTPS /api/internal/health path.");
  if (process.argv.includes("--production") && parsed.hostname !== "med-250.com") {
    throw new Error("Production health verification is restricted to med-250.com.");
  }
  return parsed;
}

async function runCli() {
  if (process.argv.some((value) => value === "--token" || value.startsWith("--token="))) {
    return configurationError("The health token is accepted only through MED250_HEALTH_PROBE_TOKEN.");
  }
  const token = process.env.MED250_HEALTH_PROBE_TOKEN ?? "";
  if (token.length < 32 || token.length > 256) {
    return configurationError("MED250_HEALTH_PROBE_TOKEN must be a 32-256 byte process secret.");
  }
  let url;
  try {
    url = probeUrl();
  } catch (error) {
    return configurationError(error instanceof Error ? error.message : "The health probe URL is invalid.");
  }

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return configurationError("The Worker-D1 health endpoint could not be reached securely.");
  }
  if (!response.ok) return configurationError(`Worker-D1 health returned HTTP ${response.status}.`);
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) return configurationError("Worker-D1 health exceeded the response size bound.");
  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    return configurationError("Worker-D1 health returned invalid JSON.");
  }
  const result = evaluateWorkerD1Health(snapshot);
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--strict") && result.status !== "healthy") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runCli();
