begin;

-- Forward repair for direct database drift that removed the verified-rights
-- publication boundary without recording a migration. Unverified rows remain
-- as private provenance records, but cannot be approved, projected into the
-- catalogue, or read through public RLS.
select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

lock table public.dawanear_product_images in share row exclusive mode;

with invalid_products as (
  select image.product_id
  from public.dawanear_product_images as image
  where image.approved
  group by image.product_id
  having count(*) <> 3
    or count(*) filter (
      where image.rights_verified and image.background_removed
    ) <> 3
    or count(distinct image.position) <> 3
    or count(distinct image.content_sha256) <> 3
    or count(distinct image.perceptual_hash) <> 3
)
update public.dawanear_product_images as image
set approved = false
where image.approved
  and (
    not image.rights_verified
    or not image.background_removed
    or image.product_id in (select product_id from invalid_products)
  );

update public.dawanear_products as product
set image_url = null,
    image_source = null
where exists (
  select 1
  from public.dawanear_product_images as image
  where image.product_id = product.id
    and image.public_url = product.image_url
    and not (
      image.approved
      and image.rights_verified
      and image.background_removed
    )
);

update public.dawanear_marketplace_products as product
set image_url = null,
    image_source = null
where exists (
  select 1
  from public.dawanear_product_images as image
  where image.product_id = product.id
    and image.public_url = product.image_url
    and not (
      image.approved
      and image.rights_verified
      and image.background_removed
    )
);

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid =
      'public.dawanear_product_images'::pg_catalog.regclass
    and constraint_row.conname =
      'dawanear_product_images_approved_rights_verified';

  if v_definition is null then
    alter table public.dawanear_product_images
      add constraint dawanear_product_images_approved_rights_verified
      check (not approved or (rights_verified and background_removed))
      not valid;
  elsif v_definition not like '%rights_verified%'
    or v_definition not like '%background_removed%' then
    raise exception
      'The existing product-image rights constraint has an unexpected definition';
  end if;
end;
$$;
alter table public.dawanear_product_images
  validate constraint dawanear_product_images_approved_rights_verified;

drop index if exists public.dawanear_product_images_public_idx;
create index dawanear_product_images_public_idx
  on public.dawanear_product_images (product_id, position)
  where approved and rights_verified and background_removed;

drop policy if exists dawanear_product_images_public_read
  on public.dawanear_product_images;
create policy dawanear_product_images_public_read
on public.dawanear_product_images
for select
to anon, authenticated
using (
  approved
  and rights_verified
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
  if p_product_id is null or char_length(trim(p_product_id)) not between 1 and 100 then
    raise exception 'A valid product ID is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.dawanear_products where id = p_product_id
  ) then
    raise exception 'Product was not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_images) is distinct from 'array'
    or jsonb_array_length(p_images) <> 3 then
    raise exception 'Exactly three product images are required' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_images) as image(value)
    where image.value->'rights_verified' is distinct from 'true'::jsonb
      or nullif(trim(image.value->>'rights_basis'), '') is null
  ) then
    raise exception
      'Every product image requires explicit verified reuse rights and a durable rights basis'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_images) as image(value)
    where image.value->'background_removed' is distinct from 'true'::jsonb
  ) then
    raise exception 'Every product image must have its background removed'
      using errcode = '23514';
  end if;

  select
    count(*),
    count(distinct image.value->>'content_sha256'),
    count(distinct image.value->>'perceptual_hash')
  into v_count, v_distinct_content, v_distinct_perceptual
  from jsonb_array_elements(p_images) as image(value);

  if v_count <> 3 or v_distinct_content <> 3 or v_distinct_perceptual <> 3 then
    raise exception 'The three product images must be distinct' using errcode = '23514';
  end if;

  delete from public.dawanear_product_images where product_id = p_product_id;

  insert into public.dawanear_product_images (
    product_id, position, public_url, storage_path, source_page_url,
    source_image_url, source_domain, source_kind, rights_basis,
    rights_verified, width, height, quality_score, content_sha256,
    perceptual_hash, background_removed, approved, checked_at
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
    true,
    (image.value->>'width')::integer,
    (image.value->>'height')::integer,
    (image.value->>'quality_score')::numeric,
    lower(image.value->>'content_sha256'),
    lower(image.value->>'perceptual_hash'),
    true,
    true,
    coalesce((image.value->>'checked_at')::timestamptz, clock_timestamp())
  from jsonb_array_elements(p_images) with ordinality as image(value, ordinality);

  select public_url into v_primary_url
  from public.dawanear_product_images
  where product_id = p_product_id
    and position = 1
    and approved
    and rights_verified
    and background_removed;

  update public.dawanear_products
  set image_url = v_primary_url,
      image_source = 'MED+250 rights-verified product-image pipeline'
  where id = p_product_id;

  update public.dawanear_marketplace_products
  set image_url = v_primary_url,
      image_source = 'MED+250 rights-verified product-image pipeline'
  where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'image_count', 3,
    'rights_verified', true,
    'image_url', v_primary_url
  );
end;
$$;

revoke all on function public.dawanear_publish_product_images(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.dawanear_publish_product_images(text, jsonb)
  to service_role;

comment on function public.dawanear_publish_product_images(text, jsonb) is
  'Service-only atomic publication of exactly three distinct, background-free images with explicit reuse-rights evidence.';

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
      and pg_catalog.pg_get_constraintdef(oid) like '%rights_verified%'
      and pg_catalog.pg_get_constraintdef(oid) like '%background_removed%'
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
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=']
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
  if exists (
    select 1
    from public.dawanear_product_images
    where approved and (not rights_verified or not background_removed)
  ) then
    raise exception 'Unsafe approved product images remain after governance repair';
  end if;

  if exists (
    select image.product_id
    from public.dawanear_product_images as image
    where image.approved
    group by image.product_id
    having count(*) <> 3
      or count(distinct image.position) <> 3
      or count(distinct image.content_sha256) <> 3
      or count(distinct image.perceptual_hash) <> 3
  ) then
    raise exception 'Incomplete approved product-image galleries remain after governance repair';
  end if;
end;
$$;

commit;
