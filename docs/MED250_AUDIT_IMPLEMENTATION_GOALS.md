# MED+250 audit implementation goals

Date: 2026-07-18; extended 2026-08-04

Sources: `MED250_Digital_Marketplace_Audit` and the [MED+250 vs Amazon product/full-stack audit](audits/med250-amazon-2026-08-04/REPORT.md)

Current audit target: `https://med-250.com/`

Program owner: IKANISA Ltd. / MED+250

## Program outcome

Move MED+250 from the audit baseline of **38/100 and not ready for scaled acquisition** to a trustworthy, searchable, localized Rwanda pharmacy marketplace whose public claims are supported by live data and whose protected availability-request flow is approved for operation.

Success is not “the code exists.” Success requires all of the following:

1. the live storefront satisfies every P0 and P1 audit acceptance criterion;
2. each P2/P3 item is completed or explicitly deferred by the named owner with a reason and review date;
3. the production evidence registry and physical-device UAT pass;
4. catalogue, privacy, security, accessibility, performance, SEO, and operational evidence is current for the deployed release; and
5. no metric, price, availability claim, image, pharmacy badge, review, or regulatory statement is fabricated.

## Evidence baseline

The audit and the current repository describe different states. The audit observed three empty departments, a 24-product ceiling, no sampled price, zero Google visibility, and cart-oriented language on the live site. The current repository contains a paginated catalogue implementation, 4,680 traceable source rows, 4,657 publishable products after two governed non-product exclusions, 2,198 publishable consumer products across 25 taxonomy pairs, 128 central indicative prices, a sitemap, multilingual search aliases, and extensive release controls. Targeted catalogue, rendering, deployment, and marketplace tests currently pass.

Repository evidence is therefore treated as implementation evidence, not proof that the public deployment has the same behavior. Every goal below requires deployment-specific verification.

## Source coverage contract

The machine-readable register is bound to the exact Google Doc revision recorded in `data/audit-implementation-register.json`. It covers 73 distinct source units: 17 prioritized findings, 9 scorecard categories, 5 preservation directives, 11 benchmark capabilities, 15 roadmap actions, 4 checks the remote audit marked for separate verification, and 12 audited surfaces or external checks.

Duplicate recommendations remain mapped to one accountable implementation item instead of being counted as extra work. The Phase 3 journey-education recommendation is intentionally mapped to the product owner's `P2-2` decline; its rejected UI, route, copy, styles, and assets must remain absent. The five positive findings are regression invariants, not closure claims: each names an owner, two acceptance conditions, and repository evidence that must continue to pass while other remediation proceeds.

`npm run audit:goals:verify` fails if any canonical source row disappears, loses its Goal 0–11 mapping, points at an unknown audit item, loses required preservation evidence, or drifts from the exact source revision.

## Current implementation status

This status is deliberately evidence-scoped. `Implemented locally` means the behavior exists in the current worktree and has automated coverage; it does not close live, legal, operational, or physical-device acceptance.

