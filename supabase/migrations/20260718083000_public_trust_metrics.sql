begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

-- Public service claims are deliberately separate from operational health.
-- Operations must approve each metric against evidence, and approvals expire.
-- No approval is seeded by this migration, so the public function fails closed.
create table if not exists public.dawanear_public_metric_approvals (
  metric_key text primary key
    check (metric_key in ('ready_pharmacy_count', 'typical_response_time')),
  approved boolean not null default false,
  reviewed_by text,
  evidence_reference text,
  approved_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    not approved
    or (
      nullif(btrim(reviewed_by), '') is not null
      and nullif(btrim(evidence_reference), '') is not null
      and approved_at is not null
      and expires_at is not null
      and expires_at > approved_at
    )
  )
);

alter table public.dawanear_public_metric_approvals enable row level security;

revoke all on table public.dawanear_public_metric_approvals
  from public, anon, authenticated;
grant select, insert, update, delete on table public.dawanear_public_metric_approvals
  to service_role;

comment on table public.dawanear_public_metric_approvals is
  'Service-only, expiring operations approvals for aggregate public trust claims. Approval evidence is never exposed by the public RPC.';

create or replace function public.dawanear_public_trust_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_generated_at timestamptz := statement_timestamp();
  v_window_days constant integer := 90;
  v_minimum_sample constant integer := 30;
  v_minimum_observation_days constant integer := 3;
  v_max_staleness_days constant integer := 14;
  v_ready_approved boolean := false;
  v_response_approved boolean := false;
  v_ready_count integer := 0;
  v_response_sample integer := 0;
  v_response_days integer := 0;
  v_latest_response_at timestamptz;
  v_median_response_seconds numeric;
  v_ready_value integer;
  v_response_value integer;
  v_ready_suppressed_reason text;
  v_response_suppressed_reason text;
begin
  select exists (
    select 1
    from public.dawanear_public_metric_approvals as approval
    where approval.metric_key = 'ready_pharmacy_count'
      and approval.approved
      and approval.approved_at <= v_generated_at
      and approval.expires_at > v_generated_at
  ) into v_ready_approved;

  select exists (
    select 1
    from public.dawanear_public_metric_approvals as approval
    where approval.metric_key = 'typical_response_time'
      and approval.approved
      and approval.approved_at <= v_generated_at
      and approval.expires_at > v_generated_at
  ) into v_response_approved;

  select count(*)::integer
    into v_ready_count
  from public.dawanear_pharmacies as pharmacy
  where dawanear_private.dawanear_pharmacy_is_dispatch_eligible(pharmacy.id);

  with first_confirmations as (
    select
      request.id as order_id,
      min(confirmation.submitted_at) as first_confirmation_at,
      extract(epoch from (min(confirmation.submitted_at) - request.broadcast_at))::numeric
        as response_seconds
    from public.dawanear_orders as request
    join public.dawanear_offers as confirmation
      on confirmation.order_id = request.id
     and confirmation.complete
     and confirmation.status in ('submitted', 'selected')
     and confirmation.submitted_at >= request.broadcast_at
     and confirmation.submitted_at <= request.broadcast_at + interval '24 hours'
    where request.broadcast_at >= v_generated_at - make_interval(days => v_window_days)
      and request.broadcast_at <= v_generated_at
      and request.status in ('offers_received', 'selected', 'completed')
      and exists (
        select 1
        from public.dawanear_order_recipients as recipient
        where recipient.order_id = request.id
      )
    group by request.id, request.broadcast_at
  )
  select
    count(*)::integer,
    count(distinct (first_confirmation_at at time zone 'Africa/Kigali')::date)::integer,
    max(first_confirmation_at),
    percentile_disc(0.5) within group (order by response_seconds)
  into
    v_response_sample,
    v_response_days,
    v_latest_response_at,
    v_median_response_seconds
  from first_confirmations;

  if not v_ready_approved then
    v_ready_suppressed_reason := 'approval_required';
  elsif v_ready_count <= 0 then
    v_ready_suppressed_reason := 'no_eligible_pharmacies';
  else
    v_ready_value := v_ready_count;
  end if;

  if not v_response_approved then
    v_response_suppressed_reason := 'approval_required';
  elsif v_response_sample < v_minimum_sample then
    v_response_suppressed_reason := 'insufficient_sample';
  elsif v_response_days < v_minimum_observation_days then
    v_response_suppressed_reason := 'insufficient_day_spread';
  elsif v_latest_response_at < v_generated_at - make_interval(days => v_max_staleness_days) then
    v_response_suppressed_reason := 'stale';
  elsif v_median_response_seconds is null then
    v_response_suppressed_reason := 'insufficient_sample';
  else
    -- Whole minutes avoid false precision; any sub-minute median is shown as one minute.
    v_response_value := greatest(1, round(v_median_response_seconds / 60.0)::integer);
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'generated_at', v_generated_at,
    'ready_pharmacy_count', jsonb_build_object(
      'value', v_ready_value,
      'source', 'governed_dispatch_eligibility',
      'measurement_type', 'current_population',
      'sample_size', case when v_ready_value is not null then v_ready_count else null end,
      'window_days', null,
      'as_of', v_generated_at,
      'suppressed_reason', v_ready_suppressed_reason
    ),
    'typical_response_minutes', jsonb_build_object(
      'value', v_response_value,
      'source', 'completed_first_confirmations',
      'percentile', 'p50',
      'sample_size', case when v_response_value is not null then v_response_sample else null end,
      'window_days', v_window_days,
      'latest_observation_at', case when v_response_value is not null then v_latest_response_at else null end,
      'max_staleness_days', v_max_staleness_days,
      'suppressed_reason', v_response_suppressed_reason
    ),
    'privacy', jsonb_build_object(
      'aggregate_only', true,
      'contains_pharmacy_identity', false,
      'contains_customer_or_health_data', false,
      'suppressed_sample_counts_hidden', true
    )
  );
