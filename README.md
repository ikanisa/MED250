# MED+250

MED+250 is an information-first Rwanda pharmacy marketplace. A customer browses one central catalogue of medicines and consumer health products, sees a centrally maintained indicative “From RWF” price where available, and sends an availability request to eligible pharmacies, with verified nearby pharmacies prioritised. Pharmacies confirm privately, then the customer and pharmacy verify availability, final price, and fulfilment on WhatsApp. An order is optional and begins only after that interaction.

The inherited `dawanear_*` database names and `lib/dawanear-client.ts` filename are retained only as legacy technical identifiers so the audited medicine, pharmacy, and ordering system remains compatible. They are not a second product or brand. All customer and new operator interfaces use MED+250.

The application defaults to `NEXT_PUBLIC_MARKETPLACE_MODE=preview`. Preview mode is intentional: it never fabricates request success or live pharmacy responses and it does not send customer health data. In live mode the customer journey stays deliberately short: find products, build a request, share location, review pharmacies that confirm availability, and continue on WhatsApp.

The current implementation and UAT record is [MED250_AMAZON_ALIGNMENT_IMPLEMENTATION.md](desktop-output/implementation-qa-2026-07-13/MED250_AMAZON_ALIGNMENT_IMPLEMENTATION.md).

## Cloudflare-only D1 migration status

The active backend target is Cloudflare Workers + D1 + private R2 + Cloudflare
Queues, below USD 25/month before WhatsApp provider usage. Supabase Pro is not
an operating option, and no Neon or other external database runtime is
authorised. The canonical forward-only schema is in
`db/d1/migrations`; the same-origin Worker now covers web Auth,
catalogue, orders, offers, pharmacy workspace/governance, private prescription
access, image-only WhatsApp intake, saved locations, deterministic nearest-ten
dispatch, retries, delivery callbacks and audit state.

Supabase CLI must not be used. Source recovery is permitted only through the
authenticated Supabase web dashboard in Codex's browser view. CSV exports must
be downloaded to the git-ignored `work/` directory, hashed with
`npm run data:dashboard-recovery:manifest`, and converted into a deterministic
D1 plan with `npm run data:dashboard-recovery:build` before any approved staging
import. The preflight and post-import count receipts are verified separately by
`data:dashboard-recovery:verify-preflight` and
`data:dashboard-recovery:verify-readback`.
The current Codex browser session is authenticated to the KIRA organization but
does not have access to MED250 project `uskfnszcdqpcfrhjxitl`; no missing source
data has been silently accepted.

Provider status was rechecked live on 2026-08-23. Meta WhatsApp Manager confirms
the requested Ikanisa Service Center sender and Phone Number ID `900256399838407`
inside WABA `1188521970082273`; the sender is `Connected`, but its display name
is still `In Review`, the last-30-day insights show zero sent, delivered or
received messages. The authenticated Twilio account inventory contains six
MED250 templates, all still at WhatsApp approval status `Received`. The submitted
OTP, saved-location choice and client-image pharmacy card are production-scoped;
the image card points to `med-250.com`. One restricted API key named
`MED250 WhatsApp Production v2` exists with only `Messages Create` permission,
but its one-time secret is not recoverable from the console and is not installed
in Cloudflare staging. Twilio confirms sender SID
`XE0c3de00ff6ecefe80924ee9040294c82` is `Online`, but both its inbound webhook
and sender-level status callback still point to the retired Supabase function.
They must not be redirected until the exact Cloudflare endpoint, secrets and
rollback window are verified. Cloudflare staging currently contains only the
five internal MED250/location-link secrets; a new least-privilege Twilio runtime
key, the Account Auth Token for webhook validation and media, plus Google Maps
and Turnstile server secrets are not installed. Provider approval and controlled
send/reply proof therefore remain open.

The retained source pack can independently seed 769 licensed pharmacies, 309
known pharmacy numbers and 36 dispatch-eligible pharmacies with verified
government coordinates. That source pack is now checksum-imported and
independently readback-verified in staging D1 under receipt
`pharmacy-registry-5c44bf4043327d7af9bfd2b5-staging`; production is untouched.
The governed bundle SHA-256 is
`88ae5460b3d1f77ed8632df61a46ae2bfab09736a1296536a7306b5d5c37da30`.
Twenty-six numbers remain ambiguous after exact FDA, MMI and
independently corroborated matches take precedence over broader public-mobile
evidence; they are still classified as pharmacy numbers but quarantined from
branch login and dispatch until their exact assignment is reviewed. The 283
resolved messaging contacts include 79 exact official-directory contacts that
retain pharmacy OTP-login authority. Every other valid WhatsApp number is a
client. Source-data preparation is credential-free and the checksum-bound D1
plan retains separate staging and production approval gates. Aggregate staging
readback reports zero classification, ambiguity-contact or dispatch-eligibility
errors, and confirms that ten eligible recipients are available for a bounded
nearest-ten selection. The separate
catalogue recovery is complete in staging: 4,680 retained
rows were checksum-imported, including 4,657 active orderable products and 21
visible but non-orderable grace-period medicines.