| Goal | Current evidence | Remaining closure |
| --- | --- | --- |
| 0 — Live baseline | The [2026-07-18 live baseline](audit/live-baseline-2026-07-18.md) retains a passing 10-route production receipt exactly bound to Git revision `5ef50a296941056bd17e614dff7b35290742f50a` and a passing source-bound 4,657-product catalogue receipt. The shared browser ledger passes all 16 production scenarios with 56 immutable desktop/mobile captures and complete session and receipt bindings. | Obtain independent QA approval for the completed browser run, then reconcile the other launch gates. |
| 1 — Departments and full browsing | Zero-count departments are hidden from source-backed taxonomy; live RPC loading is deterministic, extends beyond the first 24, includes an accessible manual `Load more products` control, and exposes an explicit retry. The [source-bound live catalogue report](audit/live-catalogue-readiness-2026-07-18.md) passes all 39 pages at exactly 4,657 governed IDs, product 25, product 120, the final row, zero duplicates, all four advertised departments, and all six search cases. All department, boundary, failure-recovery, search, navigation, request-journey, related-product, and representative product-content browser scenarios pass on desktop and mobile. | Obtain independent QA approval for the receipt-bound browser session. |
| 2 — SEO | SSR metadata, canonical product routes, environment-aware robots policy, Product/Breadcrumb schema, and a source-dated sitemap for all 4,657 publishable products now exist. The [2026-07-18 technical SEO report](audit/seo-readiness-2026-07-18.md) records the corrected 2,459-medicine/2,198-consumer population and strengthened deployment checks. | Search Console ownership/submission, URL Inspection, indexed-route monitoring, and live canonical/crawl reconciliation remain owner actions. |
| 3 — Indicative pricing | The reproducible [2026-07-18 price-coverage report](audit/price-coverage-2026-07-18.md) proves 128 central consumer-product prices, 0 medicine prices, complete technical metadata, and no Amazon-derived public values; public UI fails closed when a price is absent. | Approve or replace the priority set with medicine representation, approve price-source rights and freshness/expiry policy, name the reviewer, and capture deployed samples. |
| 4 — Request model | Customer actions now use `Add to request`, `Request basket`, `Send availability request`, and `My requests`, with no-payment microcopy and regression coverage. | Complete desktop/mobile live journey evidence and owner copy approval. |
| 5 — Trust and response expectations | The [2026-07-18 trust-metrics report](audit/trust-metrics-readiness-2026-07-18.md) documents a privacy-safe aggregate RPC, exact governed-readiness count, 90-day p50 response methodology, sample/day/freshness suppression, optional storefront rendering, and zero/small/stale/nearby/national regression coverage. The production RPC is aggregate-only and currently suppresses both values, so no unsupported claim appears. | Accumulate genuine production volume, satisfy automated sample/freshness thresholds, and capture the live state. Feedback and any reliability score remain deferred behind evidence requirements. |
| 6 — Privacy/public accountability | Terms, Privacy, retention controls, and public contact channels exist. | Verify that published entity/contact details and the implemented privacy lifecycle are accurate; this is a disclosure and implementation check, not a separate regulatory-approval launch gate. |
| 7 — Localization | A SHA-bound inventory covers 625 messages across 12 customer, legal, pharmacy-portal, system, location, and PWA source files, including icon-bearing text segments and conditional accessibility labels. The governed source/runtime catalogs contain 625/623 messages, 543 source messages are referenced at runtime, and zero budgets prevent hardcoded copy from returning on any surface. Reserved locale URL aliases, language alternates, and Rwanda-aware formatting are implemented. Publication fails closed: Kinyarwanda and French have no runtime catalog or public route until the required evidence passes. | Commission qualified Kinyarwanda translation, record glossary and clinical/legal approvals, enable localized rendering and the language switcher, and run desktop/mobile journey QA. |
| 8 — Product comprehension | Category-aware visual/JSON-LD breadcrumbs, URL-preserved catalogue state/focus, bounded customer titles, and exact official-name disclosure are implemented locally. A source-digest-bound 72-entry owner packet covers all 40 duplicate-title groups, 24 missing medicine generics, and 8 short-title candidates with strict fail-closed validation and no inferred clinical decisions. An atomic, locked, one-entry owner workflow validates the complete packet before every decision. Public descriptions now fail closed behind exact source digests, verified reuse rights, clinical applicability, substantive rationale, named review, and withdrawal guards. The live database reconciles contract `2026-07-18.3`, all 13 governance columns, both mandatory audit triggers, service-only review privileges, zero public leaks, and zero approved rows lacking current audit evidence. The protected reviewer is deployed and active; its unauthenticated production probe fails closed with the expected no-store and contract headers. The related rail uses conservative medicine/consumer boundaries. An exact-revision production verifier reconciles all 4,657 recommendable products and 17,690 generated edges with zero unsafe, duplicate, missing, or unexpected edges. The complete browser run covers related products and representative product content on desktop and mobile. | Use the protected administrator credential and a controlled product identity to capture the body-free positive-path reviewer receipt; complete and approve the 72 packet decisions; import authoritative corrections; approve source-bound descriptions; reconcile live imagery; and obtain independent QA and product/data-owner approval. |
| 9 — Visual/PWA | Rights-verified image publication remains fail-closed. A repeat-visit install prompt, iOS guidance, service-worker update flow, API-safe static caching, and explicit offline state are implemented locally. | Authentic locally approved creative, provenance completion, breakpoint/design QA, Lighthouse budgets, and supported Android/iOS physical-device evidence remain open. |
| 10 — Release gates | The 15-gate registry and strict live verification workflow exist. | All named owners must supply and approve the still-pending external, production, and physical-device evidence. |
| 11 — Strategic depth | Related browsing is constrained to non-advice catalogue similarity; payment remains outside MED+250. | Owner decisions for MoMo options, reliability scoring, and experiments remain deferred until entry criteria pass. |

## 2026-08-04 Amazon-comparison implementation extension

The newer audit changes the priority from “make the catalogue exist” to “make the marketplace model obvious and dependable.” Amazon is the benchmark for decision completeness and state visibility, not the visual target. MED+250 must preserve its calm healthcare presentation, pharmacy-native filters, Rwanda FDA-backed product fields, non-payment boundary, and lighter frontend.

### Explicit product constraints

- Do not copy Amazon's visual density, advertising system, urgency mechanics, or generic seller-marketplace language.
- Do not reintroduce the declined standalone journey-education page or section. Explain the request model at the point of action: product CTA, request basket, submitted state, and request-status panel.
- Do not publish stock, pharmacy count, response time, price, rating, or delivery promises unless the displayed value comes from the governed production source and passes suppression/freshness rules.
- Do not publish unverified pack photography. Where an approved representative image is unavailable, use an honest category-icon treatment instead of repeating one unrelated stock image.
- Product and Breadcrumb JSON-LD already exist. Treat structured SEO as a verification and monitoring task, not a missing implementation.
- Pharmacy-operations approval, marketplace regulatory approval, public source-data reuse approval, and credential-rotation approval are not launch gates for this program and must not be reintroduced into readiness reporting.

### Extension requirement register

