# MED250

MED250 is a privacy-first launch candidate for a Rwanda pharmacy request marketplace. A customer can build one product list, explicitly consent to location use, and receive itemised offers from at most 20 approved online-pharmacy partners within 10 km. Contact details, exact coordinates, and prescription files stay private until the customer selects an offer.

The inherited `dawanear_*` database names and `lib/dawanear-client.ts` filename are retained as legacy technical identifiers so the audited migration and client remain compatible. Customer-facing branding is MED250.

The application defaults to `NEXT_PUBLIC_MARKETPLACE_MODE=preview`. Preview mode is intentional: it never fabricates order success or live pharmacy responses and it does not send customer health data.

## Verified source pack

- 2,480 Rwanda FDA human-medicine register rows captured in July 2026: 2,430 valid, 29 expiring soon, and 21 grace-period rows. The import preserves six duplicate regulatory-number groups for review instead of treating registration numbers as unique.
- 766 licensed human retail pharmacy rows from the Rwanda FDA May 2026 register.
- 3 separately licensed online-pharmacy rows from the Rwanda FDA May 2026 register: AXENTT Limited, Kasha Rwanda Ltd, and Harakameds Ltd.
- Canonical product IDs `rwanda-fda-hm-0001` through `rwanda-fda-hm-2480`, retail registry keys `retail-2026-05-1` through `retail-2026-05-766`, and online registry keys `online-2026-05-1` through `online-2026-05-3`.

The public fallback CSVs contain only official register fields. Historical staff phone lists and stale Google Maps candidates are not published or imported. Products default to `prescription_status=unclassified` and `is_orderable=false` until an authorised classification and online-order approval process is completed.

The current imported product source is the human-medicine register only. The January 2026 Public Health Chemical Products Register has been identified but not imported; its 314 entries across 34 pages include medicated cosmetics and non-cosmetic chemicals, so it is not a cosmetics-only register. Cosmetics and other non-medicine products remain unimported pending a complete official snapshot plus written data-reuse and product-marketing clearance.

Rwanda FDA does not state an open-data reuse licence on the register pages. Written data-reuse permission and a supported refresh process are required before public republishing. Product cards therefore use neutral dosage-form icons unless an image has verified provenance; the app does not fabricate branded medicine packaging.

## Marketplace safeguards

- Supabase anonymous Auth for customers; permanent email identities and operator-approved memberships for pharmacy staff. Customer and pharmacy sessions use separate browser stores, and the pharmacy portal has an explicit sign-out path for shared devices.
- Atomic, idempotent order creation: a stable customer request UUID ensures retries return the same committed order while draft, line items, and location-based dispatch commit together. A database constraint permits only one active request per customer.
- PostGIS `ST_DWithin` and KNN ordering, capped at 10 km and 20 eligible pharmacies.
- Dispatch requires a current online licence, approved marketplace status, verified GPS coordinates, an active record, and an unexpired premises entry.
- Transactional offer submission and selection, with server-calculated totals and item/substitute validation.
- Private prescription Storage. Recipients see only a prescription-present flag; only the customer and selected pharmacy can read the file, and selected-pharmacy access expires 24 hours after selection. Signed links are capped by the remaining selection window. Substitutes must match non-empty generic, strength, dosage-form, and pack-size fields, and a prescription product cannot be introduced without an attached prescription.
- Definitively unused uploads can be deleted by the customer; ambiguous order retries keep and reuse the same upload. A prescription object name cannot be replaced while it is referenced or under cleanup: bucket-scoped restrictive policies compose safely with other project policies, prohibit client UPDATE/upsert, and make owner upload/delete policies share cleanup's path lock. The private `cleanup-prescriptions` Edge Function fairly paginates Storage using a service-only rotating cursor, removes unreferenced or abandoned files after 24 hours, automatically expires selected orders after 24 hours, and removes completed-order files after 30 days. Cleanup is grouped by object path: a service-only 15-minute database lease blocks new references, proves every referenced order is outside its retention window, and independently re-proves that an orphan has no committed references before Storage deletion. Eligible references are cleared together only after Storage confirms deletion; an expired-claim recovery pass retries interrupted work and removes claims that no longer have either an object or a reference. Each run reserves separate capacity for expired claims and newly due paths so persistent retry failures cannot starve new cleanup. Schedule it only after those periods are approved in the production privacy policy.
- Customers can complete or cancel a selected off-platform order and start another request. All recipient pharmacies receive a closure notification so stale requests stop appearing as actionable.
- Pharmacy price contributions are serialised and rejected when `maximum - minimum > minimum`.
- RLS on every exposed table, explicit Data API grants, and Realtime updates constrained by the same policies.
- No platform payment custody. A verified MoMo merchant code may be revealed after selection; automated payment needs a licensed PSP, signed callbacks, idempotency, receipts, cancellation, and refund handling.