Retained catalogue-media recovery is also provider-read-only. Run
`npm run media:inventory-recovery` for the hash-only plan; a detailed manifest
may be written only below git-ignored `work/`. The current inventory finds
3,690 complete source-cached galleries (19,117 images), but only 2,108 processed
objects remain byte-exact. Source-only images must be rebuilt as new governed
objects with new hashes before R2 publication; they are not silently treated
as the historical published bytes. `npm run media:recovery:build` admits only
the one complete three-image gallery whose every processed object is byte-exact.
That checksum-bound bundle is applied and independently verified in staging:
three private R2 objects totaling 345,190 bytes are bound to immutable D1 receipt
`media-recovery-staging-3efce88ddbf5bb6342c5c508`. The confirmation-gated
`npm run media:recovery:apply` verifies exact SHA-256 and byte-count readback
before writing and verifying the receipt.

The four accountable operator workflows are implemented locally through
private bearer-protected Worker routes backed by the same D1 binding. D1
migration `0003_operations_governance.sql` adds optimistic-locking and
append-only review evidence for pharmacy geocodes, pharmacy contact changes,
catalogue publication and product descriptions. The `ops:geocode`,
`ops:contacts`, `ops:marketplace-products` and `ops:product-descriptions`
commands remain gated. The independent Worker operator secret and isolated
Cloudflare staging deployment exist. Pharmacy source rows and
catalogue rows are present in staging, and the first governed media gallery is
live-verified. Provider credentials/template approval and physical WhatsApp UAT
evidence are still absent.

The deployment workflow now has three explicit targets: legacy protected
preview, Worker-D1 staging, and production. A production run must first
deploy the same Git commit to the isolated staging Worker, pass the private
aggregate health probe, verify every public route and revision header, and
record a body-free staging evidence receipt. Staging keeps ordering enabled for
UAT but forces private crawler policy, its own R2/Queue/DLQ resources, and its
own D1 database ID. Production remains separately protected
by its environment approval and all source/provider/physical-UAT gates.

Audit remediation is tracked in [`docs/MED250_AUDIT_IMPLEMENTATION_GOALS.md`](docs/MED250_AUDIT_IMPLEMENTATION_GOALS.md) and the machine-validated implementation register. The terminal-state contract requires every acceptance condition to have source-bound, hash-verified or independently verified evidence plus named accountable approval. `npm run audit:closure:status` reconciles the audit register with browser, launch, physical-device, localization, and product-content ledgers and groups all open work by accountable owner. `npm run audit:closure:verify` remains fail-closed until every finding, strategic decision, protected launch gate, live receipt, privacy-safe capture, physical-device scenario, translation, content review, and approval is complete.

## Verified source pack

- 2,480 Rwanda FDA human-medicine register rows captured in July 2026: 2,430 valid, 29 expiring soon, and 21 grace-period rows. The import preserves six duplicate regulatory-number groups for review instead of treating registration numbers as unique.
- 766 licensed human retail pharmacy rows from the Rwanda FDA May 2026 register.
- 3 separately licensed online-pharmacy rows from the Rwanda FDA May 2026 register: AXENTT Limited, Kasha Rwanda Ltd, and Harakameds Ltd.
- Canonical product IDs `rwanda-fda-hm-0001` through `rwanda-fda-hm-2480`, retail registry keys `retail-2026-05-1` through `retail-2026-05-766`, and online registry keys `online-2026-05-1` through `online-2026-05-3`.

The public fallback CSVs contain only official register fields. Historical staff phone lists and stale Google Maps candidates are not published or imported. Products with valid or expiring-soon registrations are available to add to an availability request; grace-period and expired records can remain visible for source transparency but are never requestable. Prescription handling is conservative until an authorised classification review is completed.

The regulated medicine source remains the Rwanda FDA human-medicine register. Separately, the MED+250 central consumer catalogue contains 2,200 quality-screened Amazon-first products across all 25 requested category/subcategory pairs, with at least 50 products in every pair. Canonical product metadata repairs incomplete search-result titles; exact duplicate titles, books, occupational gift items and unrelated search noise are excluded. The products are active and requestable alongside the medicines. Product information and indicative prices are centralized. MED+250 does not publish pharmacy-specific price lists or stock; pharmacies only confirm a private request, with any response price optional and non-final. The consolidated 4,680-record workbook and repeatable import/review procedure are documented in [`docs/marketplace-product-import.md`](docs/marketplace-product-import.md).

Product cards use neutral dosage-form icons unless an image has verified provenance; the app does not fabricate branded medicine packaging.

## Marketplace safeguards

