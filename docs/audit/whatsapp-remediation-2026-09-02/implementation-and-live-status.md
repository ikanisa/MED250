# MED+250 WhatsApp remediation — production implementation

Date: 2 September 2026. This report supersedes the earlier audit's technical findings and provider snapshots; it does not turn deployment or template approval into proof of real-phone delivery.

Later checkpoint: [routine-copy-update.md](routine-copy-update.md) records four scoped reply-copy revisions and fresh production Twilio checks showing image V5 and web V4 approved. The pending statuses below are retained as historical observations.

Later support checkpoint: [whatsapp-support-update.md](whatsapp-support-update.md) records the owner-approved WhatsApp-only support route at +250 795 588 248, the Help V2 action and its production verification. Older contact-page observations below describe the earlier checkpoint, not the current support configuration.

## Outcome and evidence boundary

Verdict: code deployed; unrestricted production dispatch and real-phone acceptance are not yet fully verified. The remaining gates below must not be presented as completed.

The remediation is deployed directly to the existing Cloudflare production service. Twilio remains the transport for +1 662-222-0600. There is no Supabase/Neon backend, Facebook runtime-token dependency, new Meta app, or WhatsApp catalogue/product-list implementation.

Production recipient readiness remains separate: the live database has 280 verified, active, dispatch-enabled pharmacy WhatsApp contacts, but no recorded messaging opt-ins. The migration deliberately did not fabricate consent from telephone verification. A registered pharmacy can send START or select Enable requests from its known number; existing consent evidence may instead be imported after review. With no eligible recipients, the client receives a truthful no-pharmacy response, not a claim that ten pharmacies were contacted.

No synthetic order was sent to real pharmacies in this work. Real-device rendering, a controlled complete request, pharmacy responses and ten-recipient delivery evidence are still required.

## Root cause established

The authenticated Twilio approval-resource read returned this exact reason for rejected V4, `HX4c2a1289aeeaf9b7d75782f3ff617aa9`:

> Problem: Failed to create template, Reason: Illegal character in path at index 42: https://med-250.com/whatsapp-client-media/{{5}}.png

That is a technical media-sample failure, not evidence of a pharmaceutical-policy rejection. The earlier duplicate-content explanation was only a hypothesis and is superseded.

The replacement definitions explicitly provide `5=sample` for the image card and `7=sample` for the web-order card. Both resolved sample URLs return HTTP 200 with image/png and contain no patient information. The Console Details page confirmed V5's sample and Available / Not Available labels. Twilio documents the requirement for a sample path in the variables object. [Twilio card specification](https://www.twilio.com/docs/content/twiliocard).

Content readback also adds button indexes and a provider-generated authentication body. The reconciler accepts those defined provider fields, while strictly checking the actual labels, action IDs/order, media, expiry and security controls. Ambiguous creation is reconciled against the existing versioned content, never blindly retried as another copy.

## Implemented controls

