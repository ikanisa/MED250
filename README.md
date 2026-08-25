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

Supabase CLI must not be used. Historical source recovery is permitted only
through an authenticated dashboard export into the git-ignored `work/`
directory. Every export must be hashed, converted to a deterministic D1 import,
and reconciled by aggregate preflight and post-import receipts. Supabase is not
a runtime, deployment target, messaging endpoint, or production authority.

Production has one infrastructure target: the `med250-marketplace-gikundiro`
Cloudflare Worker on `med-250.com`, its `med250-production` D1 database, private
production R2 bucket, and production dispatch Queue/DLQ. The generated release
configuration rejects non-production targets, non-Cloudflare backends, Meta
runtime credentials, and release revisions that are not exact Git commit SHAs.

The Worker classifies every known, active, verified pharmacy WhatsApp number as
a pharmacy and every other valid WhatsApp number as a client. Ambiguous or
provider-rejected pharmacy contacts stay quarantined from login and dispatch.
Catalogue, registry, and media recovery remain checksum-bound operator tasks;
no source row or media object is promoted merely because it exists in a legacy
export.

Production activation still separates technical deployment from Twilio
template approval and consented physical-device UAT. The repository never marks
those external gates complete from a local build or a Cloudflare deployment.

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
- The Cloudflare Worker creates anonymous client sessions and uses the approved six-digit Meta WhatsApp authentication template for verified clients and pharmacy staff. The portal has no email sign-up or claim path. A pharmacy number must already resolve to an approved, active pharmacy contact with explicit login authority. Successful OTP exchange creates a hashed, revocable D1 session carried in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie with a separate CSRF control and bounded idle and absolute expiry.
- OTPs expire after five minutes, are stored only as a purpose-bound salted hash plus an encrypted delivery payload, allow at most five attempts, invalidate older codes, and are rate-limited by phone, request source, and global volume. The same-origin Worker validates the browser origin and request controls before writing a challenge, queuing WhatsApp delivery, consuming a code, or creating a session. WhatsApp delivery uses `med250_whatsapp_otp_v1` through server-only Twilio credentials.
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

## Twilio WhatsApp handoff

The production sender is `+1 662-222-0600`. Twilio Programmable Messaging is the only Worker messaging transport; the runtime does not require or read a Meta access token, app secret or webhook verification token. Cloudflare Workers, D1, private R2 and Queues are the complete MED+250 application backend and database stack.

Every signed inbound number has one server-derived role. A number found in an approved, active and verified `dawanear_pharmacy_contacts` WhatsApp entry is a `pharmacy`; every other valid WhatsApp number is recorded as a `client`. The Worker recalculates this role from D1 for every inbound event, so a sender cannot claim pharmacy authority.

A client sends one JPG, PNG or WebP medicine or prescription image. The Worker streams the Twilio media object into private R2 and stores only governed metadata in D1. No medicine list, catalogue, OCR diagnosis or product inference is presented in WhatsApp. A first-time client receives a two-line instruction to use WhatsApp's attachment control and send the current location. A returning client receives `Use saved` and `Share new` quick replies; `Share new` sends the same short manual WhatsApp-location instruction.

WhatsApp does not expose a supported button deep link that launches its native location composer. The primary flow therefore uses a native WhatsApp location message, which Twilio supplies as `Latitude` and `Longitude`. As a compatibility fallback, a client may paste a trusted Google Maps share URL. Both paths validate Rwanda bounds, persist the current client location in D1, and then use the same dispatch transaction.

After location confirmation, D1 selects at most the nearest 10 eligible pharmacies using verified coordinates and WhatsApp contacts. Each assigned pharmacy receives an image-header utility template containing the request reference, image position, client WhatsApp number and approximate distance, with `Can fulfil` and `Cannot fulfil` quick replies. Web catalogue orders use a separate image-header utility template containing medicine names, quantities, total units, client number, distance and fulfilment preference. Reply actions are accepted only from the exact verified pharmacy assigned to that request; the visible client number lets the pharmacy respond directly in WhatsApp.

