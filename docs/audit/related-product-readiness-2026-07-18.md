# MED+250 related-product safety report

Report date: 2026-07-18  
Source snapshot: 2026-07-15  
Status: **local recommendation policy implemented; live and governed-content acceptance pending**

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

Two approved source rows were discovered to be books rather than pharmacy products: `AMZ-032380909X` and `AMZ-B01K1S6AHM`. Both are now recorded in the catalogue-quality override registry, fail closed in recommendation seeding/candidate selection, are absent from the generated sitemap, and are retired by migration `20260718080000_retire_non_product_catalogue_records.sql`. Applying and verifying that migration in production remains a release action.

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

The serial full-suite run passed 209/209 tests. The targeted production-mode run passed 17/17 tests across recommendation policy, governed catalogue exclusions, server metadata, sitemap/robots, and marketplace data contracts. Both preview and production bundles built successfully. The default suite is intentionally serialized because concurrent test files share the generated `dist` Worker; parallel execution could delete or replace that artifact while rendered-route tests were still importing it.

## Remaining closure

1. Apply and verify the governed live-catalogue correction for the two book records; do not infer production removal from the local migration and sitemap.
2. Capture controlled browser evidence for representative medicine and consumer pages, empty fail-closed rails, Back navigation, and required breakpoints.
3. Obtain product/data-owner approval of the medicine equivalence boundary and consumer taxonomy policy.
4. Reconcile the deployed recommendation population with the approved live catalogue and attach the deployed revision identifier.
