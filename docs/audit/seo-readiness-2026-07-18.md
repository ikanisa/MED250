# MED+250 technical SEO readiness report

Report date: 2026-07-18  
Status: **technical population and catalog-only secondary release verified; live Search Console acceptance pending**

## Sitemap population

| Population | URLs |
| --- | ---: |
| Requestable medicines | 2,459 |
| Approved active consumer products after governed exclusions | 2,198 |
| Total product URLs | 4,657 |
| Canonical public static routes | 8 |
| Expected live sitemap total | 4,665 |

The prior sitemap used only the medicine SEO index and omitted the consumer catalogue. The sitemap now consumes the compact, source-dated `data/product-sitemap-index.json`. Its generator rejects noncanonical IDs, duplicate IDs, invalid dates, and any population other than the current 4,657 publishable products. Two source rows identified as books rather than pharmacy products are excluded through the governed quality override and retirement migration.

The medicine population excludes 21 `grace_period` records that are not currently requestable. Consumer inclusion requires `publication_status=approved`, `is_active=true`, and `is_orderable=true`.

Reproduce the product population with:

```sh
npm run seo:generate-sitemap
node --test tests/product-sitemap-index.test.mjs
```

## Crawl and canonical controls

- Preview and default development modes return no sitemap URLs, disallow crawling, and use `X-Robots-Tag: noindex, nofollow`.
- Catalogue/live modes allow canonical public routes while excluding `/pharmacies` and the pharmacy-portal query flow.
- Product routes emit canonical metadata, Product JSON-LD, Breadcrumb JSON-LD, Open Graph metadata, and X card metadata.
- The deployment verifier now requires representative medicine and consumer-product routes and rejects live sitemaps below 4,600 URLs or without either product population.
- Privacy, terms, category, department, homepage, and product URLs are canonical; request, modal, pharmacy portal, API, preview, and query-state URLs are not added to the sitemap.

## Remaining live owner evidence

1. Confirm Google Search Console ownership and submit the canonical production `/sitemap.xml` only.
2. Run URL Inspection for the homepage, every department, one medicine, one priced consumer product, and one unpriced consumer product.
3. Record sitemap acceptance, crawl/indexing exclusions, canonical decisions, impressions, clicks, and zero-result searches on a dated cadence.
4. Keep Goal 2 open until Search Console evidence shows no systemic crawl or canonical failure; a `site:` query alone is insufficient.

The canonical custom domain is the sole live ordering origin. The Sites hostname is a secondary catalogue surface and cannot satisfy live deployment evidence. Sites version 13 was published from source revision `5ef50a296941056bd17e614dff7b35290742f50a` on 2026-07-18 and the body-free [10-route catalogue verification receipt](live-baseline-2026-07-18/16-sites-catalog-verification-5ef50a.json) passes with ordering disabled and all 4,665 sitemap URLs present.