- Live catalogue browsing uses the paginated same-origin Worker/D1 catalogue API instead of downloading every product into the customer browser. It ranks exact names and ingredients, common-use English/French/Kinyarwanda aliases, and close spelling matches; category, prescription, dosage-form, requestability, central indicative-price filtering, sorting, and stable result counts are applied server-side. The in-browser scorer remains only as the governed preview/offline fallback. Public catalogue routes expose no pharmacy identity or private order data.
- The Cloudflare Worker creates anonymous client sessions and uses six-digit Twilio WhatsApp authentication templates for verified clients and pharmacy staff. The portal has no email sign-up or claim path. A pharmacy number must already resolve to an approved, active pharmacy contact with explicit login authority. Successful OTP exchange creates a hashed, revocable D1 session carried in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie with a separate CSRF control and bounded idle and absolute expiry.
- OTPs expire after five minutes, are stored only as a purpose-bound salted hash plus an encrypted delivery payload, allow at most five attempts, invalidate older codes, and are rate-limited by phone, request source, and global volume. The same-origin Worker validates the browser origin and request controls before writing a challenge, queuing WhatsApp delivery, consuming a code, or creating a session. WhatsApp delivery reuses the audience-specific approved Twilio authentication template and server-only API credentials.
- Atomic, idempotent order creation: a stable customer request UUID ensures retries return the same committed order while draft, line items, and location-based dispatch commit together. A database constraint permits only one active request per customer.
- The Worker computes deterministic Haversine distance from approved government coordinates, orders by distance with a pharmacy-ID tie-break, and caps each new request at the nearest 10 eligible pharmacies.
- Dispatch requires current licence and marketplace approval, verified government coordinates, and a resolved verified WhatsApp messaging contact. Pharmacy login remains a separate, narrower authority granted only to exact official-directory contacts; approval is not displayed as a customer-facing badge.
- Transactional availability confirmation and pharmacy selection, with item/substitute validation. A pharmacy may omit price; any supplied estimate is private and non-final.
- Prescriptions and client-supplied medicine images are private R2 objects; D1 stores only governed object keys, digests, ownership, purpose, and retention state. The customer and exact assigned or selected pharmacy receive only short-lived, purpose-bound, replay-limited grants. Substitutes must match non-empty generic, strength, dosage-form, and pack-size fields, and a prescription product cannot be introduced without an attached prescription.
- Definitively unused uploads can be deleted by the owning client; ambiguous request retries reuse the same recorded object. The scheduled Worker leases due D1 cleanup jobs, verifies R2 deletion before revoking grants and clearing references, records an idempotent audit receipt, and retries failures without allowing one poison object to block newly due work. Retention periods remain closed for production until approved in the privacy policy and proven through the aggregate health contract.
- Customers can complete or cancel a selected off-platform order and start another request. All recipient pharmacies receive a closure notification so stale requests stop appearing as actionable.
- Optional central indicative prices are stored on product records only when directly observed from a Rwanda catalogue and displayed as “From RWF”. Amazon prices and currency conversions are excluded. Pharmacy catalogue-price contributions are disabled, and public catalogue surfaces never read pharmacy-price records.
- D1 is never exposed directly to browsers. Every read and mutation passes through same-origin Worker routes with explicit client/pharmacy session scope, CSRF enforcement for browser mutations, assignment and ownership checks, prepared SQL, and append-only audit events; order updates use bounded polling rather than a second realtime database service.
- Privacy-safe operations monitoring is implemented at two layers. The same-origin `/api/telemetry` route accepts only allow-listed events, replaces raw counts and timings with buckets, rejects oversized payloads, and writes no product, request, pharmacy, phone, prescription or location identifiers. The replacement `/api/internal/health` route requires an independent server-only bearer secret, verifies it in constant time, opens one request-scoped D1 client, and returns only the fixed aggregate D1 readiness contract established by migrations `0003_operations_governance.sql` through `0008_dashboard_recovery_reconciliation.sql`. It reports migration, pharmacy, dispatch, inbound, order, private-media retention and recovery counts without identifiers, phone numbers, coordinates or health content. The D1 schema and Worker media-retention handler lease expired WhatsApp and web-prescription media, verify R2 deletion, then revoke grants and record the database receipt with bounded retries.
- No platform payment custody. A verified MoMo merchant code may be revealed after selection; automated payment needs a licensed PSP, signed callbacks, idempotency, receipts, cancellation, and refund handling.

## Twilio WhatsApp order handoff

The production target is the Ikanisa Service Center WhatsApp sender `+1 662-222-0600` (Meta phone-number ID `900256399838407`) under the configured production Twilio account. A customer must verify and explicitly consent before submitting. The database then assigns no more than 10 eligible pharmacies and writes one private durable outbox row per assigned verified WhatsApp responder. The pharmacy utility card is generated from the committed order and central catalogue: request reference, medicine names, strengths and pack sizes, per-line quantities, total units, first available catalogue image, distance/coverage, fulfilment preference, and the verified customer WhatsApp number.

The card offers `Can fulfil` and `Cannot fulfil` quick replies. The public Twilio webhook accepts only signature-valid callbacks for the configured account and sender. It verifies that the replying number is the login-enabled WhatsApp contact of that exact assigned pharmacy. A `Can fulfil` reply creates the same complete, price-optional offer shown in the web portal; a web submission enters the same offer tables and produces the same customer WhatsApp update. Message creation, delivery, read, failure, and inbound reply IDs are idempotently recorded. Callback states cannot regress when Twilio delivers them out of order.

The dispatch Queue and its dead-letter Queue are both consumed by the Worker. Exhausted messages transition the matching D1 outbox row to `dead_letter`, revoke its private-media grants and append one idempotent audit event. Any future reset to `retry` must run through a protected Cloudflare operator route with a named operator, substantive reason, a staging approval gate and a second production-only gate. The scheduled outbox sweep then creates a new Queue message instead of reusing the consumed DLQ delivery.

Configure the server-only variables shown in `.env.example`, deploy the Cloudflare Worker, and register its exact `/api/twilio/whatsapp/inbound` and `/api/twilio/whatsapp/status` HTTPS routes with Twilio. Review the Content API definitions without changing Twilio:

```sh
npm run twilio:whatsapp:templates
```

