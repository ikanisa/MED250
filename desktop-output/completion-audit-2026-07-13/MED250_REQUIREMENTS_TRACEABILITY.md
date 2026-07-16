# MED+250 Completion Audit and Requirements Traceability

Date: 2026-07-13  
Repository: `/Volumes/PRO-G40/MED250`  
Product model: product-first Rwanda pharmacy marketplace; customers see pharmacies only after a complete pharmacy confirmation.

## Outcome

The corrected marketplace model is implemented across the storefront, basket, private dispatch contract, responder selection, pharmacy WhatsApp access, Supabase data boundary, SEO surfaces, and Cloudflare preview package. The final implementation pass added two missing source-backed product fields—manufacturer and Rwanda FDA registration—and changed pharmacy confirmations so the pharmacy explicitly confirms `pickup`, `delivery`, or `either`.

Software requirement coverage: **27 complete, 1 controlled physical-device gate**.  
Preview release gate: **passed**.  
Public ordering: **deliberately disabled** until the operational launch gates in this report are closed.

## Current flow

1. Search or browse source-backed products.
2. Open a dedicated product page or add directly to one order basket.
3. Keep shopping, then review the basket.
4. Press one `Place order` action; location is requested only then.
5. The backend privately dispatches to at most 20 eligible pharmacies within 10 km.
6. The customer sees only pharmacies that confirm the complete order.
7. Confirmations are ranked by distance, then total price.
8. The customer chooses one pharmacy; only then are WhatsApp and MoMo handoffs exposed.

## Corrected 28-point roadmap

| # | Requirement | State | Current evidence |
| ---: | --- | --- | --- |
| 1 | Catalogue quality checks | Complete | `data:quality` passes for 2,480 source rows; 2,459 are active/orderable. Sparse categories and source duplicates stay visible as governed warnings. |
| 2 | Useful zero-result recovery | Complete | Empty state explains recovery and provides Reset. |
| 3 | Rank exact name, ingredient, brand/generic, strength, form and pack | Complete | Server-ranked Supabase search plus deterministic preview scorer. |
| 4 | Typo and multilingual aliases | Complete | English, French and Kinyarwanda aliases and trigram recovery; live `umutwe` evidence captured. |
| 5 | Responsive grid/list and incremental loading | Complete | Grid/list control and bounded page loading. |
| 6 | Dedicated product details | Complete | Dynamic product routes show brand, generic, strength, form, pack, manufacturer, country, Rwanda FDA registration, prescription classification, price state and Add to order. |
| 7 | Governed imagery | Controlled complete | Category and fallback assets are real optimized WebP files. No unsupported product photograph is fabricated. |
| 8 | Aggregate price ranges without pharmacy identity | Complete | Catalogue exposes only contributed aggregate ranges; current live state honestly says price is confirmed after ordering because there are zero current contributors. |
| 9 | Single, isolated Supabase auth clients | Complete | Anonymous customer and persistent pharmacy identities use isolated storage without the historical duplicate-client warning. |
| 10 | Continuous shopping flow | Complete | Add to order and keep shopping. |
| 11 | Basket as the only pre-order review | Complete | Quantity, substitute consent, optional WhatsApp, fulfilment preference, conditional prescription and one primary action. |
| 12 | One `Place order` action | Complete | No checkout wizard or payment stage. |
| 13 | Native location at order time | Complete | Geolocation is requested only when placing the order; coordinates are an explicit recovery fallback. |
| 14 | Conditional prescription | Complete | Attachment appears only when a basket contains a prescription-classified product. |
| 15 | Optional remembered WhatsApp | Complete | Concise Rwanda-number input is stored to and restored from the customer profile. |
| 16 | No multi-stage checkout | Complete | No staged basket/location/prescription/offers/payment funnel. |
| 17 | Explicit order-sent state | Complete | `Order sent to nearby pharmacies` with order reference and waiting state. |
| 18 | Hide non-responders | Complete | No public pharmacy directory; the customer RPC returns complete submitted/selected confirmations only. |
| 19 | Live confirmation updates | Complete | Order-scoped Supabase Realtime refreshes confirmed offers. |
| 20 | Rank confirmed pharmacies by distance | Complete | Confirmed-offer RPC orders by distance, then total, time and stable ID. |
| 21 | Complete confirmation information | Complete | Name, approximate distance, complete items, substitutions, item prices, total, readiness and the pharmacy-confirmed fulfilment method. |
| 22 | Waiting, no-response, expired and cancelled states | Complete | Each has distinct copy and a safe recovery action. |
| 23 | Select one confirmed pharmacy | Complete | Selection is atomic and closes competing responses. |
| 24 | WhatsApp after selection | Complete | Only the selected pharmacy contact is released. |
| 25 | MoMo phone launcher | Complete | Selected pharmacy code plus `tel:*182%23`; no platform payment custody. |
| 26 | No payment-processing stack | Complete | No gateway, receipts, reconciliation, refunds or failure-recovery engine. |
| 27 | No public pharmacy profiles, badges, ratings or promotions | Complete | `/pharmacies` redirects to the private portal and directory grants remain revoked. |
| 28 | Complete mobile journey | Browser complete; phone gate | Responsive browser journey is implemented. Real GPS permission, WhatsApp handoff and MoMo USSD still require controlled physical-phone UAT. |

## Evidence captured in this pass

