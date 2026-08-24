# MED+250 Repository Threat Model

## Overview

MED+250 is a product-first pharmacy marketplace for Rwanda. Public customers browse a source-backed catalogue, place one order containing product selections and an exact location, and may optionally attach a WhatsApp number and prescription. The order-routing database function is designed to dispatch only to at most 20 eligible pharmacies within 10 km. Pharmacy identity, customer contact, and prescription access are intentionally withheld until a complete pharmacy response is selected (`README.md:1-7`, `README.md:24-39`, `supabase/migrations/20260714001000_marketplace_dispatch_eligibility.sql:3-40`).

The production runtime is a Next/Vinext application delivered through a Cloudflare Worker. Browser clients communicate directly with Supabase Auth, Data API/RPC, Realtime, Storage, and Edge Functions through an intentionally public publishable key (`package.json:41-66`, `worker/index.ts:66-109`, `lib/supabase.ts:1-23`, `lib/dawanear-client.ts:619-770`). The repository does not process card or MoMo payments; it creates WhatsApp and fixed USSD handoffs after pharmacy selection (`app/marketplace.tsx:235-245`, `app/terms/page.tsx:12-13`).

This model is repository-scoped. It describes assets, actors, boundaries, and plausible abuse cases for the frozen working-tree snapshot; it does not assert vulnerabilities.

## Security Objectives

1. A customer may read and modify only their own anonymous-session profile, orders, offers, selected contact, and prescription objects.
2. A pharmacy staff session must be issued only after a valid WhatsApp OTP for a verified, login-enabled contact linked to an active, currently licensed pharmacy.
3. Pharmacy staff may access only pharmacies for which they have an active membership, and only orders routed to those pharmacies.
4. Exact customer contact and prescription access remain unavailable before the customer selects a complete pharmacy response.
5. Order routing remains bounded to current, marketplace-approved pharmacies with reviewed GPS and an eligible WhatsApp responder; catalogue/product and price-range data remain accurate.
6. Elevated Supabase, WhatsApp, Google Maps, CI, and Cloudflare credentials never reach public browser bundles or logs.
7. Preview deployments never accept live orders or become indexable; live deployment requires explicit production gates.

## Assets and Sensitive Data

- **Customer identity and session:** anonymous Supabase user ID, persisted customer session, optional saved WhatsApp number, language preference, active-order identifiers, and order ownership (`lib/supabase.ts:14-23`, `lib/dawanear-client.ts:481-539`).
- **Customer health and order context:** products, quantities, prescription status, substitution choices, price bounds, delivery preference, and precise GPS/accuracy (`lib/dawanear-client.ts:145-210`, `lib/dawanear-client.ts:706-780`).
- **Prescription data:** private PDF/image bytes, owner-prefixed Storage paths, order linkage, short-lived signed URLs, cleanup leases, and retention metadata (`lib/dawanear-client.ts:664-704`, `lib/dawanear-client.ts:1178-1217`, `supabase/migrations/20260712130000_dawanear_marketplace.sql:2941-3210`).
- **Pharmacy identity and session:** registered WhatsApp numbers, OTP challenge hashes, permanent Auth mappings, memberships, access/refresh tokens, and login timestamps (`lib/supabase.ts:25-105`, `supabase/functions/dawanear-pharmacy-verify-otp/index.ts:47-127`).
- **Commercial and fulfilment data:** dispatch recipients, pharmacy offers, itemized prices, substitutions, readiness time, fulfilment method, MoMo code, and post-selection pharmacy/customer contact (`lib/dawanear-client.ts:73-219`, `lib/dawanear-client.ts:1111-1337`).
- **Regulatory and operational integrity:** product registration/orderability, pharmacy licence and source provenance, Google Place evidence, contact verification, maintenance state, and operational health (`supabase/migrations/20260714001000_marketplace_dispatch_eligibility.sql:3-40`, `supabase/functions/geocode-pharmacies/index.ts:69-123`).
- **Control-plane secrets:** Supabase elevated key, OTP secret, WhatsApp Cloud token/template configuration, Google Maps API key, admin/cron tokens, GitHub/Cloudflare deployment credentials, and live-gate attestations (`supabase/functions/_shared/dawanear-pharmacy-auth.ts:18-34`, `supabase/functions/geocode-pharmacies/index.ts:12-36`, `.github/workflows/deploy-cloudflare.yml:74-116`).
- **Availability and telemetry:** Worker request logs and privacy-bucketed marketplace signals, which must not contain request bodies, query strings, tokens, contacts, or health details (`worker/index.ts:87-109`, `app/api/telemetry/route.ts:30-113`).

## Actors