This produces a deterministic SHA-256 plan for the five versioned staging
templates and the exact, separate `apply`, `submit`, and `verify` arguments.
Every staging friendly name begins with `med250_staging_`; production keeps the
canonical `med250_` names. That boundary prevents a staging Worker URL from
colliding with or replacing an already submitted production template.
It does not authenticate to Twilio or change provider state. With restricted
Twilio API-key credentials in the operator process, `apply` first paginates the
existing Content inventory, verifies the configured production account,
sender `whatsapp:+16622220600`, WABA `1188521970082273`, `ONLINE` status, and
exact template bodies. It then creates missing drafts only; body drift or
duplicate names fail closed. Both the staging confirmation string and the
reviewed plan SHA are required.

Approval submission is a separate confirmed `submit` operation. It never
creates templates, skips `received`, `pending`, and `approved` templates, and
refuses to resubmit rejected, paused, disabled, drifted, or ambiguous content.
The read-only check is:

```sh
npm run twilio:whatsapp:verify
```

Verification succeeds only when the exact sender is online, its WABA matches,
all five templates match their checksum-bound definitions, and every WhatsApp
approval status is `approved`. Apply, submit, and verify can emit a Cloudflare
environment manifest containing only non-secret Content SIDs and public target
identifiers; API keys, API secrets, Auth Tokens, and authorization headers are
never printed. Template creation, Meta approval, sender migration, Cloudflare
secret installation, and a real-device end-to-end message remain distinct
activation gates.

### Image-only WhatsApp client intake

The signed Twilio webhook defines two mutually exclusive WhatsApp identities. A sender whose number is a source/admin-verified `dawanear_pharmacy_contacts` WhatsApp entry is a `pharmacy`; every other valid inbound WhatsApp number is recorded as a `client`. The role is recalculated from the canonical contact register on every inbound message, so a sender cannot self-assert pharmacy access.

A client sends one JPG, PNG, or WebP image of a medicine or prescription directly to `+1 662-222-0600`. No medicine list, catalogue selection, OCR diagnosis, or product inference is created. In the Cloudflare/D1 target, the signed Worker streams the Twilio media into private R2 and D1 retains only its governed key, digest and audit metadata. First-time clients receive a signed `Share location` action that opens the MED+250 map in WhatsApp's in-app webview; WhatsApp's native current-location message is also accepted. Returning clients receive `Use saved location` and `Share new location` quick replies. The disclosure explains that the location is retained and the client image plus WhatsApp number will be shared with no more than ten assigned verified pharmacies.

Once location is confirmed, the database selects the same eligible nearest-pharmacy population used by the web marketplace, caps assignment at 10, and creates one private delivery for the client image and every assigned pharmacy. The pharmacy card contains only the client-supplied image, request reference, distance/coverage and client WhatsApp number. Its media URL uses a random, hashed, expiring and replay-limited R2 grant bound to one outbox delivery. Pharmacy quick replies are accepted only from the exact verified assigned pharmacy number, while the displayed client number lets the pharmacy reply directly in WhatsApp.

The replacement Worker routes are `/api/twilio/whatsapp/inbound`, `/api/twilio/whatsapp/status`, `/whatsapp/location`, `/api/whatsapp/location`, and `/whatsapp-client-media/:grant.png`; Queue and scheduled handlers drain the transactional outbox. Configure D1 plus the server-only Worker secrets in `.env.example`. Submit `med250_staging_client_location_capture_v2` against the staging Worker first; production uses the separate `med250_client_location_capture_v2` template pointing to `med-250.com`. Complete a consented physical-phone image → location → ten-pharmacy dispatch test before calling this path live. The Worker implementation is locally complete, but the cutover flags remain closed until D1/R2, migration, provider approval and physical-phone gates pass.

The web migration is implemented behind closed cutover flags. The
same-origin Worker exposes `/api/catalogue`, `/api/catalogue/taxonomy`,
`/api/catalogue/products`, `/api/catalogue/image-presentations`, and governed
`/api/catalogue/media/:productId/:position` reads backed by the portable D1
schema and private R2.

MED250 has one operating backend: the same-origin Cloudflare Worker with D1,
R2 and Queues. Customer/pharmacy authentication, web ordering, offers,
polling, prescription storage, pharmacy governance, catalogue SSR and public
trust metrics all use that path. The browser cannot create a second database
client or select another backend. If D1 is unavailable, private operations
fail closed; public catalogue rendering may use the retained governed source
snapshot, never another database request.

Preview and production share this Cloudflare-only backend contract. Release
validation rejects every non-`worker-d1` backend slice, any Supabase runtime
origin or credential, and any Supabase origin in the browser CSP. This local
implementation is not evidence that Cloudflare resources or the WhatsApp
provider flow are live: source reconciliation, remote infrastructure, staging
rehearsals and controlled production cutover remain mandatory.

## Browser-dashboard recovery into D1

Supabase is a source-recovery surface only. Export each required
`dawanear_*` table as CSV from the authenticated Supabase Table Editor and save
it under its exact table name in a private ignored directory such as
`work/dashboard-recovery/source/`. Never export Auth tables, OTP challenges,
sessions or refresh tokens, and never use Supabase CLI.

```sh
npm run data:dashboard-recovery:manifest -- \
  --source-dir work/dashboard-recovery/source \
  --project-ref uskfnszcdqpcfrhjxitl \
  --exported-at 2026-08-23T12:00:00Z \
  --output work/dashboard-recovery/source/manifest.json

npm run data:dashboard-recovery:build -- \
  --manifest work/dashboard-recovery/source/manifest.json \
  --target staging \
  --imported-at 2026-08-23T12:30:00Z \
  --output-dir work/dashboard-recovery/staging
```

