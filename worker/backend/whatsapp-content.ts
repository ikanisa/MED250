// Static, versioned in-session definitions. Never submit arbitrary customer text as a template.
import { SUPPORT_WHATSAPP_URL } from "../../lib/public-contact-channels.mjs";
type ServiceBase = { version?: number; body: string; samples: Record<string, string> };
export type ServiceContent = ServiceBase & (
  | { kind?: "quick-reply"; actions: { title: string; id: string }[] }
  | { kind: "call-to-action"; actions: { type: "URL"; title: string; url: string }[] }
);
const help = { title: "Help", id: "med250:service:help" };
const cancel = { title: "Cancel", id: "med250:draft:cancel:{{2}}" };
const sampleRequest = "00000000-0000-4000-8000-000000000001";
export const SERVICE_CONTENT: Record<string, ServiceContent> = {
  draft: { body: "Received {{1}} images. Send another image or tap Ready.", actions: [{ title: "Ready", id: "med250:draft:ready:{{2}}" }, cancel, help], samples: { "1": "2", "2": sampleRequest } },
  consent: { body: "Share these {{1}} images and your WhatsApp number with up to 10 nearby pharmacies? Choose whether to save this location for next time.", actions: [{ title: "Send & save", id: "med250:draft:send_save:{{2}}" }, { title: "Send once", id: "med250:draft:send_once:{{2}}" }, cancel], samples: { "1": "2", "2": sampleRequest } },
  delivered: { body: "Your request reached {{1}} nearby pharmacies. They can contact you directly on WhatsApp.", actions: [{ title: "Share Med+250", id: "med250:service:share" }, { title: "Status", id: "med250:draft:status:{{2}}" }, help], samples: { "1": "10", "2": sampleRequest } },
  status: { body: "{{1}} pharmacies received your complete request. Delivery to {{2}} is still unconfirmed.", actions: [help], samples: { "1": "7", "2": "3" } },
  no_pharmacy: { body: "No eligible pharmacy was found for this location. Your request was not sent.", actions: [{ title: "New request", id: "med250:service:new" }, help], samples: {} },
  delivery_failed: { body: "We could not deliver your complete request to a pharmacy. Please contact support.", actions: [help, { title: "New request", id: "med250:service:new" }], samples: {} },
  send_image: { version: 2, body: "Send a clear image for your request. You can add up to 10 images.", actions: [help], samples: {} },
  media_failed: { body: "That image could not be saved. Please resend a clear JPG or PNG under 5 MB.", actions: [help, { title: "Cancel request", id: "med250:service:cancel" }], samples: {} },
  waiting_media: { body: "Your images are still being saved. Please wait before continuing.", actions: [help], samples: {} },
  request_locked: { body: "Please finish or cancel your current request before adding more images.", actions: [{ title: "Cancel request", id: "med250:service:cancel" }, help], samples: {} },
  expired: { body: "That request or action has expired. Send a new image to start again.", actions: [{ title: "New request", id: "med250:service:new" }, help], samples: {} },
  cancelled: { body: "Your request is cancelled. Images already delivered cannot be recalled.", actions: [{ title: "New request", id: "med250:service:new" }, help], samples: {} },
  stopped: { body: "WhatsApp notifications are stopped. Tap Resume if you want to receive them again.", actions: [{ title: "Resume", id: "med250:service:start" }], samples: {} },
  resumed: { body: "WhatsApp notifications are enabled. You can stop them at any time by sending STOP.", actions: [help], samples: {} },
  pharmacy_welcome: { version: 2, body: "Receive MED+250 customer requests on this number? You can stop notifications at any time.", actions: [{ title: "Enable requests", id: "med250:service:start" }, help], samples: {} },
  pharmacy_ack: { body: "{{1}} recorded for request {{2}}. Contact the customer to confirm details; this is not a price quotation.", actions: [help], samples: { "1": "Available", "2": "WA-TEST-001" } },
  pharmacy_expired: { version: 2, body: "This request is no longer active or is not assigned to your number.", actions: [help], samples: {} },
  share_invite: { body: "Keep in touch with Med+250 on WhatsApp: +1 662-222-0600. Forward our contact card to invite a friend.", actions: [help], samples: {} },
  help: { version: 2, kind: "call-to-action", body: "Need help? Chat with our team on WhatsApp.\nSend PRIVACY for privacy, CANCEL to cancel, or STOP to opt out.", actions: [{ type: "URL", title: "Chat with support", url: SUPPORT_WHATSAPP_URL }], samples: {} },
  privacy: { body: "Your request images and WhatsApp number are shared only after you confirm. Your location is reused only when you choose to save it.", actions: [{ title: "Forget location", id: "med250:service:forget" }, help], samples: {} },
  forgotten: { body: "Your location will no longer be offered for reuse. Existing request records follow the retention policy.", actions: [help], samples: {} },
  location_saved: { version: 2, body: "Location received for this request. Send an image to continue.", actions: [help], samples: {} },
  partner_location_received: { body: "MED+250 received your business location for review.\nFuture alerts are optional; tap Enable alerts or reply STOP to stop.", actions: [{title:"Enable alerts",id:"med250:service:start"},help], samples: {} },
  partner_location_retry: { body: "Please share your business location in Rwanda while at your premises.\nTap + or 📎 → Location → Send your current location.", actions: [help], samples: {} },
  limit: { body: "One request can contain up to 10 images. Tap Ready on your current request to continue.", actions: [help], samples: {} },
};

