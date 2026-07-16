begin;

-- The security hardening migration adds two service-only public functions and
-- four private enforcement triggers. Refresh the aggregate deployment
-- contract so a correctly hardened database passes verification while any
-- partial deployment still fails closed.
alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v7;
revoke all on function dawanear_private.dawanear_backend_contract_v7()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select dawanear_private.dawanear_backend_contract_v7() as contract
  ), otp_issue as (
    select
      function.oid is not null as function_exists,
      coalesce(function.prosecdef, false) as security_definer,
      coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
      coalesce(pg_catalog.has_function_privilege('service_role', function.oid, 'execute'), false) as service_role_can_execute,
      coalesce(pg_catalog.has_function_privilege('anon', function.oid, 'execute'), false) as anon_can_execute,
      coalesce(pg_catalog.has_function_privilege('authenticated', function.oid, 'execute'), false) as authenticated_can_execute
    from (values (
      pg_catalog.to_regprocedure('public.dawanear_issue_pharmacy_otp(text,text,text,timestamptz)')
    )) as resolved(oid)
    left join pg_catalog.pg_proc as function on function.oid = resolved.oid
  ), geocode_approval as (
    select
      function.oid is not null as function_exists,
      coalesce(function.prosecdef, false) as security_definer,
      coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
      coalesce(pg_catalog.has_function_privilege('service_role', function.oid, 'execute'), false) as service_role_can_execute,
      coalesce(pg_catalog.has_function_privilege('anon', function.oid, 'execute'), false) as anon_can_execute,
      coalesce(pg_catalog.has_function_privilege('authenticated', function.oid, 'execute'), false) as authenticated_can_execute
    from (values (
      pg_catalog.to_regprocedure('public.dawanear_approve_geocode_candidate(uuid,text,timestamptz,text,text)')
    )) as resolved(oid)
    left join pg_catalog.pg_proc as function on function.oid = resolved.oid
  ), enforcement as (
    select
      exists (
        select 1 from pg_catalog.pg_trigger
        where tgrelid = pg_catalog.to_regclass('public.dawanear_pharmacy_contacts')
          and tgname = 'dawanear_contacts_retire_authority'
          and tgenabled <> 'D' and not tgisinternal
      ) as contact_retirement_trigger,
      exists (
        select 1 from pg_catalog.pg_trigger
        where tgrelid = pg_catalog.to_regclass('public.dawanear_offer_items')
          and tgname = 'dawanear_offer_items_current_product'
          and tgenabled <> 'D' and not tgisinternal
      ) as offer_product_write_trigger,
      exists (
        select 1 from pg_catalog.pg_trigger
        where tgrelid = pg_catalog.to_regclass('public.dawanear_offers')
          and tgname = 'dawanear_offers_revalidate_products'
          and tgenabled <> 'D' and not tgisinternal
      ) as offer_product_selection_trigger,
      exists (
        select 1 from pg_catalog.pg_trigger
        where tgrelid = pg_catalog.to_regclass('public.dawanear_orders')
          and tgname = 'dawanear_orders_rolling_quota'
          and tgenabled <> 'D' and not tgisinternal
      ) as order_rate_limit_trigger,
      exists (
        select 1 from pg_catalog.pg_proc as function
        where function.oid = pg_catalog.to_regprocedure('public.dawanear_my_active_orders()')
          and position('@.complete == true' in pg_catalog.pg_get_functiondef(function.oid)) > 0
      ) as active_orders_complete_offer_filter,
      exists (
        select 1 from pg_catalog.pg_proc as function
        where function.oid = pg_catalog.to_regprocedure('public.dawanear_selected_contact(uuid)')
          and position('and f.complete' in pg_catalog.pg_get_functiondef(function.oid)) > 0
      ) as selected_contact_complete_offer_guard
  )
  select jsonb_set(
      base.contract,
      '{api_surface,expected_function_count}',
      '26'::jsonb,
      true
    ) || jsonb_build_object(
      'contract_version', '2026-07-14.1',
      'security_hardening', jsonb_build_object(
        'atomic_otp_function_exists', otp_issue.function_exists,
        'atomic_otp_security_definer', otp_issue.security_definer,
        'atomic_otp_search_path_locked', otp_issue.search_path_locked,
        'atomic_otp_service_role_can_execute', otp_issue.service_role_can_execute,
        'atomic_otp_anon_can_execute', otp_issue.anon_can_execute,
        'atomic_otp_authenticated_can_execute', otp_issue.authenticated_can_execute,
        'geocode_approval_function_exists', geocode_approval.function_exists,
        'geocode_approval_security_definer', geocode_approval.security_definer,
        'geocode_approval_search_path_locked', geocode_approval.search_path_locked,
        'geocode_approval_service_role_can_execute', geocode_approval.service_role_can_execute,
        'geocode_approval_anon_can_execute', geocode_approval.anon_can_execute,
        'geocode_approval_authenticated_can_execute', geocode_approval.authenticated_can_execute,
        'contact_retirement_trigger', enforcement.contact_retirement_trigger,
        'offer_product_write_trigger', enforcement.offer_product_write_trigger,
        'offer_product_selection_trigger', enforcement.offer_product_selection_trigger,
        'order_rate_limit_trigger', enforcement.order_rate_limit_trigger,
        'active_orders_complete_offer_filter', enforcement.active_orders_complete_offer_filter,
        'selected_contact_complete_offer_guard', enforcement.selected_contact_complete_offer_guard
      )
    )
  from base cross join otp_issue cross join geocode_approval cross join enforcement;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 aggregate deployment contract including security-hardening functions, triggers and disclosure guards.';

commit;
