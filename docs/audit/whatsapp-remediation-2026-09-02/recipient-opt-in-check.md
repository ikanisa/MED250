# Recipient opt-in activation check — 2 September 2026

## Result

Historical checkpoint, before the owner's subsequent confirmation. The owner has now stated that the registered pharmacies are existing partners who agree to receive these messages. The later implementation records that assertion separately for one initial request, not as an invented recipient START event. See `partner-initial-permission.md` for the newer status; the checks below retain the earlier evidence.

The production opt-in flow is implemented, but recipient activation cannot be completed on behalf of recipients. The owner has been asked for any existing consent evidence suitable for verification; no such evidence was supplied in this turn.

Fresh read-only Cloudflare D1 checks found:

- 280 active, verified WhatsApp contacts enabled for dispatch at the contact-record level.
- Zero contacts with a recorded messaging opt-in; the permissions ledger contains no records.
- Contact provenance is public registry/directory/contact evidence, not recipient consent. Telephone verification is not treated as messaging permission.
- 36 unique destinations satisfy the other stored licence, geography, marketplace and dispatch controls before opt-in. The private activation list is not a client-specific nearest-ten ranking.
- The production registry marks the existing welcome, enabled and stopped response definitions ready. Those records are not evidence of a new real-phone send or response.

## Available activation path

A willing registered recipient reads the invitation, opens `https://wa.me/16622220600?text=START` from the exact registered WhatsApp number, and taps Send. Opening the link alone does not activate anything.

The signed inbound START records `signed_whatsapp_start` and a notification-permission ledger entry. Enable requests in the existing welcome message uses the same path. STOP removes the messaging permission and suppresses pending notifications. Unrecognized numbers remain clients and cannot self-enrol as registered recipients.

The two-line owner-distribution invitation is prepared at `outputs/whatsapp-activation-2026-09-02/activation-invitation.txt`. It was not sent to any recipient. Share the invitation through an appropriate existing onboarding/contact relationship or have interested recipients initiate contact; do not bulk-message the public-directory list through Twilio to manufacture permission. [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy) requires prior recipient consent and retained evidence, and distinguishes a conversational response from ongoing recurring engagement.

Existing recipient consent evidence may be reviewed for a controlled import. Do not invent an inbound START event, permission record, timestamp or opt-in source to make an import fit the current inbound-event schema. Any such import needs its own evidence-backed implementation and audit trail.

## Verification and boundaries

Four targeted local regression tests passed: known-recipient classification, nearest-ten full-bundle dispatch with opt-in, no-recipient handling, and START/STOP activation and suppression. These use synthetic local fixtures, not real recipient messages.

No production data was changed, no consent was backfilled, no messages or orders were sent, and no new deployment was needed for this check. The remaining dependency is recipient agreement or reviewable existing evidence. A full ten-recipient delivery test also needs ten eligible consenting destinations, an authorized test client and actual complete-message delivery receipts.

Cloudflare/Wrangler guidance was used for read-only production checks and keeping actual recipient consent separate from technical readiness.