export function serviceDefinition(key: string) {
  const spec = SERVICE_CONTENT[key];
  if (!spec) throw new Error("Unknown WhatsApp service message.");
  return {
    // New copy gets a new registry identity; existing provider content is immutable.
    friendly_name: `med250_service_${key}_v${spec.version ?? 1}`, language: "en", variables: spec.samples,
    types: { [spec.kind === "call-to-action" ? "twilio/call-to-action" : "twilio/quick-reply"]: { body: spec.body, actions: spec.actions } },
  };
}

export const WEB_ORDER_BODY = "MED+250 request {{1}}. Items: {{2}}. Units: {{3}}. Customer WhatsApp: {{4}}. {{5}}. Fulfilment: {{6}}. Full details are in your pharmacy portal.";
export const IMAGE_REQUEST_BODY = "New MED+250 request {{1}}. Image {{2}}.\nCustomer WhatsApp: {{3}}. Routing: {{4}}.\nReply directly to the customer or confirm below.";

// Explicit defaults are also the approval samples. In particular media sample
// variables must never be omitted by a Console duplication operation.
const STANDARD_BUSINESS_CONTENT = {
  image: { category:"UTILITY",content:{friendly_name:"med250_pharmacy_client_media_request_v5",language:"en",
    variables:{"1":"WA-TEST-001","2":"1 of 2","3":"+250788000000","4":"Approx. 1.2 km away","5":"sample",
      "6":`med250:media:can:${sampleRequest}:00000000-0000-4000-8000-000000000002`,
      "7":`med250:media:cannot:${sampleRequest}:00000000-0000-4000-8000-000000000002`},
    types:{"twilio/card":{title:IMAGE_REQUEST_BODY,media:["https://med-250.com/whatsapp-client-media/{{5}}.png"],
      actions:[{type:"QUICK_REPLY",title:"Available",id:"{{6}}"},{type:"QUICK_REPLY",title:"Not Available",id:"{{7}}"}]}}}},
  web: { category:"UTILITY",content:{friendly_name:"med250_pharmacy_request_v4",language:"en",
    variables:{"1":"MED250-TEST-001","2":"2x Amoxicillin 500 mg; 1x Paracetamol 500 mg","3":"3","4":"+250788000000",
      "5":"Approx. 1.2 km away","6":"pickup or delivery","7":"sample",
      "8":`med250:can:${sampleRequest}:00000000-0000-4000-8000-000000000002`,
      "9":`med250:cannot:${sampleRequest}:00000000-0000-4000-8000-000000000002`},
    types:{"twilio/card":{title:WEB_ORDER_BODY,media:["https://med-250.com/whatsapp-order-media/{{7}}.png"],
      actions:[{type:"QUICK_REPLY",title:"Available",id:"{{8}}"},{type:"QUICK_REPLY",title:"Not Available",id:"{{9}}"}]}}}},
  otp: { category:"AUTHENTICATION",content:{friendly_name:"med250_whatsapp_otp_v2",language:"en",variables:{"1":"123456"},
    types:{"whatsapp/authentication":{add_security_recommendation:true,code_expiration_minutes:5,actions:[{type:"COPY_CODE",copy_code_text:"Copy Code"}]}}}},
};
const initialActions = { type: "QUICK_REPLY", title: "Enable alerts", id: "med250:service:start" };
export const INITIAL_ALERT_INVITATION = "Want future requests? Tap Enable alerts. Reply STOP to stop.";
export const BUSINESS_CONTENT = {
  ...STANDARD_BUSINESS_CONTENT,
  location_initial: { category: "UTILITY", content: {
    friendly_name: "med250_partner_location_confirmation_v1", language: "en", variables: {},
    types: { "twilio/quick-reply": {
      body: "MED+250: at your premises, share your business location: + or 📎 → Location → Send your current location.\nFor future customer request alerts, tap Enable alerts. Reply STOP to stop.",
      actions: [{title:"Enable alerts",id:"med250:service:start"},{title:"Stop messages",id:"med250:service:stop"}],
    } },
  } },
  image_initial: { category: "UTILITY", content: {
    ...STANDARD_BUSINESS_CONTENT.image.content, friendly_name: "med250_partner_first_image_v1",
    types: { "twilio/card": { ...STANDARD_BUSINESS_CONTENT.image.content.types["twilio/card"],
      title: `New MED+250 request {{1}}. Image {{2}}. Customer WhatsApp: {{3}}. Routing: {{4}}.\n${INITIAL_ALERT_INVITATION}`,
      actions: [...STANDARD_BUSINESS_CONTENT.image.content.types["twilio/card"].actions, initialActions] } },
  } },
  web_initial: { category: "UTILITY", content: {
    ...STANDARD_BUSINESS_CONTENT.web.content, friendly_name: "med250_partner_first_web_v1",
    types: { "twilio/card": { ...STANDARD_BUSINESS_CONTENT.web.content.types["twilio/card"],
      title: `${WEB_ORDER_BODY}\n${INITIAL_ALERT_INVITATION}`,
      actions: [...STANDARD_BUSINESS_CONTENT.web.content.types["twilio/card"].actions, initialActions] } },
  } },
};
export type BusinessContentKey = keyof typeof BUSINESS_CONTENT;
export function businessContentKey(kind: string, payload: Record<string, unknown>): BusinessContentKey {
  if (kind === "otp") return "otp";
  const initial = payload.permission_basis === "owner_attested_initial";
  return kind === "client_media_request" ? (initial ? "image_initial" : "image") : (initial ? "web_initial" : "web");
}

export const SERVICE_VCARD = ["BEGIN:VCARD", "VERSION:3.0", "FN:Med+250", "N:;Med+250;;;", "TEL;TYPE=CELL:+16622220600", "URL:https://med-250.com", "END:VCARD", ""].join("\r\n");
