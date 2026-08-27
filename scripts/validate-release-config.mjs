import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicContactChannelErrors } from "../lib/public-contact-channels.mjs";

const liveRequired = process.argv.includes("--live");
const envPath = [".env.local", ".env"].map((path) => resolve(path)).find(existsSync);
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

const env = { ...fileEnv, ...process.env };
const errors = [];
const warnings = [];
function required(name) {
  const value = env[name]?.trim();
  if (!value) errors.push(`${name} is missing.`);
  return value ?? "";
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const backendModes = Object.fromEntries([
  "NEXT_PUBLIC_MED250_CATALOGUE_BACKEND",
  "NEXT_PUBLIC_MED250_AUTH_BACKEND",
  "NEXT_PUBLIC_MED250_ORDER_BACKEND",
  "NEXT_PUBLIC_MED250_WORKSPACE_BACKEND",
].map((name) => [name, required(name)]));
const workerD1Cutover = Object.values(backendModes).every((value) => value === "worker-d1");
const transactionalModes = [
  backendModes.NEXT_PUBLIC_MED250_AUTH_BACKEND,
  backendModes.NEXT_PUBLIC_MED250_ORDER_BACKEND,
  backendModes.NEXT_PUBLIC_MED250_WORKSPACE_BACKEND,
];
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

if (!workerD1Cutover) errors.push("Every MED250 backend slice must use worker-d1; no legacy runtime is permitted.");
if (supabaseUrl || publishableKey || env.SUPABASE_URL?.trim() || env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  errors.push("MED250 runtime configuration must not contain Supabase credentials or origins.");
}

if (transactionalModes.some((value) => value === "worker-d1") && !transactionalModes.every((value) => value === "worker-d1")) {
  errors.push("Worker-D1 auth, customer orders, and pharmacy workspace must cut over together.");
}

if (!new Set(["preview", "catalog", "live"]).has(mode)) {
  errors.push("NEXT_PUBLIC_MARKETPLACE_MODE must be preview, catalog, or live.");
}

if (!new Set(["preview", "catalog", "live"]).has(workerMode)) {
  errors.push("wrangler.jsonc vars.MED250_RELEASE_MODE must be preview, catalog, or live.");
} else if (mode && workerMode !== mode) {
  errors.push("Frontend and Worker release modes do not match.");
}

const unsafePublicKeys = Object.keys(env).filter((name) => (
  name.startsWith("NEXT_PUBLIC_")
  && name !== "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  && /(SECRET|SERVICE_ROLE|PASSWORD|ACCESS_TOKEN|PRIVATE_KEY|ADMIN_TOKEN|API_KEY)/i.test(name)
));
if (unsafePublicKeys.length) {
  errors.push(`Server credentials use public variable names: ${unsafePublicKeys.join(", ")}.`);
}

if (!envPath) warnings.push("No .env.local or .env file was found; only process environment values were checked.");
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

errors.push(...publicContactChannelErrors(env, { requireAll: false }));

if (liveRequired) {
  if (mode !== "live") errors.push("Live release validation requires NEXT_PUBLIC_MARKETPLACE_MODE=live.");
  if (!workerD1Cutover) errors.push("Live release validation requires every MED250 backend slice to use worker-d1.");
  if (!siteUrl) errors.push("Live release validation requires an explicit NEXT_PUBLIC_SITE_URL.");
  if (!turnstileSiteKey) errors.push("Live release validation requires NEXT_PUBLIC_TURNSTILE_SITE_KEY.");
  if (observabilityMode !== "cloud") errors.push("Live release validation requires NEXT_PUBLIC_MED250_OBSERVABILITY=cloud.");
}

const result = {
  status: errors.length ? "failed" : "passed",
  target: liveRequired ? "live_deployment" : mode || "unknown",
  envFileDetected: Boolean(envPath),
  workerReleaseMode: workerMode || "missing",
  workerName: workerName || "missing",
  workerEnvironment,
  backendModes,
  workerD1Cutover,
  publicVariablesChecked: Object.keys(env).filter((name) => name.startsWith("NEXT_PUBLIC_")).sort(),
  warnings,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
