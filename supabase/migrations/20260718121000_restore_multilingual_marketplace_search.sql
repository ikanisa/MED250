-- Keep the production marketplace RPC aligned with the multilingual search
-- vocabulary already used by the client and the legacy catalogue search.
-- The source-ranked function remains the only place that filters and ranks
-- catalogue rows; this wrapper only normalizes an approved common-use query.

begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

create or replace function public.dawanear_normalize_marketplace_query(p_query text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(douleur|ububabare)$' then 'paracetamol'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(mal de t[eê]te|umutwe|kubabara umutwe)$' then 'paracetamol'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(fi[eè]vre|umuriro)$' then 'paracetamol'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(allergie|allergique)$' then 'cetirizine'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(rhume|toux|grippe|ibicurane|inkorora)$' then 'cough'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(diab[eè]te|sukari)$' then 'metformin'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(br[uû]lures? d.estomac|igifu)$' then 'omeprazole'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(peau|uruhu)$' then 'skin'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(b[eé]b[eé]|enfant|uruhinja)$' then 'baby'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(couche|impuzu z.uruhinja)$' then 'diaper'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(hygi[eè]ne|hygi[eè]ne personnelle|isuku)$' then 'hygiene'
    when left(lower(trim(coalesce(p_query, ''))), 160) ~ '^(vitamine|compl[eé]ment)$' then 'vitamin'
    else left(lower(trim(coalesce(p_query, ''))), 160)
  end;
$function$;

do $migration$
begin
  if pg_catalog.to_regprocedure(
    'public.dawanear_search_marketplace_catalogue_source_ranked(text,text,text,text,text,text,integer,integer)'
  ) is null then
    alter function public.dawanear_search_marketplace_catalogue(
      text, text, text, text, text, text, integer, integer
    ) rename to dawanear_search_marketplace_catalogue_source_ranked;
  end if;
end
$migration$;

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
language sql
stable
security invoker
set search_path = ''
as $function$
  select *
  from public.dawanear_search_marketplace_catalogue_source_ranked(
    public.dawanear_normalize_marketplace_query(p_query),
    p_category,
    p_prescription_status,
    p_form_group,
    p_availability,
    p_sort,
    p_limit,
    p_offset
  );
$function$;

revoke all on function public.dawanear_search_marketplace_catalogue(
  text, text, text, text, text, text, integer, integer
) from public;
grant execute on function public.dawanear_search_marketplace_catalogue(
  text, text, text, text, text, text, integer, integer
) to anon, authenticated;

comment on function public.dawanear_search_marketplace_catalogue(
  text, text, text, text, text, text, integer, integer
) is 'Source-ranked public marketplace search with approved French and Kinyarwanda common-use query normalization.';

-- Rebind the legacy public contract to the normalized marketplace entry point
-- so older clients cannot silently lose the multilingual behavior.
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
language sql
stable
security invoker
set search_path = ''
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

revoke all on function public.dawanear_search_catalogue(
  text, text, text, text, text, text, integer, integer
) from public;
grant execute on function public.dawanear_search_catalogue(
  text, text, text, text, text, text, integer, integer
) to anon, authenticated;

commit;
