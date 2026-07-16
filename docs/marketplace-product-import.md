# MED+250 Amazon-first product catalogue

MED+250 keeps the 2,200 Amazon-first consumer-product candidates separate from the 2,480-row Rwanda FDA medicine register. The database retains its pre-existing `dawanear_*` namespace strictly as an internal compatibility layer; it is not a marketplace or customer-facing brand.

## Dataset and validation

- Source dataset: `outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json`
- Expected import: 2,200 unique ASINs
- Required taxonomy coverage: 25 department/subcategory pairs, at least 80 products each
- Validation: `npm run data:validate-marketplace-products`

## Repeatable import

Run the importer only in a trusted server/admin environment. Supply a Supabase secret key through a process environment variable; never put it in browser code or a `NEXT_PUBLIC_` variable.

```sh
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_SECRET_KEY=... \
npm run data:import-marketplace-products
```

The import is idempotent by `id` and validates uniqueness, Amazon identities, fail-closed status, and taxonomy coverage before writing.

## Publication workflow

Imported rows start as `research_candidate`, `is_active=false`, `is_orderable=false`, and `seller_verification_required=true`. A product becomes public only when all of these are true:

- `publication_status='approved'`
- `seller_verification_required=false`
- `compliance_status='approved'`
- `is_active=true`
- `is_orderable=true`

The database constraint and RLS policy enforce this boundary. An approval trigger projects the product into the existing order-product table so current order, price, offer, and foreign-key workflows continue to work. Removing approval disables that projection.

The public storefront uses a security-invoker combined catalogue and search surface. Unpublished research rows are never returned.

## Controlled product review

Use the service-only reviewer from a trusted operator terminal. Inspect immediately before every decision and copy the returned `updated_at`; stale decisions are rejected.

Set `MED250_ADMIN_TOKEN` only in the trusted operator process. Never place it in a browser variable or commit its value.

```sh
npm run ops:marketplace-products -- inspect --product-id AMZ-B004L5JCZ4
npm run ops:marketplace-products -- start-review --product-id AMZ-B004L5JCZ4 --expected-updated-at ... --reviewed-by "Operator name" --evidence-note "Initial seller review opened after checking the source record."
npm run ops:marketplace-products -- compliance-review --product-id AMZ-B004L5JCZ4 --expected-updated-at ... --reviewed-by "Operator name" --evidence-note "Seller identity and Rwanda fulfilment evidence verified." --seller-evidence-url https://...
npm run ops:marketplace-products -- approve --product-id AMZ-B004L5JCZ4 --expected-updated-at ... --reviewed-by "Compliance reviewer" --evidence-note "Final product classification and seller evidence approved." --seller-evidence-url https://... --compliance-evidence-url https://...
```

Each command changes exactly one product. Decisions are recorded in an immutable audit table. Batch approval is intentionally unavailable. Use `reject` for a failed review and `unpublish` to remove a previously approved product from search and ordering immediately.