Run `preflight-readback.sql` against the new empty staging D1 database and
verify its JSON result with `data:dashboard-recovery:verify-preflight`. Only
then apply `recovery-import.sql`. Run `postimport-readback.sql`, verify it with
`data:dashboard-recovery:verify-readback`, and apply the generated immutable
verification receipt. Product-image rows remain unapproved until their bytes
are independently recovered into private R2 and reconciled by SHA-256.

The number is currently identified in Meta WhatsApp Manager. Moving an existing direct Meta sender to Twilio is a provider migration, not a code deployment: confirm the approved Meta Business/WABA and billing prerequisites, plan an interruption window, disable Meta two-step verification only at the controlled registration step, register the same business portfolio through Twilio, re-submit duplicated templates, then prove inbound, outbound, media, quick reply, status callback, and web-portal synchronization on physical phones before marking `MED250_GATE_WHATSAPP_READY=confirmed`.

## Historical Supabase activation sequence (recovery reference only)

The commands below describe the inherited deployment and must not be used as
the active migration path. In particular, do not use Supabase CLI or local
scripts to connect to the MED250 Supabase project; source inspection and export
must use the authenticated dashboard as stated above.

MED+250 is installed in Supabase project `uskfnszcdqpcfrhjxitl`. Its prefixed tables, views, functions, private prescription bucket, explicit grants, row-level policies, and Realtime publication entries are isolated from the pre-existing project data. The official source pack is imported, anonymous customer authentication is enabled, and the geocoding, cleanup, pharmacy-OTP-send, and pharmacy-OTP-verify Edge Functions are deployed. The former public `env-dump` diagnostic is retired and JWT-protected because it exposed server environment variables.

1. Add CAPTCHA/Turnstile and confirm suitable anonymous-sign-in rate limits. This is a project-wide Auth setting, so review every existing app before changing it.
2. Keep the protected live-request release gate closed until authoritative pharmacy readiness and the documented Rwanda marketplace operating approvals are complete. The public catalogue may be reachable while formal production approval remains pending, but that state must not be represented as an approved launch.
3. Run both `npm run data:validate` and `npm run data:quality` after every source refresh.
4. Do not run the inherited Supabase import scripts. Recover live rows only
   through authenticated browser CSV exports and the checksum-bound D1
   recovery workflow above.

5. Apply only authorised product classifications through the controlled review workflow below. The source importer always resets products to `unclassified` and non-orderable, so reviews must be revalidated after each register refresh.
6. Every source-imported pharmacy is marketplace-approved automatically. Separately verify current licences, business WhatsApp/MoMo details, staff authority, and precise premises coordinates before representing a pharmacy as nearby. A pharmacy without approved coordinates may participate only through the verified national responder fallback when all other eligibility conditions pass. The WhatsApp number in `dawanear_pharmacies.whatsapp` becomes the pharmacy login identity.
   Use `npm run ops:geocode -- generate`, then `inspect`, and approve exactly one premises with `npm run ops:geocode -- approve` only after manual review. The admin token must exist only in the process environment; the command has no token flag and no batch-approval mode. The workflow never infers WhatsApp from a public phone listing.
   Pharmacy staff can view only their own linked phone and WhatsApp contacts in the Profile tab, then request a new contact, replacement, or removal. Review those requests with `npm run ops:contacts -- list`, then `inspect`, and approve or reject exactly one request after direct verification. Approval is atomic, stores the operator identity and evidence note, enables an approved WhatsApp number for login, and mirrors that number into the pharmacy's phone contacts. The service-only review function blocks replay and neither the CLI nor Edge Function supports batch decisions.
7. Rebuild with `NEXT_PUBLIC_MARKETPLACE_MODE=preview`; the connected preview reads the live product catalogue but does not publish a pharmacy directory or send customer health data.
8. Test customer, unrelated user, recipient-pharmacy staff, and selected-pharmacy access against the staging Worker. Install the same independent `MED250_HEALTH_PROBE_TOKEN` only in the Worker secret store and private monitor process, set `MED250_HEALTH_PROBE_URL` to the same-origin `/api/internal/health` URL, then run `npm run ops:health:strict`. The verifier rejects non-HTTPS paths, malformed privacy contracts, migration drift, missing dispatch/login readiness, unknown provider finality, stale work, dead letters and overdue medical-media deletion. No Supabase health endpoint is part of the operating backend.
9. Do not represent the public deployment as formally approved or expand protected live operation until written Rwanda FDA/RICA confirmation, data-reuse permission, privacy-controller/processor registration, a DPIA, any required outside-Rwanda transfer authorisation, and any applicable payment-provider arrangements are complete. The exact open regulatory issues and owner decisions are in [`docs/launch/RWANDA_REGULATORY_REVIEW_BRIEF.md`](docs/launch/RWANDA_REGULATORY_REVIEW_BRIEF.md).
10. Do not approve or redeploy `NEXT_PUBLIC_MARKETPLACE_MODE=live` through the protected release workflow until every gate above is satisfied. Create and validate a new build after the gates close.

The secret/service key and third-party API credentials must never be stored in the frontend or committed to the repository.

## Controlled product review

