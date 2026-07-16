begin;

-- Low-cardinality maintenance state used by operations monitoring. Detailed
-- object paths, order identifiers, pharmacy identities and error messages are
-- deliberately excluded from this table.
create table if not exists public.dawanear_maintenance_runs (
  task_key text primary key
    check (task_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  last_status text not null default 'running'
    check (last_status in ('running', 'succeeded', 'degraded', 'failed')),
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4096),
  updated_at timestamptz not null default now()
);

alter table public.dawanear_maintenance_runs enable row level security;
revoke all on table public.dawanear_maintenance_runs
  from public, anon, authenticated;
grant select, insert, update, delete on table public.dawanear_maintenance_runs
  to service_role;

create or replace function public.dawanear_record_maintenance_run(
  p_task_key text,
  p_status text,
  p_summary jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_task_key, '') !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or p_status not in ('running', 'succeeded', 'degraded', 'failed') then
    raise exception 'Invalid maintenance run state' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_summary, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_summary, '{}'::jsonb)::text) > 4096 then
    raise exception 'Maintenance summary must be a small JSON object' using errcode = '22023';
  end if;

  insert into public.dawanear_maintenance_runs as run (
    task_key,
    last_status,
    last_started_at,
    last_succeeded_at,
    last_failed_at,
    summary,
    updated_at
  ) values (
    p_task_key,
    p_status,
    case when p_status = 'running' then now() else null end,
    case when p_status = 'succeeded' then now() else null end,
    case when p_status in ('degraded', 'failed') then now() else null end,
    coalesce(p_summary, '{}'::jsonb),
    now()
  )
  on conflict (task_key) do update
  set last_status = excluded.last_status,
      last_started_at = case
        when excluded.last_status = 'running' then now()
        else run.last_started_at
      end,
      last_succeeded_at = case
        when excluded.last_status = 'succeeded' then now()
        else run.last_succeeded_at
      end,
      last_failed_at = case
        when excluded.last_status in ('degraded', 'failed') then now()
        else run.last_failed_at
      end,
      summary = excluded.summary,
      updated_at = now();
end;
$$;

