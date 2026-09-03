# Partner location invitation — 3 September 2026

## Clarified permission

The owner stated: “no, but, the initial outreach come with an offcial optin button, but they have physically approved”. This supersedes the earlier interpretation that an empty START ledger means no prior permission for this outreach. Record owner-attested in-person permission for **one initial administrative location invitation**. Do not invent original agreement dates, signed recipient events or recurring permission.

Existing partner permission is separate from public-directory evidence. A matching public number alone does not add a new recipient to this campaign. Enable alerts / START records future-notification permission; Stop messages / STOP suppresses messages. Sharing GPS or responding Available does not grant future alerts.

## Scope and evidence

Live Cloudflare dashboard SELECT found 64 exact-bound, unrevoked existing-partner contacts with pending GPS. Five overlap unresolved identity reviews; they are excluded. The checksum-bound private manifest contains **59 contacts**, expires after seven days, and fails closed as a whole if a selected live identity, licence, contact status or opt-out changes before installation. It is not authorization to send to all 769 register entries or newly scraped public numbers.

Private records: `private-outputs/whatsapp-location-outreach-2026-09-03/{live-scope.json,permission-plan.json,permission-plan.sql}`. Plan SHA256: `d3d9d5cf331a9f2815708392f3bc758a955b39ec45aa70fc4b774bab91cb9e52`.

## Message

> MED+250: at your premises, share your business location: + or 📎 → Location → Send your current location.
> For future customer request alerts, tap Enable alerts. Reply STOP to stop.

Buttons: **Enable alerts** (`med250:service:start`), **Stop messages** (`med250:service:stop`). New provider definition: `med250_partner_location_confirmation_v1`. Definition submission is not approval. Send-time checks must confirm exact content and current approval.

## Implementation

- Migration 0014: immutable exact-contact, one-time permissions and immutable native-location evidence awaiting review. Neither table grants login, recurring consent or automatic canonical GPS approval.
- Scheduler queues only approved, unexpired, correctly bound grants; unique recipient/grant/outbox keys prevent duplicate invitations. Maximum one provider attempt; ambiguous send outcomes are not automatically repeated.
- Sender rechecks identity, STOP, licence, pending GPS, exact permission/outbox and provider definition immediately before sending.
- Signed inbound native WhatsApp GPS is accepted only from the exact registered partner, after its invitation send started, within Rwanda bounds. It is saved for premises verification before canonical GPS changes. No direct GPS update or nearest-ten eligibility is claimed merely from receipt.
- Existing client orders and explicit START / STOP handling remain intact.

Cloudflare and Workers skills informed exact-scope database writes, pre-send rechecks, idempotency and independent deployment/provider verification.

## Validation and release evidence

- 83 focused regression / schema / production-build checks passed; Worker typecheck, targeted lint, production build and strict deployment dry-run passed.
- Current pre-release Worker: `40a44bfa-a335-4cd9-bc56-32eac6850ebb` at 100% traffic. Base Git revision `f65102273f634da2b32416ca215ca5be1feebbd5`; existing worktree changes preserved.
- Production D1 before release: migration 0013. Recovery bookmark: `0000003a-00000160-000050db-91c3bb83b32b28562d2a6609093ab158`.
- D1 command-line API returned code 7403; authenticated D1 dashboard reads work. Worker deployment listing works. No credentials were exposed or changed.
- Production D1 migration 0014: both tables and all three triggers independently read back; runtime contract and migration ledger both report 14 / 0014.
- Exact campaign `5031d05a-9817-4d57-ad19-34b40c90c9f4` installed: **59 permissions, 0 claimed, 0 revoked** at initial readback. Expiry `2026-09-10T07:06:12.621Z`. Recurring opt-in count was 0 before installation; the install does not modify it.
- Worker deployed: `81e097f0-b3b4-440a-971b-cadda407887d`; bundled entry SHA256 `cf4019238a151917ca43d30b5ed9e20a8c295c0f90d276e655e309c4fbdd29a5`. Independent deployment listing confirms **100% traffic**. Custom domain and once-per-minute scheduler plus dispatch queues confirmed by deployment result. The release is base Git revision plus preserved worktree, not a new clean commit.
- No stored secrets were read, rotated or exposed. The local authenticated health-probe command lacked its process secret, so no authenticated health-pass claim is made. Live D1/dashboard checks and public route checks provide separate evidence.
- Live route checks: homepage HTTP 200, categories HTTP 200, unsigned inbound webhook GET HTTP 405; no fabricated inbound order or live patient media was sent.
- Twilio invitation content created and approval submission succeeded: **`HXf25f3b58f7546a71223bd68693464ac9`**, registry `ready / submitted`, checked `2026-09-03T07:10:35.162Z`. Approval is **not yet confirmed**. The existing scheduler refreshes business-template approval in rotation and queues up to ten invitations per minute only once approved. No additional secret installation or manual login is required for this existing authenticated runtime path.
- Native-location acknowledgement content: `HXc5dc76477c935ce3f8721b84ff9efded`; retry guidance: `HX995f516889cd1c70bdc01f99314639f8`; both service definitions read back `ready`. These are session-bound replies, not approved initial outreach substitutes.
- The 59 destination numbers cover 57 businesses. Initial image/web order templates were independently observed `approved`: `HX663de52bfd5f49905fd2607010507b6a` and `HXf1ea6ea6055028f983755b6f6fa83e91`. This is provider status, not a claim that a patient request was delivered to ten pharmacies.
- Final production SELECT: 59 recorded permissions; 0 claimed invitations; 0 invitation outbox rows; 0 received partner locations; 0 recurring opt-ins; invitation approval state `submitted`. **No invitation sent at this readback.** Actual WhatsApp delivery and partner replies remain unverified until provider approval and real events arrive.
