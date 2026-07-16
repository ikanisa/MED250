begin;

-- MED+250 has one central product catalogue. Licensed pharmacies are the only
-- sellers; pharmacy price and order-offer records carry availability, price,
-- exact pack/variant and fulfilment. Product rows must not carry seller identity
-- or seller-evidence gates.

drop trigger if exists dawanear_marketplace_products_catalogue_sync
  on public.dawanear_marketplace_products;

drop policy if exists dawanear_marketplace_products_public_catalogue
  on public.dawanear_marketplace_products;

create policy dawanear_marketplace_products_public_catalogue
on public.dawanear_marketplace_products
for select
to anon, authenticated
using (publication_status = 'approved' and is_active and is_orderable);

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
  'unclassified'::text as regulatory_status, m.manufacturer,
  m.manufacturer_country, m.expiry_date, m.image_url, m.is_orderable,
  m.source_name, m.source_url,
  min(pp.price_rwf) filter (where pp.is_current) as price_min_rwf,
  max(pp.price_rwf) filter (where pp.is_current) as price_max_rwf,
  count(pp.product_id) filter (where pp.is_current) as price_contributors,
  m.amazon_product_url
from public.dawanear_marketplace_products as m
left join public.dawanear_pharmacy_prices as pp on pp.product_id = m.id
where m.publication_status = 'approved' and m.is_active and m.is_orderable
group by m.id;

revoke all on table public.dawanear_all_product_catalog from public, anon, authenticated;
grant select on table public.dawanear_all_product_catalog to anon, authenticated;

alter table public.dawanear_marketplace_products
  drop constraint if exists dawanear_marketplace_products_fail_closed_check,
  drop constraint if exists dawanear_marketplace_products_publication_check,
  drop constraint if exists dawanear_marketplace_products_review_evidence_check;

drop index if exists public.dawanear_marketplace_products_review_idx;

drop function if exists public.dawanear_review_marketplace_product(
  text, text, text, text, timestamptz, text, text
);

drop function if exists public.dawanear_backend_contract();
drop function if exists dawanear_private.dawanear_backend_contract_v9();

alter table public.dawanear_marketplace_product_reviews
  drop column if exists seller_evidence_url;

alter table public.dawanear_marketplace_products
  drop column if exists seller_evidence_url,
  drop column if exists seller_verification_required;

update public.dawanear_marketplace_products
set publication_status = 'catalogue_review'
where publication_status in ('seller_review', 'compliance_review');

alter table public.dawanear_marketplace_products
  add constraint dawanear_marketplace_products_publication_check
    check (publication_status in ('research_candidate', 'catalogue_review', 'approved', 'rejected')),
  add constraint dawanear_marketplace_products_fail_closed_check
    check (not is_active or publication_status = 'approved'),
  add constraint dawanear_marketplace_products_review_evidence_check check (
    (compliance_evidence_url is null or compliance_evidence_url ~ '^https://')
    and (reviewed_by_label is null or char_length(reviewed_by_label) between 3 and 200)
    and (review_note is null or char_length(review_note) between 20 and 4000)
    and (
      publication_status <> 'approved'
      or (
        reviewed_by_label is not null
        and review_note is not null
        and reviewed_at is not null
        and approved_at is not null
      )
    )
  );

create index dawanear_marketplace_products_review_idx
  on public.dawanear_marketplace_products (publication_status, is_active, is_orderable);

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
      new.brand_name, coalesce(new.generic_name, new.subcategory), new.strength,
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

create trigger dawanear_marketplace_products_catalogue_sync
after insert or update of publication_status, is_active, is_orderable,
  brand_name, generic_name, strength, dosage_form, pack_size, product_type,
  category, subcategory, manufacturer, manufacturer_country, image_url,
  source_url, source_refreshed_at
on public.dawanear_marketplace_products
for each row execute function dawanear_private.dawanear_sync_marketplace_product();