| Area | Implemented behavior |
| --- | --- |
| Identity | Verified known pharmacy numbers use pharmacy-only actions; other numbers are clients. Action ownership and assigned pharmacy are checked server-side. |
| Image bundle | One active client draft, up to ten sequential photos, replay deduplication, Ready/Cancel and two-hour draft expiry. No dispatch while photos are still processing. A failed second image does not silently dispatch only the first. |
| Location | Native WhatsApp location message; manual +/paperclip instructions retained. Returning clients choose Use saved / Share new. No Google Maps deep-link button is sent. |
| Permission | Send & save / Send once / Cancel explains image and number sharing with up to ten pharmacies. Disclosure and location-reuse choices are recorded separately. |
| Recipient selection | Licensed/current, verified/geocoded, marketplace-approved, enabled, opted-in and non-suppressed contacts. Stable straight-line distance ranking, unique destination numbers, maximum ten, snapshotted ranks and pharmacy eligibility evidence. |
| Dispatch | Private photo URL per recipient/media message. One message for each photo; multiple photos do not count as multiple pharmacies. Website orders retain a bounded whole-item summary and lead image, with full details in the pharmacy portal. |
| Delivery claims | A pharmacy counts as receiving the request only when all required photos have delivered/read callbacks. Zero, partial, delayed and failed outcomes have separate messages. Selection or API acceptance is never reported as delivery. |
| Callback reliability | Signed webhook verification; durable early callback receipts; monotonic read/delivered state; replay reconciliation; ambiguous sends held instead of blindly duplicated. |
| Media | Private R2; expiring opaque grants; HEAD supported without consuming GET allowance; maximum three successful GETs; JPG/PNG at most 5,000,000 bytes. Unsupported formats are rejected with instructions, not silently transformed. |
| Conversation controls | Short interactive guidance, Help/Privacy, STOP/Resume, Forget location, stale buttons and cancellation. Late consent preparation cannot revive a cancelled request. Already delivered images cannot be recalled. |
| Pharmacy buttons | Available / Not Available; records availability only, not a zero-price offer, completed sale or clinical dispensing decision. |
| Session/approval gates | Recipient-specific 24-hour service-window check at actual send, including retries; live approval check for both pharmacy templates and OTP. The client's window does not open a pharmacy's window. |
| Share | Share Med+250 triggers a short invitation plus a separate native contact card. The user chooses whether and to whom to forward it. No automatic messages to contacts. |

