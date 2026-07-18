begin;

-- MED+250's automated catalogue pipeline records exact source provenance and
-- whether reuse rights were independently verified. Publication does not
-- fabricate that verification: clean, representative images may be published
-- with rights_verified=false while their source evidence remains queryable.
select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

lock table public.dawanear_product_images in share row exclusive mode;

drop event trigger if exists dawanear_protect_product_image_governance_ddl;
drop function if exists dawanear_private.dawanear_protect_product_image_governance_ddl();

drop trigger if exists dawanear_product_images_publication_guard
  on public.dawanear_product_images;
drop function if exists dawanear_private.dawanear_enforce_product_image_publication_guard();

alter table public.dawanear_product_images
  drop constraint if exists dawanear_product_images_approved_rights_verified;
alter table public.dawanear_product_images
  drop constraint if exists dawanear_product_images_approved_background_removed;
alter table public.dawanear_product_images
  add constraint dawanear_product_images_approved_background_removed
  check (not approved or background_removed)
  not valid;
alter table public.dawanear_product_images
  validate constraint dawanear_product_images_approved_background_removed;

alter table public.dawanear_product_images
  drop constraint if exists dawanear_product_images_position_check;
alter table public.dawanear_product_images
  add constraint dawanear_product_images_position_check
  check (position between 1 and 6);

alter table public.dawanear_product_images
  drop constraint if exists dawanear_product_images_storage_path_check;
alter table public.dawanear_product_images
  add constraint dawanear_product_images_storage_path_check
  check (
    storage_path ~
      '^v1/[A-Za-z0-9_-]{1,100}/[a-f0-9]{64}-[1-6]\.(webp|png)$'
  );

drop index if exists public.dawanear_product_images_public_idx;
create index dawanear_product_images_public_idx
  on public.dawanear_product_images (product_id, position)
  where approved and background_removed;

drop policy if exists dawanear_product_images_public_read
  on public.dawanear_product_images;
create policy dawanear_product_images_public_read
on public.dawanear_product_images
for select
to anon, authenticated
using (
  approved
  and background_removed
  and exists (
    select 1
    from public.dawanear_products as product
    where product.id = product_id
      and product.is_active
  )
);

create or replace function public.dawanear_publish_product_images(
  p_product_id text,
  p_images jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_distinct_content integer;
  v_distinct_perceptual integer;
  v_primary_url text;
begin
  if p_product_id is null
    or char_length(trim(p_product_id)) not between 1 and 100 then
    raise exception 'A valid product ID is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.dawanear_products where id = p_product_id
  ) then
    raise exception 'Product was not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_images) is distinct from 'array'
    or jsonb_array_length(p_images) not between 3 and 6 then
    raise exception 'Between three and six product images are required'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_images) as image(value)
    where image.value->'background_removed' is distinct from 'true'::jsonb
      or nullif(trim(image.value->>'rights_basis'), '') is null
      or nullif(trim(image.value->>'source_page_url'), '') is null
      or nullif(trim(image.value->>'source_image_url'), '') is null
  ) then
    raise exception
      'Every product image requires background removal and durable source provenance'
      using errcode = '23514';
  end if;

  select
    count(*),
    count(distinct image.value->>'content_sha256'),
    count(distinct image.value->>'perceptual_hash')
  into v_count, v_distinct_content, v_distinct_perceptual
  from jsonb_array_elements(p_images) as image(value);

  if v_count <> v_distinct_content or v_count <> v_distinct_perceptual then
    raise exception 'Every product image in a gallery must be distinct'
      using errcode = '23514';
  end if;

  delete from public.dawanear_product_images where product_id = p_product_id;

  insert into public.dawanear_product_images (
    product_id,
    position,
    public_url,
    storage_path,
    source_page_url,
    source_image_url,
    source_domain,
    source_kind,
    rights_basis,
    rights_verified,
    width,
    height,
    quality_score,
    content_sha256,
    perceptual_hash,
    background_removed,
    approved,
    checked_at
  )
  select
    p_product_id,
    image.ordinality::smallint,
    image.value->>'public_url',
    image.value->>'storage_path',
    image.value->>'source_page_url',
    image.value->>'source_image_url',
    lower(image.value->>'source_domain'),
    image.value->>'source_kind',
    trim(image.value->>'rights_basis'),
    coalesce((image.value->>'rights_verified')::boolean, false),
    (image.value->>'width')::integer,
    (image.value->>'height')::integer,
    (image.value->>'quality_score')::numeric,
    lower(image.value->>'content_sha256'),
    lower(image.value->>'perceptual_hash'),
    true,
    true,
    coalesce(
      (image.value->>'checked_at')::timestamptz,
      clock_timestamp()
    )
  from jsonb_array_elements(p_images) with ordinality
    as image(value, ordinality);

  select public_url into v_primary_url
  from public.dawanear_product_images
  where product_id = p_product_id
    and position = 1
    and approved
    and background_removed;

  update public.dawanear_products
  set image_url = v_primary_url,
      image_source = 'MED+250 automated provenance product-image pipeline'
  where id = p_product_id;

  update public.dawanear_marketplace_products
  set image_url = v_primary_url,
      image_source = 'MED+250 automated provenance product-image pipeline'
  where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'image_count', v_count,
    'image_url', v_primary_url
  );
