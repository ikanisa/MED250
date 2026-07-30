import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sharedAuth = await readFile(
  new URL("../supabase/functions/_shared/dawanear-pharmacy-auth.ts", import.meta.url),
  "utf8",
);

const edgeEntrypoints = [
  "dawanear-pharmacy-send-otp",
  "dawanear-pharmacy-verify-otp",
  "dawanear-customer-send-otp",
  "dawanear-customer-verify-otp",
  "dispatch-whatsapp-notifications",
  "whatsapp-webhook",
];

test("keeps the complete WhatsApp Edge bundle on the canonical production origin", async () => {
  assert.match(sharedAuth, /"https:\/\/med-250\.com"/);
  assert.doesNotMatch(sharedAuth, /med250\.gikundiro\.com|med250-rwanda\.ikanisa\.chatgpt\.site/);

  for (const slug of edgeEntrypoints) {
    const source = await readFile(
      new URL(`../supabase/functions/${slug}/index.ts`, import.meta.url),
      "utf8",
    );
    assert.match(source, /"\.\.\/_shared\/dawanear-pharmacy-auth\.ts"/, `${slug} must use the canonical shared boundary`);
  }
});