- **Unauthenticated visitor / bot:** can request public pages, catalogue/search, telemetry, image transforms, and pre-auth WhatsApp OTP endpoints.
- **Anonymous customer:** an Auth user represented to Postgres as `authenticated` with `is_anonymous=true`; owns profile, orders, offers, and prescription paths (`lib/dawanear-client.ts:481-515`).
- **Permanent pharmacy staff:** non-anonymous Auth user linked through a WhatsApp identity and active pharmacy membership; may be legitimate, compromised, or malicious.
- **Marketplace operator/reviewer:** uses dedicated admin tokens to review GPS and contact-edit evidence.
- **Scheduled maintenance caller:** uses a cron token for prescription cleanup and timed-out order recovery.
- **Service role / Edge Functions:** privileged Supabase actor that bypasses browser RLS and can administer Auth.
- **Developer / CI / deployer:** controls source, dependencies, workflows, production variables, and Cloudflare routes.
- **External processors:** Cloudflare/Turnstile, Supabase, Meta WhatsApp Cloud API, Google Places, and the mobile operator/USSD environment.

## Trust Boundaries

### 1. Public Internet to Cloudflare Worker and application router

All URLs, headers, request bodies, image parameters, and telemetry events are attacker-controlled. The Worker dispatches `/_vinext/image` through Cloudflare Images and all other requests through Vinext (`worker/index.ts:66-86`). It adds CSP, anti-framing, HSTS, referrer, MIME, COOP/CORP, and geolocation permission controls (`worker/index.ts:22-57`).

### 2. Browser to Supabase public endpoints

The publishable key is public by design. Security must be enforced by Auth claims, RLS, function grants, explicit ownership/membership checks, and Storage policies—not by hidden UI controls or request shape (`lib/supabase.ts:1-23`, `lib/dawanear-client.ts:411-430`). Direct API callers must be assumed.

### 3. Anonymous customer session to permanent pharmacy session

Customer and pharmacy clients use separate storage keys and clients; the customer path rejects permanent identities in the customer store (`lib/supabase.ts:14-25`, `lib/supabase.ts:101-105`, `lib/dawanear-client.ts:481-500`). Both stores still share one browser origin, making script integrity and token lifecycle material.

### 4. Browser JWT to Postgres RLS and `SECURITY DEFINER` RPCs

Ownership and membership invariants depend on `auth.uid()`, locked function search paths, RLS, explicit grants, and private helper schemas. The aggregate backend contract inventories these controls without returning row-level data (`supabase/migrations/20260713230000_least_privilege_contract.sql:3-288`).

### 5. Public pre-auth OTP endpoint to privileged Edge Function

Gateway JWT verification is disabled so users can authenticate before a session exists. OTP handlers rely on origin validation, normalized inputs, rate limiting, keyed hashes, atomic challenge consumption, and eligibility checks. Administrative functions also disable gateway JWT validation but require custom secret headers (`supabase/config.toml:3-24`, `supabase/functions/_shared/dawanear-pharmacy-auth.ts:36-214`).

### 6. Edge Functions to Supabase Admin/Auth and external APIs

OTP verification uses the service role to create/update Auth users and memberships, then returns a permanent session. Other privileged functions mutate geocode/contact evidence or delete prescriptions. WhatsApp/Google requests cross separate trust domains (`supabase/functions/dawanear-pharmacy-verify-otp/index.ts:50-127`, `supabase/functions/_shared/dawanear-pharmacy-auth.ts:216-260`, `supabase/functions/geocode-pharmacies/index.ts:126-221`).

### 7. Private Storage to customer and selected pharmacy

Customer uploads are private owner-prefixed objects; selected pharmacies receive time-bounded signed URLs only after selection. Object bytes, content type, lifecycle state, link sharing, and downstream viewing remain untrusted (`lib/dawanear-client.ts:664-704`, `lib/dawanear-client.ts:1192-1217`).

### 8. Pre-selection state to post-selection disclosure

Pharmacy directory and recipient topology are intentionally private. Before selection, a routed pharmacy receives only order content, coarse distance, and fulfilment context. Exact customer WhatsApp and prescription access cross the boundary only after selection (`supabase/migrations/20260713142000_hide_unconfirmed_pharmacies.sql:1-38`, `supabase/migrations/20260713143343_hide_public_pharmacy_directory_view.sql:1-13`).

### 9. Realtime publication to browser subscriptions

Customer and pharmacy clients subscribe with attacker-controlled order/pharmacy identifiers. Realtime filters reduce noise, but table RLS remains the authorization boundary (`lib/dawanear-client.ts:939-983`, `lib/dawanear-client.ts:1223-1255`).

### 10. Developer/CI/operator to production

Source, dependencies, protected variables, Cloudflare environment selection, routes, security headers, and live-gate statements can change production behavior. Production uses a separate named Worker environment and manual workflow (`wrangler.jsonc:25-42`, `.github/workflows/deploy-cloudflare.yml:27-116`).

## Attack Surface and Input Ownership

