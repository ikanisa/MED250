# MED+250 Security Fix and Release Readiness

Date: 2026-07-13  
Repository: `/Volumes/PRO-G40/MED250`  
Scope: remediation of the sealed deep security scan, final marketplace UAT, and Cloudflare preview release verification.

## Outcome

All 12 findings in the sealed repository security scan have a local code or database-boundary remediation and a regression test. The full preview release gate passes, including a production build, 88 automated tests, catalogue/data validation, performance budgets, and a strict Cloudflare Worker dry run. The dependency audit reports zero known vulnerabilities.

The July 14 reconciliation adds `20260714070425_refresh_security_backend_contract.sql`. It advances the service-only aggregate deployment contract to `2026-07-14.1`, expects the two new hardened public functions for a total of 26, and makes every forward-security invariant visible to privileged deployment verification without exposing row identifiers. Production now has fifteen independent evidence-backed release locks, and the workflow validates those locks before the Supabase secret is made available to the privileged verification step.

This result makes the repository ready for a controlled preview deployment. It does **not** authorize public ordering. The forward Supabase migration and revised Edge Functions have not been applied to the live project because the previously shared privileged credentials must be rotated first. Cloudflare production deployment, DNS changes, real WhatsApp messages, real customer orders, and physical-phone testing were deliberately not performed.

## Sealed scan evidence

- Canonical report: `security-scan/report.md`
- Findings: `security-scan/findings.json`
- Coverage: `security-scan/coverage.json`
- Manifest: `security-scan/scan-manifest.json`
- Findings at scan time: 12 total — 2 high, 8 medium, 2 low.
- Coverage status: complete for the frozen repository snapshot described in the scan manifest.

The sealed scan bundle remains unchanged. This file records the subsequent remediation and verification.

## Finding-by-finding remediation

| # | Original finding | Remediation | Verification |
| ---: | --- | --- | --- |
| 1 | OTP login could reactivate a suspended pharmacy member | OTP verification now refuses suspended/revoked membership and preserves an existing active role/status instead of forcing `manager`/`active`. | Static contract test plus the full authentication suite. |
| 2 | Removing a pharmacy login contact did not revoke existing access | The forward migration atomically marks derived contacts stale and suspends the linked membership when a login contact is retired. | Executable PGlite test proves contact retirement, phone staleness, and membership suspension. |
| 3 | Catalogue data could break out of product JSON-LD | All JSON-LD serialization now escapes `<` before insertion into script data. | Rendered-HTML test exercises hostile catalogue values. |
| 4 | Contact imports were not cryptographically bound to reviewed sources | The extractor hashes the source registry, every roster PDF, and the matched CSV. The SQL emitter refuses unmatched or incomplete manifests and excludes rejected/stale contacts. | Import-contract test; current incomplete roster provenance remains a fail-closed launch gate. |
| 5 | Offer and contact disclosure boundaries were inconsistent | Customer offer reads expose only complete offers; selected contact release requires a complete selected offer and returns only the exact verified login-enabled WhatsApp contact. | Executable forward-migration test filters incomplete offers. |
| 6 | Production workflow overexposed secrets to mutable build steps | GitHub actions are pinned to immutable commits, the Supabase secret is scoped only to the privileged verification step, and unprivileged build/release steps are separate. | Workflow regression checks plus strict Cloudflare dry run. |
| 7 | One customer session could repeatedly dispatch and cancel orders | A database trigger enforces a rolling five-orders-per-hour customer limit before dispatch. | Forward migration applies in the executable database harness; release contract test covers the invariant. |
| 8 | OTP rate limits could be raced and partitioned | OTP issuance is now one advisory-lock-protected service-only database operation; source hashing no longer includes attacker-controlled User-Agent variation. | Executable test issues one challenge and rejects the immediate retry. |
| 9 | Telemetry buffered oversized unknown-length bodies | The telemetry route streams and caps the body at 2,048 bytes before parsing. | Runtime tests return 413 for oversized fixed and streamed payloads. |
| 10 | Disabled products could remain confirmable or selectable | Database triggers revalidate active/orderable products when offer items are written and again when an offer is selected. | Executable test rejects an offer for a disabled product. |
| 11 | Geocode approval could verify a changed candidate snapshot | Approval is an atomic service-only compare-and-set operation bound to the exact candidate `updated_at` version. | Geocode governance tests require exact-version approval. |
| 12 | Prescription cleanup performed unbounded enumeration | Cleanup has a hard per-run page budget and reports enumeration exhaustion instead of scanning without limit. | Cleanup contract and shared-path tests pass. |