Product publication and orderability decisions use the authenticated
Cloudflare Worker operator route and D1 audit ledger. Use
`npm run ops:marketplace-products` to list and inspect one product, then apply
one revision-guarded decision with the reviewer identity and evidence note.
Keep the evidence receipt in the controlled regulatory audit record. The
inherited scripts that wrote directly to the old database are not exposed as
package commands and must not be used.

## Validation

```sh
npm run release:preflight
npm run data:validate
npm run data:quality
npm run security:audit
npm run python:test
npm run lint
npm test
npm run performance:budget
npm run cloudflare:check
```

`npm run release:check` runs the complete preview-safe gate in one command. Its dependency gate audits the complete Node tree at moderate severity or higher and checks every exact Python requirement pin against OSV. The image pipeline requires Python 3.11+ because supported Pillow and rembg releases no longer support the macOS system Python. Before any protected production approval or redeployment, `npm run release:preflight:live` additionally requires live marketplace mode and an explicit HTTPS site origin. It never prints key values. `npm run release:check:live` validates the Supabase-free Worker-D1 production artifact without requiring a database credential in the build job; the protected production workflow runs the authenticated strict same-origin health probe immediately after deployment and fails if the aggregate database state is not healthy. Keep routine local development in preview mode until the GPS, WhatsApp, duplicate-register, authorised test-identity, and production-domain gates are complete.

The live preflight also requires `NEXT_PUBLIC_MED250_OBSERVABILITY=cloud`, a public Turnstile site key, and eleven CI-only launch attestations to be set to `confirmed`: GPS readiness, WhatsApp readiness, duplicate-register review, security-hardening migration deployment, revised Edge Function deployment, Supabase Turnstile server verification, approved anonymous-auth rate limits, prescription-retention approval, Cloudflare account verification, domain/DNS verification, and physical-device UAT. These values are deliberate release locks, not substitutes for evidence. Keep them unset until the corresponding signed approval, deployment receipt, or controlled test record exists. `npm run launch:go-live:status` summarizes the full gate posture and fails closed until the registry, duplicate-register review, and physical-device UAT are all production-ready; `npm run launch:closure:board` generates the owner execution queue for the remaining evidence and approvals; `npm run release:check:live` runs the fail-closed readiness gate before any service-credential or Cloudflare packaging checks.

Physical-device UAT is governed by `data/physical-device-uat.json`. `npm run uat:packet` generates the redacted 12-scenario execution packet for QA; `npm run uat:verify` validates the complete pending ledger; `npm run uat:verify:live` requires every scenario to pass with a redacted evidence reference, useful note, opaque test-identity labels, named executor, named approver and timezone-qualified timestamps. It rejects phone numbers, OTPs, UUID-like order identifiers and secret-like material. The strict UAT verifier is mandatory in `release:check:live`.

Every attestation also has a governed schema-v2 entry in [`data/launch-evidence.json`](data/launch-evidence.json). `npm run launch:evidence:status` lists each owner, acceptance criterion and missing evidence category. `npm run launch:evidence:verify` validates the complete eleven-gate registry without requiring the pending gates to be closed. `npm run launch:evidence:verify:live` requires every gate to be `confirmed` with all gate-specific evidence categories, a named approver and role, a timezone-qualified approval timestamp and valid repository-relative or HTTPS evidence references. Local evidence must be a completed JSON artifact under `docs/launch/evidence/`, match its recorded SHA-256 digest, declare the correct gate/type, confirm redaction, contain passed checks, and satisfy type-specific approval, test, review, deployment, account, domain or operations fields. Generate its shape with `npm run launch:evidence:template`, validate it with `npm run launch:evidence:artifact:verify`, then record it with `npm run launch:evidence:record`. For stale domain evidence, first generate a passed live deployment receipt with `npm run deployment:verify -- --url https://med-250.com --mode live --expected-revision <current-sha> --evidence-output <receipt.json>`, then run `npm run domain:evidence:refresh -- --deployment-evidence <receipt.json> --expected-revision git --date YYYY-MM-DD` to update only the domain artifacts and registry digests. Use `npm run launch:approval:packet` to generate the review packet for evidence-complete gates that still need owner approval. Access-controlled HTTPS evidence requires a named verifier, role and verification timestamp in the registry. Secret-like URLs, summaries and artifact contents are rejected. Production preflight runs this strict evidence check before reading environment flags, so setting CI variables alone cannot unlock a live deployment. Follow [`docs/launch/production-evidence-runbook.md`](docs/launch/production-evidence-runbook.md) to close each gate without storing secrets or fabricating approval.

The Worker-D1 operations command returns aggregate data only and never prints its credential. The isolated staging Worker, D1 database, private R2 bucket, dispatch Queue and DLQ are provisioned and migrations `0001` through `0008` are current. Staging contains the checksum-verified catalogue and first governed media gallery, while pharmacy source rows remain pending and production has not been cut over. Staging Worker version `8db9b843-d1f9-4b30-8649-25263a931480` serves artifact fingerprint `c0f6cc5657c293232736a9fbdcf3cecffecc7735`; the complete live catalogue verifier passes 4,657 orderable rows across 39 pages, 4,678 visible rows, all four departments, multilingual search and typo recovery. Historical Supabase snapshots are retained as migration evidence, not proof of the replacement runtime. `npm run ops:readiness:packet` generates the 769-row public-registry review index for GPS and WhatsApp readiness without phone numbers or coordinates. Products and indicative prices belong to the central catalogue. MED+250 publishes neither pharmacy-specific prices nor pharmacy stock; pharmacies privately confirm availability and the final interaction happens on WhatsApp. The lease-based Worker/R2 private-media cleanup is implemented locally, but it must pass the aggregate health contract in staging and production before cutover; privacy-owner approval of the retention periods is still required.

