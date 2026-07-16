begin;

update public.dawanear_products as product
set image_url = null,
    image_source = null
where exists (
  select 1
  from public.dawanear_product_images as image
  where image.product_id = product.id
    and not image.rights_verified
    and image.public_url = product.image_url
);

update public.dawanear_marketplace_products as product
set image_url = null,
    image_source = null
where exists (
  select 1
  from public.dawanear_product_images as image
  where image.product_id = product.id
    and not image.rights_verified
    and image.public_url = product.image_url
);

update public.dawanear_product_images
set approved = false
where not rights_verified;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dawanear_product_images'::pg_catalog.regclass
      and conname = 'dawanear_product_images_approved_rights_verified'
  ) then
    alter table public.dawanear_product_images
      add constraint dawanear_product_images_approved_rights_verified
      check (not approved or (rights_verified and background_removed))
      not valid;
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
  if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) <> 3 then
    raise exception 'Exactly three product images are required' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_images) as image(value)
    where image.value->'rights_verified' is distinct from 'true'::jsonb
  ) then
    raise exception 'Every product image requires explicit verified reuse rights'
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
    image.value->>'rights_basis',
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
    and rights_verified;

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
  'Service-only atomic publication of exactly three distinct, background-free images whose exact reuse rights were explicitly verified.';

commit;
