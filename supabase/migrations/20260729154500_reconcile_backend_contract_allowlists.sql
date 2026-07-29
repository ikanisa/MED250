begin;

-- Production protects product-image governance behind a database-wide DDL
-- event trigger. This migration changes only the service-only release
-- contract and one public helper grant, so use the documented local override.
set local med250.allow_product_image_governance_ddl = 'on';

-- This immutable helper is reached through the two allowlisted search RPCs.
-- It does not need a direct PUBLIC grant.
revoke all on function public.dawanear_normalize_marketplace_query(text)
  from public;
grant execute on function public.dawanear_normalize_marketplace_query(text)
  to anon, authenticated;

alter function public.dawanear_backend_contract() set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v23;
revoke all on function dawanear_private.dawanear_backend_contract_v23()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with base as materialized (
  select dawanear_private.dawanear_backend_contract_v23() as contract
), expected_authenticated_definers(signature) as (
  values
    ('public.dawanear_close_order(uuid,text)'),
    ('public.dawanear_contribute_central_price(uuid,text,integer)'),
    ('public.dawanear_contribute_price(uuid,text,integer)'),
    ('public.dawanear_create_order(double precision,double precision,jsonb,uuid,numeric,text,text,boolean,text)'),
    ('public.dawanear_my_active_orders()'),
    ('public.dawanear_my_confirmed_offers(uuid)'),
    ('public.dawanear_my_pharmacies()'),
    ('public.dawanear_my_pharmacy_contacts(uuid)'),
    ('public.dawanear_pharmacy_requests(uuid)'),
    ('public.dawanear_pharmacy_selected_orders(uuid)'),
    ('public.dawanear_public_trust_metrics()'),
    ('public.dawanear_request_pharmacy_contact_edit(uuid,text,text,uuid,text,text)'),
    ('public.dawanear_select_offer(uuid,uuid)'),
    ('public.dawanear_selected_contact(uuid)'),
    ('public.dawanear_submit_offer(uuid,uuid,jsonb,text,integer,text)')
), med_functions as materialized (
  select
    function.oid,
    function.prosecdef,
    pg_catalog.has_function_privilege(
      'public', function.oid, 'execute'
    ) as public_can_execute,
    pg_catalog.has_function_privilege(
      'authenticated', function.oid, 'execute'
    ) as authenticated_can_execute
  from pg_catalog.pg_proc as function
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = function.pronamespace
  where namespace.nspname = 'public'
    and function.proname like 'dawanear_%'
), function_surface as (
  select
    (select count(*) from med_functions) as function_count,
    (
      select count(*) from med_functions
      where public_can_execute
    ) as public_execute_count,
    (
      select count(*)
      from expected_authenticated_definers as expected
      left join med_functions as actual
        on actual.oid = pg_catalog.to_regprocedure(expected.signature)
      where actual.oid is null
        or not actual.prosecdef
        or not actual.authenticated_can_execute
    ) as missing_authenticated_security_definer_count,
    (
      select count(*)
      from med_functions as actual
      where actual.prosecdef
        and actual.authenticated_can_execute
        and not exists (
          select 1
          from expected_authenticated_definers as expected
          where pg_catalog.to_regprocedure(expected.signature) = actual.oid
        )
    ) as unexpected_authenticated_security_definer_count
), table_surface as (
  select count(*) as table_count
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname in ('public', 'dawanear_private')
    and relation.relkind in ('r', 'p')
    and relation.relname like 'dawanear_%'
), review_functions as (
  select
    coalesce(description_review.proconfig, '{}'::text[])
      @> array['search_path=""'] as description_search_path_locked,
    coalesce(identity_binding.proconfig, '{}'::text[])
      @> array['search_path=""'] as identity_search_path_locked
  from pg_catalog.pg_proc as description_review
  cross join pg_catalog.pg_proc as identity_binding
  where description_review.oid = pg_catalog.to_regprocedure(
    'public.dawanear_review_product_description(text,text,timestamptz,text,text,timestamptz,text,text,text,text,text,text,text,boolean,text)'
  )
    and identity_binding.oid = pg_catalog.to_regprocedure(
      'public.dawanear_bind_pharmacy_identity(text,uuid)'
    )
)
select base.contract
  || jsonb_build_object(
    'product_description_workflow',
      coalesce(base.contract->'product_description_workflow', '{}'::jsonb)
      || jsonb_build_object(
        'review_function_search_path_locked',
        review_functions.description_search_path_locked
      ),
    'pharmacy_identity_binding',
      coalesce(base.contract->'pharmacy_identity_binding', '{}'::jsonb)
      || jsonb_build_object(
        'search_path_locked',
        review_functions.identity_search_path_locked
      ),
    'api_surface',
      coalesce(base.contract->'api_surface', '{}'::jsonb)
      || jsonb_build_object(
        'function_count', function_surface.function_count,
        'expected_function_count', 41,
        'public_execute_count', function_surface.public_execute_count,
        'expected_authenticated_security_definer_count',
          (select count(*) from expected_authenticated_definers),
        'missing_authenticated_security_definer_count',
          function_surface.missing_authenticated_security_definer_count,
        'unexpected_authenticated_security_definer_count',
          function_surface.unexpected_authenticated_security_definer_count
      ),
    'table_surface',
      coalesce(base.contract->'table_surface', '{}'::jsonb)
      || jsonb_build_object(
        'table_count', table_surface.table_count,
        'expected_table_count', 27
      )
  )
from base
cross join function_surface
cross join table_surface
cross join review_functions;
$function$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 release contract with the complete production function and table allowlists, exact privileged-function checks, and canonical empty search paths.';

commit;
