# Catalogue Image Representative and Photography Runbook

Date: 2026-08-24

## Scope

Use the live queue generated at `work/catalogue-media-acquisition/queue/`. Each row is an active MED+250 product that has no approved, rights-verified gallery in Cloudflare D1.

Acquisition priority:

1. Exact partner API or partner product page for consumer products.
2. Exact official manufacturer product page for medicines.
3. Exact marketing-authorization-holder or local technical representative pack assets.
4. Controlled physical photography when no exact digital asset is available.

Never substitute a generic-equivalent medicine, another strength, another dosage form, another pack size, or another regional formulation.

## Representative request packet

Send the applicable CSV rows with this request:

> MED+250 is completing the governed product gallery for the listed Rwanda-registered medicines. Please provide current photographs or official pack artwork for the exact registration, brand, generic, strength, dosage form, and pack size shown. For each product, provide front, back, and one side/detail view at a minimum of 1200 px on the shortest edge. Please confirm that MED+250 may store, resize, remove the background from, and display these images in its pharmacy catalogue. Do not send images for a different strength, dosage form, presentation, or market variant.

Required evidence:

- sender organization and representative name;
- request and response dates;
- product registration number;
- exact product/strength/form/pack confirmation;
- original files, not screenshots or social-media recompressions;
- written catalogue reuse authorization or reference to the governing partner agreement.

## Photography capture contract

For each exact physical SKU:

- photograph front, back, left/right side, top/bottom where informative, and one label/detail view;
- use a neutral white sweep, diffuse lighting, no hands, people, props, promotional overlays, or reflected personal data;
- retain the original file and EXIF timestamp;
- minimum 1600 px on the shortest edge;
- ensure brand, active ingredient, strength, dosage form, pack size, manufacturer, batch/expiry area, and registration marking are legible where printed;
- do not open sterile, sealed, prescription, or cold-chain packs solely to create imagery;
- associate files with the exact `product_id` and registration number from the queue.

## Ingestion and approval

1. Add received assets to a source manifest with source URL or representative evidence reference.
2. Run the MED+250 identity, OCR, resolution, artifact, and background-isolation gates.
3. Conduct visual review of the primary image for exact brand/strength/form/pack identity.
4. Retain the processed WebPs and source provenance under `work/catalogue-media-acquisition/`.
5. Build the checksum-bound Cloudflare bundle.
6. Record the pre-import D1 Time Travel bookmark.
7. Upload to private R2, read every object back, and compare SHA-256 and byte count.
8. Register only the exact product/position/hash/domain rights asset in D1, then approve the receipt-bound gallery.
9. Verify every public `/api/catalogue/media/{product_id}/{position}` route and recount the live missing queue.

Generated or generic medicine pack imagery is not eligible for catalogue publication.
