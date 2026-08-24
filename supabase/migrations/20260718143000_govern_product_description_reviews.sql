begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

-- Decisions remain one-product-at-a-time and service-only. The public product
-- table keeps the current governed state; this table retains the exact evidence
-- used for every approval or withdrawal as an immutable audit trail.
create table public.dawanear_product_description_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.dawanear_products(id),
  decision text not null check (decision in ('approve', 'withdraw')),
  reviewed_description text not null check (
    char_length(reviewed_description) between 40 and 2000
    and btrim(reviewed_description) = reviewed_description
    and reviewed_description !~ '[[:cntrl:]]'
  ),
  source_name text not null check (char_length(btrim(source_name)) between 2 and 160),
  source_url text not null check (source_url ~ '^https://'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  rights_basis text not null check (char_length(btrim(rights_basis)) between 20 and 500),
  rights_reference text not null check (char_length(btrim(rights_reference)) between 12 and 500),
  rights_verified boolean not null check (rights_verified),
  clinical_review_status text not null check (clinical_review_status in ('not_required', 'approved')),
  review_note text not null check (char_length(btrim(review_note)) between 20 and 1000),
  reviewed_by text not null check (char_length(btrim(reviewed_by)) between 2 and 160),
  reviewed_role text not null check (char_length(btrim(reviewed_role)) between 2 and 160),
  reviewed_at timestamptz not null,
  expected_product_updated_at timestamptz not null,
  previous_state jsonb not null,
  resulting_state jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.dawanear_product_description_reviews is
  'Immutable service-only evidence ledger for one-product-at-a-time public description approvals and withdrawals.';

create index dawanear_product_description_reviews_product_created_idx
  on public.dawanear_product_description_reviews (product_id, created_at desc);

alter table public.dawanear_product_description_reviews enable row level security;
revoke all on table public.dawanear_product_description_reviews
  from public, anon, authenticated;
grant select, insert on table public.dawanear_product_description_reviews
  to service_role;

create function dawanear_private.dawanear_reject_product_description_review_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Product description review audit records are immutable'
    using errcode = '55000';
end;
$function$;

revoke all on function dawanear_private.dawanear_reject_product_description_review_mutation()
  from public, anon, authenticated;

create trigger dawanear_product_description_reviews_immutable
before update or delete on public.dawanear_product_description_reviews
for each row execute function dawanear_private.dawanear_reject_product_description_review_mutation();

create function public.dawanear_review_product_description(
  p_product_id text,
  p_decision text,
  p_expected_updated_at timestamptz,
  p_reviewed_by text,
  p_reviewed_role text,
  p_reviewed_at timestamptz,
  p_review_note text,
  p_description text default null,
  p_source_name text default null,
  p_source_url text default null,
  p_source_sha256 text default null,
  p_rights_basis text default null,
  p_rights_reference text default null,
  p_rights_verified boolean default false,
  p_clinical_review_status text default 'not_reviewed'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.dawanear_products%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_description text := coalesce(p_description, '');
  v_source_name text := btrim(coalesce(p_source_name, ''));
  v_source_url text := btrim(coalesce(p_source_url, ''));
  v_source_sha256 text := lower(btrim(coalesce(p_source_sha256, '')));
  v_rights_basis text := btrim(coalesce(p_rights_basis, ''));
  v_rights_reference text := btrim(coalesce(p_rights_reference, ''));
  v_clinical_status text := lower(btrim(coalesce(p_clinical_review_status, '')));
  v_review_note text := btrim(coalesce(p_review_note, ''));
  v_reviewed_by text := btrim(coalesce(p_reviewed_by, ''));
  v_reviewed_role text := btrim(coalesce(p_reviewed_role, ''));
  v_previous jsonb;
  v_result jsonb;
begin
  if p_product_id is null or p_product_id !~ '^(rwanda-fda-hm-[0-9]{4}|AMZ-[A-Z0-9]{10})$' then
    raise exception 'A valid MED+250 product ID is required' using errcode = '22023';
  end if;
  if v_decision not in ('approve', 'withdraw') then
    raise exception 'Decision must be approve or withdraw' using errcode = '22023';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Expected product updated_at is required' using errcode = '22023';
  end if;
  if char_length(v_reviewed_by) not between 2 and 160 then
    raise exception 'Reviewer identity must be 2-160 characters' using errcode = '22023';
  end if;
  if char_length(v_reviewed_role) not between 2 and 160 then
    raise exception 'Reviewer role must be 2-160 characters' using errcode = '22023';
  end if;
  if char_length(v_review_note) not between 20 and 1000 then
    raise exception 'Review note must be 20-1000 characters' using errcode = '22023';
  end if;
  if p_reviewed_at is null or p_reviewed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'Review timestamp is required and cannot be in the future' using errcode = '22023';
  end if;

  select * into v_product
  from public.dawanear_products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'Product was not found' using errcode = 'P0002';
  end if;
  if v_product.updated_at <> p_expected_updated_at then
    raise exception 'Product changed after inspection; inspect it again before deciding'
      using errcode = '40001';
  end if;
  if v_product.description_reviewed_at is not null
     and p_reviewed_at <= v_product.description_reviewed_at then
    raise exception 'Review timestamp must be newer than the current description review'
      using errcode = '22023';
  end if;

  v_previous := jsonb_build_object(
    'description', v_product.description,
    'source_name', v_product.description_source_name,
    'source_url', v_product.description_source_url,
    'source_sha256', v_product.description_source_sha256,
    'rights_basis', v_product.description_rights_basis,
    'rights_reference', v_product.description_rights_reference,
    'rights_verified', v_product.description_rights_verified,
    'clinical_review_status', v_product.description_clinical_review_status,
    'review_note', v_product.description_review_note,
    'reviewed_by', v_product.description_reviewed_by,
    'reviewed_role', v_product.description_reviewed_role,
    'reviewed_at', v_product.description_reviewed_at,
    'approved', v_product.description_approved,
    'updated_at', v_product.updated_at
  );

  if v_decision = 'approve' then
    if char_length(v_description) not between 40 and 2000
       or btrim(v_description) <> v_description
       or v_description ~ '[[:cntrl:]]' then
      raise exception 'Description must be 40-2000 trimmed characters without control characters'
        using errcode = '22023';
    end if;
    if char_length(v_source_name) not between 2 and 160
       or v_source_url !~ '^https://'
       or v_source_sha256 !~ '^[a-f0-9]{64}$' then
      raise exception 'Complete HTTPS source name, URL, and SHA-256 evidence are required'
        using errcode = '22023';
    end if;
    if char_length(v_rights_basis) not between 20 and 500
       or char_length(v_rights_reference) not between 12 and 500
       or not coalesce(p_rights_verified, false) then
      raise exception 'Verified reuse rights and a durable rights reference are required'
        using errcode = '22023';
    end if;
    if v_clinical_status not in ('not_required', 'approved') then
      raise exception 'Clinical review status must be approved or not_required'
        using errcode = '22023';
    end if;

    update public.dawanear_products
    set description = v_description,
        description_source_name = v_source_name,
        description_source_url = v_source_url,
        description_source_sha256 = v_source_sha256,
        description_rights_basis = v_rights_basis,
        description_rights_reference = v_rights_reference,
        description_rights_verified = true,
        description_clinical_review_status = v_clinical_status,
        description_review_note = v_review_note,
        description_reviewed_by = v_reviewed_by,
        description_reviewed_role = v_reviewed_role,
        description_reviewed_at = p_reviewed_at,
        description_approved = true
    where id = p_product_id;
  else
    if not v_product.description_approved then
      raise exception 'Only an approved description can be withdrawn' using errcode = '23514';
    end if;
    update public.dawanear_products
    set description_approved = false,
        description_review_note = v_review_note,
        description_reviewed_by = v_reviewed_by,
        description_reviewed_role = v_reviewed_role,
        description_reviewed_at = p_reviewed_at
    where id = p_product_id;
  end if;

  select jsonb_build_object(
    'id', product.id,
    'description', product.description,
    'source_name', product.description_source_name,
    'source_url', product.description_source_url,
    'source_sha256', product.description_source_sha256,
    'rights_basis', product.description_rights_basis,
    'rights_reference', product.description_rights_reference,
    'rights_verified', product.description_rights_verified,
    'clinical_review_status', product.description_clinical_review_status,
    'review_note', product.description_review_note,
    'reviewed_by', product.description_reviewed_by,
    'reviewed_role', product.description_reviewed_role,
    'reviewed_at', product.description_reviewed_at,
    'approved', product.description_approved,
    'updated_at', product.updated_at
  ) into v_result
  from public.dawanear_products as product
  where product.id = p_product_id;

  insert into public.dawanear_product_description_reviews (
    product_id, decision, reviewed_description,
    source_name, source_url, source_sha256,
    rights_basis, rights_reference, rights_verified,
    clinical_review_status, review_note,
    reviewed_by, reviewed_role, reviewed_at,
    expected_product_updated_at, previous_state, resulting_state
  ) values (
    p_product_id, v_decision, v_result->>'description',
    v_result->>'source_name', v_result->>'source_url', v_result->>'source_sha256',
    v_result->>'rights_basis', v_result->>'rights_reference',
    (v_result->>'rights_verified')::boolean,
    v_result->>'clinical_review_status', v_review_note,
    v_reviewed_by, v_reviewed_role, p_reviewed_at,
    p_expected_updated_at, v_previous, v_result
  );

  return v_result;
end;
$function$;

revoke all on function public.dawanear_review_product_description(
  text, text, timestamptz, text, text, timestamptz, text,
  text, text, text, text, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.dawanear_review_product_description(
  text, text, timestamptz, text, text, timestamptz, text,
  text, text, text, text, text, text, boolean, text
) to service_role;

comment on function public.dawanear_review_product_description(
  text, text, timestamptz, text, text, timestamptz, text,
  text, text, text, text, text, text, boolean, text
) is
  'Service-only optimistic-locking workflow. Approves or withdraws exactly one evidence-bound product description and writes one immutable audit event atomically.';

-- A deferred constraint trigger makes the workflow mandatory. Direct service
-- writes may retain private drafts, but no approval or withdrawal can commit
-- unless the same transaction wrote the matching immutable decision event.
create function dawanear_private.dawanear_require_product_description_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_decision text;
begin
  if new.description_approved then
    v_decision := 'approve';
  elsif old.description_approved and not new.description_approved then
    v_decision := 'withdraw';
  else
    return null;
  end if;

  if not exists (
    select 1
    from public.dawanear_product_description_reviews as review
    where review.product_id = new.id
      and review.decision = v_decision
      and (review.resulting_state->>'updated_at')::timestamptz = new.updated_at
      and (review.resulting_state->>'approved')::boolean = new.description_approved
      and review.resulting_state->>'description' is not distinct from new.description
      and review.resulting_state->>'source_sha256' is not distinct from new.description_source_sha256
  ) then
    raise exception 'Product description publication changes require the governed review workflow'
      using errcode = '23514';
  end if;
  return null;
end;
$function$;

revoke all on function dawanear_private.dawanear_require_product_description_audit()
  from public, anon, authenticated;

create constraint trigger dawanear_products_description_audit_required
after update on public.dawanear_products
deferrable initially deferred
for each row
when (
  row(
    old.description, old.description_source_name, old.description_source_url,
    old.description_source_sha256, old.description_rights_basis,
    old.description_rights_reference, old.description_rights_verified,
    old.description_clinical_review_status, old.description_review_note,
    old.description_reviewed_by, old.description_reviewed_role,
    old.description_reviewed_at, old.description_approved
  ) is distinct from row(
    new.description, new.description_source_name, new.description_source_url,
    new.description_source_sha256, new.description_rights_basis,
    new.description_rights_reference, new.description_rights_verified,
    new.description_clinical_review_status, new.description_review_note,
    new.description_reviewed_by, new.description_reviewed_role,
    new.description_reviewed_at, new.description_approved
  )
)
execute function dawanear_private.dawanear_require_product_description_audit();

-- Extend the aggregate release contract with the operational review boundary.
alter function public.dawanear_backend_contract() set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v21;
revoke all on function dawanear_private.dawanear_backend_contract_v21()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with base as (
  select dawanear_private.dawanear_backend_contract_v21() as contract
), review_table as (
  select
    pg_catalog.to_regclass('public.dawanear_product_description_reviews') is not null as table_exists,
    coalesce(relation.relrowsecurity, false) as rls_enabled,
    not exists (
      select 1 from pg_catalog.pg_policy
      where polrelid = 'public.dawanear_product_description_reviews'::pg_catalog.regclass
    ) as deny_by_default,
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.dawanear_product_description_reviews'::pg_catalog.regclass
        and tgname = 'dawanear_product_description_reviews_immutable'
        and not tgisinternal and tgenabled <> 'D'
    ) as immutable_trigger_enabled,
    not pg_catalog.has_table_privilege('anon', 'public.dawanear_product_description_reviews', 'select')
      and not pg_catalog.has_table_privilege('authenticated', 'public.dawanear_product_description_reviews', 'select')
      and pg_catalog.has_table_privilege('service_role', 'public.dawanear_product_description_reviews', 'select,insert')
      as service_only
  from pg_catalog.pg_class as relation
  where relation.oid = 'public.dawanear_product_description_reviews'::pg_catalog.regclass
), review_function as (
  select
    function.oid is not null as function_exists,
    coalesce(function.prosecdef, false) as security_definer,
    coalesce(function.proconfig @> array['search_path=']::text[], false) as search_path_locked,
    pg_catalog.has_function_privilege(
      'service_role',
      'public.dawanear_review_product_description(text,text,timestamptz,text,text,timestamptz,text,text,text,text,text,text,text,boolean,text)',
      'execute'
    ) as service_role_can_execute,
    pg_catalog.has_function_privilege(
      'anon',
      'public.dawanear_review_product_description(text,text,timestamptz,text,text,timestamptz,text,text,text,text,text,text,text,boolean,text)',
      'execute'
    ) as anon_can_execute,
    pg_catalog.has_function_privilege(
      'authenticated',
      'public.dawanear_review_product_description(text,text,timestamptz,text,text,timestamptz,text,text,text,text,text,text,text,boolean,text)',
      'execute'
    ) as authenticated_can_execute
  from pg_catalog.pg_proc as function
  where function.oid = pg_catalog.to_regprocedure(
    'public.dawanear_review_product_description(text,text,timestamptz,text,text,timestamptz,text,text,text,text,text,text,text,boolean,text)'
  )
), governance as (
  select
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.dawanear_products'::pg_catalog.regclass
        and tgname = 'dawanear_products_description_audit_required'
        and not tgisinternal and tgenabled <> 'D'
    ) as audit_constraint_trigger_enabled,
    (
      select count(*)
      from public.dawanear_products as product
      where product.description_approved
        and not exists (
          select 1
          from public.dawanear_product_description_reviews as review
          where review.product_id = product.id
            and review.decision = 'approve'
            and (review.resulting_state->>'updated_at')::timestamptz = product.updated_at
            and review.resulting_state->>'description' is not distinct from product.description
            and review.resulting_state->>'source_sha256' is not distinct from product.description_source_sha256
        )
    ) as approved_without_current_audit_count
)
select base.contract
  || jsonb_build_object(
    'contract_version', '2026-07-18.3',
    'product_description_workflow', jsonb_build_object(
      'review_table_exists', review_table.table_exists,
      'review_table_rls', review_table.rls_enabled,
      'review_table_deny_by_default', review_table.deny_by_default,
      'review_table_service_only', review_table.service_only,
      'immutable_audit_trigger', review_table.immutable_trigger_enabled,
      'review_function_exists', review_function.function_exists,
      'review_function_security_definer', review_function.security_definer,
      'review_function_search_path_locked', review_function.search_path_locked,
      'service_role_can_review', review_function.service_role_can_execute,
      'anon_can_review', review_function.anon_can_execute,
      'authenticated_can_review', review_function.authenticated_can_execute,
      'audit_constraint_trigger_enabled', governance.audit_constraint_trigger_enabled,
      'approved_without_current_audit_count', governance.approved_without_current_audit_count,
      'single_product_only', true
    ),
    'api_surface', coalesce(base.contract->'api_surface', '{}'::jsonb)
      || jsonb_build_object('expected_function_count', 31),
    'table_surface', coalesce(base.contract->'table_surface', '{}'::jsonb)
      || jsonb_build_object(
        'expected_table_count', 24,
        'expected_deny_by_default_count', 11,
        'unexpected_deny_by_default_count', greatest(
          coalesce((base.contract #>> '{table_surface,unexpected_deny_by_default_count}')::integer, 0)
            - case when review_table.rls_enabled and review_table.deny_by_default then 1 else 0 end,
          0
        )
      )
  )
from base
cross join review_table
cross join review_function
cross join governance;
$function$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 deployment contract including the immutable, single-product public-description review workflow.';

commit;
