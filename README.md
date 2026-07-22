# MED+250

MED+250 is an information-first Rwanda pharmacy marketplace. A customer browses one central catalogue of medicines and consumer health products, sees a centrally maintained indicative “From RWF” price where available, and sends an availability request to eligible pharmacies, with verified nearby pharmacies prioritised. Pharmacies confirm privately, then the customer and pharmacy verify availability, final price, and fulfilment on WhatsApp. An order is optional and begins only after that interaction.

The inherited `dawanear_*` database names and `lib/dawanear-client.ts` filename are retained only as legacy technical identifiers so the audited medicine, pharmacy, and ordering system remains compatible. They are not a second product or brand. All customer and new operator interfaces use MED+250.

The application defaults to `NEXT_PUBLIC_MARKETPLACE_MODE=preview`. Preview mode is intentional: it never fabricates request success or live pharmacy responses and it does not send customer health data. In live mode the customer journey stays deliberately short: find products, build a request, share location, review pharmacies that confirm availability, and continue on WhatsApp.

The current implementation and UAT record is [MED250_AMAZON_ALIGNMENT_IMPLEMENTATION.md](desktop-output/implementation-qa-2026-07-13/MED250_AMAZON_ALIGNMENT_IMPLEMENTATION.md).

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

- Live catalogue browsing uses the paginated unified catalogue RPC instead of downloading every product into the customer browser. It ranks exact names and ingredients, full-text matches, common-use English/French/Kinyarwanda aliases, and close spelling matches; category, prescription, dosage-form, requestability, central indicative-price filtering, sorting, and stable result counts are applied server-side. The in-browser scorer remains only as the preview/offline fallback. The RPC is `SECURITY INVOKER`, has an empty search path, exposes no pharmacy identity, and is executable only by `anon` and `authenticated`.
- Supabase anonymous Auth for customers; six-digit WhatsApp Cloud API OTP for pharmacy staff. The portal has no email sign-up or claim path. A pharmacy number must already be attached to an active, marketplace-approved pharmacy record. Approved GPS coordinates improve nearby ranking; an otherwise eligible pharmacy without approved coordinates may participate only through the verified national responder fallback and is never represented as nearby. Successful OTP exchange creates a permanent Supabase session in a pharmacy-only browser store; it refreshes and persists until staff explicitly sign out.
- Pharmacy OTPs expire after five minutes, are stored only as a purpose-bound salted hash, allow at most five attempts, invalidate older codes, and are rate-limited by phone, request source, and global volume. Both OTP Edge Functions validate the browser origin before parsing input, writing a challenge, sending WhatsApp, consuming a code, or changing an identity/session, so a rejected site has no authentication side effects. WhatsApp delivery reuses the project-level authentication template and server-only Cloud API credentials.
- Atomic, idempotent order creation: a stable customer request UUID ensures retries return the same committed order while draft, line items, and location-based dispatch commit together. A database constraint permits only one active request per customer.
- PostGIS `ST_DWithin` and KNN ordering prioritise eligible pharmacies within 10 km, followed by a stable verified national responder fallback, with at most 20 recipients in total.
- Dispatch requires approved marketplace status, an active record, an unexpired premises entry, and a verified login-enabled business WhatsApp contact. Approved GPS coordinates are required only for a pharmacy to be ranked or described as nearby. All source-imported pharmacies are marketplace-approved automatically; approval is not displayed as a customer-facing badge.
- Transactional availability confirmation and pharmacy selection, with item/substitute validation. A pharmacy may omit price; any supplied estimate is private and non-final.
- Private prescription Storage. Recipients see only a prescription-present flag; only the customer and selected pharmacy can read the file, and selected-pharmacy access expires 24 hours after selection. Signed links are capped by the remaining selection window. Substitutes must match non-empty generic, strength, dosage-form, and pack-size fields, and a prescription product cannot be introduced without an attached prescription.
- Definitively unused uploads can be deleted by the customer; ambiguous order retries keep and reuse the same upload. Bucket-scoped restrictive policies compose safely with other project policies: only the owner or selected pharmacy can read a prescription, clients cannot UPDATE/upsert it, and owner upload/delete policies share cleanup's path lock so a referenced or claimed object cannot be replaced. The private `cleanup-prescriptions` Edge Function fairly paginates Storage using a service-only rotating cursor, removes unreferenced or abandoned files after 24 hours, automatically expires selected orders after 24 hours, and removes completed-order files after 30 days. Cleanup is grouped by object path: a service-only 15-minute database lease blocks new references, proves every referenced order is outside its retention window, and independently re-proves that an orphan has no committed references before Storage deletion. Eligible references are cleared together only after Storage confirms deletion; an expired-claim recovery pass retries interrupted work and removes claims that no longer have either an object or a reference. Each run reserves separate capacity for expired claims and newly due paths so persistent retry failures cannot starve new cleanup. Schedule it only after those periods are approved in the production privacy policy.
- Customers can complete or cancel a selected off-platform order and start another request. All recipient pharmacies receive a closure notification so stale requests stop appearing as actionable.
- Optional central indicative prices are stored on product records only when directly observed from a Rwanda catalogue and displayed as “From RWF”. Amazon prices and currency conversions are excluded. Pharmacy catalogue-price contributions are disabled, and public catalogue surfaces never read pharmacy-price records.
- RLS on every exposed table, explicit Data API grants, and Realtime updates constrained by the same policies.
- Privacy-safe operations monitoring is implemented at two layers. The same-origin `/api/telemetry` route accepts only allow-listed events, replaces raw counts and timings with buckets, rejects oversized payloads, and writes no product, request, pharmacy, phone, prescription or location identifiers. The service-role-only `dawanear_operational_health()` RPC aggregates catalogue freshness, centralized price coverage, GPS/contact readiness, dispatch and confirmation counts, OTP delivery, pharmacy logins, response latency and prescription-cleanup health without returning row identifiers.
- No platform payment custody. A verified MoMo merchant code may be revealed after selection; automated payment needs a licensed PSP, signed callbacks, idempotency, receipts, cancellation, and refund handling.

