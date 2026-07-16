-- Amazon-first consumer catalogue for the Rwanda marketplace.
--
-- Consumer research records are intentionally isolated from the Rwanda FDA
-- medicine register. They remain invisible and non-orderable until an
-- administrator completes seller/compliance review and explicitly approves
-- each record. Approved rows are projected into dawanear_products so the
-- existing order, offer and price foreign keys continue to work unchanged.

create table public.dawanear_marketplace_products (
  id text primary key,
  source_register text not null,
  source_serial integer,
  registration_number text,
  brand_name text not null,
  generic_name text,
  strength text,
  dosage_form text,
  pack_size text,
  shelf_life text,
  product_type text not null,
  category text not null,
  prescription_status text not null default 'not_applicable',
  regulatory_status text not null default 'verification_pending',
  manufacturer text,
  manufacturer_country text,
  marketing_authorization_holder text,
  local_technical_representative text,
  registration_date date,
  expiry_date date,
  image_url text,
  image_source text,
  is_orderable boolean not null default false,
  is_active boolean not null default false,
  source_name text not null,
  source_url text not null,
  source_refreshed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_platform text not null,
  source_product_id text not null,
  asin text not null,
  product_name text not null,
  subcategory text not null,
  regulatory_class text not null,
  publication_status text not null default 'research_candidate',
  seller_verification_required boolean not null default true,
  age_gate_required boolean not null default false,
  amazon_product_url text not null,
  amazon_category_url text not null,
  amazon_search_query text not null,
  amazon_price_usd_observed numeric(12,2),
  amazon_rating_observed numeric(2,1),
  amazon_reviews_observed integer,
  amazon_bought_past_month_observed integer,
  amazon_page_observed integer,
  amazon_evidence_status text not null,
  ships_to_rwanda_status text not null,
  rwanda_match_status text not null,
  rwanda_match_score integer,
  rwanda_matched_product_name text,
  rwanda_source_name text,
  rwanda_product_url text,
  observed_price_rwf integer,
  observed_inventory_units integer,
  rwanda_availability_status text not null,
  taxonomy_relevance_score integer not null,
  amazon_popularity_score integer not null,
  assortment_score integer not null,
  compliance_status text not null,
  brand_verification_status text not null,
  data_quality_note text not null,
  constraint dawanear_marketplace_products_source_product_unique
    unique (source_platform, source_product_id),
  constraint dawanear_marketplace_products_asin_unique unique (asin),
  constraint dawanear_marketplace_products_identity_check
    check (id = 'AMZ-' || asin and source_product_id = asin and asin ~ '^[A-Z0-9]{10}$'),
  constraint dawanear_marketplace_products_source_check
    check (
      source_platform = 'Amazon.com'
      and amazon_product_url ~ '^https://(www\\.)?amazon\\.com/'
      and amazon_category_url ~ '^https://(www\\.)?amazon\\.com/'
    ),
  constraint dawanear_marketplace_products_taxonomy_check
    check ((category, subcategory) in (
      ('Beauty & Personal Care', 'Makeup'),
      ('Beauty & Personal Care', 'Skin Care'),
      ('Beauty & Personal Care', 'Hair Care'),
      ('Beauty & Personal Care', 'Fragrance'),
      ('Beauty & Personal Care', 'Foot, Hand & Nail Care'),
      ('Beauty & Personal Care', 'Tools & Accessories'),
      ('Beauty & Personal Care', 'Shave & Hair Removal'),
      ('Beauty & Personal Care', 'Personal Care'),
      ('Beauty & Personal Care', 'Oral Care'),
      ('Baby', 'Baby Care'),
      ('Baby', 'Diapering'),
      ('Baby', 'Feeding'),
      ('Baby', 'Nursery'),
      ('Baby', 'Pregnancy & Maternity'),
      ('Health & Household', 'Baby & Child Care'),
      ('Health & Household', 'Health Care'),
      ('Health & Household', 'Household Supplies'),
      ('Health & Household', 'Medical Supplies & Equipment'),
      ('Health & Household', 'Oral Care'),
      ('Health & Household', 'Personal Care'),
      ('Health & Household', 'Sexual Wellness'),
      ('Health & Household', 'Sports Nutrition'),
      ('Health & Household', 'Vision Care'),
      ('Health & Household', 'Vitamins & Dietary Supplements'),
      ('Health & Household', 'Wellness & Relaxation')
    )),
  constraint dawanear_marketplace_products_publication_check
    check (publication_status in (
      'research_candidate', 'seller_review', 'compliance_review', 'approved', 'rejected'
    )),
  constraint dawanear_marketplace_products_score_check check (
    taxonomy_relevance_score between 0 and 100
    and amazon_popularity_score between 0 and 100
    and assortment_score between 0 and 100
    and (rwanda_match_score is null or rwanda_match_score between 0 and 100)
    and (amazon_rating_observed is null or amazon_rating_observed between 0 and 5)
  ),
  constraint dawanear_marketplace_products_nonnegative_check check (
    (amazon_price_usd_observed is null or amazon_price_usd_observed >= 0)
    and (amazon_reviews_observed is null or amazon_reviews_observed >= 0)
    and (amazon_bought_past_month_observed is null or amazon_bought_past_month_observed >= 0)
    and (amazon_page_observed is null or amazon_page_observed > 0)
    and (observed_price_rwf is null or observed_price_rwf >= 0)
    and (observed_inventory_units is null or observed_inventory_units >= 0)
  ),
  constraint dawanear_marketplace_products_fail_closed_check check (
    not is_active
    or (
      publication_status = 'approved'
      and not seller_verification_required
      and lower(compliance_status) = 'approved'
    )
  ),
  constraint dawanear_marketplace_products_orderable_check check (
    not is_orderable or is_active
  )
);