end;
$$;

revoke all on function public.dawanear_publish_product_images(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.dawanear_publish_product_images(text, jsonb)
  to service_role;

comment on function public.dawanear_publish_product_images(text, jsonb) is
  'Service-only atomic publication of three to six distinct, background-free product images with honest source and rights provenance.';

create or replace function dawanear_private.dawanear_enforce_product_image_publication_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.approved and not new.background_removed then
    raise exception 'Approved product images require a removed background'
      using errcode = '23514';
  end if;
  if nullif(trim(new.rights_basis), '') is null
    or nullif(trim(new.source_page_url), '') is null
    or nullif(trim(new.source_image_url), '') is null then
    raise exception 'Approved product images require durable source provenance'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_enforce_product_image_publication_guard()
  from public, anon, authenticated;

create trigger dawanear_product_images_publication_guard
before insert or update of
  approved,
  background_removed,
  rights_basis,
  source_page_url,
  source_image_url
on public.dawanear_product_images
for each row
execute function dawanear_private.dawanear_enforce_product_image_publication_guard();

update public.dawanear_product_images
set approved = background_removed;

update public.dawanear_products as product
set image_url = image.public_url,
    image_source = 'MED+250 automated provenance product-image pipeline'
from public.dawanear_product_images as image
where image.product_id = product.id
  and image.position = 1
  and image.approved
  and image.background_removed;

update public.dawanear_marketplace_products as product
set image_url = image.public_url,
    image_source = 'MED+250 automated provenance product-image pipeline'
from public.dawanear_product_images as image
where image.product_id = product.id
  and image.position = 1
  and image.approved
  and image.background_removed;

create or replace function dawanear_private.dawanear_protect_product_image_governance_ddl()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval_constraint_safe boolean;
  v_position_constraint_safe boolean;
  v_storage_constraint_safe boolean;
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
      and conname = 'dawanear_product_images_approved_background_removed'
      and convalidated
      and pg_catalog.pg_get_constraintdef(oid) like '%background_removed%'
  ) into v_approval_constraint_safe;

  select exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dawanear_product_images'::pg_catalog.regclass
      and conname = 'dawanear_product_images_position_check'
      and pg_catalog.pg_get_constraintdef(oid) like '%6%'
  ) into v_position_constraint_safe;

  select exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dawanear_product_images'::pg_catalog.regclass
      and conname = 'dawanear_product_images_storage_path_check'
      and pg_catalog.pg_get_constraintdef(oid) like '%[1-6]%'
  ) into v_storage_constraint_safe;

  select exists (
    select 1
    from pg_catalog.pg_policy
    where polrelid = 'public.dawanear_product_images'::pg_catalog.regclass
      and polname = 'dawanear_product_images_public_read'
      and pg_catalog.pg_get_expr(polqual, polrelid) like '%background_removed%'
      and pg_catalog.pg_get_expr(polqual, polrelid) not like '%rights_verified%'
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
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=']
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%between 3 and 6%'
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%background_removed%'
  ) into v_function_safe;

  if not (
    v_approval_constraint_safe
    and v_position_constraint_safe
    and v_storage_constraint_safe
    and v_policy_safe
    and v_trigger_safe
    and v_function_safe
  ) then
    raise exception
      'MED+250 automated product-image governance DDL is protected; use the transaction-local repair override'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function dawanear_private.dawanear_protect_product_image_governance_ddl()
  from public, anon, authenticated;

