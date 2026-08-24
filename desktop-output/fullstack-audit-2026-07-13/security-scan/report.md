# Security Review: MED250

## Scope

Full repository security review of the frozen dirty working-tree snapshot.

- Scan mode: deep_repository
- Target kind: git_worktree
- Target ID: target_sha256_e71b40704a8f1fed3d652a46a41f4deed170fe871f741035e0861ad9d8370e96
- Revision: 565904a48825d810c544271e0cc10882a59272c1
- Snapshot digest: codex-security-snapshot/v1:sha256:8d7642c617446e815f5dae210932b0972bb9c46ed42916c5b0a9e0c78a728f0b
- Inventory strategy: repository
- Included paths: .
- Excluded paths: node_modules/, .next/, dist/
- Runtime or test status: release:check previously passed; npm audit reported no known dependency vulnerabilities
- Artifacts reviewed: 176 source and configuration files, Supabase migrations and Edge Functions, Cloudflare Worker and deployment workflows, browser, data, release, and backend tests
- Scan context: MED+250 is gated as a private preview; live operations remain disabled.

Limitations and exclusions:
- No privileged production mutation or live OTP was attempted.
- No physical-phone UAT or Cloudflare production deployment was performed.
- External regulatory and operational approvals remain launch gates.
- Excluded node_modules/ and generated build output: Third-party/generated contents were evaluated through manifests, lockfiles, build artifacts, and dependency audit rather than line-by-line source review.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable DSS findings | 12 |
| Report instances | 12 |
| Report severity mix | high: 2, medium: 8, low: 2 |
| Report confidence mix | high: 11, medium: 1 |
| Coverage | complete |
| Validation mode | Static source-to-sink review plus bounded local diagnostics and non-destructive public-role checks. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

Public customers and pharmacy staff cross Cloudflare, Supabase Auth/RLS/RPC, private Storage, and pre/post-selection disclosure boundaries.

### Assets

- Customer sessions, exact locations, orders, WhatsApp contacts, and prescriptions
- Pharmacy identities, memberships, OTP challenges, and offers
- Supabase, WhatsApp, Google Maps, GitHub, and Cloudflare credentials

### Trust Boundaries

- Public Internet to Cloudflare Worker
- Browser to Supabase public endpoints
- OTP Edge Function to Auth and service role
- Browser JWT to RLS and SECURITY DEFINER RPCs
- Private Storage to selected pharmacy
- Developer and CI to production

### Attacker Capabilities

- Unauthenticated HTTP and Supabase calls
- Authenticated anonymous customer calls
- Legitimate or compromised pharmacy staff calls
- Supply-chain influence over imported data or CI dependencies

### Security Objectives

- Preserve tenant ownership and pre/post-selection privacy
- Issue pharmacy sessions only to current authorized staff
- Keep regulated product and routing state current
- Keep privileged credentials out of public and unnecessary execution contexts

### Assumptions

- External processors enforce their documented controls
- Live mode remains gated until all operational approvals and credential rotation are evidenced

## Findings

