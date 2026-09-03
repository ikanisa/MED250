import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parsePublicBookingUrl,
  parsePublicEmail,
  parsePublicWhatsApp,
  publicContactChannelErrors,
  publicContactChannels,
  SUPPORT_WHATSAPP_URL,
} from "../lib/public-contact-channels.mjs";

const validEnv = {
  NEXT_PUBLIC_MED250_CONTACT_EMAIL: "Support@MED250.example",
  NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP: "+250 780 000 000",
  NEXT_PUBLIC_MED250_MEETING_URL: "https://calendar.example/med250?slot=intake#private",
};

test("normalizes safe public MED+250 contact channels", () => {
  assert.deepEqual(parsePublicEmail(validEnv.NEXT_PUBLIC_MED250_CONTACT_EMAIL), {
    label: "email",
    href: "mailto:support@med250.example",
    display: "support@med250.example",
  });
  assert.deepEqual(parsePublicWhatsApp(validEnv.NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP), {
    label: "whatsapp",
    href: "https://wa.me/250780000000",
    display: "+250780000000",
  });
  assert.deepEqual(parsePublicBookingUrl(validEnv.NEXT_PUBLIC_MED250_MEETING_URL), {
    label: "booking",
    href: "https://calendar.example/med250?slot=intake",
    display: "calendar.example",
  });
  assert.deepEqual(publicContactChannels(validEnv), [{ label: "whatsapp", href: SUPPORT_WHATSAPP_URL, display: "+250 795 588 248" }]);
});

test("rejects unsafe or incomplete public contact configuration", () => {
  assert.equal(parsePublicEmail("owner@example.com\nbcc:attacker@example.com"), null);
  assert.equal(parsePublicWhatsApp("token=unsafe"), null);
  assert.equal(parsePublicBookingUrl("http://calendar.example/med250"), null);
  assert.equal(parsePublicBookingUrl("https://localhost/med250"), null);
  assert.deepEqual(publicContactChannelErrors({}, { requireAll: true }), []);
  assert.deepEqual(publicContactChannelErrors({
    NEXT_PUBLIC_MED250_CONTACT_EMAIL: "unsafe",
    NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP: "not-a-number",
    NEXT_PUBLIC_MED250_MEETING_URL: "http://example.com",
  }), [
    "NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP is not a safe public contact value.",
  ]);
  assert.deepEqual(publicContactChannelErrors({ NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP: "+250 795 588 248" }), []);
  assert.deepEqual(publicContactChannelErrors(validEnv), [
    "NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP must match the owner-approved WhatsApp support number.",
  ]);
});

test("binds WhatsApp-only public support to the footer and example env", async () => {
  const [marketplace, infoShell, envExample, preflight, messages] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/info-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../scripts/validate-release-config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../data/localization/runtime-messages.en-RW.json", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /publicContactChannels\(\)/);
  assert.match(marketplace, /public-contact-links/);
  assert.match(infoShell, /publicContactChannels\(\)/);
  assert.match(infoShell, /public-contact-links/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_MED250_CONTACT_EMAIL=/);
  assert.match(envExample, /NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP=\+250795588248/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_MED250_MEETING_URL=/);
  assert.match(preflight, /publicContactChannelErrors\(env, \{ requireAll: false \}\)/);
  assert.match(messages, /public_contact\.email/);
  assert.match(messages, /public_contact\.whatsapp/);
  assert.match(messages, /public_contact\.booking/);
});

test("live technical validation allows omitted public contact channels", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-release-config.mjs", "--live"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_MED250_CATALOGUE_BACKEND: "worker-d1",
      NEXT_PUBLIC_MED250_AUTH_BACKEND: "worker-d1",
      NEXT_PUBLIC_MED250_ORDER_BACKEND: "worker-d1",
      NEXT_PUBLIC_MED250_WORKSPACE_BACKEND: "worker-d1",
      NEXT_PUBLIC_MARKETPLACE_MODE: "live",
      NEXT_PUBLIC_SITE_URL: "https://med-250.com",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAA-example",
      NEXT_PUBLIC_MED250_OBSERVABILITY: "cloud",
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"target": "live_deployment"/);
  assert.doesNotMatch(result.stdout, /MED250_GATE_|Operational activation/);
});
