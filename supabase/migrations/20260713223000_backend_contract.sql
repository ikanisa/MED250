begin;

-- Versioned, aggregate-only deployment contract. Operations can compare this
-- snapshot with the repository expectation without exposing any marketplace
-- rows, identities, phone numbers, orders, products or prescription metadata.
create or replace function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with function_state as (
    select
      search.prosecdef as search_security_definer,
      search.provolatile as search_volatility,
      coalesce(search.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
      health.prosecdef as health_security_definer,
      coalesce(health.proconfig, '{}'::text[]) @> array['search_path=""'] as health_search_path_locked
    from pg_catalog.pg_proc as search
    join pg_catalog.pg_proc as health
      on health.oid = pg_catalog.to_regprocedure('public.dawanear_operational_health()')
    where search.oid = pg_catalog.to_regprocedure(
      'public.dawanear_search_catalogue(text,text,text,text,text,text,integer,integer)'
    )
  )
  select jsonb_build_object(
    'contract_version', '2026-07-13.3',
    'generated_at', now(),
    'privacy', jsonb_build_object(
      'aggregate_only', true,
      'contains_row_identifiers', false
    ),
    'catalogue_search', jsonb_build_object(
      'exists', pg_catalog.to_regprocedure(
        'public.dawanear_search_catalogue(text,text,text,text,text,text,integer,integer)'
      ) is not null,
      'security_invoker', not function_state.search_security_definer,
      'stable', function_state.search_volatility = 's',
      'search_path_locked', function_state.search_path_locked,
      'anon_can_execute', pg_catalog.has_function_privilege(
        'anon',
        'public.dawanear_search_catalogue(text,text,text,text,text,text,integer,integer)',
        'execute'
      ),
      'authenticated_can_execute', pg_catalog.has_function_privilege(
        'authenticated',
        'public.dawanear_search_catalogue(text,text,text,text,text,text,integer,integer)',
        'execute'
      )
    ),
    'monitoring', jsonb_build_object(
      'health_exists', pg_catalog.to_regprocedure('public.dawanear_operational_health()') is not null,
      'health_security_definer', function_state.health_security_definer,
      'health_search_path_locked', function_state.health_search_path_locked,
      'anon_can_execute_health', pg_catalog.has_function_privilege(
        'anon', 'public.dawanear_operational_health()', 'execute'
      ),
      'authenticated_can_execute_health', pg_catalog.has_function_privilege(
        'authenticated', 'public.dawanear_operational_health()', 'execute'
      ),
      'service_role_can_execute_health', pg_catalog.has_function_privilege(
        'service_role', 'public.dawanear_operational_health()', 'execute'
      )
    ),
    'pharmacy_privacy', jsonb_build_object(
      'anon_can_read_pharmacies', pg_catalog.has_table_privilege(
        'anon', 'public.dawanear_pharmacies', 'select'
      ),
      'authenticated_can_read_pharmacies', pg_catalog.has_table_privilege(
        'authenticated', 'public.dawanear_pharmacies', 'select'
      ),
      'anon_can_read_recipients', pg_catalog.has_table_privilege(
        'anon', 'public.dawanear_order_recipients', 'select'
      ),
      'authenticated_can_read_recipients', pg_catalog.has_table_privilege(
        'authenticated', 'public.dawanear_order_recipients', 'select'
      )
    ),
    'prescriptions', jsonb_build_object(
      'bucket_exists', exists (
        select 1 from storage.buckets as bucket where bucket.id = 'dawanear-prescriptions'
      ),
      'cleanup_claims_rls', coalesce((
        select relation.relrowsecurity
        from pg_catalog.pg_class as relation
        where relation.oid = pg_catalog.to_regclass(
          'dawanear_private.dawanear_prescription_cleanup_claims'
        )
      ), false)
    ),
    'realtime', jsonb_build_object(
      'orders', exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'dawanear_orders'
      ),
      'offers', exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'dawanear_offers'
      ),
      'notifications', exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'dawanear_pharmacy_notifications'
      )
    )
  )
  from function_state;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 backend deployment contract with aggregate schema and privilege invariants only.';

commit;