The full 28-definition inventory and exact copy are in [message-templates.md](message-templates.md). Twenty-three new in-session content definitions were created and read back as ready; the two existing native-location definitions are retained. Business approval is required for the three remaining families. vCards have no unsupported text caption. [Twilio media guidance](https://help.twilio.com/articles/360017961894-Sending-and-Receiving-Media-with-WhatsApp-Messaging-on-Twilio).

## Provider and binding inventory

| Purpose | Exact candidate | Content SID |
| --- | --- | --- |
| Client images to pharmacy | med250_pharmacy_client_media_request_v5 | HXbe5008c1475d4d5027a81a7ab0e4b59e |
| Web order to pharmacy | med250_pharmacy_request_v4 | HX8099a8e5bc862bf0ecf5818362c0c3e8 |
| Customer/pharmacy/admin OTP | med250_whatsapp_otp_v2 | HXcd1480a6674edf378f48a5ba6088161a |
| Delivery confirmation | med250_service_delivered_v1 | HX45d5344f889db981b4f8daad9b62d760 |

The versioned D1 content registry is authoritative for service/business SID resolution. Canonical production Wrangler bindings are aligned with the candidates above. Send-time approval checks remain mandatory; a configured SID alone does not permit sending. Old SIDs and the sender were preserved, not deleted or deregistered.

Earlier V3 `HXc40fbd759da820c338972f0f0e8c4a09` was observed **approved** at 08:03:44 UTC. It has the older button labels and is not the requested-label replacement. The old configured image V2, web V3 and OTP V1 were still **received** when read at 08:00–08:01 UTC.

Provider readback after reconciliation:

| Candidate | Evidence at this checkpoint (UTC) |
| --- | --- |
| Image V5 | Submission acknowledged 08:23:44; PENDING review confirmed 08:26:43. |
| Web V4 | Submission acknowledged 08:24:43; PENDING review confirmed 08:27:43. |
| OTP V2 | APPROVED, read from the Twilio approval resource at 08:22:42. |

All three existing candidate records reconciled successfully without another creation POST. The setup utility also tolerates the same provider-added fields and retains strict checks on text, samples, action labels/payloads and authentication controls.

Support follow-up: two Post comment attempts on ticket 29185539 returned “Your comment could not be posted. Please try again.” No new comment was confirmed. Refreshing the ticket then explicitly showed “You haven't logged in yet.” The complete diagnostic draft is saved in [twilio-support-follow-up.txt](twilio-support-follow-up.txt); this is not a sent message. Twilio Console also returned to sign-in, and the owner was asked to sign in again in the Codex web view.

## Deployment provenance

- Production Worker: `med250-marketplace-gikundiro`; domain `https://med-250.com`.
- Final deployed Cloudflare version: `7164efe2-fd34-41f4-bc4f-eb96a28de14b`; startup 60 ms. Both queue consumers, the producer and the every-minute trigger were confirmed in deployment output.
- D1: `med250-production`, `87faa538-bfde-4b23-ae21-c0770436552a`.
- Private R2: `med250-private-media-production`.
- Existing production dispatch queue and DLQ retained; every-minute maintenance trigger retained.
- Migrations 0011 (previously pending admin authentication) and 0012 (conversation reliability) applied remotely; 12 migrations now applied.
- Pre-migration D1 recovery bookmark: `0000002f-00000000-000050da-f076ed13cd3e2d2e0220d65d95ae7009`.
- Pre-turn Worker recovery reference: `8f694dfd-0765-453e-8300-da454f16a8be`. No rollback was performed.
- Source: base HEAD `f65102273f634da2b32416ca215ca5be1feebbd5` plus the uncommitted remediation worktree. No Git commit or push occurred. The release header reports the base revision and must not be treated as proof that this work is committed.
- Final server entry artifact SHA-256: `7f060155e3c0e8f8f3380556506e579dcd52c9ef74d1ac896c5b9d5681ca5db3`. This hash identifies the entry artifact, not every asset in the deployment; the Cloudflare version identifies the deployed bundle.

## Verification performed

- 113 Cloudflare/Twilio regression tests passed, including real local SQLite execution of the D1 migrations and provider-added field compatibility. These are local fixtures, not production deliveries.
- Worker TypeScript check and focused ESLint passed.
- Production build, four production artifact/rendering checks and strict Wrangler dry-run passed.
- Live homepage, contact page, both public non-patient sample images and business vCard returned HTTP 200.
- Final Cloudflare deployment readback confirmed version `7164efe2-fd34-41f4-bc4f-eb96a28de14b` at 100% traffic, created 08:22:57.999 UTC. Post-release public and signature-rejection probes passed again.
- Invalid private-media token returned 410. Unsigned form requests to both Twilio inbound and callback endpoints returned 403 invalid_signature.
- Public contact page has no configured email or WhatsApp support link. Its HTTP 200 is not proof of a staffed support route.

## Remaining activation and acceptance gates

1. Confirm the exact replacement templates' approval state; never substitute the older approved V3 as proof of V5 approval. Keep support ticket 29185539 open until the actual candidates are resolved.
2. Obtain or import genuine pharmacy messaging opt-ins. No recipient consent was backfilled or invented.
3. The owner supplied +250 795 588 248 for WhatsApp-only human support. The Help action and website route are implemented in the later support checkpoint; no email address or email configuration is required. Actual operator access, response availability and a real-device support exchange remain human acceptance checks, not inferred from a configured link.
4. Run a controlled request from an authorized client to consenting pharmacies: two photos, new/saved location, Send once/Send & save, ranked recipient snapshot, every-photo delivery callbacks, availability buttons, cancellation, STOP and physical iOS/Android sharing. Verify the actual delivered pharmacy count before declaring nearest-ten delivery complete.
5. Owner/provider review of the precise healthcare-routing use case and applicable privacy/retention arrangements remains distinct from technical template approval. Removing catalogues does not by itself establish an exemption from the broader messaging policy. No blanket policy clearance is claimed. [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/).

Existing local media retention jobs remain in place. Automatic WebP/image normalization, provider-side retained-media deletion, authenticated physical UAT and a qualified privacy/legal review were not completed or represented as completed by this change.

## Skill influence

The Cloudflare and Workers guidance kept the changes on the existing production stack, with additive migrations, private media, bounded provider operations and explicit external-status checks. Browser inspection verified the actual Console samples and labels; it was not used to infer approval from creation alone.
