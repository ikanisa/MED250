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

## Empty-data surface rule

- When price, stock, availability, or another optional catalogue value is absent, the value area remains visually blank.
- Do not render placeholder labels, explanatory copy, “confirm on WhatsApp” text, “not published” text, or invented values for missing data.
- Preserve the surrounding card anatomy and the request action; blank data must not be communicated as a value or a status.
- This rule applies across catalogue cards, product detail views, request summaries, pharmacy surfaces, loading states, and future designs.

## Product request action rule

- Every catalogue-card commerce action uses the established basket icon without a redundant visible label.
- The accessible name is “Add [product] to request”; the product-detail action shows “Add to request”.
- The action remains right-aligned when price data is blank, and adding an item immediately opens the request basket with clear added-item feedback.
- Customer-facing copy consistently describes an availability request and never implies checkout, payment, or a completed purchase.

## Product-name integrity rule

- Catalogue cards and product pages display the complete source-backed product name.
- A quantity, year, pack size, dosage, category, subcategory, retailer, or extracted brand token must never be used as the product title.
- Consumer catalogue rows use `product_name`; regulated medicines continue to use their registered brand name.
- Products without a meaningful customer-facing name are blocked during import instead of being published with invented or incomplete titles.
- Exact duplicate normalized titles collapse to one catalogue product; variant ASINs may coexist only when their canonical titles identify a meaningful size, scent, bundle, colour, or configuration difference.
- Consumer taxonomy stays in category, subcategory, and product-type fields. It is never copied into medicine-only generic-name or dosage-form slots, and repeated taxonomy labels are suppressed on cards.
- Books, occupational gifts, unrelated search noise, adult-only products incorrectly returned for child care, and unresolved one- or two-word source labels are not publishable.

## Adaptive layout rule

- Every design element, asset, layout, and interactive component must adapt to its content, container, viewport, zoom level, and available input mode.
- Content determines component height. Do not reserve empty grid or flex tracks, fixed viewport-filling sections, or placeholder space after optional content disappears.
- Prefer `clamp()`, `minmax()`, `fr`, percentages, logical properties, intrinsic sizing, flexible wrapping, aspect ratios, and container or viewport queries over hardcoded dimensions and breakpoint-only logic.
- Fixed dimensions are permitted only for true invariants such as minimum accessible pointer targets, icon geometry, borders, and source-backed media aspect ratios. They must not force page overflow or unused visual space.
- Typography must respond to both viewport size and content length. Images must preserve their intrinsic proportions and fit without distortion, clipping, or layout shift.
- New and changed interfaces must be checked at minimum at 320 px, 390 px, 768 px, 1024 px, and 1440 px widths, with browser zoom and long-content states included when relevant.
- A change that works at one captured viewport but creates overflow, clipping, excessive whitespace, or unreadable density at another viewport does not pass design QA.

final result: passed
