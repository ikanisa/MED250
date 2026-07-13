# MED250 Design QA

Date: 2026-07-13

## Comparison basis

- Source design: `design/reference/med250-amazon-home-selected.png`
- Live desktop implementation: `design/qa/med250-amazon-home-implementation-desktop.png`
- Full-page implementation: `design/qa/med250-amazon-home-implementation-full-page.png`
- Marketplace focus: `design/qa/med250-amazon-home-marketplace-focus.png`
- Mobile implementation: `design/qa/med250-amazon-home-implementation-mobile.png`

## Viewports and states

- Desktop comparison: 1440 × 1024, home page at the top, catalogue loaded from the current Rwanda FDA source snapshot.
- Desktop full view: 1440 px wide, full-page capture.
- Focused evidence: 1440 × 1024 with the frequently requested product rail and licensed-pharmacy directory in view.
- Mobile: 390 × 844, home page at the top. The document measured 375 px wide inside the 390 px browser viewport and had no horizontal page overflow.

## Findings

- The final implementation matches the selected direction's marketplace hierarchy: dark two-tier commerce header, dominant department search, trust notices, pastel product-led hero, four department cards, and a horizontal product rail.
- MED250's supplied four-colour mark and palette are consistently applied without copying Amazon trademarks, logos, or proprietary product artwork.
- Real generated raster assets are used for the hero, departments, and catalogue packs; there are no placeholder boxes, emoji assets, or CSS-drawn product art.
- Product cards were tightened to two-line names and compact request actions so the first catalogue row remains legible in the initial desktop viewport.
- The mobile header, notices, hero, product art, and primary CTA remain readable at 390 px. No horizontal document overflow was detected.
- Search filtering, adding a product, opening the request basket, closing the basket, and opening verified pharmacy staff sign-in were exercised successfully.
- Production build, lint, and six automated tests pass. The browser reported no page errors; the only warning observed was the development hot-reload Supabase client duplication warning.

## Iteration history

1. Converted the earlier editorial layout into the selected Amazon-familiar marketplace direction.
2. Added a two-tier header, department navigation, commerce notices, department cards, and a horizontal product rail.
3. Replaced temporary visual treatments with generated MED250 product and category assets.
4. Reduced hero density and catalogue-card height after the first desktop comparison.
5. Hid the secondary filter row, clamped long regulatory product names, and compressed request actions after the second comparison.
6. Validated desktop and mobile layouts and the core customer and pharmacy entry flows.

## Severity check

- P0 blockers: none.
- P1 major visual or interaction mismatches: none.
- P2 material polish issues: none.
- P3 non-blocking difference: generated catalogue packs are intentionally generic and regulator-safe rather than copies of branded product packaging shown in the concept image.

final result: passed
