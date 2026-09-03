# WhatsApp-only support — 2 September 2026

Owner decision: no email; human support uses **+250 795 588 248**. Automated ordering remains on **+1 662-222-0600**. This update does not change sender registration, business templates, administrator access or recipient consent.

## User-facing behavior

- Help returns `med250_service_help_v2`, with two short sentences/lines:
  - “Need help? Chat with our team on WhatsApp.”
  - “Send PRIVACY for privacy, CANCEL to cancel, or STOP to opt out.”
- Its single **Chat with support** URL action points to `https://wa.me/250795588248`. No email, external contact-page hop, mixed quick-reply actions or prefilled patient data is included.
- The contact page and website footer use the same shared support constant. Legacy email/calendar environment values cannot re-enable those public channels. Optional support configuration must match the owner's number.
- Typed PRIVACY is recognized; CANCEL and STOP remain available. Existing quick-reply payloads continue to work.
- Opening the support chat does not automatically forward images, coordinates, a request record or customer details. Users choose what to send. Operator access and actual response availability still require human acceptance.

The one-URL action is used only inside the recipient's service window, following the [Twilio call-to-action requirements](https://www.twilio.com/docs/content/twilio-call-to-action). Help is not a newly approved business-initiated template. The existing Help V1 and all submitted business definitions are preserved.

## Provider verification

The first production readback caught an additional `/types/twilio/call-to-action/actions/0/id` field in Twilio's URL action. Strict comparison initially held the record as `creation_unconfirmed`; no duplicate creation was issued. The compatibility correction ignores only a scalar ID annotation on URL actions. The actual URL, title, body, type, action count/order and all quick-reply payload IDs remain strict.

The corrected release reconciled the existing versioned content by name after the normal five-minute retry cooldown, without submitting another copy. Production readback confirmed `service:med250_service_help_v2` **ready**, Content SID `HX2c422ab1085637e60487b6e206c89dd0`, at `2026-09-02T10:05:46.079Z`. The rejection reason is now null and the stored definition hash exactly matches the locally computed reviewed definition below. This is readiness for in-session use, not business-template approval or a real-phone delivery receipt.

Verified Help definition SHA-256: `3f9f50c80392465bc14ac67ce7e4c913b059ab063d558363a811eebdea1e04cf`.

## Deployment and verification

- Final Cloudflare version: `c82b1da2-b046-4005-b9eb-4ff3b1d6262a`, created `2026-09-02T10:02:23.580616Z`; deployment readback confirmed 100% traffic.
- Initial support release: `00b81e2c-a981-4a8e-98a3-febb47cf45cc`; the final version adds the provider-annotation compatibility correction.
- Pre-support recovery reference: `36e3c49d-2da4-4622-a4fa-da6343aa7dfc`. No rollback was performed.
- Worker: `med250-marketplace-gikundiro`, domain `https://med-250.com`; existing D1, private R2, queues, cron and secrets retained. No migration or secret rotation was needed.
- Server entry artifact SHA-256: `e96ba6ab3699deccd91e5a5b110e8010a8397eaa63273ab7956952f413afea4f`. The Cloudflare version identifies the full deployed bundle; this hash identifies its server entry artifact.
- Current 28-definition plan SHA-256: `ebf332758ad5fffbeac6fcd1aafb08cc986e81cce0ef66a42a4d9088e2966493`.
- Source: base HEAD `f65102273f634da2b32416ca215ca5be1feebbd5` plus the existing dirty worktree and scoped support changes. No commit or push occurred; the release header is not proof of committed changes.
- 121 local Cloudflare/Twilio/contact regression tests, Worker TypeScript, focused ESLint, production build, five artifact/render checks and strict deployment dry-run passed.
- The new regression exercises lost-creation reconciliation with URL-ID annotations and rejection of destination, wording, label, action-type/count, malformed metadata and quick-reply-ID drift.
- After the final deployment, all ten hosted-route checks passed. Live homepage and contact-page HTML returned 200, contained the exact support URL, and had no email link; the contact page displayed the formatted support number and label.

No real-user test message, customer request, support conversation, email, consent import or recipient broadcast was sent by this update. Live support rendering and a human reply are not claimed as tested.

## Separate activation gate

A fresh read-only production count still found 280 verified active dispatch contacts and **zero recorded messaging opt-ins**. This support change does not activate recipients. Genuine recipient opt-ins and controlled real-phone delivery evidence remain necessary before asserting that a request reached ten nearby pharmacies.

Cloudflare/Workers guidance kept deployment on the existing production resources, preserved credentials and separated deployment from provider readback. React guidance kept the public contact source static and shared, without adding client state or another dependency.
