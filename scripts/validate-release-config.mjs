import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicContactChannelErrors } from "../lib/public-contact-channels.mjs";

const liveRequired = process.argv.includes("--live");
const runtimeManaged = process.argv.includes("--runtime-managed");
const envCandidates = liveRequired
  ? [".env.local", ".env"]
  : [".env.local", ".env", ".env.example"];
const envPath = envCandidates.map((path) => resolve(path)).find(existsSync);
const envFileSource = envPath
  ? envCandidates.find((candidate) => resolve(candidate) === envPath) ?? null
  : null;
const wranglerPath = resolve("wrangler.jsonc");
const source = envPath ? readFileSync(envPath, "utf8") : "";
const fileEnv = Object.fromEntries(source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => {
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
    return [key, value];
  }));

let configuredWorkerVars = {};
if (existsSync(wranglerPath)) {
  try {
    const configuredWrangler = JSON.parse(readFileSync(wranglerPath, "utf8"));
    const configuredWorker = liveRequired ? configuredWrangler?.env?.production : configuredWrangler;
    configuredWorkerVars = configuredWorker?.vars ?? {};
  } catch {
    configuredWorkerVars = {};
  }
}
const env = { ...configuredWorkerVars, ...fileEnv, ...process.env };
const errors = [];
const warnings = [];
const legacyAdvisoryGateNames = [
  "MED250_GATE_GPS_READY",
  "MED250_GATE_WHATSAPP_READY",
  "MED250_GATE_DUPLICATE_REGISTER_REVIEWED",
  "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
  "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
  "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
  "MED250_GATE_AUTH_RATE_LIMITS_APPROVED",
  "MED250_GATE_PRESCRIPTION_RETENTION_APPROVED",
  "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED",
  "MED250_GATE_DOMAIN_DNS_VERIFIED",
  "MED250_GATE_PHYSICAL_UAT_PASSED",
];

function required(name) {
  const value = env[name]?.trim();
  const runtimeBinding = runtimeManaged && new Set([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]).has(name);
  if (!value && !runtimeBinding) errors.push(`${name} is missing.`);
  return value ?? "";
}

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const mode = required("NEXT_PUBLIC_MARKETPLACE_MODE");
const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
const turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
const observabilityMode = env.NEXT_PUBLIC_MED250_OBSERVABILITY?.trim() ?? "";
let workerMode = "";
let workerName = "";
let workerEnvironment = liveRequired ? "production" : "default";

if (!existsSync(wranglerPath)) {
  errors.push("wrangler.jsonc is missing.");
} else {
  try {
    const wrangler = JSON.parse(readFileSync(wranglerPath, "utf8"));
    const selectedWorker = liveRequired ? wrangler?.env?.production : wrangler;
    workerMode = String(selectedWorker?.vars?.MED250_RELEASE_MODE ?? "").trim();
    workerName = String(selectedWorker?.name ?? "").trim();
    if (!liveRequired && wrangler?.name !== "med250-marketplace-preview") {
      errors.push("The default Worker must remain the isolated med250-marketplace-preview service.");
    }
    if (liveRequired) {
      if (!wrangler?.env?.production) errors.push("wrangler.jsonc env.production is missing.");
      if (workerName !== "med250-marketplace-gikundiro") errors.push("The production Worker must be named med250-marketplace-gikundiro.");
      if (selectedWorker?.workers_dev !== false) errors.push("The production Worker must disable workers.dev.");
      const productionRoutes = Array.isArray(selectedWorker?.routes) ? selectedWorker.routes : [];
      const routePatterns = productionRoutes.map((route) => typeof route === "string" ? route : route?.pattern);
      if (!routePatterns.includes("med-250.com")) {
        errors.push("The production Worker must route med-250.com.");
      }
    }
  } catch {
    errors.push("wrangler.jsonc must remain valid JSON-compatible JSONC for release validation.");
  }
}