## Activation sequence

MED250 is installed in Supabase project `uskfnszcdqpcfrhjxitl`. Its prefixed tables, views, functions, private prescription bucket, explicit grants, row-level policies, and Realtime publication entries are isolated from the pre-existing project data. The official source pack is imported, anonymous authentication is enabled, and the two administrative Edge Functions are deployed.

1. Add CAPTCHA/Turnstile and confirm suitable anonymous-sign-in rate limits. This is a project-wide Auth setting, so review every existing app before changing it.
2. Keep the site in connected preview mode while products and partners remain non-orderable.
3. Run `npm run data:validate` after every source refresh.
4. Import the validated source pack from a private environment:

   ```sh
   node scripts/import-data/load-supabase.mjs \
     --retail-pharmacies data/imports/rwanda-fda-retail-pharmacies-may-2026.csv \
     --online-pharmacies data/imports/rwanda-fda-online-pharmacies-may-2026.csv \
     --products data/imports/rwanda-fda-products-july-2026.csv
   ```

5. Apply only authorised product classifications through the controlled review workflow below. The source importer always resets products to `unclassified` and non-orderable, so reviews must be revalidated after each register refresh.
6. Verify pharmacy claims, current online licences, business WhatsApp/MoMo details, and precise premises coordinates. Only then set `marketplace_approved=true` and `geocode_status=verified` for participating records.
   Use the admin-token-protected `geocode-pharmacies` Edge Function to create candidates, then approve one premises at a time after manual review; it never infers WhatsApp from a public phone listing.
7. Rebuild with `NEXT_PUBLIC_MARKETPLACE_MODE=preview`; the connected preview reads live catalogue and directory data but does not send customer or health data.
8. Test customer, unrelated user, recipient-pharmacy staff, and selected-pharmacy access. Run Supabase security/performance advisors.
9. Keep the deployment private until written Rwanda FDA/RICA confirmation, data-reuse permission, privacy-controller/processor registration, a DPIA, any required outside-Rwanda transfer authorisation, and licensed PSP arrangements are complete.
10. Set `NEXT_PUBLIC_MARKETPLACE_MODE=live` only after every gate above is satisfied, then create and validate a new build before deployment.

The secret/service key and third-party API credentials must never be stored in the frontend or committed to the repository.

## Controlled product review

Copy `data/imports/product-orderability-review-template.csv` to a private review location. An authorised reviewer must complete exactly one canonical `product_id` or `registration_number` per row, classify it as `prescription`, `otc`, or `pharmacist_only`, set an explicit `is_orderable`, and provide their identity, a timezone-qualified `reviewed_at`, and a note. Do not commit completed review files.

Use the server-only service-role key for a read-only validation first:

```sh
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_SECRET_KEY=... \
npm run data:review-products -- --reviewed /private/product-review.csv
```

The script rejects missing review evidence, duplicate or ambiguous identifiers, inactive/non-medicine products, and expired or non-current registrations. Reviewed `otc` is stored as `non_prescription`; `pharmacist_only` remains distinct. The command is a dry run unless `--apply` is explicitly present. After checking the product list and SHA-256 digest, apply the same unchanged file:

```sh
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_SECRET_KEY=... \
npm run data:review-products -- --reviewed /private/product-review.csv --apply
```

Only `prescription_status` and `is_orderable` on matched `dawanear_products` rows are updated. Keep the completed review, digest, and command output in the controlled regulatory audit record.

## Validation

```sh
npm run data:validate
npm run lint
npm test
```

The frontend build and source-data validator run locally without a live backend. Database, RLS, Storage, Auth, geospatial dispatch, and Realtime integration tests require authorised access to the target Supabase project or an isolated test branch.
