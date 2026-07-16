alter table public.dawanear_marketplace_products
  alter column observed_price_rwf type numeric(14,2)
  using observed_price_rwf::numeric(14,2);
