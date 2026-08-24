begin;

create table public.dawanear_product_images (
  product_id text not null references public.dawanear_products(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  public_url text not null check (public_url ~ '^https://'),
  storage_path text not null check (
    storage_path ~ '^v1/[A-Za-z0-9_-]{1,100}/[a-f0-9]{64}-[1-3]\.(webp|png)$'
  ),
  source_page_url text not null check (source_page_url ~ '^https://'),
  source_image_url text not null check (source_image_url ~ '^https://'),
  source_domain text not null check (char_length(source_domain) between 3 and 253),
  source_kind text not null check (source_kind in (
    'licensed_feed',
    'manufacturer',
    'amazon_creators_api',
    'specialist_retailer',
    'marketplace_api'
  )),
  rights_basis text not null check (char_length(rights_basis) between 8 and 500),
  width integer not null check (width between 500 and 5000),
  height integer not null check (height between 500 and 5000),
  quality_score numeric(5,2) not null check (quality_score between 0 and 100),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  perceptual_hash text not null check (perceptual_hash ~ '^[a-f0-9]{16}$'),
  background_removed boolean not null check (background_removed),
  approved boolean not null default true,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (product_id, position),
  unique (product_id, content_sha256),
  unique (product_id, perceptual_hash)
);

comment on table public.dawanear_product_images is
  'Exactly three approved, provenance-recorded, background-free product images published by the trusted MED+250 image pipeline.';

create index dawanear_product_images_public_idx
  on public.dawanear_product_images (product_id, position)
  where approved;

alter table public.dawanear_product_images enable row level security;

create policy dawanear_product_images_public_read
on public.dawanear_product_images
for select
to anon, authenticated
using (
  approved
  and exists (
    select 1
    from public.dawanear_products as product
    where product.id = product_id
      and product.is_active
  )
);

revoke all on table public.dawanear_product_images
  from public, anon, authenticated;
grant select on table public.dawanear_product_images to anon, authenticated;
grant select, insert, update, delete on table public.dawanear_product_images to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'product-images',
  'product-images',
  true,
  8388608,
  array['image/webp', 'image/png']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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
  if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) <> 3 then
    raise exception 'Exactly three product images are required' using errcode = '23514';
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
    product_id,
    position,
    public_url,
    storage_path,
    source_page_url,
    source_image_url,
    source_domain,
    source_kind,
    rights_basis,
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
    image.value->>'rights_basis',
    (image.value->>'width')::integer,
    (image.value->>'height')::integer,
    (image.value->>'quality_score')::numeric,
    lower(image.value->>'content_sha256'),
    lower(image.value->>'perceptual_hash'),
    (image.value->>'background_removed')::boolean,
    true,
    coalesce((image.value->>'checked_at')::timestamptz, clock_timestamp())
  from jsonb_array_elements(p_images) with ordinality as image(value, ordinality);

  select public_url into v_primary_url
  from public.dawanear_product_images
  where product_id = p_product_id and position = 1;

  update public.dawanear_products
  set
    image_url = v_primary_url,
    image_source = 'MED+250 verified product-image pipeline'
  where id = p_product_id;

  update public.dawanear_marketplace_products
  set
    image_url = v_primary_url,
    image_source = 'MED+250 verified product-image pipeline'
  where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'image_count', 3,
    'image_url', v_primary_url
  );
end;
$$;

revoke all on function public.dawanear_publish_product_images(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.dawanear_publish_product_images(text, jsonb)
  to service_role;

comment on function public.dawanear_publish_product_images(text, jsonb) is
  'Service-only atomic publication of exactly three validated product images and the primary catalogue image URL.';

alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v11;
revoke all on function dawanear_private.dawanear_backend_contract_v11()
  from public, anon, authenticated;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v11() as contract
), gallery_table as (
  select
    pg_catalog.to_regclass('public.dawanear_product_images') is not null as table_exists,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    exists (
      select 1 from pg_catalog.pg_policy policy
      where policy.polrelid = pg_catalog.to_regclass('public.dawanear_product_images')
        and policy.polname = 'dawanear_product_images_public_read'
    ) as public_policy_exists
  from (values (pg_catalog.to_regclass('public.dawanear_product_images'))) resolved(oid)
  left join pg_catalog.pg_class c on c.oid = resolved.oid
), gallery_function as (
  select
    function.oid is not null as function_exists,
    coalesce(function.prosecdef, false) as security_definer,
    coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
    coalesce(pg_catalog.has_function_privilege('service_role', function.oid, 'execute'), false)
      as service_role_can_execute,
    coalesce(pg_catalog.has_function_privilege('anon', function.oid, 'execute'), false)
      as anon_can_execute,
    coalesce(pg_catalog.has_function_privilege('authenticated', function.oid, 'execute'), false)
      as authenticated_can_execute
  from (values (pg_catalog.to_regprocedure(
    'public.dawanear_publish_product_images(text,jsonb)'
  ))) resolved(oid)
  left join pg_catalog.pg_proc function on function.oid = resolved.oid
), gallery_counts as (
  select
    (select count(*) from public.dawanear_all_product_catalog) as live_product_count,
    (select count(*) from (
      select image.product_id
      from public.dawanear_product_images as image
      join public.dawanear_all_product_catalog as product on product.id = image.product_id
      where image.approved and image.background_removed
      group by image.product_id
      having count(*) = 3
        and count(distinct image.position) = 3
        and count(distinct image.content_sha256) = 3
        and count(distinct image.perceptual_hash) = 3
    ) complete) as complete_product_count,
    (select count(*) from public.dawanear_product_images
      where not approved or not background_removed) as unsafe_image_count
), bucket as (
  select
    exists (
      select 1 from storage.buckets
      where id = 'product-images'
        and public
        and file_size_limit = 8388608
        and allowed_mime_types @> array['image/webp', 'image/png']::text[]
    ) as configured
)
select
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(base.contract, '{contract_version}', '"2026-07-16.4"'::jsonb, true),
              '{api_surface,expected_function_count}', '29'::jsonb, true
            ),
            '{table_surface,expected_table_count}', '22'::jsonb, true
          ),
          '{table_surface,anonymous_select_count}', '0'::jsonb, true
        ),
        '{table_surface,unexpected_authenticated_select_count}', '0'::jsonb, true
      ),
      '{table_surface,missing_authenticated_select_count}', '0'::jsonb, true
    ),
    '{table_surface,unexpected_deny_by_default_count}', '0'::jsonb, true
  ) || jsonb_build_object(
    'product_images', jsonb_build_object(
      'table_exists', gallery_table.table_exists,
      'rls_enabled', gallery_table.rls_enabled,
      'public_policy_exists', gallery_table.public_policy_exists,
      'public_table_select_expected', true,
      'bucket_configured', bucket.configured,
      'publish_function_exists', gallery_function.function_exists,
      'publish_function_security_definer', gallery_function.security_definer,
      'publish_function_search_path_locked', gallery_function.search_path_locked,
      'service_role_can_publish', gallery_function.service_role_can_execute,
      'anon_can_publish', gallery_function.anon_can_execute,
      'authenticated_can_publish', gallery_function.authenticated_can_execute,
      'live_product_count', gallery_counts.live_product_count,
      'complete_product_count', gallery_counts.complete_product_count,
      'missing_product_count',
        gallery_counts.live_product_count - gallery_counts.complete_product_count,
      'unsafe_image_count', gallery_counts.unsafe_image_count
    )
  )
from base
cross join gallery_table
cross join gallery_function
cross join gallery_counts
cross join bucket;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract() to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 contract including the public three-image product gallery, immutable Storage configuration and privileged publication boundary.';

commit;
