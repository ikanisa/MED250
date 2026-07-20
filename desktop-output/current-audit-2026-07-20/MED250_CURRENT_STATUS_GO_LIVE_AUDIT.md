# MED+250 current status and go-live readiness audit

Date: 2026-07-20  
Repository: `ikanisa/MED250`  
Local checkout: `/Users/mjmwestby/Documents/MED250`  
Audited commit: `7922addefff1df9f8660d5eb7858b8a397581160` (`main`, `origin/main`)  
Live domain checked: `https://med250.gikundiro.com/`

## Executive verdict

MED+250 is buildable and visually strong, but it is not go-live approved.

The public domain is reachable over HTTPS, returns strong security headers, has an indexable robots/sitemap setup, and the local build/lint/security/performance checks largely pass. After removal of the four non-relevant launch gates, the repository’s own protected launch model reports 11 of 11 production gates still pending, 12 of 12 physical-device UAT scenarios still pending, and strict launch remains deliberately fail-closed.

There is also a fresh-checkout reproducibility issue: multiple audit/data/test commands reference a missing generated artifact at:

`outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json`

Because `outputs/` is intentionally not version-controlled, this must be restored from the governed durable evidence store or the scripts/tests must be updated to consume a committed/redacted equivalent.

## What was verified

### Local repository and dependency status

- Repo was fetched into `/Users/mjmwestby/Documents/MED250`.
- Default branch: `main`.
- Remote: `https://github.com/ikanisa/MED250.git`.
- Local HEAD: `7922addefff1df9f8660d5eb7858b8a397581160`.
- Dependencies installed from `package-lock.json` via npm 11.6.2 under bundled Node.
- npm install audit result: `0 vulnerabilities`.

### Build and static checks

Passed:

- `npm run build`
- `npm run lint`
- `npm run security:audit:node`
- `npm run security:audit:python`
- `npm run performance:budget`
- `npm run localization:verify`
- `npm run release:preflight` when the committed preview-safe `.env.example` public variables are loaded into the process
- `npm run launch:evidence:verify` in non-strict mode
- `npm run audit:browser-evidence:verify` in non-strict mode
- `npm run uat:verify` in non-strict mode

Failed or blocked:

- `npm run data:validate` fails at the product-content verification step because the corrected catalog dataset under `outputs/...` is missing.
- `npm run audit:closure:status` fails for the same missing artifact.
- Full test run: 286 passed, 6 failed.
  - 4 failures are direct `ENOENT` failures for the missing corrected catalog dataset.
  - 2 failures are rendered-HTML expectations around product image metadata/similar product cards. The hydrated local product page did show the governed Supabase images, so the issue appears to be initial server-render/test-harness behavior and still matters for SEO/social metadata.

### Launch gate status

`npm run launch:evidence:status` reports production ready: `no`.

After the launch-gate cleanup, 11 launch gates remain pending:

1. GPS readiness
2. WhatsApp readiness
3. Duplicate-register review
4. Security-hardening deployment approval
5. Edge Functions deployment approval
6. Turnstile server verification
7. Anonymous-auth rate-limit approval
8. Prescription-retention approval
9. Cloudflare account verification
10. Production domain/DNS approval — machine evidence refreshed on 2026-07-20 against live revision `37d8c1c0e0c8ac2d15eea436d2f9037c20e2814c`; owner approval remains pending
11. Physical-device UAT

### Live domain status

`https://med250.gikundiro.com/` returned HTTP 200.

Observed live headers include:

- `strict-transport-security`
- `content-security-policy`
- `x-frame-options: DENY`
- `x-content-type-options: nosniff`
- `permissions-policy`
- `referrer-policy`
- `x-med250-release-revision: 37d8c1c0e0c8ac2d15eea436d2f9037c20e2814c`

The live revision exists locally and is contained by the current `main`, so the checked-out public repo is newer than the currently deployed live revision.

`robots.txt` allows public indexing except `/pharmacies` and `?pharmacy-portal=` routes. The live sitemap is reachable and includes homepage, categories, privacy, terms, and product/category URLs.

### Sites project status

`.openai/hosting.json` contains:

`appgprj_6a53c26ac59c819197e17ee4bc024887`

Read-only Sites connector lookup returned `project_not_found`. The public Sites-style URL `https://med250-rwanda.ikanisa.chatgpt.site/` did return HTTP 200, but the local connector could not resolve the stored project ID. Treat the local Sites metadata as stale, inaccessible to the current account, or referring to a project outside this connector context until reconciled.

## Product/UX audit from current screenshots

Screenshots captured in:

`desktop-output/current-audit-2026-07-20/screenshots/`

Captured steps:

1. `01-home-desktop.png` — desktop homepage/catalogue
2. `02-after-add-basket.png` — add-to-request and basket review
3. `03-request-details.png` — request details/WhatsApp/location step
4. `04-product-detail.png` — medicine product detail
5. `05-home-mobile.png` — mobile homepage at 390px viewport

