import assert from "node:assert/strict";
import test from "node:test";

import {
  composeOutboxMessage,
  sendTwilioMessage,
  TwilioSendError,
} from "../worker/backend/twilio-send.ts";
import { encryptOtpCode } from "../worker/backend/secure-token.ts";
import { parseClientAction } from "../worker/backend/whatsapp-actions.ts";

const runtime = {
  accountSid: `AC${"0".repeat(32)}`,
  authToken: "test-only-auth-token",
  fromE164: "16622220600",
  inboundWebhookUrl: "https://med-250.com/api/twilio/whatsapp/inbound",
  statusCallbackUrl: "https://med-250.com/api/twilio/whatsapp/status",
  apiKey: "SK00000000000000000000000000000001",
  apiSecret: "test-only-api-secret",
  clientDispatchConfirmationContentSid: "HX00000000000000000000000000000008",
  locationCaptureContentSid: "HX00000000000000000000000000000007",
  locationChoiceContentSid: "HX00000000000000000000000000000002",
  pharmacyClientMediaContentSid: "HX00000000000000000000000000000003",
  pharmacyRequestContentSid: "HX00000000000000000000000000000006",
  pharmacyOtpContentSid: "HX00000000000000000000000000000004",
  customerOtpContentSid: "HX00000000000000000000000000000005",
  otpEncryptionSecret: "test-only-otp-encryption-secret-with-at-least-32-bytes",
};

function delivery(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "client_media_request",
    requestId: "00000000-0000-4000-8000-000000000002",
    pharmacyId: "00000000-0000-4000-8000-000000000003",
    recipientE164: "250788100000",
    payload: {},
    requestReference: "WA-TEST-001",
    customerE164: "250780000000",
    mediaCount: 1,
    mediaIndex: 0,
    r2Key: "client-requests/test/image.jpg",
    distanceM: 1_250,
    ...overrides,
  };
}

test("composes the submitted image template without medicine lists and with an opaque R2 grant token", async () => {
  const message = await composeOutboxMessage(delivery(), runtime, "a".repeat(43));
  assert.equal(message.kind, "content");
  assert.equal(message.contentSid, runtime.pharmacyClientMediaContentSid);
  assert.equal(message.variables["1"], "WA-TEST-001");
  assert.equal(message.variables["2"], "1 of 1");
  assert.equal(message.variables["3"], "+250780000000");
  assert.equal(message.variables["5"], "a".repeat(43));
  assert.equal(message.variables["6"], "med250:media:can:00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003");
  assert.doesNotMatch(JSON.stringify(message.variables), /medicine name|catalogue list|pack size/i);
});

test("composes pharmacy dispatches and parses replies for governed registry pharmacy IDs", async () => {
  const pharmacyId = "retail-rw-fda-123";
  const message = await composeOutboxMessage(delivery({ pharmacyId }), runtime, "a".repeat(43));
  assert.equal(
    message.variables["6"],
    `med250:media:can:00000000-0000-4000-8000-000000000002:${pharmacyId}`,
  );
  assert.deepEqual(
    parseClientAction(message.variables["6"]),
    {
      kind: "pharmacy_response",
      response: "can_fulfil",
      requestId: "00000000-0000-4000-8000-000000000002",
      pharmacyId,
    },
  );
});

