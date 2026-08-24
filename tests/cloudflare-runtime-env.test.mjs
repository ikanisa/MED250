import assert from "node:assert/strict";
import test from "node:test";

import {
  d1Database,
  healthProbeToken,
  RuntimeConfigurationError,
  twilioInboundRuntime,
  twilioSendRuntime,
  webAuthRuntime,
} from "../worker/backend/runtime-env.ts";

function bindings(overrides = {}) {
  return {
    DB: { prepare() {}, batch() {} },
    TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
    TWILIO_AUTH_TOKEN: "test-only-auth-token",
    TWILIO_WHATSAPP_FROM: "whatsapp:+16622220600",
    TWILIO_WHATSAPP_WEBHOOK_URL: "https://med-250.com/api/twilio/whatsapp/inbound",
    TWILIO_WHATSAPP_STATUS_CALLBACK_URL: "https://med-250.com/api/twilio/whatsapp/status",
    TWILIO_API_KEY: "SK00000000000000000000000000000001",
    TWILIO_API_SECRET: "test-only-api-secret",
    TWILIO_LOCATION_LINK_SECRET: "test-only-location-link-secret-with-at-least-32-bytes",
    TWILIO_CLIENT_LOCATION_CAPTURE_CONTENT_SID: "HX00000000000000000000000000000001",
    TWILIO_CLIENT_LOCATION_CHOICE_CONTENT_SID: "HX00000000000000000000000000000002",
    TWILIO_PHARMACY_CLIENT_MEDIA_REQUEST_CONTENT_SID: "HX00000000000000000000000000000003",
    TWILIO_PHARMACY_REQUEST_CONTENT_SID: "HX00000000000000000000000000000006",
    TWILIO_PHARMACY_OTP_CONTENT_SID: "HX00000000000000000000000000000004",
    TWILIO_CUSTOMER_OTP_CONTENT_SID: "HX00000000000000000000000000000005",
    MED250_OTP_SECRET: "test-only-otp-secret-with-at-least-thirty-two-bytes",
    MED250_OTP_ENCRYPTION_SECRET: "test-only-otp-encryption-secret-with-at-least-32-bytes",
    MED250_HEALTH_PROBE_TOKEN: "test-only-operational-health-token-at-least-32-bytes",
    MED250_RELEASE_MODE: "preview",
    ...overrides,
  };
}

test("validates the D1 binding and dynamically installed Twilio secrets", () => {
  const env = bindings();
  assert.equal(d1Database(env), env.DB);
  assert.equal(healthProbeToken(env), "test-only-operational-health-token-at-least-32-bytes");
  assert.equal(twilioInboundRuntime(env).fromE164, "16622220600");
  assert.equal(twilioSendRuntime(env).pharmacyClientMediaContentSid, "HX00000000000000000000000000000003");
  assert.equal(twilioSendRuntime(env).customerOtpContentSid, "HX00000000000000000000000000000005");
  assert.equal(twilioSendRuntime(env).pharmacyRequestContentSid, "HX00000000000000000000000000000006");
  assert.equal(webAuthRuntime(env).releaseMode, "preview");
});

test("requires Turnstile and an explicit HTTPS origin allowlist for live web authentication", () => {
  assert.throws(
    () => webAuthRuntime(bindings({ MED250_RELEASE_MODE: "live" })),
    (error) => error instanceof RuntimeConfigurationError && error.code === "missing_turnstile",
  );
  assert.throws(
    () => webAuthRuntime(bindings({
      MED250_RELEASE_MODE: "live",
      TURNSTILE_SECRET_KEY: "test-only-turnstile-secret",
    })),
    (error) => error instanceof RuntimeConfigurationError && error.code === "missing_origins",
  );
  const runtime = webAuthRuntime(bindings({
    MED250_RELEASE_MODE: "live",
    TURNSTILE_SECRET_KEY: "test-only-turnstile-secret",
    MED250_ALLOWED_ORIGINS: "https://med-250.com",
  }));
  assert.deepEqual([...runtime.allowedOrigins], ["https://med-250.com"]);
});

test("fails closed when a secret or canonical callback URL is absent or malformed", () => {
  assert.throws(
    () => twilioInboundRuntime(bindings({ TWILIO_AUTH_TOKEN: "" })),
    (error) => error instanceof RuntimeConfigurationError && error.code === "missing_binding",
  );
  assert.throws(
    () => twilioInboundRuntime(bindings({ TWILIO_WHATSAPP_WEBHOOK_URL: "https://example.com/wrong" })),
    (error) => error instanceof RuntimeConfigurationError && error.code === "invalid_url",
  );
  assert.throws(
    () => d1Database(bindings({ DB: undefined })),
    (error) => error instanceof RuntimeConfigurationError && error.code === "missing_d1",
  );
  assert.throws(
    () => healthProbeToken(bindings({ MED250_HEALTH_PROBE_TOKEN: "too-short" })),
    (error) => error instanceof RuntimeConfigurationError && error.code === "invalid_secret",
  );
});
