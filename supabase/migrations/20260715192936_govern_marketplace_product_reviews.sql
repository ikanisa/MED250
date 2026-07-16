begin;

alter table public.dawanear_marketplace_products
  add column seller_evidence_url text,
  add column compliance_evidence_url text,
  add column reviewed_by_label text,
  add column review_note text,
  add column reviewed_at timestamptz,
  add column approved_at timestamptz;

alter table public.dawanear_marketplace_products
  add constraint dawanear_marketplace_products_review_evidence_check check (
    (seller_evidence_url is null or seller_evidence_url ~ '^https://')
    and (compliance_evidence_url is null or compliance_evidence_url ~ '^https://')
    and (reviewed_by_label is null or char_length(reviewed_by_label) between 3 and 200)
    and (review_note is null or char_length(review_note) between 20 and 4000)
    and (
      publication_status <> 'approved'
      or (
        seller_evidence_url is not null
        and compliance_evidence_url is not null
        and reviewed_by_label is not null
        and review_note is not null
        and reviewed_at is not null
        and approved_at is not null
      )
    )
  );

create table public.dawanear_marketplace_product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.dawanear_marketplace_products(id),
  decision text not null check (decision in (
    'start_review', 'compliance_review', 'approve', 'reject', 'unpublish'
  )),
  reviewed_by_label text not null check (char_length(reviewed_by_label) between 3 and 200),
  evidence_note text not null check (char_length(evidence_note) between 20 and 4000),
  seller_evidence_url text check (seller_evidence_url is null or seller_evidence_url ~ '^https://'),
  compliance_evidence_url text check (compliance_evidence_url is null or compliance_evidence_url ~ '^https://'),
  expected_product_updated_at timestamptz not null,
  previous_state jsonb not null,
  resulting_state jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.dawanear_marketplace_product_reviews is
  'Immutable service-only audit trail for one-product-at-a-time marketplace publication decisions.';

create index dawanear_marketplace_product_reviews_product_created_idx
  on public.dawanear_marketplace_product_reviews (product_id, created_at desc);

alter table public.dawanear_marketplace_product_reviews enable row level security;
revoke all on table public.dawanear_marketplace_product_reviews from public, anon, authenticated;
grant select, insert on table public.dawanear_marketplace_product_reviews to service_role;

create function dawanear_private.dawanear_reject_marketplace_review_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Marketplace product review audit records are immutable'
    using errcode = '55000';
end;
$$;

revoke all on function dawanear_private.dawanear_reject_marketplace_review_mutation()
  from public, anon, authenticated;

create trigger dawanear_marketplace_product_reviews_immutable
before update or delete on public.dawanear_marketplace_product_reviews
for each row execute function dawanear_private.dawanear_reject_marketplace_review_mutation();

