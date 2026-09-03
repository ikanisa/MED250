# MED+250 WhatsApp template audit — 2 September 2026

## Verdict

**Not ready for unrestricted production WhatsApp dispatch.** All six core message families exist in Twilio, and their seven production bindings were read directly in Cloudflare. However, the configured image-dispatch, web-order and authentication templates remain **Received**, not Approved. Three client-service templates are intentionally **Not submitted** and are usable only within the customer-service window. Additional failure, consent/support and multi-image conversation handling is incomplete.

This is a live provider/configuration audit plus source review and local tests—not evidence that a real order reached ten pharmacies. No patient media, pharmacy test messages, production bindings, database rows or sender settings were changed during this audit.

## Authorized change completed

- Created `med250_pharmacy_client_media_request_v4`, Content SID `HX4c2a1289aeeaf9b7d75782f3ff617aa9`.
- Changed only button labels to **Available** and **Not Available**; kept the message, media URL and action payload variables `{{6}}` / `{{7}}` unchanged.
- Submitted as English / Utility on 2 September at approximately 09:09 GMT+2.
- Twilio accepted submission, then showed **Rejected**, updated `2026-09-02 09:09:54 GMT+2`. Neither inspected detail tab displayed a specific rejection reason. The cause is unknown.
- V3, `HXc40fbd759da820c338972f0f0e8c4a09`, remains **Pending**. V2, V3 and the existing sender were preserved.
- Posted the new SID and exact observed rejection to [Twilio ticket #29185539](https://help.twilio.com/tickets/29185539). Read back the posted comment timestamped **09:12 AM, 2 September 2026**. Requested Meta registration/review state, rejection code/reason and supported correction/appeal steps. No response to that comment was verified in this audit.
- V4 was **not** activated in production.

## Live configuration and provenance

Production Worker: `med250-marketplace-gikundiro`, origin `https://med-250.com`.

Cloudflare displayed `MED250_BACKEND_MODE=worker-d1`, `MED250_WHATSAPP_PROVIDER=twilio`, sender `whatsapp:+16622220600`, production dispatch queues and an every-minute trigger. Credential values remained encrypted and were not revealed.

Cloudflare's declared release revision is `a700b1db5dd4bf9fc94d89fc4a26a648b5ac6772`; local HEAD is `f65102273f634da2b32416ca215ca5be1feebbd5`. These are different. The diff of reviewed message composition/repository code adds admin OTP support; the client/pharmacy template, failure-path and routing findings below are unchanged across those revisions. A declared release variable alone does not prove the deployed bundle's contents. No deployment was made.

## Core template inventory

The MED250-filtered Console inventory contained 18 templates across two pages; no MED250 row displayed Approved at inspection. Unrelated approved easyMO/Verify templates were not substituted.

| Message purpose | Production Content SID / template | Observed approval | Assessment |
| --- | --- | --- | --- |
| Client image to pharmacy | `HXfb3ab7b129be309d85a19195861e48ad` — `med250_pharmacy_client_media_request_v2` | Received | Exists, but blocked for business-initiated dispatch. Production still uses this old SID and old labels. V3 Pending; requested-label V4 Rejected. |
| Website order to pharmacy | `HX45b1dbe72d7becfc4db5832d446af8db` — `med250_pharmacy_request_v3` | Received | Contains medicine summary, units, customer number, distance, fulfilment and one image. Approval blocked; old Can fulfil / Cannot fulfil labels; text-length and per-item-media gaps. |
| Customer/pharmacy OTP | `HX95625ee01441ee6364d08237855ba232` — `med250_whatsapp_otp_v1` | Received | Correct Authentication format, Copy Code, security reminder and five-minute expiry. Console says not eligible even for user-initiated messages until approved. Both customer and pharmacy bindings use it. Local admin flow also reuses the pharmacy binding. |
| First location request | `HX1882b320f72461dfede208c970cabd88` — `med250_client_manual_location_v3` | Not submitted | Wording matches the approved manual native-WhatsApp instructions; no external maps button. Deliberate text-only exception. Suitable in-session. |
| Saved/new location | `HX50d736062b44b3ae9d402d12d37801c4` — `med250_client_location_choice_manual_v2` | Not submitted | Correct Use saved / Share new quick replies; payloads match the parser. Suitable in-session. Share new requests the manual location message, not an app deep link. |
| Dispatch confirmation and invitation | `HX7b8a702a3b8547c8faef6d19e5840b3c` — `med250_client_dispatch_share_v1` | Not submitted | Correct variable count and Share Med+250 URL CTA. Suitable in-session; sharing behavior still requires physical iOS/Android verification. Referral wording must also clear the policy concern below. |

Unsubmitted client-service templates are **not inherently a defect**: in-session text, quick replies and supported URL CTA messages can be used without prior template approval. Outside the 24-hour window, approved templates are required. See [Twilio button guidance](https://www.twilio.com/docs/whatsapp/buttons) and [session rules](https://www.twilio.com/docs/whatsapp/key-concepts?display=embedded).

### Current client-facing copy

First location:

> We received your requests, please share your current location in WhatsApp:
> Tap + or 📎 → Location → Send your current location

Returning client:

> We received your requests, please use your saved location or share a new one

Buttons: **Use saved** / **Share new**.

Successful delivery confirmation:

> Your request was dispatched to {{1}} nearby pharmacies. They will reply to you directly on WhatsApp.

Button: **Share Med+250**. Its URL contains this invitation:

> Order medicines and prescriptions from nearby pharmacies with MED+250 on WhatsApp: https://wa.me/16622220600

This is a user-initiated sharing URL, not an automatic message to contacts. The actual mobile chooser/forward behavior was not tested. The statement “They will reply” is a promise the platform cannot enforce; consider “They can reply” in a reviewed revision.

### Requested pharmacy image message

> New MED+250 request {{1}}. Image {{2}}.
> Customer WhatsApp: {{3}}. Routing: {{4}}.
> Reply directly to the customer or confirm below.

V4 buttons: **Available** / **Not Available**. Media: `https://med-250.com/whatsapp-client-media/{{5}}.png`.

The two labels are 9 and 13 characters, within Twilio's documented WhatsApp quick-reply title limit. The action IDs remain compatible with the existing response parser. V4 retains the exact three-line pharmacy copy requested earlier; it has not silently been shortened to meet the separate client-message preference. [Twilio card specification](https://www.twilio.com/docs/content/twiliocard).

## Findings and required work

### P0 — Provider review and production bindings

1. Resolve V4's rejection with Twilio before using it. Do not assume that pending V3 or a valid SID means approved. Do not repeatedly duplicate templates without understanding the rejection.
2. Address the separately configured **web-order** and **OTP** templates stuck in Received. They predate the WABA fix, but the same root cause is an inference until Twilio confirms their Meta-side state.
3. After appropriate templates actually become Approved, update the reviewed production bindings and setup manifest together. The setup source still names image-request V2 and uses the old labels. A provider-side duplicate does not update the Worker automatically.

### P0 — Suitability of the medicine/prescription business flow

WhatsApp's policy restricts facilitating drug and healthcare-product exchange. Its limited OTC messaging exceptions do not list Rwanda; those exceptions still prohibit regulated-goods commerce experiences. Prescription-image ordering, the web-order card and the referral invitation therefore raise a substantive policy concern, not merely a wording problem. The policy also requires opt-in, opt-out handling and permissions for data use/sharing, and restricts forwarding customer-chat information. Obtain a written provider assessment of this specific Rwanda workflow and the pharmacies' role; redesign any prohibited activity rather than disguising it. **This is not a proven explanation of V4's rejection.** [WhatsApp Business Messaging Policy, sections 1–5](https://business.whatsapp.com/policy).

### P1 — Missing or incomplete conversation cases

| Case | What currently happens | Needed outcome |
| --- | --- | --- |
| No eligible pharmacy | Dispatch records cancellation/audit evidence; no client notification is enqueued on the inspected path. | Short truthful failure message with working support/new-request actions. |
| Every pharmacy delivery fails | Finalizer cancels and logs the request, but explicitly returns without queuing a client confirmation. | Distinct delivery-failure notification; never use success wording. |
| Some deliveries succeed | Confirmation waits until all attempts are terminal, then uses delivered/read count. | Keep actual count. Add a bounded delayed/unknown-status path so the client is not left waiting indefinitely. |
| Greeting / image instructions / file-save failure / location saved before an image | Runtime returns lengthy plain-text guidance without action buttons. | Reviewed short guidance with real support/continue actions, while keeping the explicit manual-location exception. |
| Medicine photo plus prescription photo | Each new inbound photo creates a new request. Native location chooses the most recent active request. | Group sequential photos into one draft, identify the image count and provide a clear ready-to-dispatch action; test that neither image is stranded. |
| Pharmacy taps availability | Response is recorded; no pharmacy acknowledgment is queued in the inspected handler. | Brief acknowledgment with request reference, plus a clear route to the customer. Do not imply medicine was supplied. |
| STOP / HELP / cancellation | No explicit command or opt-out/help branch found in the current inbound handler or inspected D1 flow. | Implement suppression, cancellation and a genuine human-support route; connect message actions to those handlers. |
| Permission to send photos/contact details to pharmacies and retain location | Native location is timestamped as consented; the inspected client prompts do not explain image/number forwarding or retention. Pharmacy eligibility checks verification/enablement, not a distinct opt-in record. | Establish and record the appropriate notices/permissions and enforce pharmacy opt-out. Do not treat “known number” as proof of messaging permission. |

These are conversation cases; they do not necessarily require a separate Meta-approved template for every case. In-session Content templates can share a reviewed design. Do not submit every guidance message for approval indiscriminately.

Source: [message composer](/Volumes/PRO-G40/MED250/worker/backend/twilio-send.ts:177), [delivery finalizer](/Volumes/PRO-G40/MED250/worker/backend/whatsapp-repository.ts:104), [new image handling](/Volumes/PRO-G40/MED250/worker/backend/whatsapp-repository.ts:234), [location dispatch](/Volumes/PRO-G40/MED250/worker/backend/whatsapp-repository.ts:357), [pharmacy response](/Volumes/PRO-G40/MED250/worker/backend/whatsapp-repository.ts:530), [inbound action handler](/Volumes/PRO-G40/MED250/worker/backend/whatsapp-runtime.ts:40).

### P1 — Window enforcement and message size

- The inspected outbox/send path does not enforce the recipient's 24-hour service-window cutoff before sending unapproved service templates or free-form replies. Delayed callbacks/retries need an expiry/suppression or approved fallback route. A client's inbound message does **not** open a service window for the ten recipient pharmacies. [Twilio outside-window error guidance](https://www.twilio.com/docs/api/errors/63016).
- Web-order composition truncates only the medicine summary to 900 characters. A synthetic expansion using the actual template, a 900-character summary and ordinary other values produced **1,127 characters**, exceeding the documented **1,024-character** WhatsApp card-title limit. Bound the complete rendered message and avoid cutting medicine details mid-item; use a secure detailed order view when necessary. [Twilio card limits](https://www.twilio.com/docs/content/twiliocard).
- Web dispatch contains one lead image plus a compact text summary, not a separate image/card for every database item. This does not fully meet the earlier per-item catalogue-like presentation request. Do not add regulated-goods catalogue features before resolving policy suitability.

Source: [web-order composer](/Volumes/PRO-G40/MED250/worker/backend/twilio-send.ts:95), [order payload](/Volumes/PRO-G40/MED250/worker/backend/order-repository.ts:310), [outbox sender](/Volumes/PRO-G40/MED250/worker/backend/outbox-runtime.ts:123).

## Routing and security positives — with evidence limits

- Current source classifies known pharmacy numbers separately; other inbound numbers become client actors. Button response processing checks the assigned pharmacy identity.
- Selection filters licensed, approved, dispatch-enabled, verified/geocoded pharmacies and verified WhatsApp contacts, calculates straight-line distance and takes at most ten, with stable tie ordering. This means **nearest eligible pharmacies by straight-line distance**, not fastest Google Maps journey or guaranteed stock.
- Private media uses expiring, bounded-fetch grants. Submission samples were synthetic, not patient information.
- Success confirmation is queued from delivered/read evidence after all pharmacy attempts become terminal, not merely because ten recipients were selected.
- **31/31 focused local tests passed** for composition, provider setup, signature verification, runtime configuration and delivery finality. Tests use fixtures/mocks; they do not prove provider approval, ten live deliveries or physical-phone rendering.

Source: [eligibility and nearest-ten selection](/Volumes/PRO-G40/MED250/worker/backend/dispatch-repository.ts:39), [actor classification](/Volumes/PRO-G40/MED250/worker/backend/whatsapp-repository.ts:174), [media grants](/Volumes/PRO-G40/MED250/worker/backend/whatsapp-repository.ts:657).

## Next controlled sequence

1. Obtain V4's rejection reason and resolve the policy-suitability question; preserve the working sender and all existing SIDs.
2. Resolve approval of the exact dispatch and OTP templates intended for use. Separately review the web-order labels and size-limited layout.
3. Implement the missing failure, multi-image, window, opt-out/support and permission handling with focused regression tests.
4. Verify approved SIDs and payload maps, then update only the intended Cloudflare production bindings and reproducible setup definitions.
5. With explicit test authorization and consenting recipients, verify image receipt, saved/new native location, the ranked eligible recipient set, provider callbacks, real delivered count, pharmacy action handling and mobile Share behavior. Never report “sent to 10” without corresponding recipient and delivery evidence.

No extra template submission, production change, patient forwarding or live order test was performed beyond the authorized V4 submission and support notification.