- [`01-home.png`](screenshots/01-home.png): product-first marketplace home.
- [`02-semantic-search.png`](screenshots/02-semantic-search.png): multilingual semantic search with explained related-term matches.
- [`03-product-detail.png`](screenshots/03-product-detail.png): structured product page with manufacturer and registration data.
- [`04-order-basket.png`](screenshots/04-order-basket.png): single-stage order basket.
- [`05-pharmacy-whatsapp-login.png`](screenshots/05-pharmacy-whatsapp-login.png): registered-WhatsApp-only pharmacy access.
- [`06-unregistered-whatsapp-recovery.png`](screenshots/06-unregistered-whatsapp-recovery.png): unknown-number recovery linked to the administrator.

The authenticated pharmacy workspace and real confirmed-pharmacy screen were not visually captured because no designated production pharmacy identity was used and no real pharmacy has an approved GPS record. Those flows are covered by implementation tests, database contracts and earlier rollback-only lifecycle UAT, not by a simulated production screenshot.

## Verification

- `npm run release:check`: pass.
- Lint: pass, zero warnings.
- Tests: **74 / 74 pass**.
- Catalogue validation: 2,480 source rows; 2,459 active/orderable.
- Performance budget: pass; 554,953 B JavaScript, 86,760 B CSS, 218,853 B marketplace JavaScript, 73,183 B initial visual assets.
- Cloudflare: strict Wrangler dry run passes; 3,171.94 KiB upload, 624.96 KiB gzip.
- Production Cloudflare artifact: 3 / 3 live-build checks pass; explicit `--env production` dry run passes at 3,190.57 KiB upload and 629.01 KiB gzip. Local and GitHub production deploy commands are regression-tested to select the production environment.
- Cloudflare account: Wrangler 4.110.0 is installed but this machine is not authenticated, so zone, Worker, route, protected-variable and deployed-preview state remain external verification gates.
- Rendered browser UAT: clean desktop 1440 x 900 and mobile 390 x 844 sessions passed page identity, meaningful-content, overlay, console, responsive overflow, structural accessibility and interaction checks. Verified Kinyarwanda search, reversible basket increment/restoration, preview no-data submission guard, invalid-coordinate handling, invalid WhatsApp handling, mobile navigation and modal focus/Escape behavior. Native GPS permission and real OTP/order delivery were deliberately not triggered.
- Supabase migrations: live `add_offer_fulfilment_method`, contract refresh, and centralized marketplace dispatch eligibility applied successfully.
- Dispatch eligibility: all 11 order-routing, response, confirmation, selected-contact and prescription-access paths use one private invariant; zero paths still gate on `online_license_verified`.
- Marketplace model: all 769 active pharmacies remain marketplace-approved. The three-source-record online-premises attribute is informational only; it is not an approval, routing or fulfilment badge.
- Live backend contract: version `2026-07-13.7`, **24 / 24 functions**, **19 / 19 tables**, zero missing or unexpected authenticated privileged functions.
- New responder RPC: authenticated execute allowed; anonymous execute denied; obsolete public signature removed.
- Rollback-only live lifecycle UAT: pass with automatic retail-pharmacy approval, pre-contact fail-closed eligibility, reviewed GPS plus verified WhatsApp readiness, two-recipient dispatch, idempotent retry, membership isolation, two-pharmacy price contribution, excessive-range rejection, customer cancellation, stale no-response replacement, 24-hour selected-order recovery, complete confirmation, pre-selection privacy, customer ownership, selection/contact release, completion and notification lifecycle.
- The UAT exposed and repaired the live `dawanear_contribute_price` conflict-target ambiguity. The clean-install and deployed function now use the named pharmacy/product unique constraint; authenticated execution remains allowed while `PUBLIC` and `anon` remain denied.
- Independent post-rollback verification: zero synthetic pharmacies, contacts, users, prices, orders, offers or notifications persisted.
- Supabase advisors: no new migration-specific error. MED+250 information/warnings remain the deliberate owner/member RLS, deny-by-default tables, anonymous-customer model, public catalogue, and allowlisted workflow RPCs. Reference: <https://supabase.com/docs/guides/database/database-linter>.

## Live operational state

| Measure | Current |
| --- | ---: |
| Active/orderable products | 2,459 |
| Pharmacies | 769 |
| Marketplace-approved pharmacies | 769 |
| Pharmacies with WhatsApp | 267 |
| Login-enabled WhatsApp contacts | 288 |
| Pharmacies contact/licence-ready before GPS | 267 |
| GPS-ready pharmacies | 0 |
| Dispatch-ready pharmacies | 0 |
| Products with current contributed prices | 0 |
| Price-contributing pharmacies | 0 |

## Remaining launch locks

1. Approve authoritative pharmacy GPS points; do not infer or publish unverified coordinates.
2. Enrich and authorise pharmacy WhatsApp coverage beyond the current 267 contact-ready pharmacies.
3. Complete the 51 named-reviewer source-duplicate decisions.
4. Obtain regulatory, privacy, source-data reuse and marketplace-operations approvals.
5. Approve the prescription-retention schedule before enabling cleanup automation.
6. Rotate the Supabase service credential, database password and personal access token previously exposed in chat.
7. Configure the Cloudflare account, custom domain, DNS, Turnstile production secret and protected deployment environments.
8. Run designated customer/pharmacy UAT on physical phones: GPS consent, OTP delivery, dispatch, confirmation, selection, WhatsApp, MoMo USSD, expiry, cancellation and prescription access.

## Evidence limits

- No real customer order was dispatched in this pass.
- No real pharmacy received a WhatsApp OTP or confirmation request.
- No physical-device GPS, WhatsApp or USSD handoff was executed.
- No Cloudflare production deployment or DNS change was made.
- Accessibility evidence is implementation and browser evidence, not a formal WCAG conformance statement.
- Product-specific pack photographs remain unavailable where the governed source contains none.