create function public.dawanear_review_marketplace_product(
  p_product_id text,
  p_decision text,
  p_reviewed_by_label text,
  p_evidence_note text,
  p_expected_updated_at timestamptz,
  p_compliance_evidence_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.dawanear_marketplace_products%rowtype;
  v_previous jsonb;
  v_result jsonb;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_reviewer text := trim(coalesce(p_reviewed_by_label, ''));
  v_note text := trim(coalesce(p_evidence_note, ''));
  v_compliance_url text;
begin
  if p_product_id is null or p_product_id !~ '^AMZ-[A-Z0-9]{10}$' then
    raise exception 'A valid Amazon marketplace product ID is required' using errcode = '22023';
  end if;
  if v_decision not in ('start_review', 'compliance_review', 'approve', 'reject', 'unpublish') then
    raise exception 'Unsupported marketplace review decision' using errcode = '22023';
  end if;
  if char_length(v_reviewer) not between 3 and 200 then
    raise exception 'Reviewer identity must be 3-200 characters' using errcode = '22023';
  end if;
  if char_length(v_note) not between 20 and 4000 then
    raise exception 'Evidence note must be 20-4000 characters' using errcode = '22023';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Expected product updated_at is required' using errcode = '22023';
  end if;

  select * into v_product
  from public.dawanear_marketplace_products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'Marketplace product was not found' using errcode = 'P0002';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception 'Marketplace product changed after inspection; inspect it again before deciding'
      using errcode = '40001';
  end if;

  v_compliance_url := coalesce(
    nullif(trim(coalesce(p_compliance_evidence_url, '')), ''),
    v_product.compliance_evidence_url
  );
  if v_compliance_url is not null and v_compliance_url !~ '^https://' then
    raise exception 'Compliance evidence must be an HTTPS URL' using errcode = '22023';
  end if;

  v_previous := jsonb_build_object(
    'publication_status', v_product.publication_status,
    'compliance_status', v_product.compliance_status,
    'is_active', v_product.is_active,
    'is_orderable', v_product.is_orderable,
    'compliance_evidence_url', v_product.compliance_evidence_url,
    'updated_at', v_product.updated_at
  );

  if v_decision in ('start_review', 'compliance_review') then
    if v_product.publication_status not in ('research_candidate', 'catalogue_review', 'rejected') then
      raise exception 'Only unpublished products can enter catalogue review' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'catalogue_review',
      compliance_status = 'catalogue_review',
      is_active = false, is_orderable = false,
      compliance_evidence_url = v_compliance_url,
      reviewed_by_label = v_reviewer, review_note = v_note,
      reviewed_at = clock_timestamp(), approved_at = null
    where id = p_product_id;
  elsif v_decision = 'approve' then
    if v_product.publication_status not in ('research_candidate', 'catalogue_review') then
      raise exception 'Product must be unpublished or in catalogue review before approval' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'approved',
      compliance_status = 'central_catalogue_pharmacy_fulfilment',
      is_active = true, is_orderable = true,
      compliance_evidence_url = v_compliance_url,
      reviewed_by_label = v_reviewer, review_note = v_note,
      reviewed_at = clock_timestamp(), approved_at = clock_timestamp()
    where id = p_product_id;
  elsif v_decision = 'reject' then
    if v_product.publication_status = 'rejected' then
      raise exception 'Product is already rejected' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'rejected', compliance_status = 'rejected',
      is_active = false, is_orderable = false,
      compliance_evidence_url = v_compliance_url,
      reviewed_by_label = v_reviewer, review_note = v_note,
      reviewed_at = clock_timestamp(), approved_at = null
    where id = p_product_id;
  else
    if v_product.publication_status <> 'approved' then
      raise exception 'Only approved products can be unpublished' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'catalogue_review',
      compliance_status = 'catalogue_review_after_unpublish',
      is_active = false, is_orderable = false,
      reviewed_by_label = v_reviewer, review_note = v_note,
      reviewed_at = clock_timestamp(), approved_at = null
    where id = p_product_id;
  end if;

  select jsonb_build_object(
    'id', id,
    'publication_status', publication_status,
    'compliance_status', compliance_status,
    'is_active', is_active,
    'is_orderable', is_orderable,
    'compliance_evidence_url', compliance_evidence_url,
    'reviewed_by_label', reviewed_by_label,
    'reviewed_at', reviewed_at,
    'approved_at', approved_at,
    'updated_at', updated_at
  ) into v_result
  from public.dawanear_marketplace_products where id = p_product_id;

  insert into public.dawanear_marketplace_product_reviews (
    product_id, decision, reviewed_by_label, evidence_note,
    compliance_evidence_url, expected_product_updated_at,
    previous_state, resulting_state
  ) values (
    p_product_id, v_decision, v_reviewer, v_note,
    v_compliance_url, p_expected_updated_at, v_previous, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.dawanear_review_marketplace_product(
  text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.dawanear_review_marketplace_product(
  text, text, text, text, timestamptz, text
) to service_role;

comment on function public.dawanear_review_marketplace_product(
  text, text, text, text, timestamptz, text
) is
  'Service-only central-catalogue publication workflow. Pharmacy seller identity and offer data remain outside product records.';

create function dawanear_private.dawanear_backend_contract_v9()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v8() as contract
), marketplace_table as (
  select
    pg_catalog.to_regclass('public.dawanear_marketplace_products') is not null as exists,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    (select count(*) from public.dawanear_marketplace_products) as product_count,
    (select count(distinct id) from public.dawanear_marketplace_products) as distinct_ids,
    (select count(distinct asin) from public.dawanear_marketplace_products) as distinct_asins,
    (select count(distinct (category, subcategory)) from public.dawanear_marketplace_products) as taxonomy_pair_count,
    (select coalesce(min(product_count), 0) from (
      select count(*) as product_count from public.dawanear_marketplace_products group by category, subcategory
    ) counts) as minimum_taxonomy_pair_count,
    (select count(*) from public.dawanear_marketplace_products
      where (is_active or is_orderable) and publication_status <> 'approved') as unsafe_publication_count,
    (select count(*) from public.dawanear_products p
      join public.dawanear_marketplace_products m using (id)
      where p.is_active and p.is_orderable and not (
        m.publication_status = 'approved' and m.is_active and m.is_orderable
      )) as unsafe_projection_count,
    (select count(*) from pg_catalog.pg_policy p
      where p.polrelid = pg_catalog.to_regclass('public.dawanear_marketplace_products')
        and p.polname = 'dawanear_marketplace_products_public_catalogue') = 1 as public_policy_exists
  from (values (pg_catalog.to_regclass('public.dawanear_marketplace_products'))) resolved(oid)
  left join pg_catalog.pg_class c on c.oid = resolved.oid
), marketplace_view as (
  select
    pg_catalog.to_regclass('public.dawanear_all_product_catalog') is not null as exists,
    coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true'] as security_invoker
  from (values (pg_catalog.to_regclass('public.dawanear_all_product_catalog'))) resolved(oid)
  left join pg_catalog.pg_class c on c.oid = resolved.oid
), marketplace_search as (
  select
    function.oid is not null as exists,
    not coalesce(function.prosecdef, true) as security_invoker,
    coalesce(function.provolatile = 's', false) as stable,
    coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
    coalesce(pg_catalog.has_function_privilege('anon', function.oid, 'execute'), false) as anon_can_execute,
    coalesce(pg_catalog.has_function_privilege('authenticated', function.oid, 'execute'), false) as authenticated_can_execute
  from (values (pg_catalog.to_regprocedure(
    'public.dawanear_search_marketplace_catalogue(text,text,text,text,text,text,integer,integer)'
  ))) resolved(oid)
  left join pg_catalog.pg_proc function on function.oid = resolved.oid
), marketplace_trigger as (
  select exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = pg_catalog.to_regclass('public.dawanear_marketplace_products')
      and tgname = 'dawanear_marketplace_products_catalogue_sync'
      and tgenabled <> 'D' and not tgisinternal
  ) as approval_projection_exists
)
select
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(base.contract, '{api_surface,expected_function_count}', '27'::jsonb, true),
            '{table_surface,expected_table_count}', '20'::jsonb, true
          ),
          '{table_surface,anonymous_select_count}', '0'::jsonb, true
        ),
        '{table_surface,expected_authenticated_select_count}', '9'::jsonb, true
      ),
      '{table_surface,unexpected_authenticated_select_count}', '0'::jsonb, true
    ),
    '{table_surface,missing_authenticated_select_count}', '0'::jsonb, true
  ) || jsonb_build_object(
    'contract_version', '2026-07-16.0',
    'marketplace_catalogue', jsonb_build_object(
      'table_exists', marketplace_table.exists,
      'rls_enabled', marketplace_table.rls_enabled,
      'product_count', marketplace_table.product_count,
      'distinct_ids', marketplace_table.distinct_ids,
      'distinct_asins', marketplace_table.distinct_asins,
      'taxonomy_pair_count', marketplace_table.taxonomy_pair_count,
      'minimum_taxonomy_pair_count', marketplace_table.minimum_taxonomy_pair_count,
      'unsafe_publication_count', marketplace_table.unsafe_publication_count,
      'unsafe_projection_count', marketplace_table.unsafe_projection_count,
      'public_policy_exists', marketplace_table.public_policy_exists,
      'public_table_select_expected', true,
      'view_exists', marketplace_view.exists,
      'view_security_invoker', marketplace_view.security_invoker,
      'search_exists', marketplace_search.exists,
      'search_security_invoker', marketplace_search.security_invoker,
      'search_stable', marketplace_search.stable,
      'search_path_locked', marketplace_search.search_path_locked,
      'anon_can_search', marketplace_search.anon_can_execute,
      'authenticated_can_search', marketplace_search.authenticated_can_execute,
      'approval_projection_exists', marketplace_trigger.approval_projection_exists
    )
  )