The canonical provider endpoints are `/api/twilio/whatsapp/inbound` and `/api/twilio/whatsapp/status`. Both validate Twilio signatures against their exact canonical URLs and configured account before accepting any data. Private media is exposed only through hashed, expiring and replay-limited per-delivery grants. D1 outbox rows, Twilio message SIDs and status events are idempotent and cannot regress on out-of-order callbacks.

Production configuration uses Twilio Content SIDs for pharmacy images/orders, OTPs, saved/new location choices, the manual location prompt, and delivery-based client confirmation. A confirmation is queued only after every pharmacy delivery attempt is terminal and at least one request was actually delivered; its count is the number delivered, never the number merely selected. Provider activation requires exact Twilio sender ownership, Cloudflare-only secret installation, active content resources, exclusive webhook routing, and a consented physical-phone image → native location → nearest-pharmacy dispatch → pharmacy reply test. Local implementation, template state, deployment, and physical delivery remain separate evidence gates.

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
provider flow are live: source reconciliation, remote infrastructure readback,
and controlled production proof remain mandatory.

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
  --target production \
  --imported-at 2026-08-23T12:30:00Z \
  --output-dir work/dashboard-recovery/production
```

Run `preflight-readback.sql` against the governed production D1 recovery target and
verify its JSON result with `data:dashboard-recovery:verify-preflight`. Only
then apply `recovery-import.sql`. Run `postimport-readback.sql`, verify it with
`data:dashboard-recovery:verify-readback`, and apply the generated immutable
verification receipt. Product-image rows remain unapproved until their bytes
are independently recovered into private R2 and reconciled by SHA-256.

The production sender `+1 662-222-0600` is transported exclusively through Twilio Programmable Messaging. The Worker does not use a Meta access token, app secret, direct Cloud API endpoint, or Meta webhook verification secret.

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

Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` only in the protected production environment. Production additionally needs `MED250_HEALTH_PROBE_TOKEN` in the private verifier and the identical value installed independently as a Cloudflare Worker secret; it must not receive a Supabase key. Configure the single production D1 ID plus all launch and Worker-D1 cutover gates as protected environment variables. Keep the Cloudflare token scoped to the MED+250 Worker and relevant zone. Cloudflare documents the required CI credentials at https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/.

To publish manually after the data, privacy, regulatory, and operational gates are complete:

```sh
npx wrangler login
npm run deploy:preview
# Production remains unavailable until every live gate passes:
npm run deploy:live
```

Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin and keep every production backend slice at `worker-d1`; production must not receive a public Supabase URL or publishable key. The customer address picker also needs a dedicated `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` with Maps JavaScript API and Geocoding API enabled and HTTP-referrer restrictions limited to the MED+250 origins. This browser key is intentionally public; never reuse the server-only `GOOGLE_MAPS_API_KEY` used for pharmacy geocoding. Live public-contact readiness requires approved owner channels in `NEXT_PUBLIC_MED250_CONTACT_EMAIL`, `NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP`, and `NEXT_PUBLIC_MED250_MEETING_URL`; the storefront renders them only when configured, and release validation rejects unsafe values. Keep health-probe, server Google Maps, Twilio, admin-token, and encryption credentials only in protected server secret stores. `npm run deployment:verify -- --url <https-url> --mode preview|live` can be rerun independently after any deployment. A successful dry run proves the Worker bundle and declared bindings are valid; it does not prove provider configuration, remote runtime authentication, order dispatch, production DNS, or physical-phone messaging.

The active custom domain is `med-250.com`, routed directly to the production-named Cloudflare Worker. DNS and TLS reachability are necessary but do not by themselves confirm the launch gate; the strict deployment verifier, account evidence, backend health, controlled UAT and named infrastructure approval must all pass before the current public release can be formally approved or redeployed through the protected production workflow.

For an owner-only Sites deployment, provide the short-lived Sites bypass credential only through the `SITES_BYPASS_BEARER_TOKEN` process environment while running `deployment:verify`. The verifier sends it in `OAI-Sites-Authorization`, never in the URL, report or repository. Public and direct Cloudflare deployments do not need that variable.
