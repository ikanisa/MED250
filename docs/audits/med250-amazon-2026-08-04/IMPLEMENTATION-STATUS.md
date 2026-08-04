# MED+250 Amazon-comparison implementation status

Date: 2026-08-04
Scope: first P0/P1 implementation slice and production-safe Supabase verification
Production origin: `https://med-250.com/`
Supabase project: `uskfnszcdqpcfrhjxitl`

## Implemented locally

- Search, category, filter, sort, and view intent now collapse landing-page storytelling so results begin directly below global navigation.
- The request basket explains the one-to-up-to-ten pharmacy dispatch, optional verified-WhatsApp alert, pharmacy confirmation step, and no-payment boundary at the point of action.
- The submitted state exposes recipient matching/count, WhatsApp qualification, responses received, expiry/no-recipient states, and the next action.
- Unverified or absent product imagery now renders an honest icon treatment; unrelated catalogue/category photography is no longer repeated as a product fallback.
- Customer offer subscriptions and pharmacy-request subscriptions expose connecting/connected/degraded state, refresh on focus/visibility/online recovery, and poll every 15 seconds when Realtime is unavailable.
- Realtime status emits privacy-safe, low-cardinality telemetry without order, product, pharmacy, location, prescription, or contact identifiers.
- WhatsApp delivery now uses bounded concurrency (default four, hard cap eight) and refuses unsupported WebP media headers. When image headers are enabled and no JPEG/PNG product image is available, the function uses the verified public MED+250 PNG brand asset.
- Pharmacy refresh tokens are no longer manually persisted or refreshed in `localStorage`; Supabase Auth owns rotation in tab-scoped `sessionStorage`, and local sign-out clears both the current and legacy storage locations.
- Cloudflare runtime configuration now uses request-scoped `AsyncLocalStorage`, Wrangler-generated production binding types, and 5% sampled tracing instead of mutable Worker-global state.

## Production-safe Supabase findings

Read-only Management API checks confirmed:

- project status `ACTIVE_HEALTHY`, PostgreSQL 17;
- migration `20260730143000_repair_offer_realtime_and_whatsapp_dispatch` is applied;
- migration `20260801160000_harden_private_trigger_privileges` is the latest repository migration applied;
- `dawanear_orders`, `dawanear_offers`, and `dawanear_pharmacy_notifications` are all present in the `supabase_realtime` publication;
- both repair triggers are installed;
- 345 pharmacies have a verified WhatsApp contact;
- the `med250-whatsapp-dispatch` cron job is active every minute;
- the WhatsApp dispatcher Edge Function was deployed as active version 4 with JWT gateway verification disabled only because the function enforces its private constant-time cron-token check.

The historical outbox contains 11 failed records: ten `pharmacy_request` and one `customer_offer`, all with Meta error `131053`. Every failed payload used a WebP first image. This is a production-confirmed root-cause correlation for the unsupported media-header path; it is not proof of a fresh successful delivery after the fix.

No historical failed message was replayed because all are stale. Replaying them would send misleading old request notifications to real recipients.

## Verification completed

- localization inventory: 618 messages, zero hardcoded and zero high-risk hardcoded messages;
- focused implementation suite: 64/64 passing;
- WhatsApp/Edge focused suite: 8/8 passing;
- targeted ESLint: passing;
- Vinext production build: passing;
- mobile browser QA: search intent removes the hero, displays 49 direct results, uses honest missing-image states, and records no runtime warning/error;
- request-basket browser QA: point-of-action request-model explanation is present.

## Still required before closure

- a controlled, current production synthetic request tied to one correlation ID, using coordinated test recipients so no real pharmacy receives misleading traffic;
- proof that the current Meta template accepts and delivers the PNG fallback header, followed by webhook delivery/read state;
- live customer/pharmacy browser evidence for Realtime connected and forced-degraded recovery states;
- aggregate queue-depth, retry-exhaustion, delivery-latency, and first-response alerts;
- release-bound redeployment of the final combined frontend/security slice and responsive/performance verification;
- independent physical-device UAT.