| ID | Priority | Outcome and implementation | Acceptance evidence | Current state |
| --- | --- | --- | --- | --- |
| AX-P0-1 | P0 | Search or filter intent collapses homepage/category storytelling and places query, count, filters, and results directly below global navigation. | Unit coverage for every intent control; desktop/mobile browser evidence for query, category, filter, sort, and reset; no layout trap or focus loss. | Implemented locally; full live desktop/mobile evidence pending. |
| AX-P0-2 | P0 | Explain “availability request” at the product action and inside the request basket: one request goes to up to 10 eligible nearby pharmacies; verified WhatsApp contacts may receive an alert; pharmacies confirm availability, final price, and fulfilment; MED+250 takes no payment. | Copy-contract, localization, accessibility, and browser-journey tests; no purchase/checkout claim. | Implemented locally; live copy/accessibility evidence pending. |
| AX-P0-3 | P0 | Make dispatch and response work visible through a status timeline showing request ID, eligible-recipient count, WhatsApp-alert qualification, responses received, expiry/no-recipient state, and the next customer action. | Controlled database, Realtime, and UI receipt tied by one correlation ID; polling fallback test; desktop/mobile status evidence. | Local status and recovery UI implemented; controlled production receipt pending. |
| AX-P0-4 | P0 | Prove the live path with a privacy-safe synthetic request: nearest-ten recipient selection, Realtime delivery, WhatsApp outbox/send/webhook status, pharmacy response, customer offer display, selection, and cleanup. | Dated production-safe receipt with no customer data or secrets; all physical UAT scenarios pass. | Pending execution. |
| AX-P1-1 | P1 | Eliminate repeated placeholder imagery in category cards and improve approved packshot coverage without weakening provenance controls. | Zero repeated fallback stock image across unrelated subcategories; image-provenance verifier and responsive visual QA pass. | Repeated fallback eliminated locally; approved packshot coverage remains open. |
| AX-P1-2 | P1 | Add honest decision support to cards/detail pages: prescription state, indicative-price behavior, eligible coverage or its absence, approved expected-response metric, and delivery/pickup capability. | Every value has source/freshness/suppression evidence; zero fabricated stock or promise; result/detail consistency tests. | Product details now explain dispatch scope, indicative-versus-final price, fulfilment confirmation, WhatsApp privacy, and only render approved aggregate readiness/response evidence. Card-level consistency and live visual evidence remain open. |
| AX-P1-3 | P1 | Instrument Realtime connection, event latency, polling activation, duplicate suppression, offer refresh, and customer-visible recovery. | Aggregate telemetry and alerts cover disconnect, timeout, fallback, delayed offer, and duplicate-event scenarios. | Connection/fallback, bounded event-latency, offer-arrival telemetry, and customer-visible recovery are implemented; production alert thresholds and release-bound samples remain open. |
| AX-P1-4 | P1 | Instrument WhatsApp from outbox claim through Meta message ID and webhook state; move sequential delivery to provider-safe bounded concurrency or a queue consumer. | Load/retry/idempotency tests; alerting for queue depth, retry exhaustion, zero delivery, and webhook delay. | Bounded delivery, WebP-safe media fallback, and aggregate completed/degraded dispatcher summaries are implemented; fresh Meta delivery/webhook receipt and production alert routing remain open. |
| AX-P1-5 | P1 | Reduce session and XSS risk by replacing manually managed pharmacy refresh-token persistence, tightening CSP, and proving no privileged key reaches the client. | Auth journey and session-revocation tests; CSP report; secret scan; Supabase advisors pass. | Manual refresh-token handling removed; pharmacy auth now uses Supabase-managed, tab-scoped session storage and local sign-out. CSP nonce/hash migration, live revocation evidence, secret scan, and advisor closure remain open. |
| AX-P1-6 | P1 | Remove mutable Worker global environment state, generate binding types, and enable sampled tracing for catalogue and marketplace operations. | Generated `Env` compiles; concurrency test; Wrangler validation; trace and structured-log samples tied to request IDs. | Request-scoped `AsyncLocalStorage`, generated production binding types, and 5% tracing implemented; production trace sample and deployed-revision evidence remain open. |
| AX-P1-7 | P1 | Optimize CSS/marketplace JavaScript and establish real performance telemetry without sacrificing the calmer design. | Performance budget, route-level bundle report, desktop/mobile lab trace, and production LCP/INP/CLS/TTFB dashboard. | Budget passes; field telemetry pending. |
| AX-P1-8 | P1 | Verify existing Product/Breadcrumb schema, canonical/locale metadata, sitemap, and crawl controls on representative live medicine and consumer-product URLs. | Rich-results/schema validation, Search Console submission/inspection, and exact-release deployment receipt. | Product/Breadcrumb plus linked MedicalWebPage/WebPage and WebSite schema are implemented; external rich-results and Search Console verification remain pending. |
| AX-P2-1 | P2 | Complete qualified Kinyarwanda and French storefront journeys when approved catalogs exist. | Full browse → request → status → WhatsApp QA on desktop/mobile with glossary and review evidence. | Framework exists; translations pending. |
| AX-P2-2 | P2 | Add privacy-safe fulfilment quality signals—response rate, median response time, and completion reliability—only after sample thresholds are met. | Methodology, suppression, anti-gaming, correction path, and aggregate-only API tests. | Deferred until production volume. |
| AX-P2-3 | P2 | Support intermittent connectivity with low-bandwidth media behavior, resumable request/status state, and explicit offline truth boundaries. | Throttled/offline browser tests; no fabricated request success or availability; recovery preserves safe state. | Partial PWA foundation. |
| AX-P2-4 | P2 | Instrument the complete funnel: search, product detail, request add, submission, recipient dispatch, first response, selection, WhatsApp continuation, and completion. | Privacy-reviewed event dictionary, funnel dashboard, event-loss tests, and release-bound sample. | Privacy-safe product-view, request-add, submit, first-response, selection, and handoff events are implemented; recipient-dispatch/completion correlation, dashboarding, and release-bound samples remain open. |