### Strengths

- Clear marketplace positioning: find products, request availability, continue on WhatsApp.
- Strong safety language: “no payment yet”, pharmacy confirmation, central indicative pricing.
- Product detail pages show concrete medicine facts: manufacturer, strength, form, Rwanda FDA registration.
- Request flow is appropriately gated around WhatsApp and location.
- Accessibility basics are present: skip link, labelled search controls, ARIA labels on basket/location/add buttons, status regions.
- Mobile viewport had no DOM-reported horizontal overflow at 390px.
- Visual system is coherent and polished: MED+250 branding, soft marketplace palette, useful product/category cards.

### UX/accessibility risks

- Mobile header/search area is cramped. The DOM does not report overflow, but the captured narrow viewport makes the search/header feel clipped and visually crowded.
- Some mobile search controls collapse to icon-only/low-text states; acceptable if labels remain accessible, but visual discoverability is weaker.
- Basket details panel is clear, but the background blur can reduce context and may be visually heavy on low-powered devices.
- The request flow depends on real location and WhatsApp verification; final happy-path testing requires controlled physical-device UAT and cannot be completed safely with fake data.
- Product images on the hydrated product page are correct, but rendered-HTML tests show image metadata can be missing in the initial response. That can affect crawlers, unfurls, and SEO.
- Privacy/terms pages exist, but public legal/contact escalation details appear thin from code inspection; launch needs named real-world owner/contact channels.

## Required additions and missing launch items

### Contact and conversion essentials

Add or confirm:

- Public support email, e.g. `support@med250...`, shown in footer, privacy, terms, and help/contact surfaces.
- Privacy/DPO email or postal contact for health-data and prescription-related requests.
- Pharmacy onboarding contact channel.
- WhatsApp public contact link for customer support and pharmacy onboarding, separate from the regulated pharmacy-to-customer handoff.
- Calendar/meeting booking link for pharmacy onboarding, partner discussions, legal/compliance discussions, and operations training.
- Escalation contact for incident, prescription, privacy, and pharmacy-operation issues.
- Clear support SLA or hours of operation.
- Public “Contact us” page or section.

### Operational launch essentials

- Complete pharmacy GPS readiness review ledger.
- Complete pharmacy-authorised WhatsApp readiness review ledger.
- Complete physical-device UAT for GPS consent, OTP, dispatch, real-time confirmation, selection, WhatsApp, MoMo, cancellation, expiry, and prescription access.
- Confirm production monitoring owners and escalation rotation.

### Legal/regulatory/privacy essentials

- Duplicate-register decisions for all 51 pending groups.
- Qualified Kinyarwanda translation approval and legal/clinical review.
- Privacy-owner approval of prescription retention periods.
- DPIA / privacy controller-processor role records for Supabase, Cloudflare, WhatsApp/Meta, Google Maps, and any other processors.
- Search Console ownership and indexing acceptance if public SEO launch is intended.

### Security/infrastructure essentials

- Replace broad Cloudflare OAuth use with least-privilege deploy token.
- Verify Cloudflare account, route ownership, Worker names, and protected environments.
- Complete Turnstile real-widget positive-path test.
- Approve anonymous-auth rate limits after controlled test.
- Reconcile `.openai/hosting.json` project ID with the current Sites connector/account.
- Decide whether live production is Cloudflare Worker canonical, Sites canonical, or both with distinct roles.

### Technical/repo completeness essentials

- Restore or recommit the missing corrected-catalog dataset evidence in an approved form.
- Fix/reconcile the 6 failing tests.
- Make `npm run data:validate` pass from a fresh checkout.
- Make `npm run audit:closure:status` work from a fresh checkout or document the required private evidence mount.
- Re-run full `npm test`, `release:check`, and eventually `release:check:live`.
- Re-run product image metadata tests and confirm crawlers receive product-specific OG images in the initial HTML response.

## Go-live decision

Current recommended state:

- Public catalogue: can remain reachable if the team is comfortable with the already-public domain and the legal/data-use posture.
- Formal production launch / live requests: not ready.
- Marketing announcement / SEO push: wait until Search Console, product metadata, and owner gates close.
- Pharmacy partner onboarding: ready to demo, but should have a public contact, WhatsApp support channel, and booking/calendar path added first.

## Highest-priority next actions

1. Restore the missing corrected catalog dataset or change validators to use a committed/redacted durable artifact.
2. Fix the rendered product image metadata tests.
3. Add public contact routes: support email, privacy contact, WhatsApp contact, pharmacy onboarding contact, and booking/calendar link.
4. Reconcile Sites project ID and decide canonical hosting path.
5. Close owner-controlled launch gates in this order: WhatsApp/GPS, security-hardening/Edge Functions, Turnstile/rate limits, infrastructure, physical-device UAT.
6. Re-run `npm run release:check`, then strict live checks only after all evidence gates are genuinely complete.