comment on table public.dawanear_marketplace_products is
  'Amazon-first Rwanda marketplace consumer-product candidates. Separate from the Rwanda FDA medicine register and fail-closed until seller/compliance approval.';

create index dawanear_marketplace_products_taxonomy_idx
  on public.dawanear_marketplace_products (category, subcategory, publication_status);
create index dawanear_marketplace_products_review_idx
  on public.dawanear_marketplace_products (publication_status, seller_verification_required, is_active);
create index dawanear_marketplace_products_rwanda_match_idx
  on public.dawanear_marketplace_products (rwanda_match_status, rwanda_match_score desc);
create index dawanear_marketplace_products_search_idx
  on public.dawanear_marketplace_products using gin ((
    lower(
      coalesce(product_name, '') || ' ' || coalesce(brand_name, '') || ' ' ||
      coalesce(product_type, '') || ' ' || coalesce(category, '') || ' ' ||
      coalesce(subcategory, '') || ' ' || coalesce(asin, '')
    )
  ) extensions.gin_trgm_ops);

drop trigger if exists dawanear_marketplace_products_updated_at
  on public.dawanear_marketplace_products;
create trigger dawanear_marketplace_products_updated_at
before update on public.dawanear_marketplace_products
for each row execute function dawanear_private.dawanear_touch_updated_at();

alter table public.dawanear_marketplace_products enable row level security;

create policy dawanear_marketplace_products_public_catalogue
on public.dawanear_marketplace_products
for select
to anon, authenticated
using (
  publication_status = 'approved'
  and is_active
  and is_orderable
  and not seller_verification_required
  and lower(compliance_status) = 'approved'
);

revoke all on table public.dawanear_marketplace_products from public, anon, authenticated;
grant select on table public.dawanear_marketplace_products to anon, authenticated;

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

  if new.publication_status = 'approved'
     and new.is_active
     and new.is_orderable
     and not new.seller_verification_required
     and lower(new.compliance_status) = 'approved' then
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
      new.brand_name, coalesce(new.generic_name, new.subcategory), new.strength,
      coalesce(new.dosage_form, new.product_type), new.pack_size, new.shelf_life,
      'consumer_product', v_legacy_category, 'non_prescription', 'valid',
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
  seller_verification_required, compliance_status, brand_name, generic_name,
  strength, dosage_form, pack_size, product_type, category, subcategory,
  manufacturer, manufacturer_country, image_url, source_url, source_refreshed_at
on public.dawanear_marketplace_products
for each row execute function dawanear_private.dawanear_sync_marketplace_product();

create or replace view public.dawanear_all_product_catalog
with (security_invoker = true)
as
select
  c.id, c.registration_number, c.brand_name, c.generic_name, c.strength,
  c.dosage_form, c.pack_size, c.product_type, c.category,
  c.category as department, null::text as subcategory,
  c.prescription_status, c.regulatory_status, c.manufacturer,
  c.manufacturer_country, c.expiry_date, c.image_url, c.is_orderable,
  c.source_name, c.source_url, c.price_min_rwf, c.price_max_rwf,
  c.price_contributors, null::text as amazon_product_url
