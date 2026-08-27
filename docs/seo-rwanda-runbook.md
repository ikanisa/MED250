# Rwanda SEO measurement and publication runbook

## Search Console setup

1. Verify the production domain in Google Search Console. If an HTML meta token is used, set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` in the production build environment; never commit the token.
2. Submit `https://med-250.com/sitemap.xml` after the deployment is public.
3. Export a baseline for Page indexing, Search results queries and pages, device, country, Core Web Vitals, and Product snippets. Record the export date and filters.
4. Compare 28-day periods only after enough data has accrued. Segment product, category, trust, and medicine-intent landing pages.

## Funnel definitions

- `seo_landing`: one landing view classified by acquisition channel, page type, and device. No raw search query, referrer URL, product ID, phone number, or order ID is collected.
- `availability_request_verified`: the customer completed WhatsApp verification for an availability request.
- `pharmacy_confirmation_received`: at least one pharmacy response was loaded for the active request. Only an offer-count bucket is stored.
- Primary SEO conversion: verified availability requests divided by organic-search landings.
- Service conversion: pharmacy confirmations divided by verified availability requests.

## Quarterly content decisions

Classify pages using Search Console impressions, clicks, position, conversions, catalogue completeness, and operational evidence:

- Keep: useful demand and accurate, complete evidence.
- Improve: demand exists but metadata, internal links, or source-backed content is weak.
- Consolidate: duplicate intent or materially duplicate catalogue records; choose one canonical destination before redirecting.
- Noindex or remove: thin, unsupported, expired, or operationally misleading pages after an accountable review.

Never generate a district, pharmacy, or service-area landing page without verified coverage, partner consent, and a review date.

## Structured Product offer evidence

Indicative catalogue prices do not qualify as offers. `AggregateOffer` is emitted only when the product is requestable and the server provides a positive offer count, valid RWF minimum and maximum, and a verification timestamp no more than 24 hours old. The public catalogue currently returns zeroed verification fields, so offer schema remains fail-closed until a governed aggregation source is connected.

## Kinyarwanda pilot gate

The pilot routes are `/find-medicine`, `/about`, and `/trust`. `/rw` remains blocked until a qualified translation provider, governed glossary version, clinical reviewer, legal reviewer, review date, and complete runtime catalogue are recorded. Run `npm run localization:verify` before any locale-release change.

## Release checks

Run `npm run seo:quality`, `npm run localization:verify`, the application test suite, production build checks, and browser QA at desktop and mobile widths. After release, verify the sitemap, canonical tags, Product and Breadcrumb JSON-LD, the absence of unsupported Offer or review markup, and all new trust and intent routes.