## Browser UAT defects found and fixed

The final Codex browser pass found four issues that were not visible in the first automated gate:

1. **Local Cloudflare runtime would not start.** `nodejs_compat` was declared in both Wrangler and the local Vite binding. The duplicate Vite declaration was removed; the flag remains in the deployment configuration and local preview starts normally.
2. **Accented French symptom searches returned no results.** Live RPC queries are now Unicode-normalized before Supabase search. `mal de tête` returns 163 ranked Pain & fever matches in the connected preview.
3. **Connected preview hid valid server-ranked results.** Preview mode no longer re-filters a single server page. It now displays the same privacy-safe Supabase ranking that live mode will use.
4. **My Orders opened the basket when no order existed.** My Orders and Order basket are now separate utilities. My Orders shows a clear empty/status panel and links to the basket; the basket remains the only pre-order editing surface.

The browser then verified:

- product-first home and catalogue;
- accented French semantic search and explained related-use matches;
- multi-product basket, quantities, substitute consent, optional WhatsApp and fulfilment preference;
- manual Kigali test coordinates and the native-location handoff surface;
- explicit preview alert confirming that no customer or health data was sent;
- separate My Orders empty/status state;
- registered-WhatsApp-only pharmacy sign-in;
- no new console errors after the corrected development runtime restart.

No real order or WhatsApp message was sent.

## Final verification

| Check | Result |
| --- | --- |
| `npm run lint` | Pass, zero warnings |
| `npm run release:check` | Pass |
| Automated tests | 88 / 88 pass |
| Executable security migration tests | 4 / 4 pass |
| Dependency audit | 0 known vulnerabilities |
| Performance budget | Pass |
| Browser JavaScript | 555,595 bytes |
| CSS | 86,760 bytes |
| Marketplace JavaScript | 219,495 bytes |
| Initial optimized visual assets | 73,183 bytes |
| Cloudflare strict dry run | Pass; 3,174.10 KiB upload, 625.47 KiB gzip |
| `git diff --check` | Pass |

The application exposes the expected routes for home, categories, four category subpages, dynamic product detail, How it works, Privacy, Terms, Accessibility, telemetry, robots, sitemap, and the private pharmacy entry redirect.

## Remaining launch locks

1. Rotate the Supabase service credential, database password, and personal access token previously exposed in chat.
2. Apply `supabase/migrations/20260714003000_security_hardening.sql` followed by `supabase/migrations/20260714070425_refresh_security_backend_contract.sql`, and deploy the revised Edge Functions only with rotated credentials. Then run the privileged backend contract and strict operations checks; the expected deployed contract is `2026-07-14.1` with 26 functions.
3. Approve authoritative GPS evidence for pharmacies. Current verified/dispatch-ready coverage remains 0 / 769; live top-20-within-10-km dispatch must remain closed.
4. Complete authorised WhatsApp coverage. Current known coverage is 267 pharmacies and 288 login-enabled WhatsApp contacts.
5. Complete the 51 duplicate-register review decisions and regenerate a complete hash-bound pharmacy-contact source manifest.
6. Obtain source-data reuse, regulatory, privacy/DPIA, prescription-retention, and marketplace-operations approval.
7. Authenticate the intended Cloudflare account, verify the `med250.rw` zone, configure protected environments/Turnstile, deploy a protected preview, and verify the deployed routes before DNS cutover.
8. Run controlled physical-phone UAT with designated customer and pharmacy identities: GPS consent, WhatsApp OTP delivery, dispatch, realtime confirmation, pharmacy selection, WhatsApp handoff, MoMo USSD, cancellation, expiry, and prescription access.

## Release decision

- **Repository / controlled preview:** pass.
- **Public marketplace ordering:** hold until every launch lock above is evidenced.
- **Security posture after local remediation:** all sealed findings addressed in code with regression coverage; live closure remains pending rotated-credential deployment and post-deploy verification.