### Attacker-controlled public inputs

- URL search/portal parameters, dynamic product IDs, search query/filter/sort/limit/offset (`app/marketplace.tsx:433-438`, `app/product/[id]/page.tsx:7-25`, `lib/dawanear-client.ts:628-650`).
- Local cart state, product IDs, quantities, substitutions, price bounds, fulfilment choice, and order/offer UUIDs (`app/marketplace.tsx:440-465`, `lib/dawanear-client.ts:706-805`).
- Native/manual coordinates and reported accuracy, customer WhatsApp, prescription file metadata/bytes, and Storage path (`lib/dawanear-client.ts:664-780`).
- OTP phone, challenge ID, six-digit code, request origin, IP-forwarding headers, and user agent (`supabase/functions/_shared/dawanear-pharmacy-auth.ts:44-55`, `supabase/functions/_shared/dawanear-pharmacy-auth.ts:103-189`).
- Telemetry bodies and direct calls to all public Supabase endpoints regardless of UI visibility (`app/api/telemetry/route.ts:78-113`).

### Authenticated pharmacy-controlled inputs

- Claimed pharmacy/order/contact UUIDs, item availability, substitute product, unit price, quantity, note, fulfilment method, readiness, price contribution, and contact-edit request (`lib/dawanear-client.ts:1257-1367`).
- The application must treat a compromised or malicious legitimate member as different from an unauthenticated attacker.

### Operator-controlled inputs

- Pharmacy contacts/memberships, GPS candidate and approval evidence, licences, regulatory state, and product orderability.
- Admin/cron/OTP secrets, external API credentials, allowed origins, WhatsApp template/version, and launch-gate attestations.

### Developer-controlled inputs

- Application/Worker source, dependencies, generated SEO catalogue, import snapshots, GitHub Actions, Wrangler routes, and release scripts (`package.json:41-69`, `wrangler.jsonc:1-43`).

## Existing Mitigations and Invariants

- Preview is the default, disables ordering in the UI, suppresses indexing, and receives Worker-level `X-Robots-Tag`; production requires an explicit environment (`app/marketplace.tsx:127-128`, `app/marketplace.tsx:273-275`, `app/robots.ts:4-7`, `worker/index.ts:55-56`).
- Customer and pharmacy sessions use separate clients/stores. Pharmacy tokens refresh through a dedicated flow and explicit sign-out clears the store (`lib/supabase.ts:14-105`, `lib/dawanear-client.ts:1023-1027`).
- New anonymous sessions can require Turnstile. Client inputs are bounded before backend calls, but server-side enforcement remains authoritative (`lib/dawanear-client.ts:436-466`, `lib/dawanear-client.ts:492-515`, `lib/dawanear-client.ts:706-780`).
- App-specific relations use a `dawanear_` prefix, privileged helpers use a revoked private schema, RLS is broadly enabled, and role grants are explicit (`supabase/migrations/20260712130000_dawanear_marketplace.sql:3-8`, `supabase/migrations/20260713230000_least_privilege_contract.sql:28-94`).
- Public pharmacy discovery is disabled; only complete customer-owned confirmations are returned, and contact is released after selection (`supabase/migrations/20260713133000_product_first_private_confirmations.sql:1-109`).
- Dispatch eligibility requires an active/approved pharmacy, current licence, reviewed GPS, and a verified login-enabled WhatsApp contact (`supabase/migrations/20260714001000_marketplace_dispatch_eligibility.sql:3-40`).
- Order creation is authenticated and idempotent, validates customer ownership/product/location/prescription conditions, and is designed to route within 10 km to at most 20 eligible pharmacies (`supabase/migrations/20260712130000_dawanear_marketplace.sql:911-1279`).
- OTP uses an origin allowlist, cryptographic six-digit code, keyed SHA-256 hash, phone/source/global rate limits, five-minute expiry, bounded attempts, and atomic row-locked consumption; eligibility requires a verified login-enabled WhatsApp contact and current pharmacy licence (`supabase/functions/_shared/dawanear-pharmacy-auth.ts:36-214`, `supabase/migrations/20260713084601_pharmacy_whatsapp_otp_auth.sql:45-113`).
- Prescription upload is limited to 10 MB and four declared MIME types, uses random owner-prefixed names, disables upsert/update, and is guarded by owner/selected-pharmacy policies. Selected-pharmacy URLs are capped to ten minutes and the remaining selection window (`lib/dawanear-client.ts:664-704`, `supabase/migrations/20260712130000_dawanear_marketplace.sql:3114-3210`, `lib/dawanear-client.ts:1192-1217`).
- Telemetry allow-lists event names/properties, buckets values, and rejects bodies above 2 KiB (`app/api/telemetry/route.ts:1-113`).
- Release preflight rejects secret-looking public variable names and invalid mode/origin/gate combinations; production deployment is manual, environment-separated, and post-deployment verified (`scripts/validate-release-config.mjs:78-136`, `.github/workflows/deploy-cloudflare.yml:27-116`).
- Privileged maintenance/review functions compare dedicated secrets before constructing service clients; logs are intended to omit request bodies and credentials (`supabase/functions/geocode-pharmacies/index.ts:3-36`, `supabase/functions/cleanup-prescriptions/index.ts:27-46`, `worker/index.ts:87-109`).

