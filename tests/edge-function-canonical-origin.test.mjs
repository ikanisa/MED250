import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the complete WhatsApp Worker bundle on the canonical production origin", async () => {
  const [entrypoint, runtime, setup, wrangler] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/backend/runtime-env.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/twilio-whatsapp-setup.mjs", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ]);
  const active = `${entrypoint}\n${runtime}\n${setup}\n${wrangler}`;
  assert.match(active, /https:\/\/med-250\.com/);
  assert.match(entrypoint, /\/api\/twilio\/whatsapp\/inbound/);
  assert.match(entrypoint, /\/api\/twilio\/whatsapp\/status/);
  assert.doesNotMatch(active, /\/api\/meta\/whatsapp|META_ACCESS_TOKEN|WHATSAPP_ACCESS_TOKEN/);
  assert.doesNotMatch(active, /med250\.gikundiro\.com|med250-rwanda\.ikanisa\.chatgpt\.site/);
});
