# Existing-partner first request — production checkpoint, 2 September 2026

## Outcome and remaining gate

The one-time existing-partner permission flow is deployed to production and 280 exact current contact records have an owner-attested initial permission. The two new request-plus-opt-in templates were created, exact-content readback verified and submitted to WhatsApp through Twilio. At this checkpoint their registry status is **submitted**, not approved. First requests using these permissions remain blocked until the corresponding template is observed approved. The existing one-minute scheduled reconciler reads their statuses; no additional dispatch switch or recipient import is needed after approval.

There has been no new pharmacy outreach, invented order, replay of historical failures, or claimed real-phone delivery in this update. The outbox remained at its pre-change total of 48 records, and zero initial permissions were claimed. A real complete-delivery test remains separate.

## Permission provenance and scope

Owner statement: “Yes pharmacies are already our partners and they are ok to receive these messages”. This is recorded as an **owner assertion of existing partner permission**, not independently verified recipient evidence or a newly received WhatsApp opt-in. The original recipient agreement date and method were not invented.

- Attestation ID: `667852eb-5782-489d-a16d-a6443be0e4b1`.
- Recorded at: `2026-09-02T10:31:31.165Z`.
- Exact roster: 280 active verified WhatsApp dispatch contacts; excludes existing opt-outs and already explicitly opted-in contacts.
- Scope SHA-256: `9a812c4a0383771657e33d3e87320658aa95888d6388dd8a4ee54eed79ec61ac`.
- Full reviewed-plan SHA-256: `bf9c795f781f1168c809026cca40276ad58e789adfea0524fc649555a9af9372`.
- Production readback: 280 initial permissions; **zero recurring opt-in fields changed and zero recipient-permission events fabricated**.
- Of these contacts, 36 currently pass the other stored licence, marketplace, geocode and dispatch filters. This is a capacity count, not a client-specific nearest-ten ranking.
- Newly added contacts do not inherit this attestation. Each grant binds the exact contact, pharmacy and phone number. The private roster/SQL files are owner-readable only and Git-ignored.

Twilio requires prior permission and respect for opt-outs. This implementation relies on the owner's express confirmation for the initial message; it does not treat a public-directory number or an opt-in request itself as permission. Retain the underlying partner agreement evidence. [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy).

## Implemented behavior

1. A new client request uses the existing consented image/location flow or authenticated website order flow. Earlier requests created before this attestation are not newly eligible through it.
2. Dispatch selects up to ten nearest **eligible** unique destinations using the existing straight-line Haversine ranking. Recipient opt-in and unused initial permission are separate eligibility bases; licence/geography/marketplace/STOP checks remain.
3. The first request includes the media, customer WhatsApp, request details and **Available / Not Available / Enable alerts** buttons. Every image in the first bundle carries the opt-in action, so delivery order does not hide it.
4. The invitation reads: “Want future requests? Tap Enable alerts. Reply STOP to stop.”
5. Available and Not Available record this request's availability only. Silence, delivery and reading never grant recurring alerts.
6. Enable alerts uses the signed inbound START handler. Only this explicit choice or typed START enables subsequent ordinary request messages.
7. An initial grant is atomically bound to one request bundle. Concurrent requests cannot spend it twice; a losing transaction reselects remaining recipients. Provider retries use the same request, not a new permission. Failed/uncertain delivery does not replenish the grant.
8. STOP revokes unused/claimed initial permission, removes recurring permission and suppresses queued sends. START may re-enable recurring alerts but never restores the old initial grant.
9. Send-time checks revalidate the exact grant, request, registered destination and physical eligibility. An expired licence, changed contact, revoked grant or cancelled request fails closed. Actual complete delivery counts remain distinct from queued/provider-accepted messages.
10. The protected health report exposes aggregate initial-permission counts separately from recurring opt-in counts. Its overall dispatch capacity requires both new template families approved when relying on initial permissions.

## Twilio template readback

| Purpose | Content SID | State at checkpoint | Exact definition SHA-256 |
| --- | --- | --- | --- |
| `med250_partner_first_image_v1` | `HX663de52bfd5f49905fd2607010507b6a` | Ready content; submitted `2026-09-02T10:32:44.491Z` | `c453bb6643b701710f2d8c2938308d01b7df9aeae379f2c4006cdffd48a8c984` |
| `med250_partner_first_web_v1` | `HXf1ea6ea6055028f983755b6f6fa83e91` | Ready content; submitted `2026-09-02T10:33:44.280Z` | `7431c0e744c5ef5936ffe3e731b9a435f1b0f41902c9fae17c91e962e5741e4c` |

These are new Utility-category submissions for existing-partner request notifications and preferences; Meta controls the final categorization and approval. Existing approved image V5, web V4 and OTP V2 are unchanged. No sender, WABA, secret or Meta app was replaced. Canonical 30-definition plan: `043600e5f08f43895894a681b7feeea5c8746efb0ce222ea684c39cacbb35b08`.

## Deployment, checks and recovery

- Cloudflare Worker: `med250-marketplace-gikundiro`, `https://med-250.com`.
- Version: `40a44bfa-a335-4cd9-bc56-32eac6850ebb`; deployment readback confirmed 100% traffic, created `2026-09-02T10:32:34.741758Z`.
- Server-entry artifact SHA-256: `d7afc11becee0a7864741a1e882531519b3eff618a22530cb6899388bff45896`.
- Source: base `f65102273f634da2b32416ca215ca5be1feebbd5` plus preserved dirty worktree. No commit or push; the release header alone does not prove committed provenance.
- Additive migration `0013_partner_initial_request_permission.sql` applied to `med250-production` (`87faa538-bfde-4b23-ae21-c0770436552a`); 13 migrations confirmed. No existing consent or business data was deleted.
- Pre-migration D1 Time Travel bookmark: `00000030-0000024e-000050da-2459b498a42d9899c387a45e906b0467`. Prior Worker version: `c82b1da2-b046-4005-b9eb-4ff3b1d6262a`. No rollback performed. Prefer code rollback retaining additive permission history; database restore would require separate review of intervening real data.
- Existing D1/R2/queues/DLQ/one-minute cron and secrets retained. Cloudflare-only backend and Twilio-only runtime preserved; no Supabase CLI, Neon, Facebook token or email was used.
- 132 regression tests passed, including real SQLite claim races, full bundles, STOP/START, forged references, exact-roster import, web dispatch and health/template gates. TypeScript, focused ESLint, production build, five artifact/render checks, strict deployment dry-run and ten hosted-route checks passed.
- The import's first local JSON parser encountered Wrangler's non-JSON file-upload progress after the remote operation. Read-only reconciliation confirmed the complete 280-row result; no blind re-import was made. The importer now separates upload completion from SELECT readback and returns `already_recorded` for the confirmed attestation.
- No health-probe secret was extracted or reset. Live capacity evidence came from authenticated aggregate D1 readback; a secret-authenticated hosted health response and physical WhatsApp acceptance are not claimed.

Cloudflare/Workers guidance drove additive migrations, the pre-change recovery bookmark, strict deployment validation, preserved bindings/secrets and the distinction between deployment, provider approval, recipient permission and actual delivery.