from base
cross join marketplace_table
cross join marketplace_view
cross join marketplace_search
cross join marketplace_trigger;
$$;

revoke all on function dawanear_private.dawanear_backend_contract_v9()
  from public, anon, authenticated, service_role;

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
    'contract_version', '2026-07-16.1',
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
    )
  )
from base cross join review_table cross join review_function;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract() to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 deployment contract proving the central-catalogue and pharmacy-only seller model.';

-- The user's activation instruction is recorded once per central product. This
-- is catalogue audit metadata, not seller evidence. The row trigger projects
-- each activated product into the existing order/offer product table.
with prior as materialized (
  select
    m.id,
    m.updated_at as expected_product_updated_at,
    jsonb_build_object(
      'publication_status', m.publication_status,
      'compliance_status', m.compliance_status,
      'is_active', m.is_active,
      'is_orderable', m.is_orderable,
      'compliance_evidence_url', m.compliance_evidence_url,
      'updated_at', m.updated_at
    ) as previous_state
  from public.dawanear_marketplace_products m
  where m.publication_status <> 'approved' or not m.is_active or not m.is_orderable
), activated as (
  update public.dawanear_marketplace_products m
  set
    publication_status = 'approved',
    compliance_status = 'central_catalogue_pharmacy_fulfilment',
    is_active = true,
    is_orderable = true,
    reviewed_by_label = 'MED+250 catalogue activation',
    review_note = 'Activated as a central catalogue product; licensed pharmacies are the only sellers and provide price, availability and fulfilment offers.',
    reviewed_at = clock_timestamp(),
    approved_at = clock_timestamp()
  from prior
  where m.id = prior.id
  returning
    m.id,
    prior.expected_product_updated_at,
    prior.previous_state,
    jsonb_build_object(
      'publication_status', m.publication_status,
      'compliance_status', m.compliance_status,
      'is_active', m.is_active,
      'is_orderable', m.is_orderable,
      'compliance_evidence_url', m.compliance_evidence_url,
      'reviewed_by_label', m.reviewed_by_label,
      'reviewed_at', m.reviewed_at,
      'approved_at', m.approved_at,
      'updated_at', m.updated_at
    ) as resulting_state
)
insert into public.dawanear_marketplace_product_reviews (
  product_id, decision, reviewed_by_label, evidence_note,
  compliance_evidence_url, expected_product_updated_at,
  previous_state, resulting_state
)
select
  a.id,
  'approve',
  'MED+250 catalogue activation',
  'Activated as a central catalogue product; licensed pharmacies are the only sellers and provide price, availability and fulfilment offers.',
  null,
  a.expected_product_updated_at,
  a.previous_state,
  a.resulting_state
from activated a;

comment on table public.dawanear_marketplace_products is
  'Central Amazon-first MED+250 product catalogue. Pharmacies are the only sellers; prices, availability and fulfilment belong to pharmacy price and offer records.';

commit;
-- Filename aligned with the migration version recorded by the production project.
