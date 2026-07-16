begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

create or replace function dawanear_private.dawanear_enforce_product_image_publication_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.approved and (not new.rights_verified or not new.background_removed) then
    raise exception
      'Approved product images require verified reuse rights and a removed background'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_enforce_product_image_publication_guard()
  from public, anon, authenticated;

drop trigger if exists dawanear_product_images_publication_guard
  on public.dawanear_product_images;
create trigger dawanear_product_images_publication_guard
before insert or update of approved, rights_verified, background_removed
on public.dawanear_product_images
for each row
execute function dawanear_private.dawanear_enforce_product_image_publication_guard();

comment on trigger dawanear_product_images_publication_guard
  on public.dawanear_product_images is
  'Defense-in-depth guard that rejects unsafe public image approval even if another schema change removes the equivalent check constraint.';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dawanear_private.dawanear_backend_contract_v16()'
  ) is null then
    execute 'alter function public.dawanear_backend_contract() set schema dawanear_private';
    execute 'alter function dawanear_private.dawanear_backend_contract() rename to dawanear_backend_contract_v16';
  end if;
end;
$$;
revoke all on function dawanear_private.dawanear_backend_contract_v16()
  from public, anon, authenticated;

create or replace function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v16() as contract
), publication_guard as (
  select exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.dawanear_product_images'::pg_catalog.regclass
      and tgname = 'dawanear_product_images_publication_guard'
      and not tgisinternal
      and tgenabled <> 'D'
  ) as trigger_exists
)
select jsonb_set(
  jsonb_set(
    base.contract,
    '{contract_version}',
    '"2026-07-16.9"'::jsonb,
    true
  ),
  '{product_images}',
  coalesce(base.contract->'product_images', '{}'::jsonb)
    || jsonb_build_object(
      'publication_guard_trigger_exists',
      publication_guard.trigger_exists
    ),
  true
)
from base
cross join publication_guard;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 deployment contract including the independent runtime product-image publication guard.';

commit;
