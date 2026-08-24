-- Retire two book/search-noise records that passed the July consumer-product
-- selection but are not pharmacy catalogue products. The source snapshot stays
-- immutable for traceability; public catalogue views already require approved,
-- active and orderable rows, so this correction fails closed immediately.

begin;

-- Publication-state transitions are governed by a deferred constraint trigger.
-- Preserve the exact previous state and write the matching immutable rejection
-- event in the same transaction instead of bypassing the moderation boundary.
with targets as materialized (
  select
    product.id,
    product.updated_at as expected_product_updated_at,
    product.compliance_evidence_url,
    jsonb_build_object(
      'publication_status', product.publication_status,
      'compliance_status', product.compliance_status,
      'is_active', product.is_active,
      'is_orderable', product.is_orderable,
      'reviewed_by_label', product.reviewed_by_label,
      'review_note', product.review_note,
      'reviewed_at', product.reviewed_at,
      'approved_at', product.approved_at,
      'updated_at', product.updated_at
    ) as previous_state
  from public.dawanear_marketplace_products as product
  where product.id in ('AMZ-032380909X', 'AMZ-B01K1S6AHM')
    and (
      product.publication_status <> 'rejected'
      or product.is_active
      or product.is_orderable
    )
), changed as (
  update public.dawanear_marketplace_products as product
  set
    publication_status = 'rejected',
    is_active = false,
    is_orderable = false,
    reviewed_by_label = 'MED+250 catalogue quality audit',
    review_note = 'Retired 2026-07-18: book or clinical study guide, not a pharmacy catalogue product.',
    reviewed_at = statement_timestamp(),
    approved_at = null,
    updated_at = statement_timestamp()
  from targets
  where product.id = targets.id
  returning
    product.*,
    targets.expected_product_updated_at,
    targets.previous_state
)
insert into public.dawanear_marketplace_product_reviews (
  product_id,
  decision,
  reviewed_by_label,
  evidence_note,
  compliance_evidence_url,
  expected_product_updated_at,
  previous_state,
  resulting_state,
  created_at
)
select
  changed.id,
  'reject',
  changed.reviewed_by_label,
  changed.review_note,
  changed.compliance_evidence_url,
  changed.expected_product_updated_at,
  changed.previous_state,
  jsonb_build_object(
    'publication_status', changed.publication_status,
    'compliance_status', changed.compliance_status,
    'is_active', changed.is_active,
    'is_orderable', changed.is_orderable,
    'updated_at', changed.updated_at
  ),
  changed.updated_at
from changed;

do $$
begin
  if exists (
    select 1
    from public.dawanear_all_product_catalog
    where id in ('AMZ-032380909X', 'AMZ-B01K1S6AHM')
  ) then
    raise exception 'Non-product catalogue records remain publicly visible';
  end if;
end
$$;

commit;