## Activation sequence

MED+250 is installed in Supabase project `uskfnszcdqpcfrhjxitl`. Its prefixed tables, views, functions, private prescription bucket, explicit grants, row-level policies, and Realtime publication entries are isolated from the pre-existing project data. The official source pack is imported, anonymous customer authentication is enabled, and the geocoding, cleanup, pharmacy-OTP-send, and pharmacy-OTP-verify Edge Functions are deployed. The former public `env-dump` diagnostic is retired and JWT-protected because it exposed server environment variables.

1. Add CAPTCHA/Turnstile and confirm suitable anonymous-sign-in rate limits. This is a project-wide Auth setting, so review every existing app before changing it.
2. Keep the protected live-request release gate closed until authoritative pharmacy readiness and the documented Rwanda marketplace operating approvals are complete. The public catalogue may be reachable while formal production approval remains pending, but that state must not be represented as an approved launch.
3. Run both `npm run data:validate` and `npm run data:quality` after every source refresh.
4. Import the validated source pack from a private environment:

   ```sh
   node scripts/import-data/load-supabase.mjs \
     --retail-pharmacies data/imports/rwanda-fda-retail-pharmacies-may-2026.csv \
     --online-pharmacies data/imports/rwanda-fda-online-pharmacies-may-2026.csv \
     --products data/imports/rwanda-fda-products-july-2026.csv
   ```

5. Apply only authorised product classifications through the controlled review workflow below. The source importer always resets products to `unclassified` and non-orderable, so reviews must be revalidated after each register refresh.
6. Every source-imported pharmacy is marketplace-approved automatically. Separately verify current licences, business WhatsApp/MoMo details, staff authority, and precise premises coordinates before representing a pharmacy as nearby. A pharmacy without approved coordinates may participate only through the verified national responder fallback when all other eligibility conditions pass. The WhatsApp number in `dawanear_pharmacies.whatsapp` becomes the pharmacy login identity.
   Use `npm run ops:geocode -- generate`, then `inspect`, and approve exactly one premises with `npm run ops:geocode -- approve` only after manual review. The admin token must exist only in the process environment; the command has no token flag and no batch-approval mode. The workflow never infers WhatsApp from a public phone listing.
   Pharmacy staff can view only their own linked phone and WhatsApp contacts in the Profile tab, then request a new contact, replacement, or removal. Review those requests with `npm run ops:contacts -- list`, then `inspect`, and approve or reject exactly one request after direct verification. Approval is atomic, stores the operator identity and evidence note, enables an approved WhatsApp number for login, and mirrors that number into the pharmacy's phone contacts. The service-only review function blocks replay and neither the CLI nor Edge Function supports batch decisions.