end;
$$;

revoke all on function public.dawanear_public_trust_metrics()
  from public;
grant execute on function public.dawanear_public_trust_metrics()
  to anon, authenticated, service_role;

comment on function public.dawanear_public_trust_metrics() is
  'Public, aggregate-only service signals. Values remain null unless separately approved, adequately sampled and fresh; no identifiers, locations, health data or suppressed sample counts are returned.';

-- Preserve the complete deployment contract and allowlist exactly this public,
-- aggregate-only SECURITY DEFINER function plus its service-only approval table.
-- The release gate still fails for any additional anonymous definer or table.
alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v19;
revoke all on function dawanear_private.dawanear_backend_contract_v19()
  from public, anon, authenticated;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as (
  select dawanear_private.dawanear_backend_contract_v19() as contract
), trust_function as (
  select
    function.prosecdef as security_definer,
    function.provolatile = 's' as stable,
    coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""']
      as search_path_locked,
    pg_catalog.has_function_privilege('public', function.oid, 'execute')
      as public_can_execute,
    pg_catalog.has_function_privilege('anon', function.oid, 'execute')
      as anon_can_execute,
    pg_catalog.has_function_privilege('authenticated', function.oid, 'execute')
      as authenticated_can_execute,
    pg_catalog.has_function_privilege('service_role', function.oid, 'execute')
      as service_role_can_execute
  from pg_catalog.pg_proc as function
  where function.oid = pg_catalog.to_regprocedure(
    'public.dawanear_public_trust_metrics()'
  )
), approval_table as (
  select
    relation.relrowsecurity as rls_enabled,
    pg_catalog.has_table_privilege('public', relation.oid, 'select')
      as public_can_select,
    pg_catalog.has_table_privilege('anon', relation.oid, 'select')
      as anon_can_select,
    pg_catalog.has_table_privilege('authenticated', relation.oid, 'select')
      as authenticated_can_select,
    pg_catalog.has_table_privilege('service_role', relation.oid, 'select')
      as service_role_can_select,
    not exists (
      select 1
      from pg_catalog.pg_policy as policy
      where policy.polrelid = relation.oid
    ) as deny_by_default
  from pg_catalog.pg_class as relation
  where relation.oid = pg_catalog.to_regclass(
    'public.dawanear_public_metric_approvals'
  )
), boundary as (
  select
    trust_function.security_definer
      and trust_function.stable
      and trust_function.search_path_locked
      and not trust_function.public_can_execute
      and trust_function.anon_can_execute
      and trust_function.authenticated_can_execute
      and trust_function.service_role_can_execute
      as function_allowlisted,
    approval_table.rls_enabled
      and not approval_table.public_can_select
      and not approval_table.anon_can_select
      and not approval_table.authenticated_can_select
      and approval_table.service_role_can_select
      and approval_table.deny_by_default
      as table_allowlisted,
    trust_function.*,
    approval_table.*
  from trust_function
  cross join approval_table
)
select base.contract || jsonb_build_object(
  'contract_version', '2026-07-18.1',
  'trust_metrics', jsonb_build_object(
    'function_exists', pg_catalog.to_regprocedure(
      'public.dawanear_public_trust_metrics()'
    ) is not null,
    'security_definer', boundary.security_definer,
    'stable', boundary.stable,
    'search_path_locked', boundary.search_path_locked,
    'public_can_execute', boundary.public_can_execute,
    'anon_can_execute', boundary.anon_can_execute,
    'authenticated_can_execute', boundary.authenticated_can_execute,
    'service_role_can_execute', boundary.service_role_can_execute,
    'approval_table_exists', pg_catalog.to_regclass(
      'public.dawanear_public_metric_approvals'
    ) is not null,
    'approval_table_rls', boundary.rls_enabled,
    'approval_table_deny_by_default', boundary.deny_by_default,
    'public_can_read_approvals', boundary.public_can_select,
    'anon_can_read_approvals', boundary.anon_can_select,
    'authenticated_can_read_approvals', boundary.authenticated_can_select,
    'service_role_can_read_approvals', boundary.service_role_can_select,
    'approval_rows_with_incomplete_evidence', (
      select count(*)
      from public.dawanear_public_metric_approvals as approval
      where approval.approved
        and (
          nullif(btrim(approval.reviewed_by), '') is null
          or nullif(btrim(approval.evidence_reference), '') is null
          or approval.approved_at is null
          or approval.expires_at is null
          or approval.expires_at <= approval.approved_at
        )
    )
  ),
  'api_surface', coalesce(base.contract->'api_surface', '{}'::jsonb)
    || jsonb_build_object(
      'expected_function_count', 30,
      'expected_authenticated_security_definer_count', 14,
      'unexpected_authenticated_security_definer_count', greatest(
        coalesce((base.contract #>> '{api_surface,unexpected_authenticated_security_definer_count}')::integer, 0)
          - case when boundary.function_allowlisted then 1 else 0 end,
        0
      )
    ),
  'table_surface', coalesce(base.contract->'table_surface', '{}'::jsonb)
    || jsonb_build_object(
      'expected_table_count', 23,
      'expected_deny_by_default_count', 10,
      'unexpected_deny_by_default_count', greatest(
        coalesce((base.contract #>> '{table_surface,unexpected_deny_by_default_count}')::integer, 0)
          - case when boundary.table_allowlisted then 1 else 0 end,
        0
      )
    )
)
from base
cross join boundary;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 deployment contract including the exact aggregate public trust-metric boundary and service-only approval governance.';

commit;
