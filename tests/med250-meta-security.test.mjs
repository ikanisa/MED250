import assert from "node:assert/strict";
import test from "node:test";

import {
  createMetaSignature,
  enabledFlag,
  explicitGraphVersion,
  explicitTemplateName,
  normalizeRecipient,
  parseCountryCodes,
  pseudonymousIdentifier,
  safeTemplateText,
  timingSafeText,
  validateMetaSignature,
} from "../supabase/functions/_shared/med250-meta-security.mjs";

test("validates the exact raw Meta body and rejects tampering", async () => {
  const secret = "synthetic-meta-app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const signature = await createMetaSignature(secret, body);
  assert.equal(await validateMetaSignature(secret, body, signature), true);
  assert.equal(await validateMetaSignature(secret, `${body} `, signature), false);
});

test("rejects missing and malformed Meta signatures", async () => {
  assert.equal(await validateMetaSignature("synthetic-meta-app-secret", "{}", ""), false);
  assert.equal(await validateMetaSignature("synthetic-meta-app-secret", "{}", "sha256=abcd"), false);
  assert.equal(await validateMetaSignature("short", "{}", `sha256=${"0".repeat(64)}`), false);
});

test("compares verification tokens without accepting length differences", () => {
  assert.equal(timingSafeText("verification-token", "verification-token"), true);
  assert.equal(timingSafeText("verification-token", "verification-token-x"), false);
  assert.equal(timingSafeText("", ""), true);
});

test("requires an explicit valid country allowlist", () => {
  assert.deepEqual(parseCountryCodes("250,1"), ["250", "1"]);
  assert.throws(() => parseCountryCodes(""), /allowlist/);
  assert.throws(() => parseCountryCodes("250,abcd"), /allowlist/);
});

test("normalizes only allowlisted E.164 digit recipients", () => {
  const countries = parseCountryCodes("250");
  assert.equal(normalizeRecipient("250788000001", countries), "250788000001");
  assert.equal(normalizeRecipient("16622220600", countries), null);
  assert.equal(normalizeRecipient("+250788000001", countries), null);
});

test("accepts only explicit Graph versions and normalized template names", () => {
  assert.equal(explicitGraphVersion("v25.0"), "v25.0");
  assert.equal(explicitTemplateName("med250_pharmacy_order_v1"), "med250_pharmacy_order_v1");
  assert.throws(() => explicitGraphVersion("latest"), /Graph/);
  assert.throws(() => explicitTemplateName("MED250 order"), /template/);
});

test("pseudonymizes identifiers with independent strong material", async () => {
  const secret = "synthetic-rate-pepper-at-least-32-bytes-long";
  const first = await pseudonymousIdentifier(secret, "recipient", "250788000001");
  const second = await pseudonymousIdentifier(secret, "recipient", "250788000001");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(first, /250788000001/);
  await assert.rejects(() => pseudonymousIdentifier("short", "recipient", "250788000001"));
});

test("bounds and strips unsafe template control characters", () => {
  assert.equal(safeTemplateText("hello\u0000world", "", 20), "hello world");
  assert.equal(safeTemplateText("", "fallback", 20), "fallback");
  assert.equal(safeTemplateText("x".repeat(50), "", 10).length, 10);
  assert.equal(enabledFlag("TRUE"), true);
  assert.equal(enabledFlag("false"), false);
});