7. Rebuild with `NEXT_PUBLIC_MARKETPLACE_MODE=preview`; the connected preview reads the live product catalogue but does not publish a pharmacy directory or send customer health data.
8. Test customer, unrelated user, recipient-pharmacy staff, and selected-pharmacy access. Run Supabase security/performance advisors.
   Run `npm run ops:health` from a private operations environment with `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` supplied only through the process environment. Use `npm run ops:health:strict` in production monitoring to fail when GPS/dispatch/WhatsApp readiness or cleanup health is critical.
   Run `npm run backend:verify` with the same private process-only credential after every database deployment. It compares the live versioned contract against catalogue-search function mode, monitoring grants, pharmacy/recipient privacy, prescription storage/RLS, and Realtime publication invariants.
9. Do not represent the public deployment as formally approved or expand protected live operation until written Rwanda FDA/RICA confirmation, data-reuse permission, privacy-controller/processor registration, a DPIA, any required outside-Rwanda transfer authorisation, and any applicable payment-provider arrangements are complete. The exact open regulatory issues and owner decisions are in [`docs/launch/RWANDA_REGULATORY_REVIEW_BRIEF.md`](docs/launch/RWANDA_REGULATORY_REVIEW_BRIEF.md).
10. Do not approve or redeploy `NEXT_PUBLIC_MARKETPLACE_MODE=live` through the protected release workflow until every gate above is satisfied. Create and validate a new build after the gates close.

The secret/service key and third-party API credentials must never be stored in the frontend or committed to the repository.

## Controlled product review

Copy `data/imports/product-orderability-review-template.csv` to a private review location. An authorised reviewer must complete exactly one canonical `product_id` or `registration_number` per row, classify it as `prescription`, `otc`, or `pharmacist_only`, set an explicit `is_orderable`, and provide their identity, a timezone-qualified `reviewed_at`, and a note. Do not commit completed review files.

Use the server-only service-role key for a read-only validation first:

```sh
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_SECRET_KEY=... \
npm run data:review-products -- --reviewed /private/product-review.csv
```

The script rejects missing review evidence, duplicate or ambiguous identifiers, inactive/non-medicine products, and expired or non-current registrations. Reviewed `otc` is stored as `non_prescription`; `pharmacist_only` remains distinct. The command is a dry run unless `--apply` is explicitly present. After checking the product list and SHA-256 digest, apply the same unchanged file:

```sh
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_SECRET_KEY=... \
npm run data:review-products -- --reviewed /private/product-review.csv --apply
```

Only `prescription_status` and `is_orderable` on matched `dawanear_products` rows are updated. Keep the completed review, digest, and command output in the controlled regulatory audit record.

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

`npm run release:check` runs the complete preview-safe gate in one command. Its dependency gate audits the complete Node tree at moderate severity or higher and checks every exact Python requirement pin against OSV. The image pipeline requires Python 3.11+ because supported Pillow and rembg releases no longer support the macOS system Python. Before any protected production approval or redeployment, `npm run release:preflight:live` additionally requires live marketplace mode and an explicit HTTPS site origin. It never prints key values. The final `npm run release:check:live` command then requires the deployed backend contract and strict operational-health snapshot to pass before the dependency audit, lint, data validation, tests, budgets, and Cloudflare packaging can proceed. Keep routine local development in preview mode until the GPS, WhatsApp, duplicate-register, authorised test-identity, and production-domain gates are complete.

