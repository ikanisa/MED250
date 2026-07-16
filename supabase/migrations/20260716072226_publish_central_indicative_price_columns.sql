-- Allow the existing RLS-protected public catalogue views to read the new
-- central indicative-price columns. The base product table remains protected
-- by dawanear_products_public_select (is_active), and no pharmacy price or
-- stock columns are exposed by this grant.

grant select (
  indicative_price_rwf,
  indicative_price_basis,
  indicative_price_source_url,
  indicative_price_updated_at
) on table public.dawanear_products to anon, authenticated;

comment on column public.dawanear_products.indicative_price_rwf is
  'Central informational From RWF price; indicative only and never a pharmacy-specific or final price.';
-- Filename aligned with the migration version recorded by the production project.