## Attacker Stories for Discovery and Validation

These are scenarios to test, not findings.

1. An anonymous caller bypasses UI validation and changes product IDs, quantities, coordinates, prescription paths, order IDs, offer IDs, or RPC arguments; backend ownership, orderability, geography, and idempotency must hold.
2. A user manipulates Realtime filters or queries published tables directly to enumerate another customer's order/offers or another pharmacy's notifications.
3. A legitimate or compromised staff session supplies a different pharmacy ID, enumerates other pharmacies' assigned orders, reads selected customer data, submits unauthorized substitutes/prices, or edits another pharmacy's contacts.
4. A bot farms anonymous sessions, catalogue search, telemetry, OTP send, or OTP verify to exhaust quota, enumerate registered pharmacy numbers, or create WhatsApp cost.
5. An attacker obtains same-origin script execution and steals customer/pharmacy tokens from browser storage, active-order data, prescriptions, or selected contacts.
6. A crafted prescription abuses MIME ambiguity, downstream rendering, signed-link sharing, object ownership, or cleanup/retention gaps.
7. A malicious catalogue/operator value crosses server/client output boundaries through product names, image URLs, offer/contact notes, SEO metadata, or structured data.
8. An attacker forges proxy headers or Origin semantics to influence OTP rate-limit identity or bypass intended browser-origin checks.
9. An external handoff changes the WhatsApp destination/message or MoMo behavior after the user leaves MED+250.
10. A developer, dependency, CI secret, deployment environment, or release-mode compromise publishes a malicious bundle, weakens security headers, changes Supabase origins, or bypasses launch gates.
11. An administrative or cleanup caller obtains/replays a custom token and reaches service-role mutation or prescription deletion.
12. Concurrency at OTP, order, offer, selection, contact review, geocode approval, or cleanup transitions creates duplicate, stale, or cross-tenant state.

Less applicable: card-payment custody attacks are outside the current repository; email-password signup is not the pharmacy access model; public catalogue enumeration is intended unless it crosses into pharmacy/customer-private data.

## Assumptions and External Dependencies

- Supabase Auth token issuance, RLS enforcement, PostgREST, Storage, Realtime, and Edge runtime behave as currently documented and configured.
- HTTPS, Cloudflare, Turnstile, Meta/WhatsApp, Google Places, and the mobile operator are trusted only within their stated interfaces; their outages or compromise remain external risks.
- Operator-reviewed GPS, contact, licence, and product-classification data are trustworthy only after their controlled approval workflows.
- Production secrets are unique, rotated after any exposure, scoped to the intended project/environment, and unavailable to browser bundles.
- Live mode is not enabled until regulatory/privacy/source-use/operations approvals, GPS/contact readiness, credential rotation, Cloudflare account/domain configuration, and physical-phone UAT are supported by real evidence.

## Severity Calibration

- **Critical:** service-role, WhatsApp, CI, or deploy credential compromise enabling broad privileged access; arbitrary pharmacy-session minting; remote code execution in a deployed privileged function; or authorization failure exposing/modifying prescriptions, exact locations, contacts, and orders across many tenants.
- **High:** takeover of one pharmacy; cross-customer order/contact/prescription access; unauthorized signed prescription URL; stored script execution that steals sessions; unauthorized offer selection/routing or health-sensitive substitution manipulation.
- **Medium:** bounded OTP abuse or number enumeration; limited authenticated price/contact/geocode manipulation; retention failure; sustained resource abuse affecting ordering/OTP/cleanup; or meaningful single-order integrity/availability impact without broad private-data access.
- **Low:** non-sensitive catalogue/SEO presentation issues, isolated telemetry spoofing, preview indexing leakage, or defense-in-depth configuration weaknesses without meaningful confidentiality, integrity, or availability consequence.

Severity increases when exploitation crosses customer/pharmacy identity boundaries, exposes prescriptions/location/contact data, defeats ownership/membership checks, or reaches service-role execution. Severity decreases when it requires an already-held operator secret, affects only public catalogue data, or remains constrained to the attacker's own anonymous session.

Repository: target_sha256_e71b40704a8f1fed3d652a46a41f4deed170fe871f741035e0861ad9d8370e96
Version: codex-security-snapshot/v1:sha256:8d7642c617446e815f5dae210932b0972bb9c46ed42916c5b0a9e0c78a728f0b