The live preflight also requires `NEXT_PUBLIC_MED250_OBSERVABILITY=cloud`, a public Turnstile site key, and eleven CI-only launch attestations to be set to `confirmed`: GPS readiness, WhatsApp readiness, duplicate-register review, security-hardening migration deployment, revised Edge Function deployment, Supabase Turnstile server verification, approved anonymous-auth rate limits, prescription-retention approval, Cloudflare account verification, domain/DNS verification, and physical-device UAT. These values are deliberate release locks, not substitutes for evidence. Keep them unset until the corresponding signed approval, deployment receipt, or controlled test record exists. `npm run launch:go-live:status` summarizes the full gate posture and fails closed until the registry, duplicate-register review, and physical-device UAT are all production-ready; `npm run launch:closure:board` generates the owner execution queue for the remaining evidence and approvals; `npm run release:check:live` runs the fail-closed readiness gate before any service-credential or Cloudflare packaging checks.

Physical-device UAT is governed by `data/physical-device-uat.json`. `npm run uat:packet` generates the redacted 12-scenario execution packet for QA; `npm run uat:verify` validates the complete pending ledger; `npm run uat:verify:live` requires every scenario to pass with a redacted evidence reference, useful note, opaque test-identity labels, named executor, named approver and timezone-qualified timestamps. It rejects phone numbers, OTPs, UUID-like order identifiers and secret-like material. The strict UAT verifier is mandatory in `release:check:live`.

Every attestation also has a governed schema-v2 entry in [`data/launch-evidence.json`](data/launch-evidence.json). `npm run launch:evidence:status` lists each owner, acceptance criterion and missing evidence category. `npm run launch:evidence:verify` validates the complete eleven-gate registry without requiring the pending gates to be closed. `npm run launch:evidence:verify:live` requires every gate to be `confirmed` with all gate-specific evidence categories, a named approver and role, a timezone-qualified approval timestamp and valid repository-relative or HTTPS evidence references. Local evidence must be a completed JSON artifact under `docs/launch/evidence/`, match its recorded SHA-256 digest, declare the correct gate/type, confirm redaction, contain passed checks, and satisfy type-specific approval, test, review, deployment, account, domain or operations fields. Generate its shape with `npm run launch:evidence:template`, validate it with `npm run launch:evidence:artifact:verify`, then record it with `npm run launch:evidence:record`. Use `npm run launch:approval:packet` to generate the review packet for evidence-complete gates that still need owner approval. Access-controlled HTTPS evidence requires a named verifier, role and verification timestamp in the registry. Secret-like URLs, summaries and artifact contents are rejected. Production preflight runs this strict evidence check before reading environment flags, so setting CI variables alone cannot unlock a live deployment. Follow [`docs/launch/production-evidence-runbook.md`](docs/launch/production-evidence-runbook.md) to close each gate without storing secrets or fabricating approval.

The operations command returns aggregate data only and never prints its credential. The current captured live snapshot reports 4,659 requestable products (2,459 active medicines plus 2,200 centrally managed consumer products), 769 active pharmacies, 93 GPS-ready pharmacies, 300 dispatch-ready pharmacies, 300 pharmacies with WhatsApp coverage, and 338 login-enabled WhatsApp contact rows. `npm run ops:readiness:packet` generates the 769-row public-registry review index for GPS and WhatsApp readiness without phone numbers or coordinates. Products and indicative prices belong to the central catalogue. MED+250 publishes neither pharmacy-specific prices nor pharmacy stock; pharmacies privately confirm availability and the final interaction happens on WhatsApp. Prescription cleanup is installed through a Vault-backed six-hour schedule; the latest controlled run produced a healthy, non-stale aggregate signal. Privacy-owner approval of the retention periods is still required.

Preview protection is enforced twice: `NEXT_PUBLIC_MARKETPLACE_MODE=preview` emits `noindex` metadata and a blocking `robots.txt`, while `wrangler.jsonc` sets `MED250_RELEASE_MODE=preview` so the Worker adds `X-Robots-Tag: noindex, nofollow`. The modes must match or release preflight fails. The explicit production environment uses `live`; `workers.dev` URLs remain unindexed even in live mode. The public Worker is currently reachable, but it is not formally approved by the protected evidence workflow while gates remain pending. Run `npm run release:check:live` for the final production gate.