from public.dawanear_product_catalog as c
where not exists (
  select 1 from public.dawanear_marketplace_products as m where m.id = c.id
)
union all
select
  m.id, m.registration_number, m.brand_name,
  coalesce(m.generic_name, m.subcategory) as generic_name,
  m.strength, coalesce(m.dosage_form, m.product_type) as dosage_form,
  m.pack_size, m.product_type, m.category, m.category as department,
  m.subcategory, 'non_prescription'::text as prescription_status,
  'valid'::text as regulatory_status, m.manufacturer,
  m.manufacturer_country, m.expiry_date, m.image_url, m.is_orderable,
  m.source_name, m.source_url,
  min(pp.price_rwf) filter (where pp.is_current) as price_min_rwf,
  max(pp.price_rwf) filter (where pp.is_current) as price_max_rwf,
  count(pp.product_id) filter (where pp.is_current) as price_contributors,
  m.amazon_product_url
from public.dawanear_marketplace_products as m
left join public.dawanear_pharmacy_prices as pp on pp.product_id = m.id
where m.publication_status = 'approved'
  and m.is_active and m.is_orderable
  and not m.seller_verification_required
  and lower(m.compliance_status) = 'approved'
group by m.id;

revoke all on table public.dawanear_all_product_catalog from public, anon, authenticated;
grant select on table public.dawanear_all_product_catalog to anon, authenticated;

