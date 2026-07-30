# MED+250 Full-Stack Go-Live Readiness and Optimization Report

Audit date: 23 July 2026

Repository: `https://github.com/ikanisa/MED250`

Reviewed base revision: `20a7f703ac07a8d3e12dd87f15599eccdd21903b`

Production target: `https://med250.gikundiro.com`

Public catalogue target: `https://med250-rwanda.ikanisa.chatgpt.site`

Decision: **NO-GO for production**

## Executive decision

MED+250 has a credible, polished marketplace foundation. Its responsive
catalogue, search, category navigation, product detail surfaces, loading
feedback, motion safeguards, metadata, canonical URLs, structured data,
sitemap, robots controls, and performance budgets are materially stronger than
a typical pre-launch marketplace.

It is not production-ready. The production hostname did not resolve during
this audit, the repository's release authority reports `productionReady:
false`, 11 launch gates remain unconfirmed, 51 duplicate-register decisions
remain pending, all 12 physical-device UAT scenarios remain pending, and the
governed corrected catalogue dataset is absent, and 72 product-content
decisions remain pending. These are hard release
blockers, not cosmetic recommendations.

This pass fixed the code-level issues that could be corrected safely in the
repository:

- upgraded Next.js and vulnerable transitive packages, reducing `npm audit`
  from seven high-severity advisories to zero vulnerabilities;
- bound offer-item reads to the owning customer or an active pharmacy member;
- changed pharmacy login authority from public-directory evidence to a
  named-review, one-number/one-pharmacy, transaction-locked binding;
- made public description projection permission-safe and fail-closed;
- removed the visibly mismatched `rwanda-fda-hm-1594` image gallery from the
  publication path;
- bounded medicine-basket persistence to 24 hours and moved phone, delivery
  preference, and exact location into 30-minute session storage;
- removed continuous category-rail auto-scrolling and added manual scroll
  snapping so discovery does not compete with reading or assistive input;
- added regression tests for the security, privacy, and media-governance fixes.

The fixes are local and validated, but they are not deployed. Production must
remain closed until the migration, Edge Function, data authority, DNS,
approvals, and physical UAT are complete for one immutable release revision.

## 23 July continuation: recovery and duplicate triage

A full local, Git-history, attached-volume, and recorded retention-bundle
search did not recover the original corrected Amazon dataset, its raw research
snapshot, or the governed workbook. The retention receipt proves that a
25-artifact bundle existed, but records `approved_durable_storage: false`; the
receipt is not a substitute for the missing content.

A provenance-safe public recovery was completed without overwriting the
missing source. It reconciles:

- all 2,200 unique consumer identities in the committed related-product index;
- all 2,198 currently published consumer rows in the public Supabase view;
- the two governed non-product exclusions; and
- all 128 Rwanda-observed indicative price records.

The recovery is explicitly classified as reconstructed public catalogue
evidence. It does not contain the missing private Amazon research fields, raw
observations, workbook, or original SHA-256, and therefore does not close the
source-retention gate.

Recovery evidence:

- `outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23/recovered-public-marketplace-catalogue.json`
- `outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23/recovery-manifest.json`
- recovered artifact SHA-256:
  `5cad7067c8d904454f66f7e8a2d7bc276d72ac645bc2acdb30fc8a52642a6395`

The 51 duplicate groups were technically triaged, but no human or regulatory
decision was fabricated. All six product-registration pairs contain material
product identity conflicts. Of 45 pharmacy groups, 32 use the same
order-insensitive technician-name tokens across premises; 13 contain a
different or variant name, including ten high-priority apparent person
conflicts. The named register reviewer must still decide every row.

Technical triage:

`desktop-output/fullstack-audit-2026-07-23/DUPLICATE_REGISTER_TECHNICAL_TRIAGE.md`

## 24 July continuation: operational validation closure

The recovery was extended to the complete 4,680-product pipeline population:
2,200 consumer identities plus the committed 2,480-row Rwanda FDA register.
Medicine display fields are reconciled against the committed SEO index and
active-state index. The result reproduces the existing 72-entry
product-content review population exactly at source-evidence level, while
continuing to report `originalSourceRecovered: false`.

This removes accidental file-not-found coupling from operational validation
without weakening source governance:

- the complete Node application suite passes 352/352;
- the Sites catalogue build and rendered suite pass 57/57;
- the Python suite completes 171 tests: 170 pass and one is intentionally
  skipped;
- non-strict import, duplicate-ledger, and content-population validation pass;
- strict duplicate review still fails on 51 pending decisions;
- strict product-content review still fails on 72 pending decisions; and
- source-retention verification still fails because the original controlled
  bundle manifest and original source contents are absent.

The localization inventory was regenerated after the marketplace hardening
changes. It now records 596 messages, 569 runtime-catalogued messages, zero
hard-coded messages, and zero high-risk hard-coded messages.

## Critical blocker register

| Priority | Blocker | Current evidence | Acceptance condition |
|---|---|---|---|
| P0 | Production hostname unavailable | `med250.gikundiro.com` returned DNS resolution failure; repository DNS verifier reports no matching records | DNS resolves through the approved Cloudflare account, all required routes respond, and fresh evidence is bound to the release revision |
| P0 | Formal launch authority incomplete | `productionReady: false`; 0/11 gates confirmed | All 11 gates carry current evidence, named owners, explicit approval, and the exact release revision |
| P0 | Physical-device UAT absent | 0/12 scenarios complete | Execute and approve the committed device/browser/accessibility matrix on physical devices |
| P0 | Corrected catalogue authority missing | Required `outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json` is absent | Restore or formally replace the governed input, preserve provenance, and pass all data and test gates |
| P0 | Duplicate decisions incomplete | 51/51 groups remain `pending` | Record governed retain/merge/block decisions for six product and 45 pharmacy groups |
| P0 | Product-content decisions incomplete | 72/72 entries remain `pending`: 40 duplicate-title groups, 24 missing generics and eight short-title candidates | Named regulatory/clinical data reviewer completes every source-bound decision with authoritative evidence |
| P0 | Hardening not deployed | New database migration and pharmacy OTP Edge Function exist only in the working tree | Apply to a non-production environment, execute negative authorization tests, approve, then promote the exact verified revision |
| P1 | Public Sites catalogue is behind the audited source | Active Sites version 13 is sourced from commit `5ef50a296941056bd17e614dff7b35290742f50a`, not the audited base revision or this hardening tree | Save and deploy only a pushed, immutable, fully verified revision after launch blockers close |

## Remediation implemented in this pass

### Dependency and runtime security

`next` and `eslint-config-next` were upgraded from 16.2.6 to 16.2.11.
Patched overrides were added for `sharp` 0.35.0, `fast-uri` 3.1.4, and the
affected `brace-expansion` branches. The lockfile was regenerated through
`npm install`.

Result: `npm audit --json` reports zero critical, high, moderate, low, or
informational vulnerabilities.

### Pharmacy portal authorization

The new database migration fails closed:

- directory-derived login contacts without a named `verified_by` reviewer are
  disabled;
- an enabled WhatsApp login number must belong to one pharmacy only;
- login authority is restricted to explicit admin or pharmacy-submission
  review;
- identity/membership creation occurs inside
  `dawanear_bind_pharmacy_identity`, protected by a phone-specific advisory
  transaction lock;
- cross-pharmacy manager binding and reactivation of suspended/revoked
  membership are rejected;
- revocation takes the same lock before suspending authority.

The OTP verification Edge Function now requires exactly one eligible pharmacy
and delegates the final authority check and membership binding to this
database transaction. A newly created Auth user is deleted if binding fails.

### Row-level authorization

The previous offer-item SELECT policy authorized any authenticated caller when
the parent offer merely existed. It now authorizes only:

- the authenticated customer who owns the parent order; or
- a non-anonymous authenticated user with an active membership in the
  offering pharmacy.

### Description governance

The public catalogue retains a stable column shape, but description fields are
projected as `NULL` and direct anon/authenticated grants on governed
description columns are revoked. This temporarily sacrifices public
descriptions to prevent permission leakage. A future dedicated approved-only
projection may re-enable them after database-level privilege tests.

### Product-media correctness

Visual inspection found `rwanda-fda-hm-1594`, a Paracetamol 125 mg suppository
record, displaying paediatric oral-suspension bottles. The migration removes
that product's gallery from public approval and clears linked image fields.
The normal governed image workflow must not republish until a
product-specific human review confirms form, strength, pack, and manufacturer.

### Sensitive browser retention

Browser storage now uses versioned expiring envelopes:

- the medicine basket persists in local storage for at most 24 hours;
- phone number, delivery preference, and precise coordinates use session
  storage for at most 30 minutes;
- legacy unbounded keys and malformed/expired envelopes are removed;
- an empty basket is no longer persisted.

## UX, interaction, motion, and 2026 marketplace review

### What is launch-quality

- Search is immediate, keyboard-usable, and preserves catalogue state in the
  URL.
- Product cards, category routes, product details, basket feedback, loading
  skeletons, error states, and pharmacy/customer surfaces form a coherent
  request-first commerce model.
- The information architecture keeps regulated products and availability
  confirmation distinct from ordinary instant checkout.
- Navigation feedback, status toasts, skeletons, modal focus behavior, touch
  targets, skip navigation, and `aria-live` status regions are implemented.
- Motion is purposeful and includes a reduced-motion path; route feedback and
  product-gallery controls are available without relying on animation alone.
- Desktop and 390 x 844 responsive catalogue flows were visually inspected.
  Search, menus, product navigation, and mobile category browsing work.

### Non-blocking improvements after release blockers

- Reduce the 454,098-byte raw marketplace client module through route-level
  feature extraction for the pharmacy portal, checkout wizard, maps, and
  galleries. The current 122,563-byte estimated marketplace transfer remains
  inside budget.
- Add an explicit scroll-progress indicator to the now manual, snap-aligned
  mobile category rail; the masked edge is useful but subtle.
- Pause decorative hero movement while the mobile menu is open.
- Add a visible “clear saved details” control beside customer details even
  though the new 30-minute session TTL already bounds retention.
- Run screen-reader and switch-control testing on physical devices; source
  semantics and automated checks do not replace assistive-technology evidence.

## SEO and discoverability

The implementation contains:

- canonical URLs and `en-RW` alternates;
- crawl directives for public catalogue mode and noindex safeguards for
  preview/worker contexts;
- product-specific titles and descriptions;
- Open Graph and Twitter metadata;
- Product and BreadcrumbList JSON-LD;
- product sitemap generation and robots controls;
- WebSite organization/publisher semantics and PWA metadata.

The 1200 x 630 social preview is visually launch-appropriate: its wordmark is
clear, the proposition is readable, and the still life matches the current
brand system. Regeneration is not recommended.

SEO cannot be called production-ready until the production hostname resolves,
the canonical origin is verified, sitemap and robots are fetched from that
origin, and search-engine indexing is monitored. Code-level SEO quality cannot
compensate for an unreachable production domain.

## Performance and loading

| Metric | Result |
|---|---:|
| JavaScript raw | 809,612 B |
| Estimated JavaScript transfer | 236,380 B |
| Marketplace JavaScript raw | 453,417 B |
| Estimated marketplace transfer | 122,337 B |
| CSS raw | 204,438 B |
| Estimated CSS transfer | 34,137 B |
| Initial visual assets | 73,183 B |
| Optimized marketplace images detected | 10 |

The performance budget passes. Images use optimized delivery/lazy behavior
where appropriate, fonts are self-hosted in build output, loading states are
meaningful, and layout remains stable in the inspected flows. Real Core Web
Vitals, network throttling, and physical low-/mid-tier Android evidence remain
required before launch approval.

## Accessibility

The inspected implementation includes strong foundations: semantic landmarks,
skip navigation, accessible control names, status announcements, modal
semantics, focus-visible styling, reduced-motion support, keyboard-operable
search/menu controls, and responsive touch targets. The accessibility and
rendered HTML regression assertions pass except for the two governed
product-image fixtures described above.

Accessibility remains conditional because no physical assistive-technology
evidence was supplied. Complete VoiceOver/TalkBack, keyboard-only, 200% zoom,
text spacing, high contrast, focus order, error-recovery, and motion-preference
scenarios before approval.

## Validation results

| Check | Result | Evidence |
|---|---|---|
| `git diff --check` | Pass | No whitespace errors |
| `npm run lint` | Pass | ESLint clean |
| Focused hardening, backend-contract, and recovery tests | Pass | 31/31 |
| Complete Node application suite | Pass | 352/352 |
| `npm run build:sites` | Pass | All application routes built |
| `npm run cloudflare:check:production` | Pass | Production build, 3/3 checks, and strict Wrangler dry-run |
| `npm run performance:budget` | Pass | Metrics above |
| `npm audit --json` | Pass | 0 vulnerabilities |
| `npm run security:audit:python` | Pass | 10 packages checked; 0 vulnerable |
| `npm run catalogue:recover:public` | Pass, limited recovery | 4,680 unique pipeline identities; 2,198 public consumer rows, two governed exclusions, 2,480 FDA rows and 128 Rwanda-observed prices; original source remains missing |
| Public recovery regression tests | Pass | 3/3 provenance and fail-closed assertions |
| Serial Sites catalogue suite | Pass | 57/57; unbound local image behavior and connected-image filtering are tested separately |
| `npm run python:test` | Pass | 171 tests: 170 passed, one intentionally skipped |
| `npm run data:validate` | Pass, non-strict | Source imports, 51-row duplicate ledger, and exact 72-entry content-review population reconcile using the declared recovery |
| Strict duplicate review | Fail | 51 decisions pending |
| Strict product-content review | Fail | 72 decisions pending |
| Source-retention verification | Fail | Original controlled bundle manifest is absent |
| Go-live readiness | Fail | 11 gates pending; 12 physical UAT scenarios pending |
| Production DNS | Fail | `med250.gikundiro.com` did not resolve |

A parallel Sites build initially produced an `ENOTEMPTY` output-directory
collision because two builds wrote `dist` simultaneously. The serial rerun
built successfully. The stale product/image fixtures were subsequently
replaced with mode-aware fail-closed assertions, and the serial Sites suite now
passes 57/57.

## Visual audit evidence

- `evidence/01-sites-home-desktop.png` — desktop public catalogue home
- `evidence/02-sites-search-desktop.png` — desktop Paracetamol search results
- `evidence/03-sites-product-desktop.png` — product/media mismatch that caused
  the image-publication hold
- `evidence/04-sites-home-mobile.png` — 390 x 844 responsive home
- `evidence/05-sites-mobile-menu.png` — expanded mobile navigation

The public Sites catalogue is proof of the existing design and interaction
quality. It is not proof that the uncommitted hardening is deployed, and it
does not replace production or physical-device certification. Sites reports
the public project as active on version 13, sourced from commit
`5ef50a296941056bd17e614dff7b35290742f50a`; no new version or deployment was
created during this audit.

## Required path to production

1. Restore the governed corrected catalogue dataset or approve a documented
   authoritative replacement; close all 51 duplicate decisions and all 72
   product-content decisions.
2. Apply the hardening migration and updated OTP Edge Function in a
   non-production environment. Run cross-user offer-item, duplicate-number,
   revoked-contact, cross-tenant, and rollback tests.
3. Rebuild product-image evidence, keep `rwanda-fda-hm-1594` unpublished until
   human review, and obtain 57/57 rendered catalogue tests.
4. Configure the production DNS record through the approved Cloudflare
   account and refresh release-bound DNS evidence.
5. Execute all 12 physical-device UAT scenarios, including GPS, WhatsApp OTP,
   customer request, pharmacy response, prescription retention/deletion,
   accessibility, performance, offline/failure recovery, and logout/session
   isolation.
6. Record explicit human approval for every launch gate. No filing,
   notification, production deployment, or regulatory submission should occur
   without that approval.
7. Build and deploy one immutable revision, then verify its revision header,
   security headers, canonical URLs, sitemap, robots, monitoring, rollback,
   and all required routes from the production origin.

## Release acceptance criteria

Production can be reconsidered only when:

- production DNS and required routes resolve;
- the local and deployed security fixes pass negative authorization tests;
- `productionReady` is true and 11/11 launch gates are confirmed;
- 51/51 duplicate decisions, 72/72 product-content decisions, and 12/12
  physical UAT scenarios are complete;
- application, Python, data, production, dependency, and deployment checks
  pass without missing-artifact exceptions;
- the exact approved commit is deployed and reported on every required route;
- monitoring, rollback, privacy/retention, secrets, and operational ownership
  evidence is current.

## Audit limits

No production database mutation, migration, account creation, WhatsApp
delivery, prescription upload, or deployment was performed. The production
domain was unavailable, so the browser audit used the public Sites catalogue.
No approved pharmacy test account or physical device/assistive-technology
matrix was supplied. The database hardening is source- and regression-tested
locally but must still be applied and verified against the real Supabase
project.
