# MED+250 Production Readiness, Critical Risk, and Optimization Report

Audit date: 24 July 2026  
Repository: `https://github.com/ikanisa/MED250`  
Candidate branch: `codex/med250-go-live-hardening`  
Validated application revision: `8ca3f6dc79f57f89c7e3d4b221a357b4fba7c49f`
Canonical production origin: `https://med-250.com`  
Public catalogue origin: `https://med250-rwanda.ikanisa.chatgpt.site`  
Release decision: **NO-GO**

## Executive decision

The application code, catalogue-mode build, production-mode build, dependency
set, localization inventory, performance budget, SEO implementation, responsive
navigation, and core marketplace interactions are technically release-capable.
The hardening candidate passes 373 Node tests, 171 Python tests with one
intentional skip, 58 Sites catalogue/rendering tests, three production build
tests, lint, catalogue validation, localization validation, two dependency
audits, and the Cloudflare production dry run.

Production remains **NO-GO only for evidence-backed external or governance
blockers**:

1. source authority remains pending: the original controlled source-retention
   bundle has not been recovered and no named data owner has yet approved the
   bounded public reconstruction as a new operational baseline;
2. 51 duplicate-register decisions require a named register-data reviewer;
3. 72 product-content decisions require a named regulatory or clinical data
   reviewer;
4. all 11 launch gates remain pending named approval, with one gate's
   release-bound evidence stale;
5. all 12 physical-device UAT scenarios require execution and named QA
   approval;
6. read-only management access now reaches the configured shared Supabase
   production project, but no isolated staging target or staging approval is
   established; the July 23 hardening migration is absent and the deployed
   pharmacy OTP verifier is still the pre-hardening implementation;
7. the completed 16-scenario rendered audit is historical evidence from the
   retired `med250.gikundiro.com` origin and revision `5ef50a296941056bd17e614dff7b35290742f50a`;
   it requires a fresh run on `med-250.com` for the exact candidate revision
   and named QA approval.

GitHub Actions billing is deliberately outside the release path. GitHub is
used only as a free source repository and the local release gate is
authoritative. The free-account requirement is permanent: no paid plan,
Actions overage, paid runner, paid Marketplace app, paid storage, or other
billable GitHub add-on is permitted for MED+250. Optional manual workflows
require separate confirmation that both the account and remaining Actions
allocation are free.

The former DNS blocker is resolved. `med-250.com` resolves through Cloudflare,
HTTPS is live, robots and sitemap respond, and production routes return HTTP
200. The direct production Worker is still revision
`468a3003e3b27c0f42a4ee089c8dae38028c1740`, not this audited hardening
revision, so production must not be represented as running the fix.

The separate public Sites catalogue remains version 15 in `catalog` mode.
Requests and pharmacy fulfilment remain disabled there, and its ten-route live
verification passes. The Sites response does not expose a Git revision header,
so this check does not claim that application revision `8ca3f6d…` is deployed
there. Its live product page has been visually verified to omit the held
mismatched Paracetamol image.

## Critical status register

| Area | Status | Evidence | Release condition |
|---|---|---|---|
| Source authority | **BLOCKED** | `data/source-authority-decision.json` is valid but pending; strict verification blocks production | Restore and checksum-verify the original controlled bytes, or record a named, bounded replacement decision with approved durable storage |
| Duplicate-register review | **BLOCKED** | 51/51 rows remain `pending` | Named reviewer records an allowed decision for every source-bound row |
| Product-content review | **BLOCKED** | 72/72 entries remain `pending` | Named regulatory/clinical reviewer records all source-bound decisions |
| Launch authority | **BLOCKED** | 0/11 gates confirmed; ten prepared-evidence-pending, one stale, zero evidence-complete gates ready for approval | Every gate has complete current evidence, named owner approval, timezone-qualified timestamps, and exact release binding where required |
| Physical UAT | **BLOCKED** | 0/12 scenarios passed | Execute the committed matrix on physical devices and attach redacted evidence and named approval |
| Rendered production audit | **BLOCKED / HISTORICAL** | 16/16 scenarios and 56 captures exist, but they belong to the retired hostname and revision `5ef50a…` and have no named approval | Rerun on `med-250.com` for the exact candidate revision, bind fresh deployment/catalogue receipts and obtain named QA approval |
| Supabase hardening | **BLOCKED** | Read-only access reaches the shared project; migration `20260723120000` is absent, deployed OTP version 12 is pre-hardening, and no isolated staging target is verified | Approve an isolated staging target, deploy and negatively test the exact candidate there, approve rollback, then explicitly authorize production promotion |
| GitHub source hosting | **PASS / FREE-ONLY** | Candidate branch is pushed; paid hosted CI is not a release dependency | Keep automatic workflows disabled and use the local immutable release evidence |
| Production DNS/TLS | **RESOLVED** | Cloudflare A answers, HTTPS route checks, robots, sitemap, and security headers respond | Refresh immutable deployment evidence after the audited revision is deployed |
| Application build | **PASS** | Production build and Wrangler strict dry run pass | Preserve exact source and environment mode through deployment |
| Dependency security | **PASS** | npm and PyPI audits report zero known vulnerable packages | Re-run on the immutable release revision |