### Extension execution order

1. **Intent and comprehension:** AX-P0-1, AX-P0-2, AX-P0-3, AX-P1-1.
2. **Production correctness:** AX-P0-4, AX-P1-3, AX-P1-4.
3. **Decision confidence:** AX-P1-2, AX-P2-2.
4. **Security and runtime:** AX-P1-5, AX-P1-6.
5. **Performance, acquisition, and reach:** AX-P1-7, AX-P1-8, AX-P2-1, AX-P2-3, AX-P2-4.

No extension item becomes complete merely because code exists. Completion requires the acceptance evidence in the same row against the current deployed revision.

## Delivery principles

- Preserve complete server-rendered pages, canonical metadata, Rwanda FDA registration details, staged contact disclosure, the non-diagnostic disclaimer, and the pharmacy-portal query exclusion in `robots.txt`.
- Describe the customer action consistently as an **availability request**, not a completed purchase.
- Keep central indicative prices separate from private, non-final pharmacy confirmations.
- Never expose pharmacy-specific stock or a pharmacy contact before the customer selects a complete confirmation.
- Use source-backed catalogue data, rights-verified imagery, and evidence-backed operational metrics only.
- Keep the default development and preview environment non-ordering and non-indexed. Production activation remains gated.

## Ownership model

| Role | Accountability |
| --- | --- |
| Product owner | Scope, sequencing, KPI decisions, and acceptance of customer experience |
| Frontend lead | Storefront, localization, accessibility, PWA, and browser QA |
| Backend/data lead | Catalogue, search, pagination, pricing, recommendations, telemetry, and contracts |
| Design/creative lead | Design system, Rwandan visual direction, governed assets, and fidelity QA |
| SEO/growth owner | Search Console, sitemap monitoring, indexing, structured data, and acquisition reporting |
| Legal/privacy owner | Controller identity, privacy contact, retention, transfers, DPIA, and approvals |
| Pharmacy operations lead | Pharmacy readiness, response SLAs, contact/GPS review, and incident procedures |
| Security/infrastructure owner | Credentials, Turnstile, rate limits, Cloudflare, DNS, deployment, and monitoring |
| QA owner | Automated, browser, accessibility, physical-device, and release evidence |

## Goal 0 — Establish one trustworthy live baseline

**Priority:** P0 prerequisite  
**Owner:** QA owner with product, infrastructure, and data leads  
**Target:** before remediation claims or acquisition spend

Create a reproducible live audit run that distinguishes source code, preview, catalogue-only public mode, and protected live ordering.

### Deliverables

- Record the deployed commit/version, release mode, public origin, backend contract version, catalogue totals, priced-product count, and operational readiness counts.
- Capture desktop and mobile evidence for home, each department, a late-alphabet search, a product with price, a product without price, request basket, request status, privacy, terms, sitemap, and `robots.txt`.
- Add a deployment smoke check that proves a user can reach product 25 and beyond without duplicates or a silent ceiling.
- Reconcile any difference between local tests and the deployed public site before closing another goal.

### Acceptance evidence

- `npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision <immutable-release>` passes against the intended release and writes a dated receipt through `--evidence-output`.
- The shared browser ledger passes `npm run audit:browser-evidence:verify:live` with all 16 desktop/mobile scenarios and 56 captures bound to that same release.
- A dated evidence record identifies the deployed revision and all sampled routes.
- Live catalogue totals agree with the approved source within an explicitly documented tolerance.
- Browser and API evidence both prove pagination beyond the initial 24 records.

## Goal 1 — Make every advertised department complete and browsable

**Audit coverage:** P0-1, P0-2, P1-5  
**Owner:** Backend/data lead and frontend lead  
**Target:** 0–2 weeks

Eliminate dead departments and the apparent 24-item cap while preserving stable, accessible, server-ranked browsing.

### Deliverables

- Publish only departments with active source-backed products; automatically hide a department if its live count is zero.
- Keep at least one meaningful, approved assortment in Medicines, Beauty & Personal Care, Baby, and Health & Household before advertising them.
- Use stable server-side pagination or cursor loading with total counts, no duplicate rows, deterministic ordering, retry recovery, and an accessible manual fallback when automatic infinite scroll is unavailable.
- Test late-alphabet and high-demand terms independently of department browsing.
- Keep empty-state copy useful: explain the state, offer reset/recovery, and never leave a loading placeholder as a terminal result.

### Acceptance evidence