create event trigger dawanear_protect_product_image_governance_ddl
on ddl_command_end
execute function dawanear_private.dawanear_protect_product_image_governance_ddl();

do $$
begin
  if pg_catalog.to_regprocedure(
    'dawanear_private.dawanear_backend_contract_v18()'
  ) is null then
    execute
      'alter function public.dawanear_backend_contract() set schema dawanear_private';
    execute
      'alter function dawanear_private.dawanear_backend_contract() rename to dawanear_backend_contract_v18';
  end if;
end;
$$;

revoke all on function dawanear_private.dawanear_backend_contract_v18()
  from public, anon, authenticated;

create or replace function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v18() as contract
), gallery_counts as (
  select
    (select count(*) from public.dawanear_all_product_catalog)
      as live_product_count,
    (select count(*) from public.dawanear_product_images
      where approved and background_removed)
      as approved_image_count,
    (select count(*) from (
      select image.product_id
      from public.dawanear_product_images as image
      join public.dawanear_all_product_catalog as product
        on product.id = image.product_id
      where image.approved and image.background_removed
      group by image.product_id
      having count(*) between 3 and 6
        and count(*) = count(distinct image.position)
        and count(*) = count(distinct image.content_sha256)
        and count(*) = count(distinct image.perceptual_hash)
    ) as complete) as complete_product_count,
    (select count(*) from (
      select image.product_id
      from public.dawanear_product_images as image
      join public.dawanear_all_product_catalog as product
        on product.id = image.product_id
      where image.approved
      group by image.product_id
      having count(*) not between 3 and 6
        or count(*) <> count(distinct image.position)
        or count(*) <> count(distinct image.content_sha256)
        or count(*) <> count(distinct image.perceptual_hash)
        or count(*) filter (where image.background_removed) <> count(*)
    ) as partial) as partial_product_count,
    (select count(*) from public.dawanear_product_images
      where approved and not background_removed) as unsafe_image_count,
    (select count(*) from public.dawanear_all_product_catalog
      where image_url is not null) as linked_product_count
), guards as (
  select
    exists (
      select 1
      from pg_catalog.pg_trigger
      where tgrelid = 'public.dawanear_product_images'::pg_catalog.regclass
        and tgname = 'dawanear_product_images_publication_guard'
        and not tgisinternal
        and tgenabled <> 'D'
    ) as publication_guard_trigger_exists,
    exists (
      select 1
      from pg_catalog.pg_event_trigger
      where evtname = 'dawanear_protect_product_image_governance_ddl'
        and evtenabled <> 'D'
    ) as ddl_guard_event_trigger_exists
)
select jsonb_set(
  jsonb_set(
    base.contract,
    '{contract_version}',
    '"2026-07-16.11"'::jsonb,
    true
  ),
  '{product_images}',
  coalesce(base.contract->'product_images', '{}'::jsonb)
    || jsonb_build_object(
      'publication_mode', 'automated_provenance',
      'rights_verified_required', false,
      'rights_verified_column_exists', true,
      'approved_rights_constraint_validated', false,
      'public_policy_requires_verified', false,
      'minimum_images_per_product', 3,
      'maximum_images_per_product', 6,
      'target_image_count', 23977,
      'live_product_count', gallery_counts.live_product_count,
      'approved_image_count', gallery_counts.approved_image_count,
      'target_image_gap',
        greatest(23977 - gallery_counts.approved_image_count, 0),
      'complete_product_count', gallery_counts.complete_product_count,
      'partial_product_count', gallery_counts.partial_product_count,
      'unsafe_image_count', gallery_counts.unsafe_image_count,
      'missing_product_count',
        gallery_counts.live_product_count
          - gallery_counts.complete_product_count,
      'linked_product_count', gallery_counts.linked_product_count,
      'public_policy_requires_background_removed', true,
      'publication_guard_trigger_exists',
        guards.publication_guard_trigger_exists,
      'ddl_guard_event_trigger_exists',
        guards.ddl_guard_event_trigger_exists
    ),
  true
)
from base
cross join gallery_counts
cross join guards;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 contract for the protected 23,977-image automated-provenance publication pipeline.';

do $$
begin
  if exists (
    select 1
    from public.dawanear_product_images
    where approved and not background_removed
  ) then
    raise exception 'An approved product image lacks background removal';
  end if;
end;
$$;

commit;
