begin;

-- Production protects product-image governance behind a database-wide DDL
-- event trigger. This replacement preserves every image-governance invariant
-- while consolidating repeated full-catalogue scans into materialized rollups.
set local med250.allow_product_image_governance_ddl = 'on';

create or replace function dawanear_private.dawanear_backend_contract_v19()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with base as materialized (
  select dawanear_private.dawanear_backend_contract_v18() as contract
), catalogue as materialized (
  select product.id, product.image_url
  from public.dawanear_all_product_catalog as product
), image_totals as materialized (
  select
    count(*) filter (where image.approved and image.background_removed)
      as approved_image_count,
    count(*) filter (where image.approved and not image.background_removed)
      as unsafe_image_count
  from public.dawanear_product_images as image
), product_rollup as materialized (
  select
    image.product_id,
    count(*) as approved_count,
    count(*) filter (where image.background_removed) as background_removed_count,
    count(distinct image.position) as distinct_position_count,
    count(distinct image.content_sha256) as distinct_content_count,
    count(distinct image.perceptual_hash) as distinct_perceptual_count,
    count(distinct image.position) filter (where image.background_removed)
      as background_position_count,
    count(distinct image.content_sha256) filter (where image.background_removed)
      as background_content_count,
    count(distinct image.perceptual_hash) filter (where image.background_removed)
      as background_perceptual_count
  from public.dawanear_product_images as image
  join catalogue on catalogue.id = image.product_id
  where image.approved
  group by image.product_id
), gallery_counts as (
  select
    (select count(*) from catalogue) as live_product_count,
    image_totals.approved_image_count,
    count(*) filter (
      where product_rollup.background_removed_count between 3 and 6
        and product_rollup.background_removed_count
          = product_rollup.background_position_count
        and product_rollup.background_removed_count
          = product_rollup.background_content_count
        and product_rollup.background_removed_count
          = product_rollup.background_perceptual_count
    ) as complete_product_count,
    count(*) filter (
      where product_rollup.approved_count not between 3 and 6
        or product_rollup.approved_count
          <> product_rollup.distinct_position_count
        or product_rollup.approved_count
          <> product_rollup.distinct_content_count
        or product_rollup.approved_count
          <> product_rollup.distinct_perceptual_count
        or product_rollup.background_removed_count
          <> product_rollup.approved_count
    ) as partial_product_count,
    image_totals.unsafe_image_count,
    (select count(*) from catalogue where image_url is not null)
      as linked_product_count
  from image_totals
  left join product_rollup on true
  group by image_totals.approved_image_count, image_totals.unsafe_image_count
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
$function$;

revoke all on function dawanear_private.dawanear_backend_contract_v19()
  from public, anon, authenticated;

comment on function dawanear_private.dawanear_backend_contract_v19() is
  'Private MED+250 image-governance contract using one materialized catalogue and product rollup while preserving the 2026-07-16.11 contract.';

commit;