- Each advertised department route returns a non-zero live count and at least one requestable product.
- Product 25, product 120, and the last available page are reachable in a controlled browser test.
- Pagination tests prove stable totals, no gaps, no duplicates, and filter/sort preservation.
- Live searches for `paracetamol`, `zinc`, `omeprazole`, a typo, one French alias, and one Kinyarwanda alias return relevant results.
- Search and browsing use the live catalogue RPC rather than silently falling back to an incomplete client snapshot.
- [`docs/audit/browser-evidence-closure-2026-07-18.md`](audit/browser-evidence-closure-2026-07-18.md) defines the fail-closed capture and approval contract; its committed ledger stays pending after the completed controlled production run until independent QA approval is recorded.

## Goal 2 — Restore organic discovery and measurable SEO

**Audit coverage:** P0-3, P1-5, benchmark search reach  
**Owner:** SEO/growth owner with frontend and infrastructure leads  
**Target:** 30 days for technical closure; 90 days for indexing trend

Turn the existing server-rendered foundation into an indexed, monitorable acquisition channel.

### Deliverables

- Serve the live custom domain with indexable page metadata and response headers only after production approval; keep preview and `workers.dev` blocked.
- Publish a canonical XML sitemap containing department and requestable product URLs, with accurate `lastmod` values when source evidence exists.
- Verify Google Search Console ownership, submit the sitemap, inspect priority URLs, and request indexing for the homepage, departments, and representative products.
- Validate canonical URLs, structured Product and Breadcrumb data, Open Graph/X cards, status codes, redirects, and crawl rules.
- Monitor indexed URLs, crawl errors, excluded reasons, impressions, clicks, and top zero-result searches.

### Acceptance evidence

- Production `robots.txt`, sitemap, canonical tags, and `X-Robots-Tag` agree on indexability.
- Search Console accepts the sitemap and reports no systemic crawl or canonical error.
- Priority URLs pass URL Inspection and begin accumulating impressions; a zero-result `site:` check alone is not used as the only acceptance test.
- The sitemap contains the expected approved product population and no private, modal, preview, or noncanonical URLs.

## Goal 3 — Make indicative pricing honest and useful

**Audit coverage:** P0-4, benchmark upfront pricing  
**Owner:** Data lead with product and legal owners  
**Target:** 30 days

Provide useful central “From RWF” prices without implying real-time pharmacy stock or a guaranteed final price.

### Deliverables

- Prioritize at least 100 high-demand products across medicines and consumer health, using approved Rwanda price sources only.
- Store price provenance, observation date, currency, source, reviewer, and freshness state.
- Display `From RWF` only when a valid central indicative price exists; leave the price surface blank when it does not.
- Expose the price filter/sort only when live coverage meets the product-owner threshold and the result count is truthful.
- Add a refresh, expiry, withdrawal, and correction process; prohibit Amazon prices and currency conversion.

### Acceptance evidence

- At least 100 prioritized live products have current, reviewed, source-backed indicative prices.
- Automated tests prove no pharmacy-specific catalogue prices, Amazon-derived prices, or fabricated fallback values reach public surfaces.
- Product cards, detail pages, filters, sitemap/structured data, and empty-price states agree.
- A dated price-coverage report shows coverage by department, priority product set, source, and freshness.

## Goal 4 — Align every interaction with the availability-request model

**Audit coverage:** P0-5, benchmark order status/live support  
**Owner:** Product owner and frontend lead  
**Target:** 0–2 weeks

Remove the cart/checkout expectation and keep the privacy-conscious handoff clear at the point of action.

### Deliverables

- Replace visible and accessible `Add to cart`, `Cart`, and checkout-oriented language with one approved vocabulary: `Add to request`, `Request basket`, `Send availability request`, and `My requests`.
- Add the microcopy: pharmacies confirm availability and final price first; no payment is taken by MED+250.
- Surface the staged privacy promise: approximate location and request details first; exact contact and prescription only after pharmacy selection.
- Preserve explicit waiting, no-response, expired, cancelled, selected, and completed request states.

### Acceptance evidence

- A repository-wide copy contract rejects prohibited cart/checkout terms on customer-facing surfaces, except in migration notes or tests that intentionally assert absence.
- Desktop and mobile browser tests complete the request journey without encountering a purchase, checkout, payment, or order-confirmation claim before pharmacy selection.
- Terms, Privacy, footer, product detail, request basket, status panel, and WhatsApp handoff use the same model.

## Goal 5 — Add trust and response expectations without inventing proof

**Audit coverage:** P1-1, P2-4, benchmark trust/availability, Phase 4 reliability score  
**Owner:** Product owner, backend lead, and pharmacy operations lead  
**Target:** 60–90 days for basic signals; reliability score only after evidence threshold

Give customers useful confidence signals while avoiding unsupported badges, ratings, stock, or response promises.

### Deliverables

- Show the count of operationally ready participating pharmacies only when it comes from the governed readiness set.
- Compute typical response time from completed production requests using a documented percentile and rolling window; suppress it when the sample is insufficient or stale.
- Show product/request availability expectations only from eligible-pharmacy matching, never from invented stock.
- Add post-interaction feedback with abuse controls, consent, moderation, dispute handling, and privacy review.
- Introduce a pharmacy reliability score only after the minimum data volume, methodology, appeals process, and legal/operations approval are defined.

