-- Preserve an honest immutable audit trail for products whose source-backed
-- bulk import completed before the per-product audit ledger was synchronized.

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
  product.id,
  'approve',
  coalesce(
    nullif(trim(product.reviewed_by_label), ''),
    'MED+250 governed import reconciliation'
  ),
  'Backfilled immutable audit evidence for an already approved, source-backed import. The historical pre-approval state was unavailable and no state transition was performed.',
  product.compliance_evidence_url,
  product.updated_at,
  jsonb_build_object(
    'historical_state_unavailable', true,
    'reconciliation_only', true
  ),
  jsonb_build_object(
    'publication_status', product.publication_status,
    'compliance_status', product.compliance_status,
    'is_active', product.is_active,
    'is_orderable', product.is_orderable,
    'compliance_evidence_url', product.compliance_evidence_url,
    'updated_at', product.updated_at
  ),
  coalesce(product.approved_at, product.reviewed_at, product.updated_at)
from public.dawanear_marketplace_products as product
where product.publication_status = 'approved'
  and not exists (
    select 1
    from public.dawanear_marketplace_product_reviews as review
    where review.product_id = product.id
      and review.decision = 'approve'
  );

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
  product.id,
  'reject',
  'MED+250 catalogue quality reconciliation',
  'Backfilled immutable audit evidence for a source candidate rejected during catalogue quality reconciliation. The historical pre-rejection state was unavailable.',
  product.compliance_evidence_url,
  product.updated_at,
  jsonb_build_object(
    'historical_state_unavailable', true,
    'reconciliation_only', true
  ),
  jsonb_build_object(
    'publication_status', product.publication_status,
    'compliance_status', product.compliance_status,
    'is_active', product.is_active,
    'is_orderable', product.is_orderable,
    'updated_at', product.updated_at
  ),
  product.updated_at
from public.dawanear_marketplace_products as product
where product.publication_status = 'rejected'
  and not exists (
    select 1
    from public.dawanear_marketplace_product_reviews as review
    where review.product_id = product.id
      and review.decision = 'reject'
  );

alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v13;
revoke all on function dawanear_private.dawanear_backend_contract_v13()
  from public, anon, authenticated;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v13() as contract
), catalogue as (
  select
    count(*) as candidate_count,
    count(*) filter (
      where publication_status = 'rejected'
    ) as rejected_candidate_count,
    count(*) filter (
      where publication_status = 'approved'
        and is_active
        and is_orderable
    ) as product_count,
    count(distinct id) filter (
      where publication_status = 'approved'
        and is_active
        and is_orderable
    ) as distinct_ids,
    count(distinct asin) filter (
      where publication_status = 'approved'
        and is_active
        and is_orderable
    ) as distinct_asins,
    count(distinct (category, subcategory)) filter (
      where publication_status = 'approved'
        and is_active
        and is_orderable
    ) as taxonomy_pair_count,
    (
      select coalesce(min(pair.product_count), 0)
      from (
        select count(*) as product_count
        from public.dawanear_marketplace_products
        where publication_status = 'approved'
          and is_active
          and is_orderable
        group by category, subcategory
      ) as pair
    ) as minimum_taxonomy_pair_count
  from public.dawanear_marketplace_products
), audit as (
  select
    count(*) filter (
      where product.publication_status = 'approved'
        and not exists (
          select 1
          from public.dawanear_marketplace_product_reviews as review
          where review.product_id = product.id
            and review.decision = 'approve'
        )
    ) as approved_without_audit_count,
    count(*) filter (
      where product.publication_status = 'rejected'
        and not exists (
          select 1
          from public.dawanear_marketplace_product_reviews as review
          where review.product_id = product.id
            and review.decision = 'reject'
        )
    ) as rejected_without_audit_count
  from public.dawanear_marketplace_products as product
)
select jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        base.contract,
                        '{contract_version}',
                        '"2026-07-16.6"'::jsonb,
                        true
                      ),
                      '{marketplace_catalogue,product_count}',
                      to_jsonb(catalogue.product_count),
                      true
                    ),
                    '{marketplace_catalogue,distinct_ids}',
                    to_jsonb(catalogue.distinct_ids),
                    true
                  ),
                  '{marketplace_catalogue,distinct_asins}',
                  to_jsonb(catalogue.distinct_asins),
                  true
                ),
                '{marketplace_catalogue,taxonomy_pair_count}',
                to_jsonb(catalogue.taxonomy_pair_count),
                true
              ),
              '{marketplace_catalogue,minimum_taxonomy_pair_count}',
              to_jsonb(catalogue.minimum_taxonomy_pair_count),
              true
            ),
            '{marketplace_catalogue,candidate_count}',
            to_jsonb(catalogue.candidate_count),
            true
          ),
          '{marketplace_catalogue,rejected_candidate_count}',
          to_jsonb(catalogue.rejected_candidate_count),
          true
        ),
        '{marketplace_catalogue,minimum_required_per_pair}',
        '50'::jsonb,
        true
      ),
      '{marketplace_moderation,approved_without_audit_count}',
      to_jsonb(audit.approved_without_audit_count),
      true
    ),
    '{marketplace_moderation,rejected_without_audit_count}',
    to_jsonb(audit.rejected_without_audit_count),
    true
  ),
  '{marketplace_moderation,audit_reconciliation_complete}',
  to_jsonb(
    audit.approved_without_audit_count = 0
    and audit.rejected_without_audit_count = 0
  ),
  true
)
from base
cross join catalogue
cross join audit;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 contract counting only approved live consumer products, requiring meaningful coverage across every taxonomy pair, and reconciling immutable approval and rejection audit evidence.';
