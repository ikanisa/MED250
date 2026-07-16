# MED+250 Amazon-first product catalogue

MED+250 keeps the 2,200 Amazon-first consumer products separate from the 2,480-row Rwanda FDA medicine register. Both feed one central customer catalogue. The database retains its pre-existing `dawanear_*` namespace strictly as an internal compatibility layer; it is not a marketplace or customer-facing brand.

All products, including medicines and Amazon-first consumer products, belong to one central catalogue. Product records never own a pharmacy identity. The central product record may carry a non-final indicative “From RWF” price. MED+250 does not publish pharmacy-specific price lists or stock. Pharmacies privately confirm availability for a customer request and may optionally include a non-final estimate before continuing on WhatsApp.

## Dataset and validation

- Source dataset: `outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json`
- Expected import: 2,200 unique ASINs
- Required taxonomy coverage: all 25 department/subcategory pairs, with at least 50 quality-screened products in each pair
- Canonical-title audit: incomplete Amazon search labels are repaired from product metadata, exact duplicate titles are collapsed, and irrelevant search noise is excluded through `data/imports/amazon-product-quality-overrides-2026-07-16.json`
- Validation: `npm run data:validate-marketplace-products`

## Repeatable import

Run the importer only in a trusted server/admin environment. Supply a Supabase secret key through a process environment variable; never put it in browser code or a `NEXT_PUBLIC_` variable.

```sh
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_SECRET_KEY=... \
npm run data:import-marketplace-products
```

The import is idempotent by `id` and validates unique ASINs, unique normalized customer-facing titles, Amazon identities, central-catalogue activation and taxonomy coverage before writing. Titles shorter than three words, pack-only labels, category labels, rejected audit records and duplicate canonical product names fail closed.

## Publication workflow

Activated rows use the central catalogue state:

- `publication_status='approved'`
- `is_active=true`
- `is_orderable=true`

The database constraint and RLS policy enforce this boundary. A projection trigger copies active central products into the existing request-product table so the private availability-confirmation and foreign-key workflows continue to work. Removing publication disables that projection.

The public storefront uses a security-invoker combined catalogue and search surface. Unpublished research rows are never returned.

## Controlled product review

Use the service-only reviewer from a trusted operator terminal. Inspect immediately before every decision and copy the returned `updated_at`; stale decisions are rejected.

Set `MED250_ADMIN_TOKEN` only in the trusted operator process. Never place it in a browser variable or commit its value.

```sh
npm run ops:marketplace-products -- inspect --product-id AMZ-B004L5JCZ4
npm run ops:marketplace-products -- start-review --product-id AMZ-B004L5JCZ4 --expected-updated-at ... --reviewed-by "Operator name" --evidence-note "Catalogue identity review opened after checking the central source record."
npm run ops:marketplace-products -- approve --product-id AMZ-B004L5JCZ4 --expected-updated-at ... --reviewed-by "Catalogue operator" --evidence-note "Central product identity and pharmacy fulfilment model confirmed."
```

Each command changes exactly one central product. Decisions are recorded in an immutable audit table. Use `reject` for a failed catalogue review and `unpublish` to remove a product from search and availability requests immediately. Pharmacy participation is governed separately by pharmacy identity, membership, contact, location, and private request-confirmation records; it does not create public stock or pharmacy-specific catalogue prices.
