begin;

-- Extend the deployment contract from selected critical objects to the full
-- MED+250 database API surface. The output contains counts and boolean state
-- only: no row values, identities, phone numbers, locations, orders, products,
-- prescriptions or object names are returned to the caller.
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
  ),
  med_functions as (
    select
      function.oid,
      function.prosecdef,
      coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
      pg_catalog.has_function_privilege('public', function.oid, 'execute') as public_can_execute,
      pg_catalog.has_function_privilege('anon', function.oid, 'execute') as anon_can_execute,
      pg_catalog.has_function_privilege('authenticated', function.oid, 'execute') as authenticated_can_execute
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.proname like 'dawanear_%'
  ),
  expected_authenticated_definers(signature) as (
    values
      ('public.dawanear_close_order(uuid,text)'),
      ('public.dawanear_contribute_price(uuid,text,integer)'),
      ('public.dawanear_create_order(double precision,double precision,jsonb,uuid,numeric,text,text,boolean,text)'),
      ('public.dawanear_my_active_orders()'),
      ('public.dawanear_my_confirmed_offers(uuid)'),
      ('public.dawanear_my_pharmacies()'),
      ('public.dawanear_pharmacy_requests(uuid)'),
      ('public.dawanear_pharmacy_selected_orders(uuid)'),
      ('public.dawanear_request_pharmacy_contact_edit(uuid,text,text,uuid,text,text)'),
      ('public.dawanear_select_offer(uuid,uuid)'),
      ('public.dawanear_selected_contact(uuid)'),
      ('public.dawanear_submit_offer(uuid,uuid,jsonb,text,integer,text)')
  ),
  med_tables as (
    select
      relation.oid,
      namespace.nspname as schema_name,
      relation.relname as table_name,
      relation.relrowsecurity,
      pg_catalog.has_table_privilege('anon', relation.oid, 'select') as anon_can_select,
      pg_catalog.has_table_privilege('authenticated', relation.oid, 'select') as authenticated_can_select,
      exists (
        select 1 from pg_catalog.pg_policy as policy where policy.polrelid = relation.oid
      ) as has_policy
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'dawanear_private')
      and relation.relkind in ('r', 'p')
      and relation.relname like 'dawanear_%'
  ),
  expected_deny_by_default(schema_name, table_name) as (
    values
      ('dawanear_private', 'dawanear_prescription_cleanup_claims'),
      ('public', 'dawanear_maintenance_runs'),
      ('public', 'dawanear_maintenance_state'),
      ('public', 'dawanear_order_recipients'),
      ('public', 'dawanear_pharmacy_contact_edit_requests'),
      ('public', 'dawanear_pharmacy_contacts'),
      ('public', 'dawanear_pharmacy_identities'),
      ('public', 'dawanear_pharmacy_otp_challenges')
  ),
  expected_authenticated_select(schema_name, table_name) as (
    values
      ('public', 'dawanear_customer_profiles'),
      ('public', 'dawanear_offer_items'),
      ('public', 'dawanear_offers'),
      ('public', 'dawanear_order_items'),
      ('public', 'dawanear_orders'),
      ('public', 'dawanear_pharmacy_claims'),
      ('public', 'dawanear_pharmacy_memberships'),
      ('public', 'dawanear_pharmacy_notifications')
  )
  select jsonb_build_object(
    'contract_version', '2026-07-13.4',
    'generated_at', now(),
    'privacy', jsonb_build_object(
      'aggregate_only', true,
      'contains_row_identifiers', false,
      'contains_object_names', false
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
    ),
    'api_surface', jsonb_build_object(
      'function_count', (select count(*) from med_functions),
      'expected_function_count', 22,
      'public_execute_count', (
        select count(*) from med_functions where public_can_execute
      ),
      'anonymous_security_definer_count', (
        select count(*) from med_functions where prosecdef and anon_can_execute
      ),
      'mutable_security_definer_path_count', (
        select count(*) from med_functions where prosecdef and not search_path_locked
      ),
      'expected_authenticated_security_definer_count', (
        select count(*) from expected_authenticated_definers
      ),
      'missing_authenticated_security_definer_count', (
        select count(*)
        from expected_authenticated_definers as expected
        left join med_functions as actual
          on actual.oid = pg_catalog.to_regprocedure(expected.signature)
        where actual.oid is null
          or not actual.prosecdef
          or not actual.authenticated_can_execute
      ),
      'unexpected_authenticated_security_definer_count', (
        select count(*)
        from med_functions as actual
        where actual.prosecdef
          and actual.authenticated_can_execute
          and not exists (
            select 1
            from expected_authenticated_definers as expected
            where pg_catalog.to_regprocedure(expected.signature) = actual.oid
          )
      )
    ),
    'table_surface', jsonb_build_object(
      'table_count', (select count(*) from med_tables),
      'expected_table_count', 19,
      'rls_disabled_count', (
        select count(*) from med_tables where not relrowsecurity
      ),
      'anonymous_select_count', (
        select count(*) from med_tables where anon_can_select
      ),
      'expected_deny_by_default_count', (
        select count(*) from expected_deny_by_default
      ),
      'missing_deny_by_default_count', (
        select count(*)
        from expected_deny_by_default as expected
        left join med_tables as actual
          on actual.schema_name = expected.schema_name
          and actual.table_name = expected.table_name
        where actual.oid is null
          or not actual.relrowsecurity
          or actual.has_policy
          or actual.anon_can_select
          or actual.authenticated_can_select
      ),
      'unexpected_deny_by_default_count', (
        select count(*)
        from med_tables as actual
        where actual.relrowsecurity
          and not actual.has_policy
          and not exists (
            select 1
            from expected_deny_by_default as expected
            where expected.schema_name = actual.schema_name
              and expected.table_name = actual.table_name
          )
      ),
      'expected_authenticated_select_count', (
        select count(*) from expected_authenticated_select
      ),
      'missing_authenticated_select_count', (
        select count(*)
        from expected_authenticated_select as expected
        left join med_tables as actual
          on actual.schema_name = expected.schema_name
          and actual.table_name = expected.table_name
        where actual.oid is null
          or not actual.relrowsecurity
          or not actual.authenticated_can_select
      ),
      'unexpected_authenticated_select_count', (
        select count(*)
        from med_tables as actual
        where actual.authenticated_can_select
          and not exists (
            select 1
            from expected_authenticated_select as expected
            where expected.schema_name = actual.schema_name
              and expected.table_name = actual.table_name
          )
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
  'Service-only MED+250 aggregate deployment contract including complete API and table-surface allowlists.';

commit;