### Acceptance evidence

- Every displayed trust metric has source, sample size, time window, freshness, and suppression rules.
- No public directory, pharmacy badge, stock count, rating, or ranking leaks before the allowed stage.
- Tests cover zero-data, stale-data, small-sample, national-responder, and nearby-responder cases.
- Production telemetry proves that public wording matches actual service levels.

## Goal 6 — Keep privacy and public accountability accurate

**Audit coverage:** P1-3 and benchmark public disclosure

**Owner:** Product/privacy owner

**Target:** maintained continuously

Publish accurate accountable-entity, contact, and data-handling information that matches the implemented service.

### Deliverables

- Publish the operating entity name, service address/contact details, and working privacy contact.
- Publish purposes, recipients, retention behavior, rights/contact process, transfer handling, security-contact route, and prescription lifecycle in plain language.
- Keep legal copy synchronized with the implemented data flow, WhatsApp, MoMo, Cloudflare, Supabase, Google Maps, and prescription handling.

### Acceptance evidence

- Privacy and Terms contain non-placeholder identity and working contact details.
- Automated data-flow and retention tests match the public explanation.
- A product-to-disclosure trace confirms that every public privacy and fulfilment statement matches implemented behavior.

## Goal 7 — Localize the high-trust journey

**Audit coverage:** P1-4, benchmark multilingual storefront  
**Owner:** Product owner, localization owner, and frontend lead  
**Target:** 30–60 days

Ship a complete Kinyarwanda interface for the customer journey, then add French where research and support capacity justify it.

### Deliverables

- Introduce locale routing and a translation system for navigation, search, filters, product metadata labels, request actions, validation, empty/error states, privacy explanation, medical disclaimer, and request statuses.
- Use qualified translators and pharmacy/legal review for clinical, regulatory, privacy, and fulfilment terms.
- Preserve source product names and regulatory data while translating surrounding explanations and controlled vocabulary.
- Set document language, alternate locales, metadata, number/currency/date formatting, and accessible language-switcher behavior.

### Implemented foundation

- [`data/localization/locale-releases.json`](../data/localization/locale-releases.json) is the release authority for `en-RW`, `rw-RW`, and `fr-RW`. It records URL segments, public/runtime state, catalog availability, glossary evidence, and the required translation, clinical, and legal review fields.
- [`data/localization/messages.en-RW.json`](../data/localization/messages.en-RW.json) contains the complete current 592-message governed English source set extracted from the 12 scoped customer, legal, pharmacy-portal, system, location, and PWA files. The extractor includes leaf copy, text around nested icons and emphasis, conditional variants, dynamic attributes, and user feedback. [`data/localization/source-copy-inventory.json`](../data/localization/source-copy-inventory.json) binds that coverage to source-file SHA-256 hashes, message risk, surface, line, context, and runtime state.
- [`data/localization/runtime-messages.en-RW.json`](../data/localization/runtime-messages.en-RW.json) is the 590-message client-safe catalog. Shared navigation, error, disclaimer, checkout-step, product-status, product-description attribution, formatting, Privacy, marketplace terms, request/status, pharmacy-portal, browse, location, legal, accessibility, and system strings consume it without changing approved English copy. The inventory proves 574 source messages are referenced at runtime, including all detected Privacy and Terms occurrences. Stable API, CAPTCHA-action, category-filter, and other control identifiers remain untranslated implementation values.
- Locale-prefixed aliases are reserved for supported routes. The English alias redirects to the unprefixed canonical route while preserving query state; draft Kinyarwanda and French aliases return not-found and are excluded from language alternates and the sitemap.
- `npm run localization:inventory` regenerates the source-copy evidence, and `npm run localization:verify` rejects stale inventory, uncatalogued messages, source/runtime catalog drift, any hardcoded inventoried message on any surface, duplicate/invalid locales, missing journey messages, unsafe publication, and missing high-risk review evidence. The original baseline was 450 detected hardcoded messages and 203 high-risk messages; broader nested-text and dynamic-attribute coverage now proves zero hardcoded occurrences across the complete 592-message inventory.

### Acceptance evidence

- The full browse → product → request → status → WhatsApp journey passes in Kinyarwanda on desktop and mobile.
- No untranslated critical string, clipped text, broken URL state, or mixed-language validation remains.
- Reviewer identity, glossary version, and approval are recorded for high-trust strings.
- Search continues to support English, French, and Kinyarwanda intent aliases independent of interface locale.

## Goal 8 — Improve product comprehension and discovery depth

**Audit coverage:** P1-2, P2-1, P2-3, P2-5, Phase 4 cross-sell  
**Owner:** Product, data, and frontend leads  
**Target:** 60–90 days

Make every product page easy to scan, easy to return from, and useful for the next relevant action.

### Deliverables

