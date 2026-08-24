begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

create or replace function dawanear_private.dawanear_protect_product_image_governance_ddl()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_constraint_safe boolean;
  v_policy_safe boolean;
  v_trigger_safe boolean;
  v_function_safe boolean;
begin
  if pg_catalog.current_setting(
    'med250.allow_product_image_governance_ddl',
    true
  ) = 'on' then
    return;
  end if;

  if pg_catalog.to_regclass('public.dawanear_product_images') is null then
    return;
  end if;

  select exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dawanear_product_images'::pg_catalog.regclass
      and conname = 'dawanear_product_images_approved_rights_verified'
      and convalidated
  ) into v_constraint_safe;

  select exists (
    select 1
    from pg_catalog.pg_policy
    where polrelid = 'public.dawanear_product_images'::pg_catalog.regclass
      and polname = 'dawanear_product_images_public_read'
      and pg_catalog.pg_get_expr(polqual, polrelid) like '%rights_verified%'
      and pg_catalog.pg_get_expr(polqual, polrelid) like '%background_removed%'
  ) into v_policy_safe;

  select exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.dawanear_product_images'::pg_catalog.regclass
      and tgname = 'dawanear_product_images_publication_guard'
      and not tgisinternal
      and tgenabled <> 'D'
  ) into v_trigger_safe;

  select exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'dawanear_publish_product_images'
      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
        'p_product_id text, p_images jsonb'
      and pg_catalog.pg_get_functiondef(procedure.oid) like '%rights_verified%'
      and pg_catalog.pg_get_functiondef(procedure.oid) like '%background_removed%'
  ) into v_function_safe;

  if not (
    v_constraint_safe
    and v_policy_safe
    and v_trigger_safe
    and v_function_safe
  ) then
    raise exception
      'MED+250 product-image governance DDL is protected; use the reviewed transaction-local override only inside an authorised repair migration'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function dawanear_private.dawanear_protect_product_image_governance_ddl()
  from public, anon, authenticated;

drop event trigger if exists dawanear_protect_product_image_governance_ddl;
create event trigger dawanear_protect_product_image_governance_ddl
on ddl_command_end
execute function dawanear_private.dawanear_protect_product_image_governance_ddl();

comment on event trigger dawanear_protect_product_image_governance_ddl is
  'Rejects DDL that leaves the MED+250 product-image rights constraint, public RLS policy, runtime approval trigger, or publication RPC unsafe.';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dawanear_private.dawanear_backend_contract_v17()'
  ) is null then
    execute 'alter function public.dawanear_backend_contract() set schema dawanear_private';
    execute 'alter function dawanear_private.dawanear_backend_contract() rename to dawanear_backend_contract_v17';
  end if;
end;
$$;
revoke all on function dawanear_private.dawanear_backend_contract_v17()
  from public, anon, authenticated;

create or replace function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v17() as contract
), ddl_guard as (
  select exists (
    select 1
    from pg_catalog.pg_event_trigger
    where evtname = 'dawanear_protect_product_image_governance_ddl'
      and evtenabled <> 'D'
  ) as event_trigger_exists
)
select jsonb_set(
  jsonb_set(
    base.contract,
    '{contract_version}',
    '"2026-07-16.10"'::jsonb,
    true
  ),
  '{product_images}',
  coalesce(base.contract->'product_images', '{}'::jsonb)
    || jsonb_build_object(
      'ddl_guard_event_trigger_exists',
      ddl_guard.event_trigger_exists
    ),
  true
)
from base
cross join ddl_guard;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 deployment contract including the DDL-level product-image governance guard.';

commit;