if (supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
      errors.push("NEXT_PUBLIC_SUPABASE_URL must be an HTTPS Supabase project URL.");
    }
  } catch {
    errors.push("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
}

if (publishableKey && !publishableKey.startsWith("sb_publishable_")) {
  errors.push("Use a modern sb_publishable_ key in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; never use a secret or service-role key.");
}

if (!new Set(["preview", "catalog", "live"]).has(mode)) {
  errors.push("NEXT_PUBLIC_MARKETPLACE_MODE must be preview, catalog, or live.");
}

if (!new Set(["preview", "catalog", "live"]).has(workerMode)) {
  errors.push("wrangler.jsonc vars.MED250_RELEASE_MODE must be preview, catalog, or live.");
} else if (mode && workerMode !== mode) {
  errors.push("Frontend and Worker release modes do not match.");
}

const approvedPublicCredentialNames = new Set([
  "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
]);
const unsafePublicKeys = Object.entries(env).filter(([name, value]) => (
  name.startsWith("NEXT_PUBLIC_")
  && String(value).trim()
  && !approvedPublicCredentialNames.has(name)
  && /(SECRET|SERVICE_ROLE|PASSWORD|ACCESS_TOKEN|PRIVATE_KEY|ADMIN_TOKEN|API_KEY)/i.test(name)
)).map(([name]) => name);
if (unsafePublicKeys.length) {
  errors.push(`Server credentials use public variable names: ${unsafePublicKeys.join(", ")}.`);
}

if (!envPath) warnings.push("No governed environment file was found; only process environment values were checked.");
if (envFileSource === ".env.example") {
  warnings.push("Using committed public preview defaults from .env.example; process environment values take precedence.");
}
if (mode !== "live") warnings.push(`Marketplace mode is ${mode || "preview"}, so customer ordering remains disabled.`);
if (!siteUrl) warnings.push("NEXT_PUBLIC_SITE_URL is not explicitly configured; metadata uses the med-250.com default.");

if (siteUrl) {
  try {
    const parsed = new URL(siteUrl);
    if (parsed.protocol !== "https:") errors.push("NEXT_PUBLIC_SITE_URL must use HTTPS.");
    if (liveRequired && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      errors.push("A live release cannot use a local NEXT_PUBLIC_SITE_URL.");
    }
  } catch {
    errors.push("NEXT_PUBLIC_SITE_URL is not a valid URL.");
  }
}

if (liveRequired) {
  if (mode !== "live") errors.push("Live release validation requires NEXT_PUBLIC_MARKETPLACE_MODE=live.");
  if (!siteUrl) errors.push("Live release validation requires an explicit NEXT_PUBLIC_SITE_URL.");
  if (!turnstileSiteKey && !runtimeManaged) errors.push("Live release validation requires NEXT_PUBLIC_TURNSTILE_SITE_KEY.");
  if (!turnstileSiteKey && runtimeManaged) warnings.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY is runtime-managed and must be verified after deployment.");
  if (observabilityMode !== "cloud") errors.push("Live release validation requires NEXT_PUBLIC_MED250_OBSERVABILITY=cloud.");
  const publicContactErrors = publicContactChannelErrors(env, { requireAll: true });
  if (runtimeManaged) warnings.push(...publicContactErrors.map((error) => `Non-blocking public contact follow-up: ${error}`));
  else errors.push(...publicContactErrors);
  if (runtimeManaged) warnings.push("Committed production public bindings require exact live verification after deployment.");
}

const result = {
  status: errors.length ? "failed" : "passed",
  target: liveRequired ? "live" : mode || "unknown",
  envFileDetected: Boolean(envPath),
  envFileSource,
  workerReleaseMode: workerMode || "missing",
  workerName: workerName || "missing",
  workerEnvironment,
  runtimeManagedBindings: runtimeManaged,
  publicVariablesChecked: Object.keys(env).filter((name) => name.startsWith("NEXT_PUBLIC_")).sort(),
  legacyAdvisoryGateFlagsObserved: liveRequired
    ? legacyAdvisoryGateNames.filter((name) => Boolean(env[name]?.trim()))
    : [],
  warnings,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