- Create a customer-facing, sentence-cased, brand-first display title while preserving the complete official regulatory string as a separate field on medicine details.
- Add QA rules for blank generic/description fields, malformed titles, duplicated taxonomy, and unusable images.
- Maintain a deterministic, source-digest-bound owner packet for every duplicate-title, missing-generic, and malformed-title exception; require named review, authoritative evidence, timezone-qualified approval, and a substantive rationale without pre-filling clinical or merge decisions.
- Publish a dedicated description only when its exact source digest, reuse-rights reference, clinical applicability, substantive rationale, and named review are complete; withdraw it immediately when approval is removed.
- Include department/category context in visual and structured breadcrumbs.
- Persist search, department, filter, sort, result position, and pagination state in the URL so browser Back returns to the same results.
- Keep that URL-state contract independently testable: normalize stale or hostile values, retain unrelated deep-link parameters, and distinguish result-changing controls from loaded depth and return focus.
- Add an evidence-backed `Similar products` or `Often requested together` rail after catalogue quality is complete. Recommendations must use safe category/form/ingredient rules and must not imply medical advice.

### Acceptance evidence

- Title and description quality reports pass for the approved live catalogue, with governed exceptions only.
- Product-description database tests reject incomplete evidence, stale post-approval edits, and public draft leakage.
- Product-description workflow tests reject stale inspections and direct publication bypass, preserve immutable approval/withdrawal evidence, and prove service-only single-product operation.
- `npm run backend:verify:description-reviewer` proves the deployed reviewer rejects unauthenticated access and returns the exact inspected product version under the same database/reviewer contract without retaining response content.
- `npm run data:content-review:verify -- --strict` passes against the exact approved catalogue snapshot with zero pending or correction-required entries.
- Back-navigation tests restore the same query, filters, sort, page, and focus position.
- [`docs/audit/catalogue-navigation-readiness-2026-07-18.md`](audit/catalogue-navigation-readiness-2026-07-18.md) records the functional state-contract evidence and the remaining immutable-release browser capture gate.
- Breadcrumbs match visual navigation and JSON-LD.
- Recommendation tests exclude non-requestable, expired, incompatible, or clinically unsafe suggestions and include a clear non-advice boundary.
- The representative product, recommendation, and result-restoration scenarios pass the shared strict browser-evidence ledger against one immutable live release.

## Goal 9 — Build a locally credible, rights-safe visual and mobile experience

**Audit coverage:** P3-1, P3-2, product imagery findings  
**Owner:** Design/creative lead and frontend lead  
**Target:** after P0/P1 closure

Replace generic brand imagery with a recognizable Rwandan context and make repeat mobile use convenient without adding unsupported product claims.

### Deliverables

- Produce a coherent visual system and approved asset family showing authentic Rwanda pharmacy/customer contexts, with releases and reuse rights.
- Continue to fail closed on unverified branded product images; use verified packshots or honest neutral treatment.
- Verify image crops, alt text, performance, color contrast, responsive behavior, and consistency at 320, 390, 768, 1024, and 1440 px.
- Complete the PWA install path: service worker/offline strategy, install eligibility, update handling, and a dismissible install prompt after a repeat visit.
- Keep the install prompt secondary to the customer task and suppress it in unsupported/private contexts.

### Acceptance evidence

- Every public image has provenance/rights status and an approved use.
- Design QA compares accepted concepts with desktop and mobile implementation screenshots and records no material mismatch.
- Lighthouse/accessibility/performance budgets pass; offline behavior never fabricates live availability or request success.
- Install, dismissal, update, and standalone-mode behavior pass on supported Android; iOS guidance is accurate and non-intrusive.

## Goal 10 — Close production operations and release gates

**Audit coverage:** all production-readiness dependencies and the audit's acquisition warning  
**Owner:** Program owner with every accountable owner  
**Target:** before formal launch approval

Complete the evidence-backed human, operational, security, and infrastructure work that software cannot approve for itself.

### Required closures

1. authoritative GPS review ledger;
2. pharmacy-authorized WhatsApp review ledger;
3. all duplicate-register decisions;
4. backend security-hardening approval;
5. Edge Function approval;
6. valid Turnstile server test;
7. anonymous-auth rate-limit approval and test;
8. prescription-retention approval;
9. least-privilege Cloudflare account verification;
10. domain/DNS approval; and
11. all physical-device UAT scenarios.

### Acceptance evidence

- `npm run launch:evidence:verify:live` passes all 11 gates.
- `npm run release:check:live` passes against the intended production environment.
- Physical-device UAT proves GPS consent, OTP delivery, dispatch, realtime confirmation, selection, WhatsApp, MoMo, expiry, cancellation, and prescription access with controlled identities.
- The deployed live revision passes the Goal 0 baseline and post-deployment monitoring has no critical finding.

## Goal 11 — Evaluate strategic depth only after the core service is proven

**Audit coverage:** Phase 4 MoMo API, reliability scoring, cross-sell  
**Owner:** Product owner, legal, finance, operations, and engineering  
**Target:** 90+ days; conditional

Do not add payment custody or a marketplace reliability score merely because they appear in the long-term audit roadmap.

### Entry criteria

- P0 and P1 goals are closed.
- Production request and fulfilment SLAs are measured and stable.
- Pharmacy operations and dispute handling are staffed.
- Legal, consumer-protection, payment-provider, privacy, reconciliation, refund, and accounting decisions are approved.

### Decision deliverables

