begin;

-- Operations monitoring must measure the same centralized indicative-price
-- model exposed by the catalogue. Historical pharmacy-price rows are not a
-- MED+250 price-coverage signal and must never drive launch health.
do $rewrite_operational_price_health$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure(
    'public.dawanear_operational_health()'
  );
  v_definition text;
  v_rewritten text;
begin
  if v_procedure is null then
    raise exception 'Operational health function is missing' using errcode = 'P0002';
  end if;

  select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
  v_rewritten := replace(
    v_definition,
    'count(distinct price.product_id) filter (where price.is_current) as products_with_current_prices',
    'count(*) filter (where product.indicative_price_rwf is not null) as products_with_central_indicative_prices'
  );
  v_rewritten := replace(
    v_rewritten,
    'count(distinct price.pharmacy_id) filter (where price.is_current) as price_contributing_pharmacies',
    '0::bigint as pharmacy_specific_price_records_in_use'
  );
  v_rewritten := replace(
    v_rewritten,
    'max(price.observed_at) filter (where price.is_current) as latest_price_observed_at',
    'max(product.indicative_price_updated_at) filter (where product.indicative_price_rwf is not null) as latest_indicative_price_updated_at'
  );
  v_rewritten := replace(
    v_rewritten,
    'from public.dawanear_pharmacy_prices as price',
    'from public.dawanear_products as product'
  );
  v_rewritten := replace(
    v_rewritten,
    '''products_with_current_prices'', pricing.products_with_current_prices',
    '''products_with_central_indicative_prices'', pricing.products_with_central_indicative_prices'
  );
  v_rewritten := replace(
    v_rewritten,
    '''price_contributing_pharmacies'', pricing.price_contributing_pharmacies',
    '''pharmacy_specific_price_records_in_use'', pricing.pharmacy_specific_price_records_in_use'
  );
  v_rewritten := replace(
    v_rewritten,
    '''latest_price_observed_at'', pricing.latest_price_observed_at',
    '''latest_indicative_price_updated_at'', pricing.latest_indicative_price_updated_at'
  );

  if v_rewritten = v_definition
     or v_rewritten like '%products_with_current_prices%'
     or v_rewritten like '%price_contributing_pharmacies%'
     or v_rewritten like '%latest_price_observed_at%'
     or v_rewritten like '%from public.dawanear_pharmacy_prices as price%' then
    raise exception 'Operational central-price health rewrite was incomplete'
      using errcode = 'P0002';
  end if;

  execute v_rewritten;
end;
$rewrite_operational_price_health$;

comment on function public.dawanear_operational_health() is
  'Service-only aggregate health snapshot. Catalogue price coverage measures central indicative product prices and never pharmacy-specific price or stock records.';

commit;
-- Filename aligned with the migration version recorded by the production project.
