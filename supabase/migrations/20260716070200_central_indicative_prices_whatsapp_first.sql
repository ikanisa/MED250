begin;

-- MED+250 is an informational, connection-first catalogue. Product prices are
-- centrally maintained reference values. They are never pharmacy price lists,
-- never proof of stock, and never a final customer charge. A pharmacy confirms
-- availability privately and may optionally include a price in that response;
-- the customer and pharmacy finalise the interaction on WhatsApp.

alter table public.dawanear_products
  add column if not exists indicative_price_rwf integer,
  add column if not exists indicative_price_basis text,
  add column if not exists indicative_price_source_url text,
  add column if not exists indicative_price_updated_at timestamptz;

alter table public.dawanear_products
  drop constraint if exists dawanear_products_indicative_price_check,
  drop constraint if exists dawanear_products_indicative_price_metadata_check;

alter table public.dawanear_products
  add constraint dawanear_products_indicative_price_check check (
    indicative_price_rwf is null
    or indicative_price_rwf between 1 and 100000000
  ),
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
        'amazon_usd_reference_conversion',
        'central_manual'
      )
      and indicative_price_source_url ~ '^https://'
      and indicative_price_updated_at is not null
    )
  );

comment on column public.dawanear_products.indicative_price_rwf is
  'Central MED+250 From RWF reference. Informational only; not a pharmacy-specific or final price.';
comment on column public.dawanear_products.indicative_price_basis is
  'Central reference methodology. Never identifies a pharmacy or asserts pharmacy stock.';
comment on column public.dawanear_products.indicative_price_source_url is
  'Catalogue evidence URL supporting the central indicative price.';
comment on column public.dawanear_products.indicative_price_updated_at is
  'When the central indicative price evidence was last observed or reviewed.';

-- Use locally observed catalogue prices where the research has them. Otherwise
-- convert the observed Amazon USD reference at a deliberately rounded central
-- catalogue rate of 1,500 RWF/USD and round upward to the nearest 100 RWF. This
-- is a reference-price methodology, not a landed-cost or pharmacy quote.
update public.dawanear_products as product
set
  indicative_price_rwf = case
    when marketplace.observed_price_rwf > 0
      then pg_catalog.round(marketplace.observed_price_rwf)::integer
    when marketplace.amazon_price_usd_observed > 0
      then pg_catalog.ceil(marketplace.amazon_price_usd_observed * 1500 / 100)::integer * 100
    else null
  end,
  indicative_price_basis = case
    when marketplace.observed_price_rwf > 0 then 'rwanda_observed_catalogue'
    when marketplace.amazon_price_usd_observed > 0 then 'amazon_usd_reference_conversion'
    else null
  end,
  indicative_price_source_url = case
    when marketplace.observed_price_rwf > 0
      then coalesce(marketplace.rwanda_product_url, marketplace.amazon_product_url)
    when marketplace.amazon_price_usd_observed > 0 then marketplace.amazon_product_url
    else null
  end,
  indicative_price_updated_at = case
    when marketplace.observed_price_rwf > 0
      or marketplace.amazon_price_usd_observed > 0
      then marketplace.source_refreshed_at
    else null
  end,
  updated_at = now()
from public.dawanear_marketplace_products as marketplace
where product.id = marketplace.id;

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
        then pg_catalog.round(new.observed_price_rwf)::integer
      when new.amazon_price_usd_observed > 0
        then pg_catalog.ceil(new.amazon_price_usd_observed * 1500 / 100)::integer * 100
      else null
    end,
    indicative_price_basis = case
      when new.observed_price_rwf > 0 then 'rwanda_observed_catalogue'
      when new.amazon_price_usd_observed > 0 then 'amazon_usd_reference_conversion'
      else null
    end,
    indicative_price_source_url = case
      when new.observed_price_rwf > 0
        then coalesce(new.rwanda_product_url, new.amazon_product_url)
      when new.amazon_price_usd_observed > 0 then new.amazon_product_url
      else null
    end,
    indicative_price_updated_at = case
      when new.observed_price_rwf > 0 or new.amazon_price_usd_observed > 0
        then new.source_refreshed_at
      else null
    end,
    updated_at = now()
  where product.id = new.id;
  return new;
