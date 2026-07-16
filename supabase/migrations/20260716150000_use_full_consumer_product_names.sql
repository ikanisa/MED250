begin;

-- Consumer-product research stores the complete customer-facing title in
-- product_name. The separately extracted brand_name can be a quantity or pack
-- token (for example "10pcs"), so it must never be used as the storefront
-- product name.

create or replace function dawanear_private.dawanear_sync_marketplace_product()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_legacy_category text;
begin
  v_legacy_category := case new.category
    when 'Beauty & Personal Care' then 'Personal care'
    when 'Baby' then 'Baby & family'
    when 'Health & Household' then 'Wellness'
    else new.category
  end;

  if new.publication_status = 'approved' and new.is_active and new.is_orderable then
    insert into public.dawanear_products (
      id, source_register, source_serial, registration_number, brand_name,
      generic_name, strength, dosage_form, pack_size, shelf_life,
      product_type, category, prescription_status, regulatory_status,
      manufacturer, manufacturer_country, marketing_authorization_holder,
      local_technical_representative, registration_date, expiry_date,
      image_url, image_source, is_orderable, is_active, source_name,
      source_url, source_refreshed_at
    ) values (
      new.id, new.source_register, new.source_serial, new.registration_number,
      new.product_name, coalesce(new.generic_name, new.subcategory), new.strength,
      coalesce(new.dosage_form, new.product_type), new.pack_size, new.shelf_life,
      'consumer_product', v_legacy_category, 'non_prescription', 'unclassified',
      new.manufacturer, new.manufacturer_country,
      new.marketing_authorization_holder, new.local_technical_representative,
      new.registration_date, new.expiry_date, new.image_url, new.image_source,
      true, true, new.source_name, new.source_url, new.source_refreshed_at
    )
    on conflict (id) do update set
      brand_name = excluded.brand_name,
      generic_name = excluded.generic_name,
      strength = excluded.strength,
      dosage_form = excluded.dosage_form,
      pack_size = excluded.pack_size,
      product_type = excluded.product_type,
      category = excluded.category,
      prescription_status = excluded.prescription_status,
      regulatory_status = excluded.regulatory_status,
      manufacturer = excluded.manufacturer,
      manufacturer_country = excluded.manufacturer_country,
      image_url = excluded.image_url,
      image_source = excluded.image_source,
      is_orderable = true,
      is_active = true,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      source_refreshed_at = excluded.source_refreshed_at;
  else
    update public.dawanear_products
    set is_orderable = false, is_active = false
    where id = new.id and source_register = new.source_register;
  end if;

  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_sync_marketplace_product()
  from public, anon, authenticated;

drop trigger if exists dawanear_marketplace_products_catalogue_sync
  on public.dawanear_marketplace_products;

create trigger dawanear_marketplace_products_catalogue_sync
after insert or update of publication_status, is_active, is_orderable,
  product_name, brand_name, generic_name, strength, dosage_form, pack_size,
  product_type, category, subcategory, manufacturer, manufacturer_country,
  image_url, source_url, source_refreshed_at
on public.dawanear_marketplace_products
for each row execute function dawanear_private.dawanear_sync_marketplace_product();

update public.dawanear_products as product
set
  brand_name = marketplace.product_name,
  updated_at = now()
from public.dawanear_marketplace_products as marketplace
where product.id = marketplace.id
  and nullif(trim(marketplace.product_name), '') is not null
  and product.brand_name is distinct from marketplace.product_name;

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
  coalesce(marketplace.generic_name, marketplace.subcategory) as generic_name,
  marketplace.strength,
  coalesce(marketplace.dosage_form, marketplace.product_type) as dosage_form,
  marketplace.pack_size, marketplace.product_type, marketplace.category,
  marketplace.category as department, marketplace.subcategory,
  'non_prescription'::text as prescription_status,
  'unclassified'::text as regulatory_status, marketplace.manufacturer,
  marketplace.manufacturer_country, marketplace.expiry_date,
  marketplace.image_url, marketplace.is_orderable, marketplace.source_name,
  marketplace.source_url, product.indicative_price_rwf as price_min_rwf,
  product.indicative_price_rwf as price_max_rwf,
  0::bigint as price_contributors, marketplace.amazon_product_url,
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

comment on view public.dawanear_all_product_catalog is
  'Unified central catalogue. Consumer rows use their complete source product_name; quantity, pack-size, and extracted brand tokens are never storefront titles.';

commit;