Preview protection is enforced twice: `NEXT_PUBLIC_MARKETPLACE_MODE=preview` emits `noindex` metadata and a blocking `robots.txt`, while `wrangler.jsonc` sets `MED250_RELEASE_MODE=preview` so the Worker adds `X-Robots-Tag: noindex, nofollow`. The modes must match or release preflight fails. The explicit production environment uses `live`; `workers.dev` URLs remain unindexed even in live mode. The public Worker is currently reachable, but it is not formally approved by the protected evidence workflow while gates remain pending. Run `npm run release:check:live` for the final production gate.

The frontend build and source-data validator run locally without a live backend. Canonical SQLite migrations run against isolated local D1 state. The authorised D1 staging database, private R2 and Queues now exist; pharmacy/source reconciliation, provider configuration, latency/failure testing and controlled Twilio physical identities remain required before UAT or cutover.

For an authorised release database, `npm run backend:verify` executes the service-only aggregate deployment contract. Version `2026-07-18.3` fails on any unreviewed change to the MED+250 API, GraphQL/RLS, marketplace moderation, publication-audit, catalogue, product-image governance, product-description governance, or aggregate public trust-metric boundary. It additionally proves that catalogue prices are centralized and indicative, pharmacy-specific catalogue-price writes are disabled, public catalogue views avoid pharmacy-price records, pharmacy confirmation prices are optional, public stock is unsupported, every approved or rejected consumer-product version has matching immutable audit evidence, and public product images satisfy the governed provenance and background-removal contract. Product descriptions remain hidden unless their exact source content, reuse rights, clinical applicability, substantive rationale, and named review are complete, and no approval or withdrawal can bypass the single-product immutable review ledger. The image boundary is enforced independently by a validated check constraint, public RLS, a service-only publication RPC, a runtime approval trigger, and a DDL event guard that rejects schema changes leaving those controls unsafe. The only public trust signals allowed by the contract are fixed-shape, aggregate, suppression-aware outputs backed by expiring service-only operations approvals. Supply the service credential through the process environment only; the command never needs it in a file and the contract returns no row identifiers or object names.

After deploying the product-description reviewer, run `npm run backend:verify:description-reviewer -- --product-id PRODUCT_ID --expected-updated-at EXACT_INSPECT_UPDATED_AT --evidence-output docs/launch/evidence/product-description-reviewer-verification-YYYY-MM-DD.json` with the process-only service and admin credentials. It performs no approval or withdrawal: it verifies backend contract `2026-07-18.3`, anonymous HTTP 403 denial, one authenticated `inspect`, the exact product version, and the deployed reviewer contract. Its receipt retains no response body, raw product identifier, credential, description, or review note.

The strict live release command requires the same probe through `MED250_DESCRIPTION_REVIEWER_PROBE_PRODUCT_ID` and `MED250_DESCRIPTION_REVIEWER_PROBE_EXPECTED_UPDATED_AT`; the protected GitHub environment supplies `MED250_ADMIN_TOKEN` as a secret. Missing or stale inputs stop the release before Cloudflare packaging.

`data/imports/duplicate-register-review.csv` is the controlled review ledger for duplicate official identifiers. `npm run data:validate` confirms that its 51 rows still match every source row and reference in the imported registers. A reviewer may set a row to `accepted_source_duplicate` only with their name, a timezone-qualified review timestamp, and a rationale; `blocked_source_correction` records an authoritative correction still required. `npm run data:duplicates:verify -- --strict` rejects both pending and blocked rows and is mandatory in `release:check:live`. Never merge or delete source rows merely to make this gate pass.

`npm run data:duplicates:packet` generates a deterministic private reviewer packet containing all 51 groups, source references, exact field values, differing fields and source-file SHA-256 digests. It contains no inferred decision or recommendation; the named register data reviewer must still inspect the authoritative record and write the decision only to the governed ledger.

The test suite also executes the real catalogue-search TypeScript module and both the historical Supabase and replacement Cloudflare D1 search contracts in PGlite. This covers exact ingredient ranking, multilingual aliases, alias-over-fuzzy precedence, typo recovery, category/form/requestability filters, stable pagination totals, requested-product order and governed same-origin media routes without making a live database write. The storefront preserves the configured server backend's result order; it does not re-rank a server page with the preview fallback scorer.

`npm run performance:budget` fails if browser JavaScript, CSS, the marketplace chunk, or the initial storefront visual assets exceed their measured release budgets. Until the controlled catalogue flag is changed, connected preview and live builds server-render the first 24 source-backed products and use the historical Supabase search RPC. After the gated catalogue cutover, browser catalogue calls use the paginated same-origin Worker/D1 API and server-rendered product/taxonomy enrichment plus approved aggregate trust metrics use the same private D1 boundary. The 1 MB fallback CSV is fetched only when no catalogue backend is configured. The source PNG artwork remains available for future asset work, while the storefront uses display-sized wordmark and WebP derivatives.