The frontend build and source-data validator run locally without a live backend. Database, RLS, Storage, Auth, geospatial dispatch, and Realtime integration tests require authorised access to the target Supabase project or an isolated test branch.

For an authorised release database, `npm run backend:verify` executes the service-only aggregate deployment contract. Version `2026-07-18.3` fails on any unreviewed change to the MED+250 API, GraphQL/RLS, marketplace moderation, publication-audit, catalogue, product-image governance, product-description governance, or aggregate public trust-metric boundary. It additionally proves that catalogue prices are centralized and indicative, pharmacy-specific catalogue-price writes are disabled, public catalogue views avoid pharmacy-price records, pharmacy confirmation prices are optional, public stock is unsupported, every approved or rejected consumer-product version has matching immutable audit evidence, and public product images satisfy the governed provenance and background-removal contract. Product descriptions remain hidden unless their exact source content, reuse rights, clinical applicability, substantive rationale, and named review are complete, and no approval or withdrawal can bypass the single-product immutable review ledger. The image boundary is enforced independently by a validated check constraint, public RLS, a service-only publication RPC, a runtime approval trigger, and a DDL event guard that rejects schema changes leaving those controls unsafe. The only public trust signals allowed by the contract are fixed-shape, aggregate, suppression-aware outputs backed by expiring service-only operations approvals. Supply the service credential through the process environment only; the command never needs it in a file and the contract returns no row identifiers or object names.

After deploying the product-description reviewer, run `npm run backend:verify:description-reviewer -- --product-id PRODUCT_ID --expected-updated-at EXACT_INSPECT_UPDATED_AT --evidence-output docs/launch/evidence/product-description-reviewer-verification-YYYY-MM-DD.json` with the process-only service and admin credentials. It performs no approval or withdrawal: it verifies backend contract `2026-07-18.3`, anonymous HTTP 403 denial, one authenticated `inspect`, the exact product version, and the deployed reviewer contract. Its receipt retains no response body, raw product identifier, credential, description, or review note.

The strict live release command requires the same probe through `MED250_DESCRIPTION_REVIEWER_PROBE_PRODUCT_ID` and `MED250_DESCRIPTION_REVIEWER_PROBE_EXPECTED_UPDATED_AT`; the protected GitHub environment supplies `MED250_ADMIN_TOKEN` as a secret. Missing or stale inputs stop the release before Cloudflare packaging.

`data/imports/duplicate-register-review.csv` is the controlled review ledger for duplicate official identifiers. `npm run data:validate` confirms that its 51 rows still match every source row and reference in the imported registers. A reviewer may set a row to `accepted_source_duplicate` only with their name, a timezone-qualified review timestamp, and a rationale; `blocked_source_correction` records an authoritative correction still required. `npm run data:duplicates:verify -- --strict` rejects both pending and blocked rows and is mandatory in `release:check:live`. Never merge or delete source rows merely to make this gate pass.

`npm run data:duplicates:packet` generates a deterministic private reviewer packet containing all 51 groups, source references, exact field values, differing fields and source-file SHA-256 digests. It contains no inferred decision or recommendation; the named register data reviewer must still inspect the authoritative record and write the decision only to the governed ledger.

The test suite also executes the real catalogue-search TypeScript module and the actual PostgreSQL search migration in PGlite. This covers exact ingredient ranking, multilingual aliases, alias-over-fuzzy precedence, typo recovery, category/form/requestability filters, and stable pagination totals without making a live database write. The storefront preserves the server RPC's result order in live mode; it does not re-rank a server page with the preview fallback scorer.

`npm run performance:budget` fails if browser JavaScript, CSS, the marketplace chunk, or the initial storefront visual assets exceed their measured release budgets. Connected preview and live builds server-render the first 24 source-backed products, then use the paginated Supabase search RPC; the 1 MB fallback CSV is fetched only when no backend is configured. The source PNG artwork remains available for future asset work, while the storefront uses display-sized wordmark and WebP derivatives.

