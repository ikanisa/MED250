# MED+250 technical SEO readiness report

Report date: 2026-07-18  
Status: **local technical population corrected; live Search Console acceptance pending**

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

1. Verify the canonical production origin exposes 4,665 sitemap URLs and matching canonical hosts.
2. Retire the public Sites origin or replace its stale release with a current catalog-only build. `npm run sites:verify:catalog` must pass, and customer ordering must remain disabled there.
3. Confirm Google Search Console ownership and submit the canonical production `/sitemap.xml` only.
4. Run URL Inspection for the homepage, every department, one medicine, one priced consumer product, and one unpriced consumer product.
5. Record sitemap acceptance, crawl/indexing exclusions, canonical decisions, impressions, clicks, and zero-result searches on a dated cadence.
6. Keep Goal 2 open until Search Console evidence shows no systemic crawl or canonical failure; a `site:` query alone is insufficient.

The canonical custom domain is the sole live ordering origin. The Sites hostname is a secondary catalogue surface and cannot satisfy live deployment evidence. The currently published Sites version predates the active remediation work and fails the catalog verifier, so it must not be treated as current or release-ready.