For an authorised release database, [`tests/live-marketplace-rollback.sql`](tests/live-marketplace-rollback.sql) executes the deployed order lifecycle inside one transaction and then rolls it back. It proves automatic retail-pharmacy marketplace approval, verified nearby ranking with national responder fallback, WhatsApp eligibility, idempotent retry, membership isolation, complete confirmation, pre-selection contact privacy, customer ownership, selection/contact release, completion and notification lifecycle while leaving no customer, pharmacy, contact, order, offer or notification fixture behind. Run it through the Supabase SQL editor or an authorised database connection; never add a database password to the repository.

[`tests/live-pharmacy-otp-rollback.sql`](tests/live-pharmacy-otp-rollback.sql) similarly verifies the deployed service-only OTP state machine without sending WhatsApp: correct-code acceptance, single use, safe wrong-code retry, expiry, malformed input and role grants are exercised and rolled back. Twilio delivery and the resulting browser refresh session still require the controlled physical-device test because the automated suite deliberately sends no real message.

## Cloudflare build and deployment

The repository includes a Cloudflare Worker entry point and `wrangler.jsonc`. The default configuration is the isolated `med250-marketplace-preview` Worker with `MED250_RELEASE_MODE=preview`; the explicit `production` environment targets `med250-marketplace-gikundiro`, disables `workers.dev`, routes the custom domain `med-250.com`, and sets `MED250_RELEASE_MODE=live`. This follows Cloudflare's named-environment model while keeping a routine/default deployment away from production traffic. Validate the preview bundle without publishing it:

```sh
npm run cloudflare:check
```

Validate the complete production artifact without publishing it:

```sh
npm run cloudflare:check:production
```

That command supplies the live public mode only for the smoke build, checks indexable metadata, production robots and the source-backed sitemap, and then runs a strict dry run against the explicit `production` Wrangler environment. Both the local `deploy:live` command and the protected GitHub production job include `--env production`; this is a tested safety boundary so a production approval cannot accidentally deploy the default preview Worker.

The repository also contains `.github/workflows/quality.yml` and `.github/workflows/deploy-cloudflare.yml`. Quality checks run without private credentials using the committed preview-safe public configuration. Deployment is manual only:

- `preview` uses the protected `med250-preview` GitHub environment, deploys only the preview Worker, then verifies routes, headers, HTTPS, `robots.txt`, sitemap suppression, and `X-Robots-Tag`.
- `production` requires the exact `DEPLOY MED250 LIVE` confirmation plus approval of the `med250-production` GitHub environment. It runs every attestation and Worker-D1 artifact check, deploys the production Worker, then requires the private same-origin operational-health probe and public deployment verifier to pass.

Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets in both GitHub environments. Production additionally needs `MED250_HEALTH_PROBE_TOKEN` as a GitHub environment secret and the identical value installed independently as a Cloudflare Worker secret; it must not receive a Supabase key. Provision distinct staging and production D1 databases before enabling live traffic, then configure their `MED250_D1_DATABASE_ID` values plus all launch and Worker-D1 cutover gates as protected environment variables. Keep the Cloudflare token scoped to the single deployment account and relevant zone. Cloudflare documents the required CI credentials and official Wrangler action at https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ and its named-environment behavior at https://developers.cloudflare.com/workers/wrangler/environments/.

To publish manually after the data, privacy, regulatory, and operational gates are complete:

```sh
npx wrangler login
npm run deploy:preview
# Production remains unavailable until every live gate passes:
npm run deploy:live
```

Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin and keep every production backend slice at `worker-d1`; production must not receive a public Supabase URL or publishable key. The customer address picker also needs a dedicated `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` with Maps JavaScript API and Geocoding API enabled and HTTP-referrer restrictions limited to the MED+250 origins. This browser key is intentionally public; never reuse the server-only `GOOGLE_MAPS_API_KEY` used for pharmacy geocoding. Live public-contact readiness requires approved owner channels in `NEXT_PUBLIC_MED250_CONTACT_EMAIL`, `NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP`, and `NEXT_PUBLIC_MED250_MEETING_URL`; the storefront renders them only when configured, and release validation rejects unsafe email, WhatsApp or non-HTTPS booking values. Keep Twilio WhatsApp, health-probe, server Google Maps, admin-token, and encryption credentials only in protected server secret stores. `npm run deployment:verify -- --url <https-url> --mode preview|live` can be rerun independently after any deployment. A successful dry run proves the Worker bundle and declared bindings are valid; it does not prove that the currently missing remote D1 database, runtime authentication, order dispatch, production DNS or Core Web Vitals are ready. Wrangler is currently authenticated to the intended account, but the local OAuth session has broad account-wide write scopes. Replace it with a least-privilege MED+250 deploy credential and retain a redacted account-verification record before confirming the Cloudflare gate.

The active custom domain is `med-250.com`, routed directly to the production-named Cloudflare Worker. DNS and TLS reachability are necessary but do not by themselves confirm the launch gate; the strict deployment verifier, account evidence, backend health, controlled UAT and named infrastructure approval must all pass before the current public release can be formally approved or redeployed through the protected production workflow.

For an owner-only Sites deployment, provide the short-lived Sites bypass credential only through the `SITES_BYPASS_BEARER_TOKEN` process environment while running `deployment:verify`. The verifier sends it in `OAI-Sites-Authorization`, never in the URL, report or repository. Public and direct Cloudflare deployments do not need that variable.