## Hardening implemented

### Authorization and tenant isolation

- Added a forward-only database migration that binds pharmacy identity through
  a transaction-locked, reviewed phone-to-pharmacy authority.
- Enforced one enabled pharmacy login number to one pharmacy.
- Disabled directory-derived login authority lacking a named reviewer.
- Failed closed for suspended or revoked membership and conflicting tenant
  binding.
- Restricted offer-item reads to the owning customer or an active member of
  the offering pharmacy.
- Added executable PGlite integration tests that apply the complete migration
  to a realistic fixture and prove negative authorization paths.

### Product description and media governance

- Revoked broad public access to the product source table and re-granted only
  the non-description columns needed by the security-invoker public projection.
- Kept draft and governed description fields unavailable to public roles until
  the approved-only database contract is deployed and proven.
- Held the mismatched `rwanda-fda-hm-1594` image from publication in both the
  database migration and a frontend fail-closed guard. The older direct
  production Worker labels the product as a 125 mg suppository while visibly
  showing oral-suspension bottles. The current Sites catalogue now omits the
  gallery. The direct Worker remains a regulated-product trust P0 until this
  code is deployed there or a correct product-specific gallery is approved.

### Privacy and client-side retention

- Replaced unbounded browser persistence with versioned expiring envelopes.
- Limited basket persistence to 24 hours.
- Moved phone, delivery preference, and precise location to session storage
  with a 30-minute lifetime.
- Removed malformed, expired, empty, and legacy values.

### Motion, navigation, and feedback

- Removed continuous subcategory auto-scrolling.
- Kept discovery user-controlled with snap-aligned horizontal navigation.
- Preserved clear route feedback, skeleton loading, error recovery, basket
  feedback, modal focus handling, live status regions, and reduced-motion
  safeguards.

## Validation record

| Gate | Result |
|---|---:|
| Node application and integration suite | **373/373 passed** |
| Python suite | **171 passed, 1 intentionally skipped** |
| Source-authority preview verification | **Passed; pending owner decision remains visible** |
| Source-authority strict verification | **Failed correctly before credentials or deployment: owner authority pending** |
| Sites catalogue/rendering suite | **58/58 passed** |
| Production build checks | **3/3 passed** |
| ESLint | **Passed** |
| Localization | **596 inventoried, 0 hard-coded, 0 high-risk hard-coded** |
| Catalogue quality | **2,480 source-backed medicine rows passed; six source duplicate warnings retained for review** |
| npm dependency audit | **0 vulnerabilities** |
| Python OSV audit | **10 packages checked, 0 vulnerable** |
| Cloudflare production strict dry run | **Passed** |
| DNS verification | **Passed** |
| Full live exact-revision verification | **Failed correctly: live revision is older than the candidate** |
| Deno Edge type-check | **Environment-blocked: jsr.io package manifest could not be fetched** |

The privacy-safe automated execution record is
`desktop-output/goal-progress-2026-07-24/automated-release-validation-2026-07-24.json`.
It is a technical receipt only and is not launch approval, physical-device
evidence, backend deployment evidence, or proof that the candidate is live.

The performance budget passes:

| Asset class | Result |
|---|---:|
| JavaScript raw | 809,829 B |
| Estimated JavaScript transfer | 236,468 B |
| Marketplace JavaScript raw | 453,634 B |
| Estimated marketplace transfer | 122,438 B |
| CSS raw | 204,438 B |
| Estimated CSS transfer | 34,137 B |
| Initial visual assets | 73,183 B |
| Optimized marketplace images | 10 |

Live synthetic route observations from Kigali on the audit connection were:

| Route | HTTP | Total time | Response size |
|---|---:|---:|---:|
| `/` | 200 | 0.535 s | 108,703 B |
| `/categories` | 200 | 0.798 s | 102,926 B |
| `/category/medicines` | 200 | 0.814 s | 94,666 B |
| `/product/rwanda-fda-hm-1594` | 200 | 0.664 s | 43,471 B |
| `/robots.txt` | 200 | 0.099 s | 143 B |
| `/sitemap.xml` | 200 | 0.276 s | 798,248 B |

These are request-level observations, not field Core Web Vitals. Production
should collect real-user LCP, INP, CLS, error rate, search latency, request
completion, pharmacy response time, and Web Vitals percentiles after approval.

## Live UX and visual audit

The desktop and 390 x 844 mobile surfaces were inspected in the in-app browser.
The live site has:

- a clear value proposition and primary call to action;
- readable responsive typography and stable layout;
- a labelled marketplace search control;
- keyboard-accessible links and buttons;
- skip navigation;
- named landmark regions;
- a valid single level-one heading;
- labelled hero controls and a user-operated pause action;
- accessible mobile navigation whose toggle exposes expanded state;
- visible, understandable search and filter results;
- coherent category, product, basket, and pharmacy-entry paths; and
- no browser console warnings or errors during the audited flows.

The mobile menu is visually clear and touch-friendly. The category rail is
compact and intentionally horizontally scrollable. The strongest current live
defect is the form-mismatched Paracetamol image described above. The hardening
candidate removes it fail-closed.

Evidence:

- `evidence/01-live-home-desktop.png`
- `evidence/02-live-search-paracetamol-desktop.png`
- `evidence/03-live-product-paracetamol-desktop.png`
- `evidence/04-live-home-mobile.png`
- `evidence/05-live-mobile-menu.png`
- `evidence/06-sites-held-product-mobile.png`

## Accessibility readiness

Code and rendered semantics provide a strong WCAG 2.2 AA foundation: skip
navigation, landmarks, explicit names, status announcements, focus treatment,
keyboard-operable controls, touch-size safeguards, reduced-motion behavior,
non-animation-only feedback, and responsive text/layout rules are covered by
source and rendering tests.

Accessibility is not finally approved because the committed 12-scenario
physical-device UAT matrix remains pending. Named QA must test at minimum:

- iOS VoiceOver and Android TalkBack;
- keyboard-only browsing;
- focus order and modal focus return;
- zoom and larger text;
- reduced motion;
- high contrast and color-independent status meaning;
- mobile menu, search, filters, product gallery, basket, checkout, location,
  WhatsApp verification, and pharmacy portal;
- network interruption, retry, expiry, and error announcements.

## SEO and 2026 marketplace discoverability

The implementation includes canonical URLs, `en-RW` alternates, product
metadata, Open Graph and Twitter metadata, Product and BreadcrumbList JSON-LD,
WebSite/publisher semantics, an indexable catalogue mode, noindex protection
for previews, a production robots file, and a complete product sitemap.

The canonical domain is now live and crawlable. SEO release evidence must be
refreshed only after the exact audited revision is deployed. Post-launch
operations should add:

- Google Search Console and Bing Webmaster ownership;
- sitemap submission and index coverage monitoring;
- structured-data validation sampling;
- merchant/product feed governance where policy permits;
- crawl-error, duplicate-canonical, soft-404, and orphan-route monitoring;
- product availability freshness and expiry monitoring; and
- real query-to-product analytics using the existing privacy-safe event
  taxonomy.

The 798 KB sitemap is within protocol limits, but should be monitored as the
catalogue grows and split before it approaches URL or byte ceilings.

## 2026 marketplace product and engineering assessment

### Launch-quality capabilities

- Request-first commerce accurately avoids promising instant regulated-product
  fulfilment.
- Multilingual intent matching supports English, French, and Kinyarwanda query
  recovery while publication of incomplete locale surfaces remains fail-closed.
- Product and related-product discovery use governed catalogue evidence.
- Customer and pharmacy authentication boundaries are separated.
- Turnstile, bounded telemetry, expiring local state, strict security headers,
  RLS contracts, and private notification outbox patterns are present.
- Mobile navigation, category discovery, product detail, basket feedback, and
  request-state restoration are coherent.
- Loading, empty, error, retry, success, expiry, and disconnected states are
  represented rather than simulated.

### Post-launch optimization queue

These are valuable improvements, but none is a reason to keep production
closed after the P0 governance blockers are resolved:

1. split the large marketplace client module by pharmacy portal, maps,
   checkout, and gallery features;
2. collect RUM Web Vitals and conversion/error funnels;
3. add a visible clear-saved-details action;
4. pause decorative hero rotation while the mobile menu is open;
5. add an explicit category-rail position indicator;
6. introduce image-quality monitoring for product/form/manufacturer mismatch;
7. publish a transparent catalogue freshness and medicine-expiry policy; and
8. establish incident, rollback, customer-support, pharmacy-support, and data
   correction service-level runbooks.

## Exact release path

1. Approve or provide an isolated MED+250 Supabase staging target; read-only
   access to the configured shared production project is already available but
   does not authorize mutation.
2. Deploy the migration and Edge Function to staging.
3. Execute negative tenant, revoked-authority, public-description, and
   mismatched-media probes; retain redacted deployment receipts.
4. Complete 51 duplicate and 72 product-content decisions.
5. Recover or formally replace the controlled source bundle.
6. Complete all 12 physical-device UAT scenarios.
7. Record named, role-qualified approvals for all 11 launch gates.
8. Rebase or merge without changing audited bytes, rerun every local gate, and deploy
   the exact revision.
9. Verify all live routes, headers, robots, sitemap, revision headers,
    authentication boundaries, request flows, rollback, and monitoring.
10. Refresh release-bound evidence and only then change the decision to
    **GO-LIVE**.

No approval, device result, source decision, or production deployment receipt
has been fabricated in this report.