revoke all on function public.dawanear_record_maintenance_run(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.dawanear_record_maintenance_run(text, text, jsonb)
  to service_role;

-- A single private operations snapshot keeps monitoring queries consistent and
-- avoids exporting any row-level marketplace or authentication data.
create or replace function public.dawanear_operational_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  catalogue as (
    select
      count(*) filter (where product.is_active) as active_products,
      count(*) filter (where product.is_active and product.is_orderable) as orderable_products,
      max(product.source_refreshed_at) as source_refreshed_at
    from public.dawanear_products as product
  ),
  pricing as (
    select
      count(distinct price.product_id) filter (where price.is_current) as products_with_current_prices,
      count(distinct price.pharmacy_id) filter (where price.is_current) as price_contributing_pharmacies,
      max(price.observed_at) filter (where price.is_current) as latest_price_observed_at
    from public.dawanear_pharmacy_prices as price
  ),
  pharmacy as (
    select
      count(*) filter (where p.is_active) as active_pharmacies,
      count(*) filter (where p.is_active and p.marketplace_approved) as marketplace_approved_pharmacies,
      count(*) filter (
        where p.is_active
          and p.marketplace_approved
          and p.geocode_status = 'verified'
          and p.location is not null
      ) as gps_ready_pharmacies,
      count(*) filter (
        where p.is_active
          and p.marketplace_approved
          and p.online_license_verified
          and p.geocode_status = 'verified'
          and p.location is not null
          and p.license_expires_on >= current_date
      ) as dispatch_ready_pharmacies
    from public.dawanear_pharmacies as p
  ),
  contacts as (
    select
      count(distinct contact.pharmacy_id) filter (
        where contact.contact_type = 'phone'
          and contact.verification_status not in ('rejected', 'stale')
      ) as pharmacies_with_phone,
      count(distinct contact.pharmacy_id) filter (
        where contact.contact_type = 'whatsapp'
          and contact.verification_status not in ('rejected', 'stale')
      ) as pharmacies_with_whatsapp,
      count(*) filter (
        where contact.contact_type = 'whatsapp'
          and contact.is_login_enabled
          and contact.verification_status in ('source_verified', 'admin_verified')
      ) as login_enabled_whatsapp_contacts
    from public.dawanear_pharmacy_contacts as contact
  ),
  recent_orders as (
    select order_row.*
    from public.dawanear_orders as order_row
    where order_row.created_at >= now() - interval '24 hours'
  ),
  recipient_rollup as (
    select recipient.order_id, count(*) as recipient_count
    from public.dawanear_order_recipients as recipient
    join recent_orders as recent on recent.id = recipient.order_id
    group by recipient.order_id
  ),
  confirmation_rollup as (
    select
      offer.order_id,
      count(*) filter (where offer.complete and offer.status in ('submitted', 'selected')) as complete_confirmations,
      min(offer.submitted_at) filter (where offer.complete and offer.status in ('submitted', 'selected')) as first_confirmation_at
    from public.dawanear_offers as offer
    join recent_orders as recent on recent.id = offer.order_id
    group by offer.order_id
  ),
  order_health as (
    select
      count(*) as created_24h,
      count(*) filter (where recent.created_at >= now() - interval '1 hour') as created_1h,
      count(*) filter (where coalesce(recipient.recipient_count, 0) > 0) as dispatched_24h,
      count(*) filter (where coalesce(recipient.recipient_count, 0) = 0) as without_recipient_24h,
      round((avg(recipient.recipient_count) filter (where recipient.recipient_count > 0))::numeric, 2) as average_recipients_24h,
      count(*) filter (where coalesce(confirmation.complete_confirmations, 0) > 0) as orders_confirmed_24h,
      coalesce(sum(confirmation.complete_confirmations), 0) as complete_confirmations_24h,
      round((avg(extract(epoch from (confirmation.first_confirmation_at - recent.broadcast_at)))
        filter (where confirmation.first_confirmation_at is not null and recent.broadcast_at is not null))::numeric, 1)
        as average_first_confirmation_seconds_24h,
      count(*) filter (
        where recent.status = 'broadcast'
          and recent.broadcast_at <= now() - interval '30 minutes'
          and recent.expires_at > now()
          and coalesce(confirmation.complete_confirmations, 0) = 0
      ) as waiting_without_confirmation_over_30m,
      count(*) filter (where recent.status = 'expired') as expired_24h,
      count(*) filter (where recent.status = 'selected') as selected_24h,
      count(*) filter (where recent.status = 'completed') as completed_24h
    from recent_orders as recent
    left join recipient_rollup as recipient on recipient.order_id = recent.id
    left join confirmation_rollup as confirmation on confirmation.order_id = recent.id
  ),
  otp as (
    select
      count(*) filter (where challenge.created_at >= now() - interval '1 hour') as challenges_1h,
      count(*) filter (where challenge.created_at >= now() - interval '24 hours') as challenges_24h,
      count(*) filter (
        where challenge.created_at >= now() - interval '24 hours'
          and challenge.delivery_status = 'sent'
      ) as sent_24h,
      count(*) filter (
        where challenge.created_at >= now() - interval '24 hours'
          and challenge.delivery_status = 'failed'
      ) as failed_24h,
      count(*) filter (
        where challenge.created_at >= now() - interval '24 hours'
          and challenge.delivery_status = 'suppressed'
      ) as unregistered_suppressed_24h
    from public.dawanear_pharmacy_otp_challenges as challenge
  ),
  identity as (
    select count(*) filter (where identity.last_login_at >= now() - interval '24 hours') as pharmacy_logins_24h
    from public.dawanear_pharmacy_identities as identity
  ),
  cleanup as (
    select
      run.last_status,
      run.last_started_at,
      run.last_succeeded_at,
      run.last_failed_at,
      run.summary,
      run.updated_at
    from public.dawanear_maintenance_runs as run
    where run.task_key = 'prescription_cleanup'
  ),
  cleanup_claims as (
    select
      count(*) filter (where claim.lease_expires_at > now()) as active_claims,
      count(*) filter (where claim.lease_expires_at <= now()) as expired_claims
    from dawanear_private.dawanear_prescription_cleanup_claims as claim
  )
  select jsonb_build_object(
    'generated_at', now(),
    'privacy', jsonb_build_object(
      'aggregate_only', true,
      'contains_customer_identifiers', false,
      'contains_pharmacy_identifiers', false,
      'contains_health_or_location_data', false
    ),
    'catalogue', jsonb_build_object(
      'active_products', catalogue.active_products,
      'orderable_products', catalogue.orderable_products,
      'products_with_current_prices', pricing.products_with_current_prices,
      'price_contributing_pharmacies', pricing.price_contributing_pharmacies,
      'source_refreshed_at', catalogue.source_refreshed_at,
      'latest_price_observed_at', pricing.latest_price_observed_at
    ),
    'pharmacies', jsonb_build_object(
      'active', pharmacy.active_pharmacies,
      'marketplace_approved', pharmacy.marketplace_approved_pharmacies,
      'gps_ready', pharmacy.gps_ready_pharmacies,
      'dispatch_ready', pharmacy.dispatch_ready_pharmacies,
      'with_phone', contacts.pharmacies_with_phone,
      'with_whatsapp', contacts.pharmacies_with_whatsapp,
      'login_enabled_whatsapp_contacts', contacts.login_enabled_whatsapp_contacts
    ),
    'orders', jsonb_build_object(
      'created_1h', order_health.created_1h,
      'created_24h', order_health.created_24h,
      'dispatched_24h', order_health.dispatched_24h,
      'without_recipient_24h', order_health.without_recipient_24h,
      'average_recipients_24h', order_health.average_recipients_24h,
      'orders_confirmed_24h', order_health.orders_confirmed_24h,
      'complete_confirmations_24h', order_health.complete_confirmations_24h,
      'average_first_confirmation_seconds_24h', order_health.average_first_confirmation_seconds_24h,
      'waiting_without_confirmation_over_30m', order_health.waiting_without_confirmation_over_30m,
      'expired_24h', order_health.expired_24h,
      'selected_24h', order_health.selected_24h,
      'completed_24h', order_health.completed_24h
    ),
    'pharmacy_auth', jsonb_build_object(
      'otp_challenges_1h', otp.challenges_1h,
      'otp_challenges_24h', otp.challenges_24h,
      'otp_sent_24h', otp.sent_24h,
      'otp_failed_24h', otp.failed_24h,
      'unregistered_numbers_suppressed_24h', otp.unregistered_suppressed_24h,
      'pharmacy_logins_24h', identity.pharmacy_logins_24h
    ),
    'prescription_cleanup', jsonb_build_object(
      'last_status', coalesce(cleanup.last_status, 'never_run'),
      'last_started_at', cleanup.last_started_at,
      'last_succeeded_at', cleanup.last_succeeded_at,
      'last_failed_at', cleanup.last_failed_at,
      'stale', coalesce(cleanup.updated_at < now() - interval '26 hours', true),
      'active_claims', cleanup_claims.active_claims,
      'expired_claims', cleanup_claims.expired_claims,
      'summary', coalesce(cleanup.summary, '{}'::jsonb)
    )
  )
  from catalogue
  cross join pricing
  cross join pharmacy
  cross join contacts
  cross join order_health
  cross join otp
  cross join identity
  cross join cleanup_claims
  left join cleanup on true;
$$;

revoke all on function public.dawanear_operational_health()
  from public, anon, authenticated;
grant execute on function public.dawanear_operational_health()
  to service_role;

comment on function public.dawanear_operational_health() is
  'Service-only aggregate MED+250 operations snapshot with no row identifiers, contact details, products, prescriptions or locations.';

commit;
-- Filename aligned with the migration version recorded by the production project.