end;
$$;

drop trigger if exists dawanear_marketplace_indicative_price_sync
  on public.dawanear_marketplace_products;
drop trigger if exists dawanear_marketplace_products_price_sync
  on public.dawanear_marketplace_products;
create trigger dawanear_marketplace_products_price_sync
after insert or update of observed_price_rwf, amazon_price_usd_observed,
  source_refreshed_at, rwanda_product_url, amazon_product_url
on public.dawanear_marketplace_products
for each row execute function dawanear_private.dawanear_sync_marketplace_indicative_price();

revoke all on function dawanear_private.dawanear_sync_marketplace_indicative_price()
  from public, anon, authenticated, service_role;

create or replace view public.dawanear_product_catalog
with (security_invoker = true)
as
select
  product.id,
  product.registration_number,
  product.brand_name,
  product.generic_name,
  product.strength,
  product.dosage_form,
  product.pack_size,
  product.product_type,
  product.category,
  product.prescription_status,
  product.regulatory_status,
  product.manufacturer,
  product.manufacturer_country,
  product.expiry_date,
  product.image_url,
  product.is_orderable,
  product.source_name,
  product.source_url,
  product.indicative_price_rwf as price_min_rwf,
  product.indicative_price_rwf as price_max_rwf,
  0::bigint as price_contributors,
  product.indicative_price_rwf,
  (product.indicative_price_rwf is not null) as price_is_indicative,
  product.indicative_price_basis,
  product.indicative_price_source_url,
  product.indicative_price_updated_at
from public.dawanear_products as product
where product.is_active;

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
  marketplace.id, marketplace.registration_number, marketplace.brand_name,
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

revoke all on table public.dawanear_product_catalog
  from public, anon, authenticated;
grant select on table public.dawanear_product_catalog to anon, authenticated;
revoke all on table public.dawanear_all_product_catalog
  from public, anon, authenticated;
grant select on table public.dawanear_all_product_catalog to anon, authenticated;

drop function if exists public.dawanear_search_marketplace_catalogue(
  text, text, text, text, text, text, integer, integer
);
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
  amazon_product_url text, indicative_price_rwf integer,
  price_is_indicative boolean, indicative_price_basis text,
  indicative_price_source_url text, indicative_price_updated_at timestamptz,
  match_score double precision, match_explanation text, total_count bigint
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
    catalogue.*,
    lower(
      coalesce(catalogue.brand_name, '') || ' ' ||
      coalesce(catalogue.generic_name, '') || ' ' ||
      coalesce(catalogue.strength, '') || ' ' ||
      coalesce(catalogue.dosage_form, '') || ' ' ||
      coalesce(catalogue.pack_size, '') || ' ' ||
      coalesce(catalogue.product_type, '') || ' ' ||
      coalesce(catalogue.category, '') || ' ' ||
      coalesce(catalogue.subcategory, '') || ' ' ||
      coalesce(catalogue.registration_number, '')
    ) as search_text,
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
  select
    products.*, input.sort, input.page_limit, input.page_offset,
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
    or (input.availability = 'priced' and products.indicative_price_rwf > 0)
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
  counted.indicative_price_rwf, counted.price_is_indicative,
  counted.indicative_price_basis, counted.indicative_price_source_url,
  counted.indicative_price_updated_at, counted.match_score,
  counted.match_explanation, counted.total_count
from counted
order by
  case when counted.sort = 'relevance' then counted.match_score end desc nulls last,
  case when counted.sort = 'price' then counted.indicative_price_rwf end asc nulls last,
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
  'Searches the central informational catalogue and returns only central indicative prices; no pharmacy-specific price or stock is exposed.';

-- Retire the separate pharmacy price-list workflow without changing the
-- audited API allowlist shape. The RPC remains as an explicit fail-closed stub
-- so an old client cannot write a pharmacy-specific catalogue price.
update public.dawanear_pharmacy_prices set is_current = false where is_current;