test("uses a manual WhatsApp location prompt, saved/new choices and a dispatch confirmation", async () => {
  const capture = await composeOutboxMessage(delivery({
    kind: "location_capture",
    pharmacyId: null,
    r2Key: null,
    customerE164: null,
    payload: {
      actor_id: "00000000-0000-4000-8000-000000000005",
      request_id: "00000000-0000-4000-8000-000000000002",
    },
  }), runtime, null);
  assert.equal(capture.kind, "content");
  assert.equal(capture.contentSid, runtime.locationCaptureContentSid);
  assert.deepEqual(capture.variables, {});

  const choice = await composeOutboxMessage(delivery({
    kind: "location_choice",
    pharmacyId: null,
    r2Key: null,
    customerE164: null,
    payload: {
      request_id: "00000000-0000-4000-8000-000000000002",
      location_id: "00000000-0000-4000-8000-000000000004",
    },
  }), runtime, null);
  assert.equal(choice.variables["1"], "med250:loc:saved:00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000004");
  assert.equal(choice.variables["2"], "med250:loc:new:00000000-0000-4000-8000-000000000002");

  const confirmation = await composeOutboxMessage(delivery({
    kind: "client_confirmation",
    pharmacyId: null,
    r2Key: null,
    customerE164: null,
    payload: { recipient_count: 10 },
  }), runtime, null);
  assert.equal(confirmation.kind, "service");
  assert.equal(confirmation.serviceKey, "delivered");
  assert.deepEqual(confirmation.variables, { "1": "10", "2": delivery().requestId });
});

test("accepts the location quick-reply payload and rejects malformed request IDs", () => {
  assert.deepEqual(
    parseClientAction("med250:loc:share:00000000-0000-4000-8000-000000000002"),
    { kind: "share_location", requestId: "00000000-0000-4000-8000-000000000002" },
  );
  assert.equal(parseClientAction("med250:loc:share:not-a-request"), null);
});

test("decrypts a durable OTP only while composing its audience-specific Twilio template", async () => {
  const challengeId = "00000000-0000-4000-8000-000000000009";
  const recipientE164 = "250780000000";
  const encrypted = await encryptOtpCode(
    "123456",
    { challengeId, e164: recipientE164, actorType: "client" },
    runtime.otpEncryptionSecret,
  );
  assert.doesNotMatch(JSON.stringify(encrypted), /123456/);
  const message = await composeOutboxMessage(delivery({
    kind: "otp",
    requestId: null,
    pharmacyId: null,
    recipientE164,
    r2Key: null,
    customerE164: null,
    payload: {
      challenge_id: challengeId,
      actor_type: "client",
      ...encrypted,
    },
  }), runtime, null);
  assert.equal(message.kind, "content");
  assert.equal(message.contentSid, runtime.customerOtpContentSid);
  assert.deepEqual(message.variables, { "1": "123456" });
});

test("uses the governed staff template for encrypted admin OTP delivery", async () => {
  const challengeId = "00000000-0000-4000-8000-000000000019";
  const recipientE164 = "250788700000";
  const encrypted = await encryptOtpCode(
    "654321",
    { challengeId, e164: recipientE164, actorType: "admin" },
    runtime.otpEncryptionSecret,
  );
  const message = await composeOutboxMessage(delivery({
    kind: "otp",
    requestId: null,
    pharmacyId: null,
    recipientE164,
    r2Key: null,
    customerE164: null,
    payload: {
      challenge_id: challengeId,
      actor_type: "admin",
      ...encrypted,
    },
  }), runtime, null);
  assert.equal(message.kind, "content");
  assert.equal(message.contentSid, runtime.pharmacyOtpContentSid);
  assert.deepEqual(message.variables, { "1": "654321" });
});

test("composes a database-backed web order summary with medicine quantities, media and direct client WhatsApp", async () => {
  const message = await composeOutboxMessage(delivery({
    kind: "web_catalogue_order",
    r2Key: null,
    payload: {
      item_summary: "2x Amoxicillin; 1x Paracetamol",
      total_units: 3,
      delivery_preference: "either",
    },
  }), runtime, "m".repeat(43));
  assert.equal(message.kind, "content");
  assert.equal(message.contentSid, runtime.pharmacyRequestContentSid);
  assert.equal(message.variables["2"], "2x Amoxicillin; 1x Paracetamol");
  assert.equal(message.variables["3"], "3");
  assert.equal(message.variables["4"], "+250780000000");
  assert.equal(message.variables["7"], "m".repeat(43));
  assert.equal(message.variables["8"], "med250:can:00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003");
});

