import assert from "node:assert/strict";
import test from "node:test";
import { BUSINESS_CONTENT, SERVICE_CONTENT, serviceDefinition } from "../worker/backend/whatsapp-content.ts";
import { SUPPORT_WHATSAPP_URL, publicContactChannels } from "../lib/public-contact-channels.mjs";

const revisedCopy = {
  send_image: "Send a clear image for your request. You can add up to 10 images.",
  pharmacy_welcome: "Receive MED+250 customer requests on this number? You can stop notifications at any time.",
  pharmacy_expired: "This request is no longer active or is not assigned to your number.",
  location_saved: "Location received for this request. Send an image to continue.",
  help: "Need help? Chat with our team on WhatsApp.\nSend PRIVACY for privacy, CANCEL to cancel, or STOP to opt out.",
};

test("routine copy revisions get new identities without renaming unchanged messages", () => {
  for (const [key, spec] of Object.entries(SERVICE_CONTENT)) {
    const definition = serviceDefinition(key);
    const revised = Object.hasOwn(revisedCopy, key);
    assert.equal(definition.friendly_name, `med250_service_${key}_v${revised ? 2 : 1}`);
    const contentType = spec.kind === "call-to-action" ? "twilio/call-to-action" : "twilio/quick-reply";
    if (revised) assert.equal(definition.types[contentType].body, revisedCopy[key]);
    assert.deepEqual(definition.types[contentType].actions, spec.actions);
    assert.equal(Object.hasOwn(definition, "version"), false);
  }
});

test("Help opens the owner-approved WhatsApp support chat without forwarding request data", () => {
  const content = serviceDefinition("help");
  assert.equal(content.friendly_name, "med250_service_help_v2");
  assert.deepEqual(content.types["twilio/call-to-action"].actions, [
    { type: "URL", title: "Chat with support", url: "https://wa.me/250795588248" },
  ]);
  assert.equal(publicContactChannels()[0].href, SUPPORT_WHATSAPP_URL);
  assert.equal(new URL(SUPPORT_WHATSAPP_URL).search, "");
  assert.doesNotMatch(content.types["twilio/call-to-action"].body, /mailto:|med-250\.com\/contact|email/i);
  assert.deepEqual(content.variables, {});
});

test("copy cleanup preserves clear recipient consent and truthful provider samples", () => {
  assert.equal(SERVICE_CONTENT.consent.body,
    "Share these {{1}} images and your WhatsApp number with up to 10 nearby pharmacies? Choose whether to save this location for next time.");
  assert.equal(BUSINESS_CONTENT.image.content.friendly_name, "med250_pharmacy_client_media_request_v5");
  assert.equal(BUSINESS_CONTENT.web.content.friendly_name, "med250_pharmacy_request_v4");
  assert.equal(BUSINESS_CONTENT.web.content.variables["2"], "2x Amoxicillin 500 mg; 1x Paracetamol 500 mg");
  assert.equal(BUSINESS_CONTENT.image.content.variables["5"], "sample");
  assert.equal(BUSINESS_CONTENT.web.content.variables["7"], "sample");
  for (const key of ["image", "web"]) {
    assert.deepEqual(BUSINESS_CONTENT[key].content.types["twilio/card"].actions.map(action => action.title),
      ["Available", "Not Available"]);
  }
});