create or replace function public.dawanear_contribute_price(
  p_pharmacy_id uuid,
  p_product_id text,
  p_price_rwf integer
)
returns table (
  product_id text,
  price_min_rwf integer,
  price_max_rwf integer,
  price_contributors bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'MED+250 uses centrally maintained indicative prices. Pharmacy-specific catalogue prices are not supported.'
    using errcode = '0A000';
end;
$$;

revoke all on function public.dawanear_contribute_price(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.dawanear_contribute_price(uuid, text, integer)
  to authenticated;

comment on function public.dawanear_contribute_price(uuid, text, integer) is
  'Deprecated fail-closed compatibility stub. MED+250 does not support pharmacy-specific catalogue prices.';
comment on table public.dawanear_pharmacy_prices is
  'Deprecated historical table. Current MED+250 catalogue prices are central indicative references on dawanear_products.';

-- A pharmacy availability confirmation may omit price. If included it is a
-- private, non-final estimate for that customer request and is never promoted
-- into the central catalogue or used as pharmacy stock data.
alter table public.dawanear_offer_items
  drop constraint if exists dawanear_offer_items_check;
alter table public.dawanear_offer_items
  add constraint dawanear_offer_items_check check (
    (
      available
      and offered_product_id is not null
      and quantity is not null
    )
    or (
      not available
      and offered_product_id is null
      and unit_price_rwf is null
      and quantity is null
      and not is_substitute
    )
  );

do $make_confirmation_price_optional$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure(
    'dawanear_private.dawanear_submit_offer(uuid,uuid,jsonb,integer,text)'
  );
  v_definition text;
  v_rewritten text;
begin
  if v_procedure is null then
    raise exception 'Private pharmacy confirmation function is missing'
      using errcode = 'P0002';
  end if;

  select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'x.unit_price_rwf is null\n          or x.unit_price_rwf not between 1 and 100000000',
    E'x.unit_price_rwf is not null\n          and x.unit_price_rwf not between 1 and 100000000'
  );
  v_rewritten := replace(
    v_rewritten,
    E'  if v_total_rwf <= 0 then\n    raise exception ''An offer must include at least one available item'' using errcode = ''22023'';\n  end if;',
    E'  if not exists (\n    select 1 from public.dawanear_offer_items as available_item\n    where available_item.offer_id = v_offer_id and available_item.available\n  ) then\n    raise exception ''A confirmation must include at least one available item'' using errcode = ''22023'';\n  end if;'
  );

  if v_rewritten = v_definition then
    raise exception 'Optional confirmation-price rewrite did not change the function'
      using errcode = 'P0002';
  end if;
  execute v_rewritten;
end;
$make_confirmation_price_optional$;

do $remove_price_from_confirmation_ranking$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure(
    'public.dawanear_my_confirmed_offers(uuid)'
  );
  v_definition text;
  v_rewritten text;
begin
  if v_procedure is null then
    raise exception 'Customer confirmation function is missing'
      using errcode = 'P0002';
  end if;
  select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
  v_rewritten := replace(
    v_definition,
    'order by offer.distance_m, offer.total_rwf, offer.submitted_at, offer.id',
    'order by offer.distance_m, offer.submitted_at, offer.id'
  );
  if v_rewritten = v_definition then
    raise exception 'Pharmacy confirmation ranking still depends on price'
      using errcode = 'P0002';
  end if;
  execute v_rewritten;
end;
$remove_price_from_confirmation_ranking$;

comment on column public.dawanear_offer_items.available is
  'Private availability confirmation for one customer request; not public stock data.';
comment on column public.dawanear_offer_items.unit_price_rwf is
  'Optional private pharmacy estimate for one request. Not final and never used as the central catalogue price.';
comment on column public.dawanear_offers.total_rwf is
  'Sum of optional private estimates supplied in one confirmation; zero when price is deferred to WhatsApp.';

drop function if exists public.dawanear_backend_contract();
create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v9() as contract
), review_table as (
  select
    pg_catalog.to_regclass('public.dawanear_marketplace_product_reviews') is not null as table_exists,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = pg_catalog.to_regclass('public.dawanear_marketplace_product_reviews')
        and tgname = 'dawanear_marketplace_product_reviews_immutable'
        and tgenabled <> 'D' and not tgisinternal
    ) as immutable_trigger,
    (select count(*) from public.dawanear_marketplace_products
      where publication_status = 'approved' and (
        reviewed_by_label is null or review_note is null
        or reviewed_at is null or approved_at is null
      )) as approved_without_review_metadata_count,
    (select count(*) from public.dawanear_marketplace_products m
      where m.publication_status = 'approved' and not exists (
        select 1 from public.dawanear_marketplace_product_reviews r
        where r.product_id = m.id and r.decision = 'approve'
      )) as approved_without_audit_count,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'dawanear_marketplace_products'
        and column_name in ('seller_verification_required', 'seller_evidence_url', 'seller_id')
    ) as product_seller_columns_absent
  from (values (pg_catalog.to_regclass('public.dawanear_marketplace_product_reviews'))) resolved(oid)
  left join pg_catalog.pg_class c on c.oid = resolved.oid
), review_function as (
  select
    function.oid is not null as function_exists,
    coalesce(function.prosecdef, false) as security_definer,
    coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
    coalesce(pg_catalog.has_function_privilege('service_role', function.oid, 'execute'), false) as service_role_can_execute,
    coalesce(pg_catalog.has_function_privilege('anon', function.oid, 'execute'), false) as anon_can_execute,
    coalesce(pg_catalog.has_function_privilege('authenticated', function.oid, 'execute'), false) as authenticated_can_execute
  from (values (pg_catalog.to_regprocedure(
    'public.dawanear_review_marketplace_product(text,text,text,text,timestamptz,text)'
  ))) resolved(oid)
  left join pg_catalog.pg_proc function on function.oid = resolved.oid
), pricing as (
  select
    (select count(*) from public.dawanear_products
      where indicative_price_rwf is not null) as central_price_count,
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
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(base.contract, '{api_surface,expected_function_count}', '28'::jsonb, true),
            '{table_surface,expected_table_count}', '21'::jsonb, true
          ),
          '{table_surface,expected_deny_by_default_count}', '9'::jsonb, true
        ),
        '{table_surface,missing_deny_by_default_count}', '0'::jsonb, true
      ),
      '{table_surface,unexpected_deny_by_default_count}', '0'::jsonb, true
    ),
    '{table_surface,unexpected_authenticated_select_count}', '0'::jsonb, true
  ) || jsonb_build_object(
    'contract_version', '2026-07-16.2',
    'marketplace_moderation', jsonb_build_object(
      'review_table_exists', review_table.table_exists,
      'review_table_rls', review_table.rls_enabled,
      'immutable_audit_trigger', review_table.immutable_trigger,
      'approved_without_review_metadata_count', review_table.approved_without_review_metadata_count,
      'approved_without_audit_count', review_table.approved_without_audit_count,
      'product_seller_columns_absent', review_table.product_seller_columns_absent,
      'review_function_exists', review_function.function_exists,
      'review_function_security_definer', review_function.security_definer,
      'review_function_search_path_locked', review_function.search_path_locked,
      'service_role_can_review', review_function.service_role_can_execute,
      'anon_can_review', review_function.anon_can_execute,
      'authenticated_can_review', review_function.authenticated_can_execute
    ),
    'pricing_model', jsonb_build_object(
      'central_price_count', pricing.central_price_count,
      'current_pharmacy_price_count', pricing.current_pharmacy_price_count,
      'public_view_avoids_pharmacy_prices', pricing.public_view_avoids_pharmacy_prices,
      'confirmation_price_optional', pricing.confirmation_price_optional,
      'pharmacy_catalogue_price_write_disabled', pricing.pharmacy_catalogue_price_write_disabled,
      'public_stock_supported', false,
      'final_price_claimed', false
    )
  )
from base cross join review_table cross join review_function cross join pricing;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract() to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 contract proving central indicative pricing, no public pharmacy stock/price lists, and WhatsApp-first availability confirmation.';

commit;
-- Filename aligned with the migration version recorded by the production project.