test("sends via least-privilege Twilio API credentials with a status callback", async () => {
  let capturedUrl = "";
  let capturedHeaders;
  let capturedForm;
  const receipt = await sendTwilioMessage({
    kind: "text",
    toE164: "250780000000",
    body: "Test message",
  }, runtime, async (url, init) => {
    capturedUrl = String(url);
    capturedHeaders = new Headers(init.headers);
    capturedForm = new URLSearchParams(init.body);
    return Response.json({ sid: "MM00000000000000000000000000000009", status: "queued" });
  });
  assert.equal(receipt.sid, "MM00000000000000000000000000000009");
  assert.equal(capturedUrl, `https://api.twilio.com/2010-04-01/Accounts/${runtime.accountSid}/Messages.json`);
  assert.match(capturedHeaders.get("authorization"), /^Basic /);
  assert.equal(capturedForm.get("To"), "whatsapp:+250780000000");
  assert.equal(capturedForm.get("From"), "whatsapp:+16622220600");
  assert.equal(capturedForm.get("StatusCallback"), runtime.statusCallbackUrl);
});

test('shares the native service contact without an unsupported vCard caption',async()=>{
  const message=await composeOutboxMessage(delivery({kind:'client_guidance',payload:{guidance:'share_contact'}}),runtime,null);
  assert.equal(message.kind,'media');assert.equal(message.body,'');
  await sendTwilioMessage(message,runtime,async(url,init)=>{
    const form=new URLSearchParams(init.body);
    assert.equal(form.has('Body'),false);
    assert.equal(form.get('MediaUrl'),'https://med-250.com/whatsapp/med250.vcf');
    return Response.json({sid:'MM00000000000000000000000000000009',status:'queued'});
  });
});

test("falls back to the proven account credential only after a definitive key authorization rejection", async () => {
  const authorization = [];
  const receipt = await sendTwilioMessage({
    kind: "text",
    toE164: "250780000000",
    body: "Test message",
  }, runtime, async (_url, init) => {
    authorization.push(new Headers(init.headers).get("authorization"));
    if (authorization.length === 1) {
      return Response.json({ code: 70051, message: "Authorization Failed" }, { status: 403 });
    }
    return Response.json({ sid: "MM00000000000000000000000000000010", status: "queued" });
  });
  assert.equal(receipt.sid, "MM00000000000000000000000000000010");
  assert.deepEqual(authorization, [
    `Basic ${btoa(`${runtime.apiKey}:${runtime.apiSecret}`)}`,
    `Basic ${btoa(`${runtime.accountSid}:${runtime.authToken}`)}`,
  ]);
});

test("classifies definitive 503 responses as retryable and transport timeouts as ambiguous", async () => {
  await assert.rejects(
    sendTwilioMessage({ kind: "text", toE164: "250780000000", body: "Test" }, runtime, async () => (
      Response.json({ code: 20500, message: "temporary" }, { status: 503 })
    )),
    (error) => error instanceof TwilioSendError && error.retryable && !error.outcomeUnknown,
  );
  await assert.rejects(
    sendTwilioMessage({ kind: "text", toE164: "250780000000", body: "Test" }, runtime, async () => {
      throw new TypeError("network unavailable");
    }),
    (error) => error instanceof TwilioSendError
      && error.code === "twilio_transport_network"
      && !error.retryable
      && error.outcomeUnknown,
  );
});

test("keeps Twilio redirects observable as definitive HTTP failures", async () => {
  let redirectMode = "";
  await assert.rejects(
    sendTwilioMessage({ kind: "text", toE164: "250780000000", body: "Test" }, runtime, async (_url, init) => {
      redirectMode = init.redirect;
      return new Response("redirect", { status: 302, headers: { location: "https://api.twilio.com/other" } });
    }),
    (error) => error instanceof TwilioSendError
      && error.code === "twilio_http_302"
      && !error.retryable
      && !error.outcomeUnknown,
  );
  assert.equal(redirectMode, "manual");
});
