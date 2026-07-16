-- Taxonomy is a projection of rows that actually exist in the public catalogue.
-- Empty departments/subcategories never become selectable UI labels.
create or replace view public.dawanear_catalogue_taxonomy
with (security_invoker = true) as
select
  nullif(trim(coalesce(catalogue.department, catalogue.category)), '') as department,
  nullif(trim(catalogue.subcategory), '') as subcategory,
  count(*)::bigint as product_count
from public.dawanear_all_product_catalog as catalogue
where nullif(trim(coalesce(catalogue.department, catalogue.category)), '') is not null
group by
  nullif(trim(coalesce(catalogue.department, catalogue.category)), ''),
  nullif(trim(catalogue.subcategory), '');

revoke all on table public.dawanear_catalogue_taxonomy from public;
grant select on table public.dawanear_catalogue_taxonomy to anon, authenticated;

-- Replace the public search implementation so category filters use only the
-- source-backed category/department/subcategory columns. In particular,
-- medicines remain one category when the FDA source has no subcategory data.
create or replace function public.dawanear_search_marketplace_catalogue(
  p_query text default '',
  p_category text default 'All products',
  p_prescription_status text default 'all',
  p_form_group text default 'all',
  p_availability text default 'all',
  p_sort text default 'relevance',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  id text, registration_number text, brand_name text, generic_name text,
  strength text, dosage_form text, pack_size text, product_type text,
  category text, department text, subcategory text, prescription_status text,
  regulatory_status text, manufacturer text, manufacturer_country text,
  expiry_date date, image_url text, is_orderable boolean, source_name text,
  source_url text, price_min_rwf integer, price_max_rwf integer,
  price_contributors bigint, amazon_product_url text, indicative_price_rwf integer,
  price_is_indicative boolean, indicative_price_basis text,
  indicative_price_source_url text, indicative_price_updated_at timestamptz,
  match_score double precision, match_explanation text, total_count bigint
)
language sql stable
set search_path to ''
as $function$
with input as (
  select
    left(lower(trim(coalesce(p_query, ''))), 160) as query,
    left(trim(coalesce(p_category, 'All products')), 120) as category,
    case when p_prescription_status in ('all', 'prescription', 'non_prescription', 'pharmacist_only', 'unclassified') then p_prescription_status else 'all' end as prescription_status,
    case when p_form_group in ('all', 'tablets', 'liquids', 'injections', 'topical', 'devices', 'other') then p_form_group else 'all' end as form_group,
    case when p_availability in ('all', 'priced', 'orderable', 'registered') then p_availability else 'all' end as availability,
    case when p_sort in ('relevance', 'az', 'za', 'price') then p_sort else 'relevance' end as sort,
    least(greatest(coalesce(p_limit, 24), 1), 120) as page_limit,
    least(greatest(coalesce(p_offset, 0), 0), 10000) as page_offset
), products as (
  select
    catalogue.*,
    lower(coalesce(catalogue.brand_name, '') || ' ' || coalesce(catalogue.generic_name, '') || ' ' || coalesce(catalogue.strength, '') || ' ' || coalesce(catalogue.dosage_form, '') || ' ' || coalesce(catalogue.pack_size, '') || ' ' || coalesce(catalogue.product_type, '') || ' ' || coalesce(catalogue.category, '') || ' ' || coalesce(catalogue.department, '') || ' ' || coalesce(catalogue.subcategory, '') || ' ' || coalesce(catalogue.registration_number, '')) as search_text,
    case
      when lower(coalesce(catalogue.dosage_form, '')) ~ '(tablet|caplet|capsule)' then 'tablets'
      when lower(coalesce(catalogue.dosage_form, '')) ~ '(syrup|solution|suspension|drops|liquid)' then 'liquids'
      when lower(coalesce(catalogue.dosage_form, '')) ~ '(injection|infusion|vial|ampoule)' then 'injections'
      when lower(coalesce(catalogue.dosage_form, '')) ~ '(cream|ointment|gel|lotion|topical)' then 'topical'
      when lower(coalesce(catalogue.dosage_form, '')) ~ '(device|meter|monitor|thermometer|inhaler)' then 'devices'
      else 'other'
    end as form_group
  from public.dawanear_all_product_catalog as catalogue
), filtered as (
  select products.*, input.sort, input.page_limit, input.page_offset,
    case
      when input.query = '' then 1::double precision
      when lower(products.brand_name) = input.query then 1000::double precision
      when lower(coalesce(products.generic_name, '')) = input.query then 900::double precision
      when lower(products.brand_name) like input.query || '%' then 800::double precision
      when products.search_text like '%' || input.query || '%' then 650::double precision
      when pg_catalog.to_tsvector('simple', products.search_text) @@ pg_catalog.websearch_to_tsquery('simple', input.query) then 500::double precision
      else 250 * greatest(extensions.similarity(lower(products.brand_name), input.query), extensions.similarity(lower(coalesce(products.generic_name, '')), input.query))
    end as match_score,
    case
      when input.query = '' then 'Catalogue product'
      when lower(products.brand_name) = input.query then 'Exact product name'
      when lower(coalesce(products.generic_name, '')) = input.query then 'Exact active ingredient'
      when lower(products.brand_name) like input.query || '%' then 'Product name prefix'
      when products.search_text like '%' || input.query || '%' then 'Product detail match'
      when pg_catalog.to_tsvector('simple', products.search_text) @@ pg_catalog.websearch_to_tsquery('simple', input.query) then 'All search terms matched'
      else 'Close spelling match'
    end as match_explanation
  from products cross join input
  where (
    input.query = ''
    or products.search_text like '%' || input.query || '%'
    or pg_catalog.to_tsvector('simple', products.search_text) @@ pg_catalog.websearch_to_tsquery('simple', input.query)
    or greatest(extensions.similarity(lower(products.brand_name), input.query), extensions.similarity(lower(coalesce(products.generic_name, '')), input.query)) >= 0.28
  ) and (
    input.category = 'All products'
    or products.category = input.category
    or products.department = input.category
    or products.department || ' / ' || coalesce(products.subcategory, '') = input.category
  ) and (
    input.prescription_status = 'all' or products.prescription_status = input.prescription_status
  ) and (input.form_group = 'all' or products.form_group = input.form_group)
  and (
    input.availability = 'all'
    or (input.availability = 'priced' and products.indicative_price_rwf > 0)
    or (input.availability = 'orderable' and products.is_orderable)
    or (input.availability = 'registered' and products.regulatory_status in ('valid', 'active', 'expiring_soon'))
  )
), counted as (
  select filtered.*, count(*) over () as total_count from filtered
)
select
  counted.id, counted.registration_number, counted.brand_name, counted.generic_name,
  counted.strength, counted.dosage_form, counted.pack_size, counted.product_type,
  counted.category, counted.department, counted.subcategory, counted.prescription_status,
  counted.regulatory_status, counted.manufacturer, counted.manufacturer_country,
  counted.expiry_date, counted.image_url, counted.is_orderable, counted.source_name,
  counted.source_url, counted.price_min_rwf, counted.price_max_rwf,
  counted.price_contributors, counted.amazon_product_url, counted.indicative_price_rwf,
  counted.price_is_indicative, counted.indicative_price_basis,
  counted.indicative_price_source_url, counted.indicative_price_updated_at,
  counted.match_score, counted.match_explanation, counted.total_count
