import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildProviderPlan } from "../scripts/twilio-whatsapp-setup.mjs";

const root = new URL("../", import.meta.url);
const forbiddenRuntime = /(?:@supabase\/|@neondatabase\/|https?:\/\/[^\s"']*(?:supabase\.co|neon\.(?:tech|build))|\b(?:NEXT_PUBLIC_)?SUPABASE_(?:URL|KEY|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY)\b|\bNEON_(?:DATABASE_URL|API_KEY|PROJECT_ID)\b)/i;

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("keeps MED250 runtime dependencies and deployment configuration Cloudflare-only", async () => {
  const [packageSource, wranglerSource, envSource] = await Promise.all([
    source("package.json"),
    source("wrangler.jsonc"),
    source(".env.example"),
  ]);
  const manifest = JSON.parse(packageSource);
  const dependencyNames = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

  assert.deepEqual(dependencyNames.filter((name) => /supabase|neondatabase/i.test(name)), []);
  assert.doesNotMatch(packageSource, forbiddenRuntime);
  assert.doesNotMatch(wranglerSource, forbiddenRuntime);
  assert.doesNotMatch(envSource, forbiddenRuntime);
  assert.match(wranglerSource, /"binding": "DB"/);
  assert.match(wranglerSource, /"binding": "PRIVATE_MEDIA"/);
  assert.match(wranglerSource, /"binding": "DISPATCH_QUEUE"/);
});

test("keeps every callable provider and deployment verifier on Worker APIs", async () => {
  const entrypoints = [
    "scripts/twilio-whatsapp-setup.mjs",
    "scripts/prepare-worker-d1-config.mjs",
    "scripts/verify-worker-d1-health.mjs",
    "scripts/verify-backend-contract.mjs",
    "scripts/verify-product-description-reviewer-deployment.mjs",
    "scripts/verify-live-catalogue.mjs",
    "scripts/verify-live-related-products.mjs",
    "scripts/cloudflare-catalogue-recovery.mjs",
    "scripts/cloudflare-media-recovery.mjs",
    "scripts/cloudflare-pharmacy-recovery.mjs",
  ];
  for (const path of entrypoints) {
    assert.doesNotMatch(await source(path), forbiddenRuntime, `${path} contains a forbidden backend provider reference`);
  }

  const manifest = JSON.parse(await source("package.json"));
  const operationalScripts = Object.entries(manifest.scripts)
    .filter(([name]) => /^(?:cloudflare:|deploy|backend:|catalogue:|related:|twilio:|ops:|media:|images:)/.test(name))
    .map(([, command]) => String(command))
    .join("\n");
  assert.doesNotMatch(operationalScripts, /prepare-gikundiro-worker|monitor-operational-health|supabase|neon/i);
  assert.match(operationalScripts, /prepare-worker-d1-config/);
  assert.match(operationalScripts, /verify-worker-d1-health/);
  assert.match(operationalScripts, /cloudflare-catalogue-recovery/);
  assert.match(operationalScripts, /cloudflare-media-recovery/);
  assert.doesNotMatch(operationalScripts, /--publish/);
});

test("uses Cloudflare-supported manual redirects for outbound Worker subrequests", async () => {
  const [authApi, operatorApi] = await Promise.all([
    source("worker/backend/auth-api.ts"),
    source("worker/backend/operator-api.ts"),
  ]);
  const outboundWorkerCalls = `${authApi}\n${operatorApi}`;

  assert.doesNotMatch(outboundWorkerCalls, /redirect:\s*["']error["']/);
  assert.match(authApi, /challenges\.cloudflare\.com[\s\S]*?redirect:\s*"manual"/);
  assert.match(operatorApi, /places\.googleapis\.com[\s\S]*?redirect:\s*"manual"/);
});

test("binds WhatsApp media to the Worker and gives clients manual WhatsApp location instructions", async () => {
  const setup = await source("scripts/twilio-whatsapp-setup.mjs");
  const plan = buildProviderPlan({
    target: "production",
    env: { TWILIO_EXPECTED_ACCOUNT_SID: `AC${"0".repeat(32)}` },
  });
  const serialized = JSON.stringify(plan.templates);
  const locationCapture = plan.templates.find(({ content }) => content.friendly_name === "med250_client_manual_location_v3");
  assert.equal(plan.worker_origin, "https://med-250.com");
  assert.ok(serialized.includes(`${plan.worker_origin}/whatsapp-client-media/{{5}}.png`));
  assert.ok(serialized.includes(`${plan.worker_origin}/whatsapp-order-media/{{7}}.png`));
  assert.ok(serialized.includes("med250_client_manual_location_v3"));
  assert.ok(serialized.includes("We received your requests, please share your current location in WhatsApp:\\nTap + or 📎 → Location → Send your current location"));
  assert.doesNotMatch(serialized, /live-google-maps|google(?:\.com\/)? maps|openstreetmap/i);
  assert.doesNotMatch(JSON.stringify(locationCapture), /twilio\/call-to-action|action|url/i);
  assert.match(setup, /TWILIO_CLIENT_LOCATION_CAPTURE_CONTENT_SID/);
  assert.doesNotMatch(setup, /TWILIO_WHATSAPP_LOCATION_URL/);
  assert.doesNotMatch(setup, forbiddenRuntime);
});

test("keeps the active Worker and deployment path independent of Meta access tokens", async () => {
  const activeFiles = await Promise.all([
    source("worker/index.ts"),
    source("worker/backend/outbox-runtime.ts"),
    source("worker/backend/runtime-env.ts"),
    source("scripts/prepare-worker-d1-config.mjs"),
    source(".env.example"),
  ]);
  const active = activeFiles.join("\n");
  assert.doesNotMatch(active, /WHATSAPP_ACCESS_TOKEN|META_APP_SECRET|metaWhatsAppRuntime|sendMetaMessage/);
  assert.match(active, /MED250_WHATSAPP_PROVIDER["']?:?\s*["']twilio/);
});
