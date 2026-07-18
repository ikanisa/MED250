begin;

-- The global DDL guard rechecks product-image governance after every DDL
-- statement. This transaction-local override is required for an unrelated,
-- reviewed catalogue-content migration; the image policy is not changed.
select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

create or replace function dawanear_private.dawanear_clean_public_product_text(
  p_value text
)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(p_value, 'amazon(\.com|as)?', ' ', 'gi'),
        '[[:space:]]+([,;:.])', '\1', 'g'
      ),
      '[[:space:]]+', ' ', 'g'
    ),
    ' ,;:–—-'
  );
$function$;

revoke all on function dawanear_private.dawanear_clean_public_product_text(text)
  from public, anon, authenticated;

update public.dawanear_marketplace_products
set product_name = dawanear_private.dawanear_clean_public_product_text(product_name),
    brand_name = coalesce(
      nullif(dawanear_private.dawanear_clean_public_product_text(brand_name), ''),
      'Unbranded'
    ),
    generic_name = nullif(
      dawanear_private.dawanear_clean_public_product_text(coalesce(generic_name, '')),
      ''
    )
where concat_ws(' ', product_name, brand_name, generic_name) ilike '%amazon%';

update public.dawanear_products
set brand_name = dawanear_private.dawanear_clean_public_product_text(brand_name),
    generic_name = nullif(
      dawanear_private.dawanear_clean_public_product_text(coalesce(generic_name, '')),
      ''
    )
where concat_ws(' ', brand_name, generic_name) ilike '%amazon%';

alter table public.dawanear_marketplace_products
  drop constraint if exists dawanear_marketplace_products_public_text_no_prohibited_reference,
  add constraint dawanear_marketplace_products_public_text_no_prohibited_reference check (
    position('amazon' in lower(concat_ws(' ', product_name, brand_name, generic_name))) = 0
  );

alter table public.dawanear_products
  drop constraint if exists dawanear_products_public_text_no_prohibited_reference,
  add constraint dawanear_products_public_text_no_prohibited_reference check (
    position('amazon' in lower(concat_ws(' ', brand_name, generic_name))) = 0
  );

create or replace view public.dawanear_all_product_catalog
with (security_invoker = true)
as
select
  catalogue.id, catalogue.registration_number, catalogue.brand_name,
  catalogue.generic_name, catalogue.strength, catalogue.dosage_form,
  catalogue.pack_size, catalogue.product_type, catalogue.category,
  catalogue.category as department, null::text as subcategory,
  catalogue.prescription_status, catalogue.regulatory_status,
  catalogue.manufacturer, catalogue.manufacturer_country,
  catalogue.expiry_date, catalogue.image_url, catalogue.is_orderable,
  catalogue.source_name, catalogue.source_url,
  catalogue.price_min_rwf, catalogue.price_max_rwf,
  catalogue.price_contributors, null::text as amazon_product_url,
  catalogue.indicative_price_rwf, catalogue.price_is_indicative,
  catalogue.indicative_price_basis, catalogue.indicative_price_source_url,
  catalogue.indicative_price_updated_at
from public.dawanear_product_catalog as catalogue
where not exists (
  select 1 from public.dawanear_marketplace_products as marketplace
  where marketplace.id = catalogue.id
)
union all
select
  marketplace.id, marketplace.registration_number, marketplace.product_name as brand_name,
  marketplace.generic_name, marketplace.strength, marketplace.dosage_form,
  marketplace.pack_size, marketplace.product_type, marketplace.category,
  marketplace.category as department, marketplace.subcategory,
  'non_prescription'::text as prescription_status,
  'unclassified'::text as regulatory_status, marketplace.manufacturer,
  marketplace.manufacturer_country, marketplace.expiry_date,
  marketplace.image_url, marketplace.is_orderable,
  'MED+250 consumer catalogue'::text as source_name,
  null::text as source_url,
  product.indicative_price_rwf as price_min_rwf,
  product.indicative_price_rwf as price_max_rwf,
  0::bigint as price_contributors, null::text as amazon_product_url,
  product.indicative_price_rwf,
  (product.indicative_price_rwf is not null) as price_is_indicative,
  product.indicative_price_basis, product.indicative_price_source_url,
  product.indicative_price_updated_at
from public.dawanear_marketplace_products as marketplace
join public.dawanear_products as product on product.id = marketplace.id
where marketplace.publication_status = 'approved'
  and marketplace.is_active and marketplace.is_orderable;

revoke all on table public.dawanear_all_product_catalog
  from public, anon, authenticated;
grant select on table public.dawanear_all_product_catalog
  to anon, authenticated;

do $migration$
begin
  if exists (
    select 1 from public.dawanear_marketplace_products
    where concat_ws(' ', product_name, brand_name, generic_name) ilike '%amazon%'
  ) or exists (
    select 1 from public.dawanear_products
    where concat_ws(' ', brand_name, generic_name) ilike '%amazon%'
  ) then
    raise exception 'Product names still contain a prohibited marketplace reference';
  end if;

  if exists (
    select 1
    from public.dawanear_all_product_catalog as product
    cross join lateral jsonb_each_text(to_jsonb(product)) as field(key, value)
    where field.value ilike '%amazon%'
  ) then
    raise exception 'The public product catalogue still exposes a prohibited marketplace reference';
  end if;
end;
$migration$;

commit;