- A MoMo options paper comparing the existing direct USSD handoff with deep links, payment initiation, and platform-processed payment.
- An operating model for reconciliation, failure recovery, refunds, charge/dispute handling, receipts, support, and incident response if MED+250 processes payment.
- A reliability-score methodology with minimum sample size, recency weighting, fraud controls, correction/appeal path, and suppression logic.
- An experiment plan for related-product recommendations with safety, usefulness, and conversion guardrails.

### Acceptance evidence

- A named owner records `proceed`, `proceed with conditions`, or `do not proceed` for each strategic capability.
- No payment or score is exposed before all entry criteria and capability-specific approvals pass.

## Sequenced execution roadmap

### Phase A — Stop trust leakage (0–2 weeks)

- Goal 0 live baseline.
- Goal 1 live category and pagination proof.
- Goal 4 request-language and explainer alignment.
- Confirm that no marketing campaign points to an empty or misleading surface.

### Phase B — Fix acquisition and disclosure (weeks 2–4)

- Goal 2 technical SEO and Search Console submission.
- Goal 3 priority price coverage and filter rules.
- Goal 6 legal identity/contact publication when approved.
- Start Goal 7 Kinyarwanda localization.

### Phase C — Close confidence gaps (months 2–3)

- Complete Goal 7.
- Goal 5 evidence-backed trust/response signals.
- Goal 8 title, breadcrumb, state persistence, description, and related-product work.
- Goal 9 local creative and PWA after core UX closure.

### Phase D — Launch and learn (after approvals)

- Goal 10 protected production closure and physical UAT.
- Run Goal 0 again against the released revision.
- Start Goal 11 discovery only after real SLA data exists.

## Program scorecard

| KPI | Audit baseline | Release target |
| --- | ---: | ---: |
| Advertised departments with products | 1 of 4 | 4 of 4, or zero-count departments hidden |
| Reach beyond initial product page | Not observed beyond 24 | Stable access to full approved catalogue |
| Priority products with reviewed indicative price | 0 sampled | At least 100 |
| Google-indexed priority routes | 0 observed | Search Console-validated and trending upward |
| Prohibited customer-facing cart/checkout terms | Present | 0 |
| Kinyarwanda completion for critical journey | 0% | 100% |
| Legal identity/privacy contact completeness | Incomplete | Owner-approved and published |
| Trust metrics with evidence contracts | 0 | All displayed metrics governed |
| Physical-device UAT | Not performed in audit | 12/12 passed and approved |
| Production evidence gates | 15 pending at program start | 15/15 confirmed |

## Audit traceability

The machine-validated companion register is [`data/audit-implementation-register.json`](../data/audit-implementation-register.json). It records the exact 17 P0–P3 findings, three Phase 4 decisions, goal mappings, accountable owners, dependencies, acceptance conditions, current evidence, and remaining closure. Run `npm run audit:goals:verify` after changing any status or evidence reference. [`docs/audit/audit-completion-contract-2026-07-18.md`](audit/audit-completion-contract-2026-07-18.md) defines the source-bound evidence and accountable approval required for a terminal state. [`docs/audit/unified-audit-closure-status-2026-07-18.md`](audit/unified-audit-closure-status-2026-07-18.md) documents the cross-ledger owner report produced by `npm run audit:closure:status`. `npm run audit:goals:verify:strict` rejects any unresolved finding or strategic decision. Full strict closure uses `npm run audit:closure:verify`, which also requires every browser, protected launch, physical-device, localization, and product-content gate to pass.

| Audit item | Goal |
| --- | --- |
| P0-1 empty departments | Goal 1 |
| P0-2 24-product ceiling | Goals 0–1 |
| P0-3 zero organic visibility | Goal 2 |
| P0-4 no indicative prices | Goal 3 |
| P0-5 cart/request mismatch | Goal 4 |
| P1-1 missing trust signals | Goal 5 |
| P1-2 no related products | Goal 8 |
| P1-3 controller identity/contact absent | Goal 6 |
| P1-4 English-only interface | Goal 7 |
| P1-5 uncertain search reach | Goals 0–2 |
| P2-1 raw product titles | Goal 8 |
| P2-2 additional journey-education module | Goal 4 — product owner declined; keep the rejected surface absent and preserve point-of-action request clarity |
| P2-3 breadcrumb/filter-state loss | Goal 8 |
| P2-4 no response expectation | Goal 5 |
| P2-5 blank descriptions/generic imagery | Goals 8–9 |
| P3-1 generic stock-style brand imagery | Goal 9 |
| P3-2 no PWA install prompt | Goal 9 |
| Phase 4 MoMo API | Goal 11 |
| Phase 4 reliability score | Goals 5 and 11 |
| Phase 4 cross-sell | Goals 8 and 11 |
| Preserve SSR, FDA data, privacy staging, disclaimer, robots hygiene | Delivery principles and every release gate |

## Definition of done

The audit program is complete only when the traceability table has no unowned item, Goals 0–10 and every AX requirement meet their acceptance evidence, every conditional Goal 11 decision is recorded, and the deployed public revision passes the full live, security, data, accessibility, performance, and physical-UAT verification suite. A passing local build or test suite alone is insufficient.
