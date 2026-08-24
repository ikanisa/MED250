import assert from "node:assert/strict";
import test from "node:test";
import twilio from "twilio";

import {
  parseTwilioInboundMessage,
  parseTwilioStatusCallback,
  TwilioWebhookError,
} from "../worker/backend/twilio-webhook.ts";

const accountSid = `AC${"0".repeat(32)}`;
const authToken = "test-auth-token-not-a-live-secret";
const webhookUrl = "https://med-250.com/api/v1/webhooks/twilio/whatsapp";
const sender = "+16622220600";
const inboundMediaSid = "MM00000000000000000000000000000001";

function form(overrides = {}) {
  return {
    AccountSid: accountSid,
    MessageSid: inboundMediaSid,
    From: "whatsapp:+250788123456",
    To: `whatsapp:${sender}`,
    Body: "",
    NumMedia: "1",
    MediaContentType0: "image/jpeg",
    MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${inboundMediaSid}/Media/ME00000000000000000000000000000001`,
    ProfileName: "Test client",
    FutureTwilioField: "must-be-signed-too",
    ...overrides,
  };
}

function signedRequest(parameters, bodyOverride) {
  const body = bodyOverride ?? new URLSearchParams(parameters).toString();
  const signature = twilio.getExpectedTwilioSignature(authToken, webhookUrl, parameters);
  return new Request(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body,
  });
}

const validation = {
  accountSid,
  authToken,
  expectedAccountSid: accountSid,
  expectedToE164: sender,
};

test("accepts a signed image-only WhatsApp webhook including future fields", async () => {
  const parsed = await parseTwilioInboundMessage(signedRequest(form()), validation);
  assert.equal(parsed.fromE164, "250788123456");
  assert.equal(parsed.toE164, "16622220600");
  assert.equal(parsed.profileName, "Test client");
  assert.equal(parsed.messageSid, inboundMediaSid);
  assert.equal(parsed.media?.contentType, "image/jpeg");
  assert.equal(parsed.allParameters.FutureTwilioField, "must-be-signed-too");
});

test("rejects form tampering before returning any parsed event", async () => {
  const parameters = form();
  const tamperedBody = new URLSearchParams({ ...parameters, From: "whatsapp:+250788999999" }).toString();
  await assert.rejects(
    parseTwilioInboundMessage(signedRequest(parameters, tamperedBody), validation),
    (error) => error instanceof TwilioWebhookError
      && error.status === 403
      && error.code === "invalid_signature",
  );
});

test("rejects media hosted outside the configured Twilio account", async () => {
  const parameters = form({ MediaUrl0: "https://example.com/private.jpg" });
  await assert.rejects(
    parseTwilioInboundMessage(signedRequest(parameters), validation),
    (error) => error instanceof TwilioWebhookError
      && error.status === 400
      && error.code === "untrusted_media_url",
  );
});

test("accepts a signed Rwanda location and rejects incomplete coordinates", async () => {
  const location = form({
    NumMedia: "0",
    Latitude: "-1.9441",
    Longitude: "30.0619",
    Address: "Kigali",
  });
  delete location.MediaContentType0;
  delete location.MediaUrl0;
  const parsed = await parseTwilioInboundMessage(signedRequest(location), validation);
  assert.equal(parsed.latitude, -1.9441);
  assert.equal(parsed.longitude, 30.0619);

  const incomplete = { ...location };
  delete incomplete.Longitude;
  await assert.rejects(
    parseTwilioInboundMessage(signedRequest(incomplete), validation),
    (error) => error instanceof TwilioWebhookError && error.code === "incomplete_location",
  );
});

test("rejects an oversized webhook body without buffering it", async () => {
  const request = new Request(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(65 * 1024),
      "x-twilio-signature": "invalid",
    },
    body: "x=1",
  });
  await assert.rejects(parseTwilioInboundMessage(request, validation), /byte limit/);
});

test("validates evolving status callbacks and maps WhatsApp read receipts", async () => {
  const statusUrl = "https://med-250.com/api/twilio/whatsapp/status";
  const parameters = {
    AccountSid: accountSid,
    MessageSid: "SM00000000000000000000000000000002",
    From: `whatsapp:${sender}`,
    To: "whatsapp:+250788123456",
    MessageStatus: "delivered",
    EventType: "READ",
    FutureStatusField: "included-in-signature",
  };
  const signature = twilio.getExpectedTwilioSignature(authToken, statusUrl, parameters);
  const request = new Request(statusUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body: new URLSearchParams(parameters),
  });
  const parsed = await parseTwilioStatusCallback(request, {
    ...validation,
    canonicalUrl: statusUrl,
  });
  assert.equal(parsed.providerStatus, "read");
  assert.equal(parsed.allParameters.FutureStatusField, "included-in-signature");
});

test("rejects status callbacks signed for a different canonical URL", async () => {
  const statusUrl = "https://med-250.com/api/twilio/whatsapp/status";
  const parameters = {
    AccountSid: accountSid,
    MessageSid: "SM00000000000000000000000000000002",
    From: `whatsapp:${sender}`,
    MessageStatus: "sent",
  };
  const wrongSignature = twilio.getExpectedTwilioSignature(authToken, `${statusUrl}?wrong=1`, parameters);
  const request = new Request(statusUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": wrongSignature,
    },
    body: new URLSearchParams(parameters),
  });
  await assert.rejects(
    parseTwilioStatusCallback(request, { ...validation, canonicalUrl: statusUrl }),
    (error) => error instanceof TwilioWebhookError && error.code === "invalid_signature",
  );
});