from counted
order by
  case when counted.sort = 'relevance' then counted.match_score end desc nulls last,
  case when counted.sort = 'price' then counted.indicative_price_rwf end asc nulls last,
  case when counted.sort = 'az' then lower(counted.brand_name) end asc nulls last,
  case when counted.sort = 'za' then lower(counted.brand_name) end desc nulls last,
  lower(counted.brand_name), counted.id
limit (select page_limit from input)
offset (select page_offset from input);
$function$;

revoke all on function public.dawanear_search_marketplace_catalogue(text, text, text, text, text, text, integer, integer) from public;
grant execute on function public.dawanear_search_marketplace_catalogue(text, text, text, text, text, text, integer, integer) to anon, authenticated;

comment on view public.dawanear_catalogue_taxonomy is
  'Dynamic source-backed departments and subcategories. Rows with no products are absent by design.';

-- Keep the legacy RPC contract source-backed as well. Older clients and
-- operational checks may still call this name.
create or replace function public.dawanear_search_catalogue(
  p_query text default '',
  p_category text default 'All products',
  p_prescription_status text default 'all',
  p_form_group text default 'all',
  p_availability text default 'all',
  p_sort text default 'relevance',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  id text, registration_number text, brand_name text, generic_name text,
  strength text, dosage_form text, pack_size text, product_type text,
  category text, prescription_status text, regulatory_status text,
  manufacturer text, manufacturer_country text, expiry_date date,
  image_url text, is_orderable boolean, source_name text, source_url text,
  price_min_rwf integer, price_max_rwf integer, price_contributors bigint,
  match_score double precision, match_explanation text, total_count bigint
)
language sql stable
set search_path to ''
as $function$
select
  result.id, result.registration_number, result.brand_name, result.generic_name,
  result.strength, result.dosage_form, result.pack_size, result.product_type,
  result.category, result.prescription_status, result.regulatory_status,
  result.manufacturer, result.manufacturer_country, result.expiry_date,
  result.image_url, result.is_orderable, result.source_name, result.source_url,
  result.price_min_rwf, result.price_max_rwf, result.price_contributors,
  result.match_score, result.match_explanation, result.total_count
from public.dawanear_search_marketplace_catalogue(
  p_query, p_category, p_prescription_status, p_form_group,
  p_availability, p_sort, p_limit, p_offset
) as result;
$function$;

revoke all on function public.dawanear_search_catalogue(text, text, text, text, text, text, integer, integer) from public;
grant execute on function public.dawanear_search_catalogue(text, text, text, text, text, text, integer, integer) to anon, authenticated;
