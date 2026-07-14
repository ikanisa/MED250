-- Scalable customer catalogue search for MED+250.
--
-- The function exposes only the same public product fields and aggregate price
-- ranges as dawanear_product_catalog. Pharmacy identities and individual price
-- contributors remain private. The browser keeps its deterministic multilingual
-- scorer as an offline/preview fallback, while live mode can page through this
-- server-ranked result set instead of downloading the complete catalogue.

create extension if not exists pg_trgm with schema extensions;

create index if not exists dawanear_products_trigram_search_idx
on public.dawanear_products using gin (
  (
    lower(
      coalesce(brand_name, '') || ' ' ||
      coalesce(generic_name, '') || ' ' ||
      coalesce(strength, '') || ' ' ||
      coalesce(dosage_form, '') || ' ' ||
      coalesce(pack_size, '') || ' ' ||
      coalesce(registration_number, '')
    )
  ) extensions.gin_trgm_ops
);

drop function if exists public.dawanear_search_catalogue(
  text, text, text, text, text, text, integer, integer
);

create function public.dawanear_search_catalogue(
  p_query text default '',
  p_category text default 'All products',
  p_prescription_status text default 'all',
  p_form_group text default 'all',
  p_availability text default 'all',
  p_sort text default 'relevance',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id text,
  registration_number text,
  brand_name text,
  generic_name text,
  strength text,
  dosage_form text,
  pack_size text,
  product_type text,
  category text,
  prescription_status text,
  regulatory_status text,
  manufacturer text,
  manufacturer_country text,
  expiry_date date,
  image_url text,
  is_orderable boolean,
  source_name text,
  source_url text,
  price_min_rwf integer,
  price_max_rwf integer,
  price_contributors bigint,
  match_score double precision,
  match_explanation text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
with input as (
  select
    left(lower(trim(coalesce(p_query, ''))), 160) as query,
    case
      when p_category in (
        'All products', 'Medicines', 'Pain & fever', 'Digestive health',
        'Allergy', 'Diabetes care', 'Personal care', 'Baby & family', 'Wellness'
      ) then p_category
      else 'All products'
    end as category,
    case
      when p_prescription_status in (
        'all', 'prescription', 'non_prescription', 'pharmacist_only', 'unclassified'
      ) then p_prescription_status
      else 'all'
    end as prescription_status,
    case
      when p_form_group in ('all', 'tablets', 'liquids', 'injections', 'topical', 'devices', 'other')
        then p_form_group
      else 'all'
    end as form_group,
    case
      when p_availability in ('all', 'priced', 'orderable', 'registered') then p_availability
      else 'all'
    end as availability,
    case when p_sort in ('relevance', 'az', 'za', 'price') then p_sort else 'relevance' end as sort,
    least(greatest(coalesce(p_limit, 24), 1), 120) as page_limit,
    least(greatest(coalesce(p_offset, 0), 0), 10000) as page_offset
), query_terms as (
  select
    input.*,
    case
      when query ~ '(pain|ache|analgesic|douleur|ububabare)'
        then array['paracetamol', 'ibuprofen', 'diclofenac']::text[]
      when query ~ '(headache|migraine|mal de tete|umutwe|kubabara umutwe)'
        then array['paracetamol', 'ibuprofen']::text[]
      when query ~ '(fever|temperature|fievre|umuriro)'
        then array['paracetamol', 'ibuprofen']::text[]
      when query ~ '(allergy|allergic|antihistamine|allergie|allergique)'
        then array['cetirizine', 'loratadine', 'antihistamine']::text[]
      when query ~ '(cold|cough|flu|decongestant|rhume|toux|grippe|ibicurane|inkorora)'
        then array['cough', 'decongestant', 'antihistamine']::text[]
      when query ~ '(diabetes|diabetic|glucose|diabete|sukari)'
        then array['insulin', 'metformin', 'glucose']::text[]
      when query ~ '(heartburn|reflux|antacid|brulures estomac|igifu)'
        then array['omeprazole', 'esomeprazole', 'antacid']::text[]
      when query ~ '(stomach|digestive|diarrhoea|nausea|estomac|digestif|diarrhee)'
        then array['digestive', 'diarrhoea', 'nausea']::text[]
      when query ~ '(skin|dermatology|cream|lotion|topical|peau|uruhu)'
        then array['cream', 'ointment', 'lotion', 'topical']::text[]
      when query ~ '(baby|infant|child|children|pediatric|bebe|enfant|uruhinja)'
        then array['baby', 'infant', 'pediatric']::text[]
      when query ~ '(diaper|nappy|couche|impuzu zuruhinja)'
        then array['diaper', 'nappy']::text[]
      when query ~ '(hygiene|personal care|oral|soap|hygiene personnelle|isuku)'
        then array['hygiene', 'oral', 'soap']::text[]
      when query ~ '(vitamin|supplement|wellness|mineral|vitamine|complement)'
        then array['vitamin', 'supplement', 'mineral']::text[]
      else array[]::text[]
    end as aliases
  from input
), products as (
  select
    p.id,
    p.registration_number,
    p.brand_name,
    p.generic_name,
    p.strength,
    p.dosage_form,
    p.pack_size,
    p.product_type,
    p.prescription_status,
    p.regulatory_status,
    p.manufacturer,
    p.manufacturer_country,
    p.expiry_date,
    p.image_url,
    p.is_orderable,
    p.source_name,
    p.source_url,
    min(pp.price_rwf) filter (where pp.is_current) as price_min_rwf,
    max(pp.price_rwf) filter (where pp.is_current) as price_max_rwf,
    count(pp.product_id) filter (where pp.is_current) as price_contributors,
    lower(
      coalesce(p.brand_name, '') || ' ' ||
      coalesce(p.generic_name, '') || ' ' ||
      coalesce(p.strength, '') || ' ' ||
      coalesce(p.dosage_form, '') || ' ' ||
      coalesce(p.pack_size, '') || ' ' ||
      coalesce(p.registration_number, '')
    ) as search_text,
    lower(coalesce(p.brand_name, '')) as brand_search,
    lower(coalesce(p.generic_name, '')) as generic_search,
    case
      when p.category <> 'Medicines' then p.category
      when lower(coalesce(p.brand_name, '') || ' ' || coalesce(p.generic_name, '') || ' ' || coalesce(p.dosage_form, ''))
        ~ '(paracetamol|diclofenac|ibuprofen|analges|pain|fever)' then 'Pain & fever'
      when lower(coalesce(p.brand_name, '') || ' ' || coalesce(p.generic_name, '') || ' ' || coalesce(p.dosage_form, ''))
        ~ '(cetirizine|loratadine|allerg|antihistamin)' then 'Allergy'
      when lower(coalesce(p.brand_name, '') || ' ' || coalesce(p.generic_name, '') || ' ' || coalesce(p.dosage_form, ''))
        ~ '(metformin|insulin|diabet|glucose meter|glucometer)' then 'Diabetes care'
      when lower(coalesce(p.brand_name, '') || ' ' || coalesce(p.generic_name, '') || ' ' || coalesce(p.dosage_form, ''))
        ~ '(omeprazole|esomeprazole|antacid|digest|laxative|constipation)' then 'Digestive health'
      when lower(coalesce(p.brand_name, '') || ' ' || coalesce(p.generic_name, '') || ' ' || coalesce(p.dosage_form, ''))
        ~ '(baby|infant|diaper|nappy|feeding bottle|pacifier)' then 'Baby & family'
      when lower(coalesce(p.brand_name, '') || ' ' || coalesce(p.generic_name, '') || ' ' || coalesce(p.dosage_form, ''))
        ~ '(lotion|shampoo|tooth|skin|cosmetic|soap|deodorant|oral care)' then 'Personal care'
      when lower(coalesce(p.brand_name, '') || ' ' || coalesce(p.generic_name, '') || ' ' || coalesce(p.dosage_form, ''))
        ~ '(vitamin|supplement|monitor|device|thermometer|blood pressure)' then 'Wellness'
      else 'Medicines'
    end as inferred_category,
    case
      when lower(coalesce(p.dosage_form, '')) ~ '(tablet|caplet|capsule)' then 'tablets'
      when lower(coalesce(p.dosage_form, '')) ~ '(syrup|solution|suspension|drops|liquid)' then 'liquids'
      when lower(coalesce(p.dosage_form, '')) ~ '(injection|infusion|vial|ampoule)' then 'injections'
      when lower(coalesce(p.dosage_form, '')) ~ '(cream|ointment|gel|lotion|topical)' then 'topical'
      when lower(coalesce(p.dosage_form, '')) ~ '(device|meter|monitor|thermometer|inhaler)' then 'devices'
      else 'other'
    end as form_group
  from public.dawanear_products as p
  left join public.dawanear_pharmacy_prices as pp on pp.product_id = p.id
  where p.is_active
  group by p.id
), scored as (
  select
    products.*,
    query_terms.query,
    query_terms.sort,
    query_terms.page_limit,
    query_terms.page_offset,
    greatest(
      extensions.similarity(products.brand_search, query_terms.query),
      extensions.similarity(products.generic_search, query_terms.query)
    ) as direct_similarity,
    coalesce((
      select max(greatest(
        extensions.similarity(products.brand_search, alias),
        extensions.similarity(products.generic_search, alias)
      ))
      from unnest(query_terms.aliases) as alias
    ), 0) as alias_similarity,
    exists (
      select 1 from unnest(query_terms.aliases) as alias
      where products.search_text like '%' || alias || '%'
    ) as alias_match,
    case
      when query_terms.query = '' then 1::double precision
      when products.brand_search = query_terms.query then 1000::double precision
      when products.generic_search = query_terms.query then 900::double precision
      when products.brand_search like query_terms.query || '%' then 800::double precision
      when products.brand_search like '%' || query_terms.query || '%' then 700::double precision
      when products.generic_search like '%' || query_terms.query || '%' then 650::double precision
      when products.search_text like '%' || query_terms.query || '%' then 575::double precision
      when pg_catalog.to_tsvector('simple', products.search_text)
        @@ pg_catalog.websearch_to_tsquery('simple', query_terms.query) then 500::double precision
      when exists (
        select 1 from unnest(query_terms.aliases) as alias
        where products.search_text like '%' || alias || '%'
      ) then 350::double precision
      else 250 * greatest(
        extensions.similarity(products.brand_search, query_terms.query),
        extensions.similarity(products.generic_search, query_terms.query)
      )
    end as match_score,
    case
      when query_terms.query = '' then 'Catalogue product'
      when products.brand_search = query_terms.query then 'Exact product name'
      when products.generic_search = query_terms.query then 'Exact active ingredient'
      when products.brand_search like query_terms.query || '%' then 'Product name prefix'
      when products.brand_search like '%' || query_terms.query || '%' then 'Product name match'
      when products.generic_search like '%' || query_terms.query || '%' then 'Active ingredient match'
      when products.search_text like '%' || query_terms.query || '%' then 'Strength, form or pack match'
      when pg_catalog.to_tsvector('simple', products.search_text)
        @@ pg_catalog.websearch_to_tsquery('simple', query_terms.query) then 'All search terms matched'
      when exists (
        select 1 from unnest(query_terms.aliases) as alias
        where products.search_text like '%' || alias || '%'
      ) then 'Related medicine or use'
      else 'Close spelling match'
    end as match_explanation
  from products
  cross join query_terms
  where
    (
      query_terms.query = ''
      or products.search_text like '%' || query_terms.query || '%'
      or pg_catalog.to_tsvector('simple', products.search_text)
        @@ pg_catalog.websearch_to_tsquery('simple', query_terms.query)
      or greatest(
        extensions.similarity(products.brand_search, query_terms.query),
        extensions.similarity(products.generic_search, query_terms.query)
      ) >= 0.28
      or exists (
        select 1 from unnest(query_terms.aliases) as alias
        where products.search_text like '%' || alias || '%'
      )
    )
    and (
      query_terms.category = 'All products'
      or products.inferred_category = query_terms.category
      or (
        query_terms.category = 'Medicines'
        and products.inferred_category in (
          'Medicines', 'Pain & fever', 'Digestive health', 'Allergy', 'Diabetes care'
        )
      )
    )
    and (
      query_terms.prescription_status = 'all'
      or products.prescription_status = query_terms.prescription_status
    )
    and (query_terms.form_group = 'all' or products.form_group = query_terms.form_group)
    and (
      query_terms.availability = 'all'
      or (query_terms.availability = 'priced' and products.price_contributors > 0 and products.price_min_rwf > 0)
      or (query_terms.availability = 'orderable' and products.is_orderable)
      or (
        query_terms.availability = 'registered'
        and products.regulatory_status in ('valid', 'active', 'expiring_soon')
      )
    )
), counted as (
  select scored.*, count(*) over () as total_count
  from scored
)
select
  counted.id,
  counted.registration_number,
  counted.brand_name,
  counted.generic_name,
  counted.strength,
  counted.dosage_form,
  counted.pack_size,
  counted.product_type,
  counted.inferred_category as category,
  counted.prescription_status,
  counted.regulatory_status,
  counted.manufacturer,
  counted.manufacturer_country,
  counted.expiry_date,
  counted.image_url,
  counted.is_orderable,
  counted.source_name,
  counted.source_url,
  counted.price_min_rwf,
  counted.price_max_rwf,
  counted.price_contributors,
  counted.match_score,
  counted.match_explanation,
  counted.total_count
from counted
order by
  case when counted.sort = 'relevance' then counted.match_score end desc nulls last,
  case when counted.sort = 'price' then counted.price_min_rwf end asc nulls last,
  case when counted.sort = 'az' then lower(counted.brand_name) end asc nulls last,
  case when counted.sort = 'za' then lower(counted.brand_name) end desc nulls last,
  lower(counted.brand_name),
  counted.id
limit (select page_limit from query_terms)
offset (select page_offset from query_terms);
$$;

revoke all on function public.dawanear_search_catalogue(
  text, text, text, text, text, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.dawanear_search_catalogue(
  text, text, text, text, text, text, integer, integer
) to anon, authenticated;

comment on function public.dawanear_search_catalogue(
  text, text, text, text, text, text, integer, integer
) is
  'Pages and ranks active MED+250 catalogue products using exact, full-text, multilingual alias and trigram matches without revealing pharmacy identities.';