For an authorised release database, [`tests/live-marketplace-rollback.sql`](tests/live-marketplace-rollback.sql) executes the deployed order lifecycle inside one transaction and then rolls it back. It proves automatic retail-pharmacy marketplace approval, verified nearby ranking with national responder fallback, WhatsApp eligibility, idempotent retry, membership isolation, complete confirmation, pre-selection contact privacy, customer ownership, selection/contact release, completion and notification lifecycle while leaving no customer, pharmacy, contact, order, offer or notification fixture behind. Run it through the Supabase SQL editor or an authorised database connection; never add a database password to the repository.

[`tests/live-pharmacy-otp-rollback.sql`](tests/live-pharmacy-otp-rollback.sql) similarly verifies the deployed service-only OTP state machine without sending WhatsApp: correct-code acceptance, single use, safe wrong-code retry, expiry, malformed input and role grants are exercised and rolled back. Cloud API delivery and the resulting browser refresh session still require the controlled physical-device test because the automated suite deliberately sends no real message.

## Cloudflare build and deployment

The repository includes a Cloudflare Worker entry point and `wrangler.jsonc`. The default configuration is the isolated `med250-marketplace-preview` Worker with `MED250_RELEASE_MODE=preview`; the explicit `production` environment targets `med250-marketplace-gikundiro`, disables `workers.dev`, routes the custom domain `med250.gikundiro.com`, and sets `MED250_RELEASE_MODE=live`. This follows Cloudflare's named-environment model while keeping a routine/default deployment away from production traffic. Validate the preview bundle without publishing it:

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
- `production` requires the exact `DEPLOY MED250 LIVE` confirmation plus approval of the `med250-production` GitHub environment. It runs every attestation, duplicate-review, backend-contract and operational-health gate before building the production environment, deploying, and verifying the custom domain is indexable with at least 2,400 sitemap URLs.

Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets in both GitHub environments. The production environment additionally needs `SUPABASE_SECRET_KEY` as a secret and the public build variables plus all eleven launch gates as protected environment variables. Keep the Cloudflare token scoped to the single deployment account and relevant zone. Cloudflare documents the required CI credentials and official Wrangler action at https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ and its named-environment behavior at https://developers.cloudflare.com/workers/wrangler/environments/.

To publish manually after the data, privacy, regulatory, and operational gates are complete:

```sh
npx wrangler login
npm run deploy:preview
# Production remains unavailable until every live gate passes:
npm run deploy:live
```

Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin and configure the public Supabase URL and publishable key as build variables. The customer address picker also needs a dedicated `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` with Maps JavaScript API and Geocoding API enabled and HTTP-referrer restrictions limited to the MED+250 origins. This browser key is intentionally public; never reuse the server-only `GOOGLE_MAPS_API_KEY` used for pharmacy geocoding. Keep service-role, WhatsApp Cloud API, the server Google Maps key, admin-token, and other server credentials only in protected CI or Supabase Edge Function secrets. `npm run deployment:verify -- --url <https-url> --mode preview|live` can be rerun independently after any deployment. A successful dry run proves the Worker bundle and bindings are valid; it does not replace production domain, DNS, runtime, authentication, order-dispatch, or Core Web Vitals verification. Wrangler is currently authenticated to the intended account, and the production Worker and deployment history are visible, but the local OAuth session has broad account-wide write scopes. Replace it with a least-privilege MED+250 deploy credential and retain a redacted account-verification record before confirming the Cloudflare gate.

The active custom domain is `med250.gikundiro.com`, routed directly to the production-named Cloudflare Worker. DNS and TLS reachability are necessary but do not by themselves confirm the launch gate; the strict deployment verifier, account evidence, backend health, controlled UAT and named infrastructure approval must all pass before the current public release can be formally approved or redeployed through the protected production workflow.

For an owner-only Sites deployment, provide the short-lived Sites bypass credential only through the `SITES_BYPASS_BEARER_TOKEN` process environment while running `deployment:verify`. The verifier sends it in `OAI-Sites-Authorization`, never in the URL, report or repository. Public and direct Cloudflare deployments do not need that variable.
