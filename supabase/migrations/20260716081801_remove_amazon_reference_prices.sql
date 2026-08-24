begin;

-- Amazon remains a product and taxonomy reference, never a price source.
-- MED+250 retains only optional, directly observed Rwanda catalogue references.

drop trigger if exists dawanear_marketplace_indicative_price_sync
  on public.dawanear_marketplace_products;
drop trigger if exists dawanear_marketplace_products_price_sync
  on public.dawanear_marketplace_products;

alter table public.dawanear_products
  drop constraint if exists dawanear_products_indicative_price_metadata_check;

create or replace function dawanear_private.dawanear_sync_marketplace_indicative_price()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.dawanear_products as product
  set
    indicative_price_rwf = case
      when new.observed_price_rwf > 0
        and new.rwanda_product_url ~ '^https://'
        then pg_catalog.round(new.observed_price_rwf)::integer
      else null
    end,
    indicative_price_basis = case
      when new.observed_price_rwf > 0
        and new.rwanda_product_url ~ '^https://'
        then 'rwanda_observed_catalogue'
      else null
    end,
    indicative_price_source_url = case
      when new.observed_price_rwf > 0
        and new.rwanda_product_url ~ '^https://'
        then new.rwanda_product_url
      else null
    end,
    indicative_price_updated_at = case
      when new.observed_price_rwf > 0
        and new.rwanda_product_url ~ '^https://'
        then new.source_refreshed_at
      else null
    end,
    updated_at = now()
  where product.id = new.id;
  return new;
end;
$$;

update public.dawanear_products as product
set
  indicative_price_rwf = case
    when marketplace.observed_price_rwf > 0
      and marketplace.rwanda_product_url ~ '^https://'
      then pg_catalog.round(marketplace.observed_price_rwf)::integer
    else null
  end,
  indicative_price_basis = case
    when marketplace.observed_price_rwf > 0
      and marketplace.rwanda_product_url ~ '^https://'
      then 'rwanda_observed_catalogue'
    else null
  end,
  indicative_price_source_url = case
    when marketplace.observed_price_rwf > 0
      and marketplace.rwanda_product_url ~ '^https://'
      then marketplace.rwanda_product_url
    else null
  end,
  indicative_price_updated_at = case
    when marketplace.observed_price_rwf > 0
      and marketplace.rwanda_product_url ~ '^https://'
      then marketplace.source_refreshed_at
    else null
  end,
  updated_at = now()
from public.dawanear_marketplace_products as marketplace
where product.id = marketplace.id;

update public.dawanear_marketplace_products
set amazon_price_usd_observed = null,
    updated_at = now()
where amazon_price_usd_observed is not null;

alter table public.dawanear_marketplace_products
  drop constraint if exists dawanear_marketplace_products_no_amazon_price_check,
  add constraint dawanear_marketplace_products_no_amazon_price_check check (
    amazon_price_usd_observed is null
  );

alter table public.dawanear_products
  add constraint dawanear_products_indicative_price_metadata_check check (
    (
      indicative_price_rwf is null
      and indicative_price_basis is null
      and indicative_price_source_url is null
      and indicative_price_updated_at is null
    )
    or (
      indicative_price_rwf is not null
      and indicative_price_basis in (
        'rwanda_observed_catalogue',
        'central_manual'
      )
      and indicative_price_source_url ~ '^https://'
      and indicative_price_updated_at is not null
    )
  );

create trigger dawanear_marketplace_products_price_sync
after insert or update of observed_price_rwf, source_refreshed_at, rwanda_product_url
on public.dawanear_marketplace_products
for each row execute function dawanear_private.dawanear_sync_marketplace_indicative_price();

revoke all on function dawanear_private.dawanear_sync_marketplace_indicative_price()
  from public, anon, authenticated, service_role;

comment on column public.dawanear_marketplace_products.amazon_price_usd_observed is
  'Deprecated price field. Values must remain null; Amazon is not a MED+250 price source.';
comment on column public.dawanear_products.indicative_price_basis is
  'Optional central price methodology. Amazon prices and currency conversions are prohibited.';
comment on function dawanear_private.dawanear_sync_marketplace_indicative_price() is
  'Copies only directly observed Rwanda catalogue prices to the central product record.';

alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v10;
revoke all on function dawanear_private.dawanear_backend_contract_v10()
  from public, anon, authenticated;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v10() as contract
), pricing as (
  select
    (select count(*) from public.dawanear_products
      where indicative_price_rwf is not null) as central_price_count,
    (select count(*) from public.dawanear_products
      where indicative_price_basis = 'amazon_usd_reference_conversion'
         or indicative_price_source_url like '%amazon.com%') as amazon_reference_price_count,
    (select count(*) from public.dawanear_marketplace_products
      where amazon_price_usd_observed is not null) as amazon_usd_value_count,
    (select count(*) from public.dawanear_pharmacy_prices
      where is_current) as current_pharmacy_price_count,
    position(
      'dawanear_pharmacy_prices' in
      pg_catalog.pg_get_viewdef('public.dawanear_all_product_catalog'::regclass, true)
    ) = 0 as public_view_avoids_pharmacy_prices,
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.dawanear_offer_items'::regclass
        and conname = 'dawanear_offer_items_check'
        and pg_catalog.pg_get_constraintdef(oid, true)
          not like '%unit_price_rwf IS NOT NULL%'
    ) as confirmation_price_optional,
    exists (
      select 1 from pg_catalog.pg_proc
      where oid = pg_catalog.to_regprocedure(
        'public.dawanear_contribute_price(uuid,text,integer)'
      )
        and prosrc like '%centrally maintained indicative prices%'
    ) as pharmacy_catalogue_price_write_disabled
)
select
  jsonb_set(
    jsonb_set(
      base.contract,
      '{contract_version}',
      '"2026-07-16.3"'::jsonb,
      true
    ),
    '{pricing_model}',
    jsonb_build_object(
      'central_price_count', pricing.central_price_count,
      'amazon_reference_price_count', pricing.amazon_reference_price_count,
      'amazon_usd_value_count', pricing.amazon_usd_value_count,
      'amazon_price_reference_supported', false,
      'current_pharmacy_price_count', pricing.current_pharmacy_price_count,
      'public_view_avoids_pharmacy_prices', pricing.public_view_avoids_pharmacy_prices,
      'confirmation_price_optional', pricing.confirmation_price_optional,
      'pharmacy_catalogue_price_write_disabled', pricing.pharmacy_catalogue_price_write_disabled,
      'public_stock_supported', false,
      'final_price_claimed', false
    ),
    true
  )
from base cross join pricing;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract() to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 contract proving Amazon-derived prices are absent and catalogue pricing remains optional, central, and non-final.';

commit;
-- Filename aligned with the migration version recorded by the production project.
