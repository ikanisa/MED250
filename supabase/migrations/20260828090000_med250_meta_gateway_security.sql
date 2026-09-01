begin;

create table if not exists public.dawanear_meta_webhook_receipts (
  event_key text primary key check (event_key ~ '^[0-9a-f]{64}$'),
  body_digest text not null check (body_digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'processing' check (state in ('processing', 'completed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 1000),
  lock_expires_at timestamptz not null,
  event_reference text check (event_reference is null or event_reference ~ '^[0-9a-f]{64}$'),
  delivery_state text check (delivery_state is null or delivery_state in ('sent', 'delivered', 'read', 'failed')),
  error_class text check (error_class is null or char_length(error_class) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create index if not exists dawanear_meta_webhook_receipts_expiry_idx
  on public.dawanear_meta_webhook_receipts (expires_at);

create table if not exists public.dawanear_meta_webhook_rate_limits (
  scope text not null check (scope ~ '^[a-z_]{1,40}$'),
  identifier text not null check (identifier ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count between 1 and 100000),
  expires_at timestamptz not null,
  primary key (scope, identifier)
);

create index if not exists dawanear_meta_webhook_rate_expiry_idx
  on public.dawanear_meta_webhook_rate_limits (expires_at);

alter table public.dawanear_meta_webhook_receipts enable row level security;
alter table public.dawanear_meta_webhook_rate_limits enable row level security;

revoke all on table public.dawanear_meta_webhook_receipts from public, anon, authenticated;
revoke all on table public.dawanear_meta_webhook_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.dawanear_meta_webhook_receipts to service_role;
grant select, insert, update, delete on table public.dawanear_meta_webhook_rate_limits to service_role;

create or replace function public.dawanear_claim_meta_webhook_event(
  p_event_key text,
  p_body_digest text,
  p_lock_seconds integer default 120
)
returns table (claimed boolean, conflict boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_receipt public.dawanear_meta_webhook_receipts%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_event_key !~ '^[0-9a-f]{64}$' or p_body_digest !~ '^[0-9a-f]{64}$'
     or p_lock_seconds < 15 or p_lock_seconds > 600 then
    raise exception 'Invalid Meta webhook claim input' using errcode = '22023';
  end if;

  insert into public.dawanear_meta_webhook_receipts (
    event_key, body_digest, state, attempt_count, lock_expires_at, created_at, updated_at, expires_at
  ) values (
    p_event_key, p_body_digest, 'processing', 1,
    v_now + make_interval(secs => p_lock_seconds), v_now, v_now, v_now + interval '30 days'
  ) on conflict (event_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return query select true, false;
    return;
  end if;

  select receipt.* into v_receipt
  from public.dawanear_meta_webhook_receipts as receipt
  where receipt.event_key = p_event_key
  for update;

  if v_receipt.body_digest <> p_body_digest then
    return query select false, true;
    return;
  end if;
  if v_receipt.state = 'completed'
     or (v_receipt.state = 'processing' and v_receipt.lock_expires_at > v_now) then
    return query select false, false;
    return;
  end if;

  update public.dawanear_meta_webhook_receipts
  set state = 'processing',
      attempt_count = attempt_count + 1,
      lock_expires_at = v_now + make_interval(secs => p_lock_seconds),
      error_class = null,
      updated_at = v_now,
      expires_at = greatest(expires_at, v_now + interval '30 days')
  where event_key = p_event_key;
  return query select true, false;
end;
$$;

create or replace function public.dawanear_complete_meta_webhook_event(
  p_event_key text,
  p_event_reference text,
  p_delivery_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_reference !~ '^[0-9a-f]{64}$'
     or p_delivery_state not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'Invalid Meta webhook completion input' using errcode = '22023';
  end if;
  update public.dawanear_meta_webhook_receipts
  set state = 'completed', event_reference = p_event_reference,
      delivery_state = p_delivery_state, error_class = null,
      lock_expires_at = clock_timestamp(), updated_at = clock_timestamp()
  where event_key = p_event_key and state = 'processing';
  if not found then raise exception 'Meta webhook receipt is not claimable' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.dawanear_fail_meta_webhook_event(
  p_event_key text,
  p_error_class text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.dawanear_meta_webhook_receipts
  set state = 'failed', error_class = left(coalesce(nullif(btrim(p_error_class), ''), 'processing_error'), 80),
      lock_expires_at = clock_timestamp(), updated_at = clock_timestamp()
  where event_key = p_event_key and state = 'processing';
end;
$$;

create or replace function public.dawanear_consume_meta_webhook_rate(
  p_scope text,
  p_identifier text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (allowed boolean, retry_after_seconds integer, request_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.dawanear_meta_webhook_rate_limits%rowtype;
begin
  if p_scope !~ '^[a-z_]{1,40}$' or p_identifier !~ '^[0-9a-f]{64}$'
     or p_window_seconds < 1 or p_window_seconds > 86400
     or p_max_requests < 1 or p_max_requests > 10000 then
    raise exception 'Invalid Meta webhook rate input' using errcode = '22023';
  end if;

  insert into public.dawanear_meta_webhook_rate_limits (
    scope, identifier, window_started_at, request_count, expires_at
  ) values (
    p_scope, p_identifier, v_now, 1,
    v_now + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (scope, identifier) do update
  set window_started_at = case
        when public.dawanear_meta_webhook_rate_limits.window_started_at
          <= v_now - make_interval(secs => p_window_seconds) then v_now
        else public.dawanear_meta_webhook_rate_limits.window_started_at
      end,
      request_count = case
        when public.dawanear_meta_webhook_rate_limits.window_started_at
          <= v_now - make_interval(secs => p_window_seconds) then 1
        else public.dawanear_meta_webhook_rate_limits.request_count + 1
      end,
      expires_at = v_now + make_interval(secs => p_window_seconds * 2)
  returning * into v_row;

  return query select
    v_row.request_count <= p_max_requests,
    case when v_row.request_count <= p_max_requests then 0
      else greatest(1, ceil(extract(epoch from (
        v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now
      )))::integer) end,
    v_row.request_count;
end;
$$;

create or replace function public.dawanear_purge_meta_webhook_security_state()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
  v_rows integer := 0;
begin
  delete from public.dawanear_meta_webhook_receipts where expires_at < clock_timestamp();
  get diagnostics v_rows = row_count;
  v_deleted := v_deleted + v_rows;
  delete from public.dawanear_meta_webhook_rate_limits where expires_at < clock_timestamp();
  get diagnostics v_rows = row_count;
  return v_deleted + v_rows;
end;
$$;

create or replace function public.dawanear_record_whatsapp_delivery(
  p_message_id text,
  p_status text,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_message_id), '') is null or char_length(p_message_id) > 512
     or p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'Invalid WhatsApp delivery input' using errcode = '22023';
  end if;

  if p_status = 'read' then
    update public.dawanear_whatsapp_outbox
    set status = 'read', read_at = coalesce(read_at, clock_timestamp()),
        delivered_at = coalesce(delivered_at, clock_timestamp()),
        sent_at = coalesce(sent_at, clock_timestamp()), updated_at = clock_timestamp()
    where whatsapp_message_id = p_message_id and status <> 'read';
  elsif p_status = 'delivered' then
    update public.dawanear_whatsapp_outbox
    set status = 'delivered', delivered_at = coalesce(delivered_at, clock_timestamp()),
        sent_at = coalesce(sent_at, clock_timestamp()), updated_at = clock_timestamp()
    where whatsapp_message_id = p_message_id
      and status in ('queued', 'sending', 'retry', 'sent', 'failed');
  elsif p_status = 'sent' then
    update public.dawanear_whatsapp_outbox
    set status = 'sent', sent_at = coalesce(sent_at, clock_timestamp()), updated_at = clock_timestamp()
    where whatsapp_message_id = p_message_id and status in ('queued', 'sending', 'retry');
  else
    update public.dawanear_whatsapp_outbox
    set status = 'failed', failed_at = coalesce(failed_at, clock_timestamp()),
        last_error_code = left(nullif(btrim(p_error_code), ''), 120), updated_at = clock_timestamp()
    where whatsapp_message_id = p_message_id and status in ('queued', 'sending', 'retry', 'sent');
  end if;
end;
$$;

revoke all on function public.dawanear_claim_meta_webhook_event(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.dawanear_complete_meta_webhook_event(text, text, text)
  from public, anon, authenticated;
revoke all on function public.dawanear_fail_meta_webhook_event(text, text)
  from public, anon, authenticated;
revoke all on function public.dawanear_consume_meta_webhook_rate(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.dawanear_purge_meta_webhook_security_state()
  from public, anon, authenticated;
revoke all on function public.dawanear_record_whatsapp_delivery(text, text, text)
  from public, anon, authenticated;

grant execute on function public.dawanear_claim_meta_webhook_event(text, text, integer) to service_role;
grant execute on function public.dawanear_complete_meta_webhook_event(text, text, text) to service_role;
grant execute on function public.dawanear_fail_meta_webhook_event(text, text) to service_role;
grant execute on function public.dawanear_consume_meta_webhook_rate(text, text, integer, integer) to service_role;
grant execute on function public.dawanear_purge_meta_webhook_security_state() to service_role;
grant execute on function public.dawanear_record_whatsapp_delivery(text, text, text) to service_role;

comment on table public.dawanear_meta_webhook_receipts is
  'Service-role-only digest receipts for the disabled-by-default MED250 direct-Meta recovery callback.';
comment on table public.dawanear_meta_webhook_rate_limits is
  'Service-role-only pseudonymous rate state for the disabled-by-default MED250 direct-Meta recovery callback.';

commit;