create function public.dawanear_search_marketplace_catalogue(
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
  id text, registration_number text, brand_name text, generic_name text,
  strength text, dosage_form text, pack_size text, product_type text,
  category text, department text, subcategory text,
  prescription_status text, regulatory_status text, manufacturer text,
  manufacturer_country text, expiry_date date, image_url text,
  is_orderable boolean, source_name text, source_url text,
  price_min_rwf integer, price_max_rwf integer, price_contributors bigint,
  amazon_product_url text, match_score double precision,
  match_explanation text, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
with input as (
  select
    left(lower(trim(coalesce(p_query, ''))), 160) as query,
    left(trim(coalesce(p_category, 'All products')), 120) as category,
    case when p_prescription_status in (
      'all', 'prescription', 'non_prescription', 'pharmacist_only', 'unclassified'
    ) then p_prescription_status else 'all' end as prescription_status,
    case when p_form_group in (
      'all', 'tablets', 'liquids', 'injections', 'topical', 'devices', 'other'
    ) then p_form_group else 'all' end as form_group,
    case when p_availability in ('all', 'priced', 'orderable', 'registered')
      then p_availability else 'all' end as availability,
    case when p_sort in ('relevance', 'az', 'za', 'price')
      then p_sort else 'relevance' end as sort,
    least(greatest(coalesce(p_limit, 24), 1), 120) as page_limit,
    least(greatest(coalesce(p_offset, 0), 0), 10000) as page_offset
), products as (
  select
    c.*,
    lower(
      coalesce(c.brand_name, '') || ' ' || coalesce(c.generic_name, '') || ' ' ||
      coalesce(c.strength, '') || ' ' || coalesce(c.dosage_form, '') || ' ' ||
      coalesce(c.pack_size, '') || ' ' || coalesce(c.product_type, '') || ' ' ||
      coalesce(c.category, '') || ' ' || coalesce(c.subcategory, '') || ' ' ||
      coalesce(c.registration_number, '')
    ) as search_text,
    case
      when lower(coalesce(c.dosage_form, '')) ~ '(tablet|caplet|capsule)' then 'tablets'
      when lower(coalesce(c.dosage_form, '')) ~ '(syrup|solution|suspension|drops|liquid)' then 'liquids'
      when lower(coalesce(c.dosage_form, '')) ~ '(injection|infusion|vial|ampoule)' then 'injections'
      when lower(coalesce(c.dosage_form, '')) ~ '(cream|ointment|gel|lotion|topical)' then 'topical'
      when lower(coalesce(c.dosage_form, '')) ~ '(device|meter|monitor|thermometer|inhaler)' then 'devices'
      else 'other'
    end as form_group
  from public.dawanear_all_product_catalog as c
), filtered as (
  select
    products.*,
    input.sort, input.page_limit, input.page_offset,
    case
      when input.query = '' then 1::double precision
      when lower(products.brand_name) = input.query then 1000::double precision
      when lower(coalesce(products.generic_name, '')) = input.query then 900::double precision
      when lower(products.brand_name) like input.query || '%' then 800::double precision
      when products.search_text like '%' || input.query || '%' then 650::double precision
      when pg_catalog.to_tsvector('simple', products.search_text)
        @@ pg_catalog.websearch_to_tsquery('simple', input.query) then 500::double precision
      else 250 * greatest(
        extensions.similarity(lower(products.brand_name), input.query),
        extensions.similarity(lower(coalesce(products.generic_name, '')), input.query)
      )
    end as match_score,
    case
      when input.query = '' then 'Catalogue product'
      when lower(products.brand_name) = input.query then 'Exact product name'
      when lower(coalesce(products.generic_name, '')) = input.query then 'Exact active ingredient or subcategory'
      when lower(products.brand_name) like input.query || '%' then 'Product name prefix'
      when products.search_text like '%' || input.query || '%' then 'Product detail match'
      when pg_catalog.to_tsvector('simple', products.search_text)
        @@ pg_catalog.websearch_to_tsquery('simple', input.query) then 'All search terms matched'
      else 'Close spelling match'
    end as match_explanation
  from products cross join input
  where (
    input.query = ''
    or products.search_text like '%' || input.query || '%'
    or pg_catalog.to_tsvector('simple', products.search_text)
      @@ pg_catalog.websearch_to_tsquery('simple', input.query)
    or greatest(
      extensions.similarity(lower(products.brand_name), input.query),
      extensions.similarity(lower(coalesce(products.generic_name, '')), input.query)
    ) >= 0.28
  ) and (
    input.category = 'All products'
    or products.category = input.category
    or products.department = input.category
    or products.department || ' / ' || coalesce(products.subcategory, '') = input.category
    or (input.category = 'Medicines' and products.category in (
      'Medicines', 'Pain & fever', 'Digestive health', 'Allergy', 'Diabetes care'
    ))
    or (input.category = 'Personal care' and products.department = 'Beauty & Personal Care')
    or (input.category = 'Baby & family' and products.department = 'Baby')
    or (input.category = 'Wellness' and products.department = 'Health & Household')
  ) and (
    input.prescription_status = 'all'
    or products.prescription_status = input.prescription_status
  ) and (input.form_group = 'all' or products.form_group = input.form_group)
  and (
    input.availability = 'all'
    or (input.availability = 'priced' and products.price_contributors > 0 and products.price_min_rwf > 0)
    or (input.availability = 'orderable' and products.is_orderable)
    or (input.availability = 'registered' and products.regulatory_status in ('valid', 'active', 'expiring_soon'))
  )
), counted as (
  select filtered.*, count(*) over () as total_count from filtered
)
select
  counted.id, counted.registration_number, counted.brand_name,
  counted.generic_name, counted.strength, counted.dosage_form,
  counted.pack_size, counted.product_type, counted.category,
  counted.department, counted.subcategory, counted.prescription_status,
  counted.regulatory_status, counted.manufacturer,
  counted.manufacturer_country, counted.expiry_date, counted.image_url,
  counted.is_orderable, counted.source_name, counted.source_url,
  counted.price_min_rwf, counted.price_max_rwf,
  counted.price_contributors, counted.amazon_product_url,
  counted.match_score, counted.match_explanation, counted.total_count
from counted
order by
  case when counted.sort = 'relevance' then counted.match_score end desc nulls last,
  case when counted.sort = 'price' then counted.price_min_rwf end asc nulls last,
  case when counted.sort = 'az' then lower(counted.brand_name) end asc nulls last,
  case when counted.sort = 'za' then lower(counted.brand_name) end desc nulls last,
  lower(counted.brand_name), counted.id
limit (select page_limit from input)
offset (select page_offset from input);
$$;

revoke all on function public.dawanear_search_marketplace_catalogue(
  text, text, text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.dawanear_search_marketplace_catalogue(
  text, text, text, text, text, text, integer, integer
) to anon, authenticated;

comment on function public.dawanear_search_marketplace_catalogue(
  text, text, text, text, text, text, integer, integer
) is
  'Searches the unified medicine and approved consumer-product catalogue without exposing unpublished research candidates or pharmacy identities.';
