begin;

-- Reconcile any publication state written outside the governed one-product
-- review workflow before making the audit requirement transactional.
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
  case product.publication_status
    when 'approved' then 'approve'
    else 'reject'
  end,
  'MED+250 publication audit reconciliation',
  'Backfilled immutable audit evidence for an existing governed publication state. Historical state was unavailable and no state transition was performed.',
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
where product.publication_status in ('approved', 'rejected')
  and not exists (
    select 1
    from public.dawanear_marketplace_product_reviews as review
    where review.product_id = product.id
      and review.decision = case product.publication_status
        when 'approved' then 'approve'
        else 'reject'
      end
      and review.resulting_state ->> 'publication_status' = product.publication_status
      and (review.resulting_state ->> 'updated_at')::timestamptz = product.updated_at
  );

create function dawanear_private.dawanear_require_marketplace_publication_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.publication_status in ('approved', 'rejected')
     and not exists (
       select 1
       from public.dawanear_marketplace_product_reviews as review
       where review.product_id = new.id
         and review.decision = case new.publication_status
           when 'approved' then 'approve'
           else 'reject'
         end
         and review.resulting_state ->> 'publication_status' = new.publication_status
         and (review.resulting_state ->> 'updated_at')::timestamptz = new.updated_at
     ) then
    raise exception 'Approved and rejected marketplace product states require a matching immutable audit event'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function dawanear_private.dawanear_require_marketplace_publication_audit()
  from public, anon, authenticated;

create constraint trigger dawanear_marketplace_products_publication_audited
after insert or update of publication_status on public.dawanear_marketplace_products
deferrable initially deferred
for each row execute function dawanear_private.dawanear_require_marketplace_publication_audit();

alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v14;
revoke all on function dawanear_private.dawanear_backend_contract_v14()
  from public, anon, authenticated;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_set(
    jsonb_set(
      dawanear_private.dawanear_backend_contract_v14(),
      '{contract_version}',
      '"2026-07-16.7"'::jsonb,
      true
    ),
    '{marketplace_moderation,publication_audit_constraint_trigger}',
    to_jsonb(exists (
      select 1
      from pg_catalog.pg_trigger
      where tgrelid = pg_catalog.to_regclass('public.dawanear_marketplace_products')
        and tgname = 'dawanear_marketplace_products_publication_audited'
        and not tgisinternal
    )),
    true
  )
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 deployment contract including transactionally enforced marketplace publication audits.';

commit;