create function public.dawanear_review_marketplace_product(
  p_product_id text,
  p_decision text,
  p_reviewed_by_label text,
  p_evidence_note text,
  p_expected_updated_at timestamptz,
  p_seller_evidence_url text default null,
  p_compliance_evidence_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.dawanear_marketplace_products%rowtype;
  v_previous jsonb;
  v_result jsonb;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_reviewer text := trim(coalesce(p_reviewed_by_label, ''));
  v_note text := trim(coalesce(p_evidence_note, ''));
  v_seller_url text;
  v_compliance_url text;
begin
  if p_product_id is null or p_product_id !~ '^AMZ-[A-Z0-9]{10}$' then
    raise exception 'A valid Amazon marketplace product ID is required' using errcode = '22023';
  end if;
  if v_decision not in ('start_review', 'compliance_review', 'approve', 'reject', 'unpublish') then
    raise exception 'Unsupported marketplace review decision' using errcode = '22023';
  end if;
  if char_length(v_reviewer) not between 3 and 200 then
    raise exception 'Reviewer identity must be 3-200 characters' using errcode = '22023';
  end if;
  if char_length(v_note) not between 20 and 4000 then
    raise exception 'Evidence note must be 20-4000 characters' using errcode = '22023';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Expected product updated_at is required' using errcode = '22023';
  end if;

  select * into v_product
  from public.dawanear_marketplace_products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'Marketplace product was not found' using errcode = 'P0002';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception 'Marketplace product changed after inspection; inspect it again before deciding'
      using errcode = '40001';
  end if;

  v_seller_url := coalesce(nullif(trim(coalesce(p_seller_evidence_url, '')), ''), v_product.seller_evidence_url);
  v_compliance_url := coalesce(nullif(trim(coalesce(p_compliance_evidence_url, '')), ''), v_product.compliance_evidence_url);
  if v_seller_url is not null and v_seller_url !~ '^https://' then
    raise exception 'Seller evidence must be an HTTPS URL' using errcode = '22023';
  end if;
  if v_compliance_url is not null and v_compliance_url !~ '^https://' then
    raise exception 'Compliance evidence must be an HTTPS URL' using errcode = '22023';
  end if;

  v_previous := jsonb_build_object(
    'publication_status', v_product.publication_status,
    'seller_verification_required', v_product.seller_verification_required,
    'compliance_status', v_product.compliance_status,
    'is_active', v_product.is_active,
    'is_orderable', v_product.is_orderable,
    'seller_evidence_url', v_product.seller_evidence_url,
    'compliance_evidence_url', v_product.compliance_evidence_url,
    'updated_at', v_product.updated_at
  );

  if v_decision = 'start_review' then
    if v_product.publication_status not in ('research_candidate', 'rejected') then
      raise exception 'Only research candidates or rejected products can start seller review' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'seller_review', seller_verification_required = true,
      compliance_status = 'Seller review in progress', is_active = false,
      is_orderable = false, seller_evidence_url = null,
      compliance_evidence_url = null, reviewed_by_label = v_reviewer,
      review_note = v_note, reviewed_at = clock_timestamp(), approved_at = null
    where id = p_product_id;
  elsif v_decision = 'compliance_review' then
    if v_product.publication_status <> 'seller_review' then
      raise exception 'Product must be in seller_review before compliance review' using errcode = '23514';
    end if;
    if v_seller_url is null then
      raise exception 'Seller evidence URL is required for compliance review' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'compliance_review', seller_verification_required = false,
      compliance_status = 'Compliance review in progress', is_active = false,
      is_orderable = false, seller_evidence_url = v_seller_url,
      reviewed_by_label = v_reviewer, review_note = v_note,
      reviewed_at = clock_timestamp(), approved_at = null
    where id = p_product_id;
  elsif v_decision = 'approve' then
    if v_product.publication_status <> 'compliance_review' then
      raise exception 'Product must be in compliance_review before approval' using errcode = '23514';
    end if;
    if v_seller_url is null or v_compliance_url is null then
      raise exception 'Seller and compliance evidence URLs are required for approval' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'approved', seller_verification_required = false,
      compliance_status = 'approved', is_active = true, is_orderable = true,
      seller_evidence_url = v_seller_url, compliance_evidence_url = v_compliance_url,
      reviewed_by_label = v_reviewer, review_note = v_note,
      reviewed_at = clock_timestamp(), approved_at = clock_timestamp()
    where id = p_product_id;
  elsif v_decision = 'reject' then
    if v_product.publication_status = 'rejected' then
      raise exception 'Product is already rejected' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'rejected', seller_verification_required = true,
      compliance_status = 'rejected', is_active = false, is_orderable = false,
      seller_evidence_url = v_seller_url, compliance_evidence_url = v_compliance_url,
      reviewed_by_label = v_reviewer, review_note = v_note,
      reviewed_at = clock_timestamp(), approved_at = null
    where id = p_product_id;
  else
    if v_product.publication_status <> 'approved' then
      raise exception 'Only approved products can be unpublished' using errcode = '23514';
    end if;
    update public.dawanear_marketplace_products set
      publication_status = 'compliance_review', compliance_status = 'Review required after unpublish',
      is_active = false, is_orderable = false, reviewed_by_label = v_reviewer,
      review_note = v_note, reviewed_at = clock_timestamp(), approved_at = null
    where id = p_product_id;
  end if;

  select jsonb_build_object(
    'id', id,
    'publication_status', publication_status,
    'seller_verification_required', seller_verification_required,
    'compliance_status', compliance_status,
    'is_active', is_active,
    'is_orderable', is_orderable,
    'seller_evidence_url', seller_evidence_url,
    'compliance_evidence_url', compliance_evidence_url,
    'reviewed_by_label', reviewed_by_label,
    'reviewed_at', reviewed_at,
    'approved_at', approved_at,
    'updated_at', updated_at
  ) into v_result
  from public.dawanear_marketplace_products where id = p_product_id;

  insert into public.dawanear_marketplace_product_reviews (
    product_id, decision, reviewed_by_label, evidence_note,
    seller_evidence_url, compliance_evidence_url,
    expected_product_updated_at, previous_state, resulting_state
  ) values (
    p_product_id, v_decision, v_reviewer, v_note,
    v_seller_url, v_compliance_url,
    p_expected_updated_at, v_previous, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.dawanear_review_marketplace_product(
  text, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.dawanear_review_marketplace_product(
  text, text, text, text, timestamptz, text, text
) to service_role;

comment on function public.dawanear_review_marketplace_product(
  text, text, text, text, timestamptz, text, text
) is
  'Service-only, optimistic-locking marketplace publication workflow. Changes exactly one product and writes one immutable evidence audit record atomically.';

-- Refresh the aggregate deployment contract for the new service-only review surface.
alter function public.dawanear_backend_contract() set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract() rename to dawanear_backend_contract_v9;
revoke all on function dawanear_private.dawanear_backend_contract_v9()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v9() as contract
), review_table as (
  select
    pg_catalog.to_regclass('public.dawanear_marketplace_product_reviews') is not null as table_exists,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = pg_catalog.to_regclass('public.dawanear_marketplace_product_reviews')
        and tgname = 'dawanear_marketplace_product_reviews_immutable'
        and tgenabled <> 'D' and not tgisinternal
    ) as immutable_trigger,
    (select count(*) from public.dawanear_marketplace_products
      where publication_status = 'approved' and (
        seller_evidence_url is null or compliance_evidence_url is null
        or reviewed_at is null or approved_at is null
      )) as approved_without_evidence_count,
    (select count(*) from public.dawanear_marketplace_products m
      where m.publication_status = 'approved' and not exists (
        select 1 from public.dawanear_marketplace_product_reviews r
        where r.product_id = m.id and r.decision = 'approve'
      )) as approved_without_audit_count
  from (values (pg_catalog.to_regclass('public.dawanear_marketplace_product_reviews'))) resolved(oid)
  left join pg_catalog.pg_class c on c.oid = resolved.oid
), review_function as (
  select
    function.oid is not null as function_exists,
    coalesce(function.prosecdef, false) as security_definer,
    coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
    coalesce(pg_catalog.has_function_privilege('service_role', function.oid, 'execute'), false) as service_role_can_execute,
    coalesce(pg_catalog.has_function_privilege('anon', function.oid, 'execute'), false) as anon_can_execute,
    coalesce(pg_catalog.has_function_privilege('authenticated', function.oid, 'execute'), false) as authenticated_can_execute
  from (values (pg_catalog.to_regprocedure(
    'public.dawanear_review_marketplace_product(text,text,text,text,timestamptz,text,text)'
  ))) resolved(oid)
  left join pg_catalog.pg_proc function on function.oid = resolved.oid
)
select
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(base.contract, '{api_surface,expected_function_count}', '28'::jsonb, true),
            '{table_surface,expected_table_count}', '21'::jsonb, true
          ),
          '{table_surface,expected_deny_by_default_count}', '9'::jsonb, true
        ),
        '{table_surface,missing_deny_by_default_count}', '0'::jsonb, true
      ),
      '{table_surface,unexpected_deny_by_default_count}', '0'::jsonb, true
    ),
    '{table_surface,unexpected_authenticated_select_count}', '0'::jsonb, true
  ) || jsonb_build_object(
    'contract_version', '2026-07-15.2',
    'marketplace_moderation', jsonb_build_object(
      'review_table_exists', review_table.table_exists,
      'review_table_rls', review_table.rls_enabled,
      'immutable_audit_trigger', review_table.immutable_trigger,
      'approved_without_evidence_count', review_table.approved_without_evidence_count,
      'approved_without_audit_count', review_table.approved_without_audit_count,
      'review_function_exists', review_function.function_exists,
      'review_function_security_definer', review_function.security_definer,
      'review_function_search_path_locked', review_function.search_path_locked,
      'service_role_can_review', review_function.service_role_can_execute,
      'anon_can_review', review_function.anon_can_execute,
      'authenticated_can_review', review_function.authenticated_can_execute
    )
  )
from base cross join review_table cross join review_function;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract() to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 aggregate deployment contract including marketplace product moderation, evidence, immutable audit and least-privilege checks.';

commit;
