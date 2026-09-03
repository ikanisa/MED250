# Routine WhatsApp copy update — 2 September 2026

Scope: simplify four in-session replies without changing the service identity, customer consent, recipient descriptions, submitted business templates, order details or approval samples. This is a wording update, not a provider-policy clearance or a claim of live message delivery.

## Revised replies

| Current definition | Body | Buttons |
| --- | --- | --- |
| med250_service_send_image_v2 | Send a clear image for your request. You can add up to 10 images. | Help |
| med250_service_location_saved_v2 | Location received for this request. Send an image to continue. | Help |
| med250_service_pharmacy_welcome_v2 | Receive MED+250 customer requests on this number? You can stop notifications at any time. | Enable requests / Help |
| med250_service_pharmacy_expired_v2 | This request is no longer active or is not assigned to your number. | Help |

The location_saved definition is retained for compatibility; its inclusion in the library does not mean the current conversation path sends it.

## Preserved boundaries

- Consent still explicitly says the images and WhatsApp number go to up to ten nearby pharmacies. The location reuse choice is unchanged.
- Existing delivery/status messages still identify the recipients accurately.
- Available / Not Available labels and all reply payload IDs are unchanged.
- Business templates med250_pharmacy_client_media_request_v5 and med250_pharmacy_request_v4 are unchanged, including their names, media samples and realistic example items. No replacement submission is part of this update.
- MED+250 branding, actual medicine details in web-order requests, provider use-case information and recipient eligibility are not concealed or relabelled.
- Existing provider content is preserved. Only the four revised service definitions use new versioned identities. No migration, secret rotation, consent backfill or test message to a real recipient is included.
- Wording does not determine policy applicability or guarantee approval. The published policy covers the underlying business activity and accurate representation, not only catalogues or keywords. [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/).

## Verification and deployment

- 115 Cloudflare/Twilio local regression tests passed, including two new copy/versioning tests.
- Worker TypeScript check and focused ESLint passed.
- Production build, four production artifact checks and strict Wrangler dry run passed.
- Current 28-definition plan SHA-256: `b5b9d7868641bf782a7f2d1edce3d8b22a792a9d6ce82f1138d0418aedad4104`.
- Server entry artifact SHA-256: `0ae30be93b150e5c384e94d99767b9940218f1dcb8b9e20d50652fcb7cc559a4`.
- Source remains base HEAD `f65102273f634da2b32416ca215ca5be1feebbd5` plus the existing worktree and this scoped update. No commit or push was performed.
- Pre-update production version: `7164efe2-fd34-41f4-bc4f-eb96a28de14b` at 100% traffic, verified before deployment.
- Deployed Cloudflare version: `36e3c49d-2da4-4622-a4fa-da6343aa7dfc`, created 09:11:19.276 UTC; deployment readback confirmed 100% traffic. Existing production domain, D1, private R2, queues, cron and secrets were preserved. Startup: 60 ms.
- Live HEAD probes returned 200 for the homepage and both non-patient sample images; an unknown opaque private-media token returned 410.
- All four new service definitions are ready in the production registry. Each stored definition hash matches the locally recomputed canonical source hash. These are in-session definitions, intentionally not submitted as new business templates.

| Reply key | New Content SID | Ready checkpoint UTC |
| --- | --- | --- |
| send_image | HXad5b1953d92d3921f8ca032cd77b1ef1 | 09:11:40.990 |
| pharmacy_welcome | HXfdc24c281bef9eb3929f56ea53912505 | 09:11:42.634 |
| pharmacy_expired | HX761b6d15aee5c40cc3b69f7c50354df6 | 09:11:43.488 |
| location_saved | HXf2b4f7db0d2bb16f9f6d7278b609b754 | 09:12:42.396 |

## Fresh business approval checkpoint

The read-only production D1 query returned the existing scheduled Twilio approval-resource checks below. Both approvals were observed before this wording deployment; they are not a result of removing words. There is no need to replace or resubmit these approved templates as part of this update.

| Candidate | Content SID | Approval | Provider-check time UTC |
| --- | --- | --- | --- |
| Image request V5 | HXbe5008c1475d4d5027a81a7ab0e4b59e | approved | 2026-09-02 09:08:43.412 |
| Web order V4 | HX8099a8e5bc862bf0ecf5818362c0c3e8 | approved | 2026-09-02 09:09:43.549 |

These checks supersede the pending snapshots in the earlier implementation report. Approval is not a delivery receipt, recipient opt-in, privacy/legal sign-off or blanket approval of every possible use of the service. No support email/comment was sent in this wording update.

Cloudflare/Workers skill guidance was used to retain the existing resources and secrets, version immutable provider definitions, and verify the build and production readback separately.
