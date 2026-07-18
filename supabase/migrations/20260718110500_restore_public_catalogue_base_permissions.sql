begin;

-- The unified public catalogue is a security-invoker view. Recreating it does
-- not preserve the caller's column privileges on its governed source table,
-- so anonymous storefront reads must retain the exact projected columns.
-- RLS still limits both anon and authenticated callers to active products.
select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

grant select (
  id,
  registration_number,
  brand_name,
  generic_name,
  strength,
  dosage_form,
  pack_size,
  product_type,
  category,
  prescription_status,
  regulatory_status,
  manufacturer,
  manufacturer_country,
  expiry_date,
  image_url,
  is_orderable,
  is_active,
  source_name,
  source_url,
  indicative_price_rwf,
  indicative_price_basis,
  indicative_price_source_url,
  indicative_price_updated_at,
  description,
  description_source_name,
  description_source_url,
  description_approved
) on table public.dawanear_products to anon, authenticated;

do $migration$
declare
  role_name text;
  column_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach column_name in array array[
      'id',
      'registration_number',
      'brand_name',
      'generic_name',
      'strength',
      'dosage_form',
      'pack_size',
      'product_type',
      'category',
      'prescription_status',
      'regulatory_status',
      'manufacturer',
      'manufacturer_country',
      'expiry_date',
      'image_url',
      'is_orderable',
      'is_active',
      'source_name',
      'source_url',
      'indicative_price_rwf',
      'indicative_price_basis',
      'indicative_price_source_url',
      'indicative_price_updated_at',
      'description',
      'description_source_name',
      'description_source_url',
      'description_approved'
    ] loop
      if not pg_catalog.has_column_privilege(
        role_name,
        'public.dawanear_products',
        column_name,
        'select'
      ) then
        raise exception '% cannot read governed public product column %',
          role_name,
          column_name;
      end if;
    end loop;
  end loop;
end;
$migration$;

commit;
