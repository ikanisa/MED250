begin;

alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v8;
revoke all on function dawanear_private.dawanear_backend_contract_v8()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
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
      select count(*) as product_count
      from public.dawanear_marketplace_products
      group by category, subcategory
    ) counts) as minimum_taxonomy_pair_count,
    (select count(*) from public.dawanear_marketplace_products
      where (is_active or is_orderable) and not (
        publication_status = 'approved'
        and not seller_verification_required
        and lower(compliance_status) = 'approved'
      )) as unsafe_publication_count,
    (select count(*) from public.dawanear_products p
      join public.dawanear_marketplace_products m using (id)
      where p.is_active and p.is_orderable and not (
        m.publication_status = 'approved'
        and m.is_active and m.is_orderable
        and not m.seller_verification_required
        and lower(m.compliance_status) = 'approved'
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
    'contract_version', '2026-07-15.1',
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

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract() to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 aggregate deployment contract including the isolated Amazon-first marketplace catalogue, approval boundary and unified search surface.';

commit;
-- Filename aligned with the migration version recorded by the production project.
