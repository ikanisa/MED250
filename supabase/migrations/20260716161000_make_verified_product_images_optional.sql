-- Verified product photography is optional. Missing source data must remain
-- blank; it must never be replaced by generated or decorative pack imagery.

alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v12;
revoke all on function dawanear_private.dawanear_backend_contract_v12()
  from public, anon, authenticated;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v12() as contract
), partial_galleries as (
  select count(*) as product_count
  from (
    select image.product_id
    from public.dawanear_product_images as image
    join public.dawanear_all_product_catalog as product
      on product.id = image.product_id
    group by image.product_id
    having count(*) <> 3
      or count(*) filter (
        where image.approved and image.background_removed
      ) <> 3
      or count(distinct image.position) <> 3
      or count(distinct image.content_sha256) <> 3
      or count(distinct image.perceptual_hash) <> 3
  ) as incomplete
)
select jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          base.contract,
          '{contract_version}',
          '"2026-07-16.5"'::jsonb,
          true
        ),
        '{product_images,coverage_required}',
        'false'::jsonb,
        true
      ),
      '{product_images,missing_images_hidden}',
      'true'::jsonb,
      true
    ),
    '{product_images,generated_placeholders_allowed}',
    'false'::jsonb,
    true
  ),
  '{product_images,partial_product_count}',
  to_jsonb(partial_galleries.product_count),
  true
)
from base
cross join partial_galleries;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 contract: verified galleries remain atomic, while products without verified photography expose no image or fabricated placeholder.';
