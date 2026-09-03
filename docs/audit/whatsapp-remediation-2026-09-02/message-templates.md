# MED+250 WhatsApp message inventory — 2 September 2026

Source: the shared production definitions in `worker/backend/whatsapp-content.ts` and `scripts/twilio-whatsapp-setup.mjs`. This inventory describes code/configuration, not provider approval.

No WhatsApp catalogue, product-list message, external location button or Facebook runtime token is used. The website catalogue is separate. Business templates require live approval; service replies are limited to the recipient's 24-hour window.

| Template | Message / purpose | Actions | Review requirement |
| --- | --- | --- | --- |
| med250_pharmacy_request_v4 | MED+250 request {{1}}. Items: {{2}}. Units: {{3}}. Customer WhatsApp: {{4}}. {{5}}. Fulfilment: {{6}}. Full details are in your pharmacy portal. | Available / Not Available | WhatsApp approval required |
| med250_whatsapp_otp_v2 | Authentication code; five-minute expiry | Copy Code | WhatsApp approval required |
| med250_client_manual_location_v3 | We received your requests, please share your current location in WhatsApp:<br>Tap + or 📎 → Location → Send your current location | Manual native location instruction | In-session only |
| med250_client_location_choice_manual_v2 | We received your requests, please use your saved location or share a new one | Use saved / Share new | In-session only |
| med250_service_delivered_v1 | Your request reached {{1}} nearby pharmacies. They can contact you directly on WhatsApp. | Share Med+250 / Status / Help | In-session only |
| med250_pharmacy_client_media_request_v5 | New MED+250 request {{1}}. Image {{2}}.<br>Customer WhatsApp: {{3}}. Routing: {{4}}.<br>Reply directly to the customer or confirm below. | Available / Not Available | WhatsApp approval required |
| med250_partner_first_image_v1 | New MED+250 request {{1}}. Image {{2}}. Customer WhatsApp: {{3}}. Routing: {{4}}.<br>Want future requests? Tap Enable alerts. Reply STOP to stop. | Available / Not Available / Enable alerts | WhatsApp approval required; owner-attested initial request only |
| med250_partner_first_web_v1 | Same complete web request details as V4 above.<br>Want future requests? Tap Enable alerts. Reply STOP to stop. | Available / Not Available / Enable alerts | WhatsApp approval required; owner-attested initial request only |
| med250_service_draft_v1 | Received {{1}} images. Send another image or tap Ready. | Ready / Cancel / Help | In-session only |
| med250_service_consent_v1 | Share these {{1}} images and your WhatsApp number with up to 10 nearby pharmacies? Choose whether to save this location for next time. | Send & save / Send once / Cancel | In-session only |
| med250_service_status_v1 | {{1}} pharmacies received your complete request. Delivery to {{2}} is still unconfirmed. | Help | In-session only |
| med250_service_no_pharmacy_v1 | No eligible pharmacy was found for this location. Your request was not sent. | New request / Help | In-session only |
| med250_service_delivery_failed_v1 | We could not deliver your complete request to a pharmacy. Please contact support. | Help / New request | In-session only |
| med250_service_send_image_v2 | Send a clear image for your request. You can add up to 10 images. | Help | In-session only |
| med250_service_media_failed_v1 | That image could not be saved. Please resend a clear JPG or PNG under 5 MB. | Help / Cancel request | In-session only |
| med250_service_waiting_media_v1 | Your images are still being saved. Please wait before continuing. | Help | In-session only |
| med250_service_request_locked_v1 | Please finish or cancel your current request before adding more images. | Cancel request / Help | In-session only |
| med250_service_expired_v1 | That request or action has expired. Send a new image to start again. | New request / Help | In-session only |
| med250_service_cancelled_v1 | Your request is cancelled. Images already delivered cannot be recalled. | New request / Help | In-session only |
| med250_service_stopped_v1 | WhatsApp notifications are stopped. Tap Resume if you want to receive them again. | Resume | In-session only |
| med250_service_resumed_v1 | WhatsApp notifications are enabled. You can stop them at any time by sending STOP. | Help | In-session only |
| med250_service_pharmacy_welcome_v2 | Receive MED+250 customer requests on this number? You can stop notifications at any time. | Enable requests / Help | In-session only |
| med250_service_pharmacy_ack_v1 | {{1}} recorded for request {{2}}. Contact the customer to confirm details; this is not a price quotation. | Help | In-session only |
| med250_service_pharmacy_expired_v2 | This request is no longer active or is not assigned to your number. | Help | In-session only |
| med250_service_share_invite_v1 | Keep in touch with Med+250 on WhatsApp: +1 662-222-0600. Forward our contact card to invite a friend. | Help | In-session only |
| med250_service_help_v2 | Need help? Chat with our team on WhatsApp.<br>Send PRIVACY for privacy, CANCEL to cancel, or STOP to opt out. | Chat with support → https://wa.me/250795588248 | In-session only; one URL action |
| med250_service_privacy_v1 | Your request images and WhatsApp number are shared only after you confirm. Your location is reused only when you choose to save it. | Forget location / Help | In-session only |
| med250_service_forgotten_v1 | Your location will no longer be offered for reuse. Existing request records follow the retention policy. | Help | In-session only |
| med250_service_location_saved_v2 | Location received for this request. Send an image to continue. | Help | In-session only |
| med250_service_limit_v1 | One request can contain up to 10 images. Tap Ready on your current request to continue. | Help | In-session only |

Sharing sends a short interactive invitation and a separate native vCard. The user forwards these themselves; nothing is automatically sent to their contacts. vCards are sent without an unsupported caption.

Pharmacy quick replies keep the existing payload meanings but display Available / Not Available. They record availability only, never an unpriced offer or a completed purchase.

Media sample defaults: `5=sample` for image requests, `7=sample` for web orders. They resolve to public, non-patient PNG samples on med-250.com; actual patient media uses short-lived opaque URLs.

Current 30-definition plan SHA-256: `043600e5f08f43895894a681b7feeea5c8746efb0ce222ea684c39cacbb35b08`.

The initial-request cards use a separately recorded owner attestation for one request bundle. They do not turn availability, delivery or silence into recurring opt-in. Enable alerts invokes the signed START action; future requests then use the ordinary two-button templates. The initial permission is consumed for that request even if delivery later fails. Each image retains the opt-in action so whichever image arrives first provides the choice. STOP revokes initial permission and recurring notifications. See `partner-initial-permission.md` for the production checkpoint.

Human support is WhatsApp-only at the owner-supplied +250 795 588 248; the automated ordering sender remains +1 662-222-0600. Help V2 uses a single URL action, without mixed quick-reply buttons, as supported for in-session [Twilio call-to-action messages](https://www.twilio.com/docs/content/twilio-call-to-action). Opening the support chat does not automatically forward request images, location, or customer details. The user chooses what to send. Typed PRIVACY, CANCEL and STOP remain available. Existing Help V1 content is preserved, not overwritten.

Copy revision: four routine replies use concise, generic operational wording. Their versioned names change without overwriting existing provider content. Consent still identifies the recipients; business-review names, realistic sample items, brand, actual order content and submitted business templates are unchanged. Wording cleanup does not establish a policy exemption or guarantee approval. See [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/).
