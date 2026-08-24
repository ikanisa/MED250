# MED+250 related-product safety report

Report date: 2026-07-18  
Source snapshot: 2026-07-15  
Status: **exact-release recommendation population reconciled; accountable acceptance pending**

## Population and source control

| Measure | Evidence |
| --- | ---: |
| Traceable requestable source records indexed | 4,659 |
| Medicine records | 2,459 |
| Consumer-product records | 2,200 |
| Duplicate IDs | 0 |
| Known non-product exceptions suppressed | 2 |
| Publishable recommendation population | 4,657 |

The previous recommendation implementation consumed only the 2,480-row medicine SEO snapshot. Consumer-product pages therefore had no complete source-backed recommendation population. The new compact index is regenerated from the corrected catalogue snapshot and contains every currently requestable medicine and consumer record.

Two approved source rows were discovered to be books rather than pharmacy products: `AMZ-032380909X` and `AMZ-B01K1S6AHM`. Both are recorded in the catalogue-quality override registry, fail closed in recommendation seeding/candidate selection, are absent from the generated sitemap, and are retired by migration `20260718080000_retire_non_product_catalogue_records.sql`. The passing production catalogue receipt now confirms both IDs are absent from the public 4,657-product population.

The source-bound [live recommendation receipt](live-baseline-2026-07-18/18-live-related-products-5ef50a.json) independently fetches all 39 production catalogue pages and binds them to release `5ef50a296941056bd17e614dff7b35290742f50a`. It proves that all 4,657 live IDs equal the recommendable index population. The production selector evaluated every seed and 17,690 edges: 106 medicine edges and 17,584 consumer edges, with zero unsafe edges, duplicate candidates, missing live products, or unexpected live products.

## Conservative matching policy

- Recommendations never cross the medicine/consumer boundary.
- A consumer-product candidate must share the governed category and subcategory and must not duplicate the source title.
- A medicine candidate must have the same normalized recorded ingredient, dosage form, dose evidence, and compatible prescription status. If the evidence is incomplete, the rail is empty.
- Non-requestable and explicitly suppressed records are excluded.
- Manufacturer, pack size, and product type affect ordering only after a candidate passes the safety filter.
- The interface labels the rail as catalogue similarity and states that it is not medical advice or a treatment recommendation.

## Automated evidence

`npm test`  
`npm run build:production && node --test tests/production-build.check.mjs tests/product-sitemap-index.test.mjs tests/product-related.test.mjs tests/marketplace-products.test.mjs`

The refreshed serial full-suite run passed 304/304 tests, including the exact-release live recommendation verifier and its source-drift test. The default suite is intentionally serialized because concurrent test files share the generated `dist` Worker; parallel execution could delete or replace that artifact while rendered-route tests were still importing it.

## Remaining closure

1. Obtain product/data-owner approval of the medicine equivalence boundary and consumer taxonomy policy.
2. Obtain independent QA approval for the completed desktop and mobile browser scenarios covering representative medicine and consumer rails plus the empty fail-closed state.
3. Preserve the verified 4,657-product, 17,690-edge reconciliation and deployment binding to revision `5ef50a296941056bd17e614dff7b35290742f50a` through approval.