| Findings | Reports | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- | --- |
| OTP login can reactivate a suspended pharmacy member | [occ_147a68e51ccb6a7c68230092](#finding-1) | high | high | occ_147a68e51ccb6a7c68230092: inline below |
| Removing a pharmacy login contact does not revoke existing access | [occ_1abf9e661950bdf8c3ebfe2c](#finding-2) | high | medium | occ_1abf9e661950bdf8c3ebfe2c: inline below |
| Catalogue data can break out of product JSON-LD | [occ_0d891f8515825b622c677ad3](#finding-3) | medium | high | occ_0d891f8515825b622c677ad3: inline below |
| Unbound contact imports can grant or restore pharmacy login authority | [occ_0fecbf35d7b475bdbc137c1e](#finding-4) | medium | high | occ_0fecbf35d7b475bdbc137c1e: inline below |
| Offer and contact disclosure boundaries are inconsistent | [occ_148f5bd2af6112cead47c713](#finding-5) | medium | high | occ_148f5bd2af6112cead47c713: inline below |
| Production workflow overexposes secrets to mutable build steps | [occ_3482edbf0bae1bd2a902ff1c](#finding-6) | medium | high | occ_3482edbf0bae1bd2a902ff1c: inline below |
| One customer session can repeatedly dispatch and cancel orders | [occ_7f398b5f0464d2c114c3a45f](#finding-7) | medium | high | occ_7f398b5f0464d2c114c3a45f: inline below |
| OTP rate limits can be raced and partitioned | [occ_9e7f709b5b99e07dd097276e](#finding-8) | medium | high | occ_9e7f709b5b99e07dd097276e: inline below |
| Telemetry buffers oversized unknown-length bodies before rejecting them | [occ_e220dd65657294354d7ab4a7](#finding-9) | medium | high | occ_e220dd65657294354d7ab4a7: inline below |
| Disabled products can remain confirmable or selectable | [occ_ee0ab421cf4986b4d803b41d](#finding-10) | medium | high | occ_ee0ab421cf4986b4d803b41d: inline below |
| Geocode approval can verify a changed candidate snapshot | [occ_dc90b712cbfc0858d4937536](#finding-11) | low | high | occ_dc90b712cbfc0858d4937536: inline below |
| Prescription cleanup performs unbounded storage enumeration | [occ_eedfd8293d7bbaa6625927d1](#finding-12) | low | high | occ_eedfd8293d7bbaa6625927d1: inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] OTP login can reactivate a suspended pharmacy member

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | The membership upsert is unconditional and downstream RPCs trust active membership. |
| Category | authorization-bypass |
| CWE | CWE-863 |
| Affected lines | supabase/functions/dawanear-pharmacy-verify-otp/index.ts:106-116 |

#### Summary

A valid OTP for a still-linked number unconditionally overwrites an existing membership as manager/active.

#### Root Cause

Authentication proof and membership authorization state are conflated in one upsert.

#### Validation

The membership upsert is unconditional and downstream RPCs trust active membership.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Valid OTP -\> eligible contact lookup -\> unconditional manager/active membership upsert -\> permanent pharmacy session.

Counterevidence and remaining uncertainty:
- The contact and licence are rechecked, but existing membership lifecycle state is not.

#### Dataflow

Valid OTP -\> eligible contact lookup -\> unconditional manager/active membership upsert -\> permanent pharmacy session.

- **Source:** Valid OTP from a still-linked suspended staff number

- **Sink:** Membership upsert at verify-OTP lines 106-116

- **Outcome:** Suspended staff regains manager access

Transformations:
- Contact and pharmacy eligibility checks
- Auth user creation or lookup

#### Reachability

The pre-auth OTP function is public by design and issues a normal pharmacy session after verification.

- **Attacker:** Suspended pharmacy staff who still controls the linked WhatsApp number

- **Entry point:** dawanear-pharmacy-verify-otp Edge Function

- **Outcome:** Suspended staff regains manager access

Preconditions:
- Valid OTP
- Login contact remains enabled

#### Severity

**High** — The path can restore or retain control of a pharmacy identity and its private order workflow.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Preserve existing role/status, refuse suspended or revoked membership reactivation, and require an explicit operator-managed restoration path.

Tests:
- Add a regression test that fails before the remediation and proves the pharmacy-membership-state-preservation invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-2"></a>

### [2] Removing a pharmacy login contact does not revoke existing access

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | medium |
| Confidence rationale | Repository review found no session revocation, membership suspension, or credential-version check on contact removal. |
| Category | session-management |
| CWE | CWE-613 |
| Affected lines | supabase/migrations/20260713234500_govern_pharmacy_contact_edit_reviews.sql:89-117, supabase/functions/dawanear-pharmacy-verify-otp/index.ts:119-125 |

#### Summary

Contact removal blocks future OTP use but leaves active memberships and previously issued permanent sessions usable.

#### Root Cause

The offboarding transition changes contact state only, while authorization is represented separately by persistent session and active membership.

#### Validation

Repository review found no session revocation, membership suspension, or credential-version check on contact removal.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Staff signs in -\> operator removes contact -\> session and membership remain active -\> pharmacy RPCs still authorize.

Counterevidence and remaining uncertainty:
- An operator can separately suspend membership, but that is not atomic with contact removal.

#### Dataflow

Staff signs in -\> operator removes contact -\> session and membership remain active -\> pharmacy RPCs still authorize.

- **Source:** Existing pharmacy session before contact removal

- **Sink:** Active-membership authorization in pharmacy RPCs

- **Outcome:** Former staff retains pharmacy access

Transformations:
- Contact marked stale/login-disabled

#### Reachability

The attacker already has a legitimate session; no new OTP is required after removal.

- **Attacker:** Removed pharmacy staff with a pre-existing browser session

- **Entry point:** Authenticated pharmacy RPCs

- **Outcome:** Former staff retains pharmacy access

Preconditions:
- Session issued before removal
- Membership remains active

#### Severity

**High** — The path can restore or retain control of a pharmacy identity and its private order workflow.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Atomically suspend affected memberships, revoke refresh sessions or increment a credential version, and enforce current contact authorization on pharmacy RPCs.

Tests:
- Add a regression test that fails before the remediation and proves the pharmacy-session-revocation-on-contact-removal invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-3"></a>

### [3] Catalogue data can break out of product JSON-LD

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | A bounded render diagnostic produced a literal script terminator in both Product and Breadcrumb JSON-LD sinks. |
| Category | stored-xss |
| CWE | CWE-79 |
| Affected lines | scripts/import-data/parse-rwanda-fda.mjs:127-132, app/product/\[id\]/page.tsx:51 |

#### Summary

The import decodes HTML entities after stripping literal tags, and product/brand values are serialized directly into inline JSON-LD script elements.

#### Root Cause

HTML normalization and script-context output encoding are both incomplete.

#### Validation

A bounded render diagnostic produced a literal script terminator in both Product and Breadcrumb JSON-LD sinks.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Encoded external catalogue value -\> entity decoding after tag stripping -\> SEO data generation -\> JSON.stringify in inline script -\> browser script-context breakout.

Counterevidence and remaining uncertainty:
- The current generated catalogue contains no angle-bracket fields, so present data is not already exploiting the sink.

#### Dataflow

Encoded external catalogue value -\> entity decoding after tag stripping -\> SEO data generation -\> JSON.stringify in inline script -\> browser script-context breakout.

- **Source:** External/local regulatory catalogue fields

- **Sink:** Product and Breadcrumb JSON-LD script elements

- **Outcome:** Stored same-origin script execution on product pages

Transformations:
- Entity decoding
- SEO catalogue generation
- JSON serialization

#### Reachability

The vulnerable pages are public, but exploitation additionally requires a hostile value to enter the supported import pipeline.

- **Attacker:** Attacker able to influence an imported catalogue source or its local artifact

- **Entry point:** Product data import followed by public product page

- **Outcome:** Stored same-origin script execution on product pages

Preconditions:
- Hostile encoded value is imported
- A user opens the affected product page

#### Severity

**Medium** — The path has a realistic product or production boundary impact, but scope or prerequisites constrain it.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Decode entities before removing markup, reject script-delimiter characters in imported structured fields, and serialize JSON-LD with a helper that escapes \< as \\u003c.

Tests:
- Add a regression test that fails before the remediation and proves the json-ld-safe-serialization invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-4"></a>

### [4] Unbound contact imports can grant or restore pharmacy login authority

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | The generated SQL grants source_verified/login-enabled state from caller-selected local files and overwrites governance state on conflict. |
| Category | supply-chain |
| CWE | CWE-345, CWE-284 |
| Affected lines | scripts/import-data/emit-rwanda-fda-pharmacy-contact-sql.mjs:65-92, scripts/import-data/extract-rwanda-fda-duty-rosters.py:1-25 |

#### Summary

Local CSV/PDF tooling assigns official provenance without source digest verification, and conflict handling can restore stale or rejected login contacts.

#### Root Cause

Data provenance labels are asserted by tooling rather than cryptographically or operationally bound to the reviewed official source.

#### Validation

The generated SQL grants source_verified/login-enabled state from caller-selected local files and overwrites governance state on conflict.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Local file is selected or substituted -\> extractor labels it official -\> SQL import marks numbers verified/login-enabled -\> OTP login accepts them or restores rejected rows.

Counterevidence and remaining uncertainty:
- An operator must run the import, which constrains likelihood but does not validate the artifact content.

#### Dataflow

Local file is selected or substituted -\> extractor labels it official -\> SQL import marks numbers verified/login-enabled -\> OTP login accepts them or restores rejected rows.

- **Source:** Caller-selected CSV/PDF contact artifacts

- **Sink:** OTP-authoritative pharmacy contact rows

- **Outcome:** Unauthorized or previously rejected number can authenticate to a pharmacy

Transformations:
- Roster extraction
- Provenance relabelling
- SQL generation
- Conflict upsert

#### Reachability

This is a production data-supply-chain path rather than a direct anonymous HTTP endpoint.

- **Attacker:** Actor able to substitute or influence the contact import artifact

- **Entry point:** Documented contact import workflow

- **Outcome:** Unauthorized or previously rejected number can authenticate to a pharmacy

Preconditions:
- Operator runs the importer against the affected file

#### Severity

**Medium** — The path has a realistic product or production boundary impact, but scope or prerequisites constrain it.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Require approved source URLs/digests and expected row counts, separate extraction from authority grants, and never overwrite stale/rejected review state without an explicit reapproval.

Tests:
- Add a regression test that fails before the remediation and proves the pharmacy-contact-import-authority invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-5"></a>

### [5] Offer and contact disclosure boundaries are inconsistent

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Direct RPC analysis confirms draft data crosses the network before client filtering and contact eligibility is not bound to the returned number. |
| Category | privacy-boundary |
| CWE | CWE-200, CWE-345 |
| Affected lines | supabase/migrations/20260712130000_dawanear_marketplace.sql:1875-1937, supabase/migrations/20260712130000_dawanear_marketplace.sql:2600-2670, supabase/migrations/20260713234500_govern_pharmacy_contact_edit_reviews.sql:89-117 |

#### Summary

Active-order recovery can return incomplete pharmacy drafts, while selected contact can resolve to a different unverified summary number and removed derived contacts may remain active.

#### Root Cause

Related privacy and contact-integrity checks use existence or client filtering instead of binding the exact returned row to the approved state.

#### Validation

Direct RPC analysis confirms draft data crosses the network before client filtering and contact eligibility is not bound to the returned number.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Customer calls active-order/contact RPCs -\> SECURITY DEFINER aggregation or summary lookup selects insufficiently constrained rows -\> private draft or wrong contact crosses the boundary.

Counterevidence and remaining uncertainty:
- Direct-table RLS and the confirmed-offers RPC are stricter, but do not protect the affected RPC responses.

#### Dataflow

Customer calls active-order/contact RPCs -\> SECURITY DEFINER aggregation or summary lookup selects insufficiently constrained rows -\> private draft or wrong contact crosses the boundary.

- **Source:** Order-owning customer after order placement or selection

- **Sink:** Active-order and selected-contact RPC outputs

- **Outcome:** Premature pharmacy disclosure or health/payment message to an unverified destination

Transformations:
- RPC aggregation
- Pharmacy eligibility check
- Summary contact lookup

#### Reachability

Both RPCs are part of the normal authenticated customer flow and are callable directly.

- **Attacker:** Authenticated order owner or an affected normal customer

- **Entry point:** Supabase RPC endpoints

- **Outcome:** Premature pharmacy disclosure or health/payment message to an unverified destination

Preconditions:
- Own active or selected order
- Affected incomplete offer or mismatched contact state exists

#### Severity

**Medium** — The path has a realistic product or production boundary impact, but scope or prerequisites constrain it.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Require complete offers in the active-order RPC; return the exact verified login-enabled WhatsApp contact; and stale derived children when the parent is removed or replaced.

Tests:
- Add a regression test that fails before the remediation and proves the preselection-offer-and-contact-integrity invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-6"></a>

### [6] Production workflow overexposes secrets to mutable build steps

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Workflow inspection confirms job-wide secret availability and mutable action references in the credential-bearing production path. |
| Category | supply-chain |
| CWE | CWE-522, CWE-829 |
| Affected lines | .github/workflows/deploy-cloudflare.yml:74-116 |

#### Summary

The elevated Supabase key is defined for the entire production job and deployment actions use mutable major-version refs.

#### Root Cause

Production credentials and third-party executable code have broader lifetime and mutability than necessary.

#### Validation

Workflow inspection confirms job-wide secret availability and mutable action references in the credential-bearing production path.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Compromised dependency/action or upstream tag change -\> code executes in production job -\> reads job-scoped secrets or alters deployment.

Counterevidence and remaining uncertainty:
- GitHub environments and manual dispatch reduce exposure, but do not restrict secrets within the job.

#### Dataflow

Compromised dependency/action or upstream tag change -\> code executes in production job -\> reads job-scoped secrets or alters deployment.

- **Source:** Mutable action resolution or compromised build dependency

- **Sink:** Supabase/Cloudflare credentials and production deployment

- **Outcome:** Production data-plane or deployment compromise

Transformations:
- Checkout
- Dependency install
- Build and release steps

#### Reachability

The path requires CI supply-chain compromise, but the workflow is the real production release surface.

- **Attacker:** Supply-chain attacker controlling a resolved action/dependency

- **Entry point:** GitHub Actions production workflow

- **Outcome:** Production data-plane or deployment compromise

Preconditions:
- Production workflow is approved and runs
- Referenced code is compromised

#### Severity

**Medium** — The path has a realistic product or production boundary impact, but scope or prerequisites constrain it.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Scope Supabase secrets only to the exact backend verification step, separate build and privileged release jobs, and pin every third-party action to a reviewed full commit SHA.

Tests:
- Add a regression test that fails before the remediation and proves the production-workflow-secret-isolation invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-7"></a>

### [7] One customer session can repeatedly dispatch and cancel orders

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | The live rollback UAT intentionally proves slot reuse immediately after cancellation, while no rolling quota exists. |
| Category | abuse |
| CWE | CWE-799 |
| Affected lines | supabase/migrations/20260712130000_dawanear_marketplace.sql:1940-2024 |

#### Summary

Cancellation immediately frees the single-active-order slot, and no rolling creation/cancellation quota limits sequential notification churn.

#### Root Cause

The concurrency invariant limits active orders but not repeated sequential dispatch.

#### Validation

The live rollback UAT intentionally proves slot reuse immediately after cancellation, while no rolling quota exists.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Anonymous customer creates order -\> routing notifies up to 20 pharmacies -\> customer cancels -\> active slot clears -\> loop repeats.

Counterevidence and remaining uncertainty:
- Turnstile protects initial anonymous sign-in, and idempotency prevents duplicates, but neither limits sequential churn.

#### Dataflow

Anonymous customer creates order -\> routing notifies up to 20 pharmacies -\> customer cancels -\> active slot clears -\> loop repeats.

- **Source:** Authenticated anonymous customer session

- **Sink:** Repeated dispatch/notification work

- **Outcome:** Pharmacy notification and operational abuse

Transformations:
- Create order
- Route recipients
- Cancel order

#### Reachability

Normal customer RPCs are internet-accessible and cancellation is a supported action.

- **Attacker:** Anonymous customer or bot with one established session

- **Entry point:** Order create and close RPCs

- **Outcome:** Pharmacy notification and operational abuse

Preconditions:
- One valid anonymous session

#### Severity

**Medium** — The path has a realistic product or production boundary impact, but scope or prerequisites constrain it.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Add a server-enforced rolling quota and cooldown keyed to customer, source, and destination footprint; count recent terminal cancellations before routing another order.

Tests:
- Add a regression test that fails before the remediation and proves the anonymous-order-rolling-quota invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-8"></a>

### [8] OTP rate limits can be raced and partitioned

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | The checks and insert are separate operations; source hashing includes caller-controlled User-Agent. |
| Category | rate-limit |
| CWE | CWE-362, CWE-799 |
| Affected lines | supabase/functions/dawanear-pharmacy-send-otp/index.ts:31-47, supabase/functions/_shared/dawanear-pharmacy-auth.ts:175-188 |

#### Summary

Concurrent requests can pass separate pre-insert counters, while caller-controlled User-Agent creates additional source buckets.

#### Root Cause

Rate-limit observation and OTP issuance are not one atomic state transition.

#### Validation

The checks and insert are separate operations; source hashing includes caller-controlled User-Agent.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Parallel public send requests -\> identical pre-insert counts -\> multiple challenge inserts and WhatsApp sends; User-Agent variation partitions the source counter.

Counterevidence and remaining uncertainty:
- Per-phone and global caps remain and bound overall abuse.

#### Dataflow

Parallel public send requests -\> identical pre-insert counts -\> multiple challenge inserts and WhatsApp sends; User-Agent variation partitions the source counter.

- **Source:** Public OTP-send requests

- **Sink:** OTP challenge insert and WhatsApp send

- **Outcome:** Bounded notification/cost abuse and expanded challenge budget

Transformations:
- Phone normalization
- Source-hash calculation
- Separate counter queries

#### Reachability

The send endpoint is public before authentication and accepts normal HTTP headers.

- **Attacker:** Unauthenticated bot

- **Entry point:** dawanear-pharmacy-send-otp Edge Function

- **Outcome:** Bounded notification/cost abuse and expanded challenge budget

Preconditions:
- Target registered pharmacy numbers for successful sends

#### Severity

**Medium** — The path has a realistic product or production boundary impact, but scope or prerequisites constrain it.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Move rate-limit reservation, invalidation, and challenge creation into one atomic database function keyed by normalized phone and trusted source IP only.

Tests:
- Add a regression test that fails before the remediation and proves the otp-rate-limit-atomicity-and-source-key invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-9"></a>

### [9] Telemetry buffers oversized unknown-length bodies before rejecting them

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | A bounded local diagnostic confirmed a 5 MB no-Content-Length request was consumed before the 413 response. |
| Category | resource-exhaustion |
| CWE | CWE-400 |
| Affected lines | app/api/telemetry/route.ts:78-91 |

#### Summary

The public telemetry route calls request.text() before applying its 2 KiB policy, so an unknown-length body is fully consumed first.

#### Root Cause

The size control is applied after full body materialization.

#### Validation

A bounded local diagnostic confirmed a 5 MB no-Content-Length request was consumed before the 413 response.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Public caller omits Content-Length and streams a large body -\> request.text buffers it -\> post-buffer check returns 413.

Counterevidence and remaining uncertainty:
- Event and property allow-lists run later and do not bound body ingestion.

#### Dataflow

Public caller omits Content-Length and streams a large body -\> request.text buffers it -\> post-buffer check returns 413.

- **Source:** Public telemetry HTTP body

- **Sink:** Worker memory/CPU allocation

- **Outcome:** Repeatable resource consumption

Transformations:
- Full text decoding

#### Reachability

The route is public on the deployed Worker and needs no authentication.

- **Attacker:** Unauthenticated internet caller

- **Entry point:** POST /api/telemetry

- **Outcome:** Repeatable resource consumption

Preconditions:
- Network access to the site

#### Severity

**Medium** — The path has a realistic product or production boundary impact, but scope or prerequisites constrain it.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Read the body through a byte-limited stream, abort immediately above 2 KiB, and add request-rate and concurrency controls at Cloudflare.

Tests:
- Add a regression test that fails before the remediation and proves the telemetry-stream-byte-limit invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-10"></a>

### [10] Disabled products can remain confirmable or selectable

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Static SQL traces show the exact requested-item path and selection transition omit current product predicates. |
| Category | integrity |
| CWE | CWE-367, CWE-20 |
| Affected lines | supabase/migrations/20260712130000_dawanear_marketplace.sql:1384-1748, supabase/migrations/20260712130000_dawanear_marketplace.sql:1752-1872 |

#### Summary

Offer submission and selection do not consistently revalidate current active/orderable state for exact and substitute products.

#### Root Cause

A time-varying regulatory/product invariant is checked at earlier stages but not at each committing transition.

#### Validation

Static SQL traces show the exact requested-item path and selection transition omit current product predicates.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Product is disabled after order or offer creation -\> pharmacy submits or customer selects -\> missing predicate permits persisted/selected fulfilment.

Counterevidence and remaining uncertainty:
- Order creation and substitute submission have partial checks, but they do not cover all later paths.

#### Dataflow

Product is disabled after order or offer creation -\> pharmacy submits or customer selects -\> missing predicate permits persisted/selected fulfilment.

- **Source:** Legitimate pharmacy offer or customer selection

- **Sink:** Offer submission and selection state updates

- **Outcome:** Withdrawn or disabled product becomes confirmed fulfilment

Transformations:
- Order/offer lifecycle state changes

#### Reachability

This is reachable through ordinary authenticated marketplace operations after product state changes.

- **Attacker:** Legitimate or compromised pharmacy staff, or normal customer selecting a stale offer

- **Entry point:** dawanear_submit_offer and dawanear_select_offer RPCs

- **Outcome:** Withdrawn or disabled product becomes confirmed fulfilment

Preconditions:
- Product state changes after an earlier validation

#### Severity

**Medium** — The path has a realistic product or production boundary impact, but scope or prerequisites constrain it.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Revalidate every offered product at submission and again in the atomic selection transaction; reject disabled or non-orderable exact and substitute items.

Tests:
- Add a regression test that fails before the remediation and proves the product-state-revalidation-on-offer-selection invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-11"></a>

### [11] Geocode approval can verify a changed candidate snapshot

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Static review confirms a same-Place-ID concurrent update can pass the final predicate. |
| Category | integrity |
| CWE | CWE-367 |
| Affected lines | supabase/functions/geocode-pharmacies/index.ts:98-123 |

#### Summary

Approval compares status and Place ID but not a version or digest of the exact reviewed coordinates and metadata.

#### Root Cause

The approval transaction is not bound to the complete reviewed candidate state.

#### Validation

Static review confirms a same-Place-ID concurrent update can pass the final predicate.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- Candidate is reviewed -\> same Place ID record changes -\> approval updates by status and Place ID only -\> changed coordinates become verified.

Counterevidence and remaining uncertainty:
- Approval requires named evidence and a matching Place ID, reducing likelihood and scope.

#### Dataflow

Candidate is reviewed -\> same Place ID record changes -\> approval updates by status and Place ID only -\> changed coordinates become verified.

- **Source:** Concurrent candidate update during operator review

- **Sink:** Verified pharmacy coordinates

- **Outcome:** Unreviewed location influences nearest-pharmacy dispatch

Transformations:
- Candidate read
- Human review
- Conditional update

#### Reachability

The path depends on a narrow concurrency window in a protected operator workflow.

- **Attacker:** Actor or process able to update staged geocode candidates

- **Entry point:** Geocode approval Edge Function

- **Outcome:** Unreviewed location influences nearest-pharmacy dispatch

Preconditions:
- Candidate update races the approval
- Place ID remains unchanged

#### Severity

**Low** — The path is real but has constrained likelihood or impact.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Store a candidate version/digest and approve it in one atomic database RPC that compares the full reviewed snapshot before promoting it.

Tests:
- Add a regression test that fails before the remediation and proves the geocode-candidate-version-binding invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

<a id="finding-12"></a>

### [12] Prescription cleanup performs unbounded storage enumeration

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Static loops show unbounded folder/page traversal before the final deletion limit is applied. |
| Category | resource-exhaustion |
| CWE | CWE-400 |
| Affected lines | supabase/functions/cleanup-prescriptions/index.ts:180-268 |

#### Summary

Cleanup caps deletions but enumerates all folders and pages first; authenticated users can create nested owner-prefixed paths.

#### Root Cause

The batch limit controls mutation count, not discovery work.

#### Validation

Static loops show unbounded folder/page traversal before the final deletion limit is applied.

Validation method: Static source-to-sink review plus bounded local diagnostics; no destructive live action.

Evidence:
- User creates many nested paths -\> scheduled cleanup recursively lists folders/pages -\> deletion cap is applied only after enumeration.

Counterevidence and remaining uncertainty:
- Per-run deletion limits and cron authentication exist but do not bound listing work.

#### Dataflow

User creates many nested paths -\> scheduled cleanup recursively lists folders/pages -\> deletion cap is applied only after enumeration.

- **Source:** Authenticated owner-prefixed Storage object paths

- **Sink:** Scheduled cleanup CPU/network/time budget

- **Outcome:** Delayed or failed retention cleanup

Transformations:
- Recursive folder listing
- Pagination

#### Reachability

The path requires many objects and affects scheduled maintenance rather than interactive ordering directly.

- **Attacker:** Authenticated customer able to upload owner-prefixed objects

- **Entry point:** Storage upload plus cleanup cron

- **Outcome:** Delayed or failed retention cleanup

Preconditions:
- Large/deep object tree
- Cleanup run executes

#### Severity

**Low** — The path is real but has constrained likelihood or impact.

Broader tenant reach, live affected-row counts, or production load evidence could raise severity; stronger server-side invariants could lower it.

#### Remediation

Enforce a maximum folder/page/time budget, persist cursors, restrict object-path depth, and stop enumeration when the run budget is exhausted.

Tests:
- Add a regression test that fails before the remediation and proves the prescription-cleanup-work-bound invariant after it.

Preventive controls:
- Keep the release contract and full-stack security tests in the mandatory production gate.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Pharmacy WhatsApp authentication and session lifecycle | identity | Reported | OTP and offboarding controls reviewed. Evidence: artifacts/03_coverage/validation_closure_table.md |
| Supabase RLS, RPC, order, offer, and contact boundaries | data and authorization | Reported | Ownership, membership, lifecycle, and disclosure paths reviewed. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Cloudflare Worker, Next rendering, telemetry, search, and headers | runtime and browser | Reported | Public input and output contexts reviewed. Evidence: artifacts/05_findings/attack_path_analysis_report.md |
| Prescription upload, access, and cleanup | health data and availability | Reported | Private bucket and cleanup flows reviewed. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Regulatory imports and CI deployment | production integrity | Reported | Import provenance, action references, and credential scope reviewed. Evidence: artifacts/02_discovery/finding_discovery_report.md |
| Runtime dependencies | third-party packages | No issue found | Package audit reported zero known vulnerabilities. Evidence: artifacts/02_discovery/work_ledger.jsonl |

## Open Questions And Follow Up

- How many live rows are affected by contact, membership, geocode, and product lifecycle defects after privileged remediation migrations are applied?
  - Follow-up prompt: Run the approved production-readiness verification with a newly rotated Supabase secret and record aggregate-only counts.
