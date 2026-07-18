begin;

-- The production database protects all DDL behind a transaction-local guard
-- that continuously re-validates product-image governance. This migration does
-- not alter that governance, but it still needs the reviewed per-transaction
-- override so unrelated WhatsApp DDL can run while the guard remains enabled.
select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

-- A customer remains in the isolated browser auth store, but an order can only
-- be broadcast after the WhatsApp number on that customer profile has been
-- verified in the current account. OTP material and delivery work stay
-- service-only even though the tables live in the public schema for Supabase
-- client compatibility.
alter table public.dawanear_customer_profiles
  add column if not exists whatsapp_verified_at timestamptz;

create table if not exists public.dawanear_customer_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^[1-9][0-9]{7,14}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 5),
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued', 'sent', 'failed')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create index if not exists dawanear_customer_otp_user_created_idx
  on public.dawanear_customer_otp_challenges (user_id, created_at desc);
create index if not exists dawanear_customer_otp_phone_created_idx
  on public.dawanear_customer_otp_challenges (phone, created_at desc);
create index if not exists dawanear_customer_otp_source_created_idx
  on public.dawanear_customer_otp_challenges (source_hash, created_at desc);
create index if not exists dawanear_customer_otp_expiry_idx
  on public.dawanear_customer_otp_challenges (expires_at)
  where used_at is null;

alter table public.dawanear_customer_otp_challenges enable row level security;
revoke all on table public.dawanear_customer_otp_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.dawanear_customer_otp_challenges to service_role;

create or replace function public.dawanear_issue_customer_otp(
  p_user_id uuid,
  p_phone text,
  p_code_hash text,
  p_source_hash text,
  p_expires_at timestamptz
)
returns table (
  challenge_id uuid,
  challenge_expires_at timestamptz,
  rate_limit_reason text,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_challenge_id uuid;
begin
  if p_user_id is null
     or p_phone !~ '^[1-9][0-9]{7,14}$'
     or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_source_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= v_now
     or p_expires_at > v_now + interval '10 minutes'
     or not exists (
       select 1 from auth.users as customer
       where customer.id = p_user_id
     ) then
    raise exception 'Invalid customer OTP challenge input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med250:customer-otp:global', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med250:customer-otp:user:' || p_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med250:customer-otp:phone:' || p_phone, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med250:customer-otp:source:' || p_source_hash, 0));

  if (select count(*) from public.dawanear_customer_otp_challenges where user_id = p_user_id and created_at >= v_now - interval '1 minute') >= 1 then
    return query select null::uuid, null::timestamptz, 'Please wait 60 seconds before requesting another code.'::text, 60;
    return;
  end if;
  if (select count(*) from public.dawanear_customer_otp_challenges where phone = p_phone and created_at >= v_now - interval '1 hour') >= 5 then
    return query select null::uuid, null::timestamptz, 'Too many codes were requested for this number. Try again later.'::text, 900;
    return;
  end if;
  if (select count(*) from public.dawanear_customer_otp_challenges where source_hash = p_source_hash and created_at >= v_now - interval '5 minutes') >= 10
     or (select count(*) from public.dawanear_customer_otp_challenges where source_hash = p_source_hash and created_at >= v_now - interval '1 hour') >= 30
     or (select count(*) from public.dawanear_customer_otp_challenges where created_at >= v_now - interval '1 minute') >= 60 then
    return query select null::uuid, null::timestamptz, 'Too many verification requests. Try again shortly.'::text, 300;
    return;
  end if;

  update public.dawanear_customer_otp_challenges
  set used_at = v_now
  where (user_id = p_user_id or phone = p_phone)
    and used_at is null;

  insert into public.dawanear_customer_otp_challenges (
    user_id, phone, code_hash, source_hash, expires_at
  ) values (
    p_user_id, p_phone, p_code_hash, p_source_hash, p_expires_at
  ) returning id into v_challenge_id;

  return query select v_challenge_id, p_expires_at, null::text, null::integer;
end;
$$;

create or replace function public.dawanear_consume_customer_otp(
  p_challenge_id uuid,
  p_user_id uuid,
  p_phone text,
  p_code_hash text
)
returns table (accepted boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.dawanear_customer_otp_challenges%rowtype;
begin
  if p_user_id is null or p_phone !~ '^[1-9][0-9]{7,14}$' or p_code_hash !~ '^[0-9a-f]{64}$' then
    return query select false, 'invalid';
    return;
  end if;

  select * into v_challenge
  from public.dawanear_customer_otp_challenges
  where id = p_challenge_id and user_id = p_user_id and phone = p_phone
  for update;

  if not found or v_challenge.used_at is not null then
    return query select false, 'invalid';
    return;
  end if;
  if v_challenge.expires_at <= now() then
    update public.dawanear_customer_otp_challenges set used_at = now() where id = p_challenge_id;
    return query select false, 'expired';
    return;
  end if;
  if v_challenge.attempts >= v_challenge.max_attempts then
    update public.dawanear_customer_otp_challenges set used_at = now() where id = p_challenge_id;
    return query select false, 'locked';
    return;
  end if;
  if v_challenge.code_hash <> p_code_hash then
    update public.dawanear_customer_otp_challenges
    set attempts = attempts + 1,
        used_at = case when attempts + 1 >= max_attempts then now() else used_at end
    where id = p_challenge_id;
    return query select false, 'invalid';
    return;
  end if;

  update public.dawanear_customer_otp_challenges
  set attempts = attempts + 1, used_at = now()
  where id = p_challenge_id;
  return query select true, 'accepted';
end;
$$;

create or replace function dawanear_private.dawanear_invalidate_changed_customer_whatsapp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.whatsapp is distinct from old.whatsapp then
    new.whatsapp_verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists dawanear_customer_whatsapp_invalidate on public.dawanear_customer_profiles;
create trigger dawanear_customer_whatsapp_invalidate
before update of whatsapp on public.dawanear_customer_profiles
for each row execute function dawanear_private.dawanear_invalidate_changed_customer_whatsapp();

create or replace function public.dawanear_mark_customer_whatsapp_verified(
  p_user_id uuid,
  p_phone text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verified_at timestamptz := now();
begin
  if p_user_id is null or p_phone !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'Invalid verified customer WhatsApp input' using errcode = '22023';
  end if;

  insert into public.dawanear_customer_profiles (user_id, whatsapp)
  values (p_user_id, p_phone)
  on conflict (user_id) do update
  set whatsapp = excluded.whatsapp,
      updated_at = now();

  -- Kept as a second statement so the contact-change trigger always clears a
  -- previous verification before this service-only operation establishes the
  -- new one.
  update public.dawanear_customer_profiles
  set whatsapp_verified_at = v_verified_at,
      updated_at = v_verified_at
  where user_id = p_user_id and whatsapp = p_phone;

  return v_verified_at;
end;
$$;

revoke all on function public.dawanear_issue_customer_otp(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.dawanear_consume_customer_otp(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.dawanear_mark_customer_whatsapp_verified(uuid, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_issue_customer_otp(uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.dawanear_consume_customer_otp(uuid, uuid, text, text)
  to service_role;
grant execute on function public.dawanear_mark_customer_whatsapp_verified(uuid, text)
  to service_role;

create or replace function dawanear_private.dawanear_require_verified_customer_whatsapp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.whatsapp is null or not exists (
    select 1
    from public.dawanear_customer_profiles as profile
    where profile.user_id = new.user_id
      and profile.whatsapp = new.whatsapp
      and profile.whatsapp_verified_at is not null
  ) then
    raise exception 'Verify this WhatsApp number before sending an availability request'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists dawanear_orders_verified_customer_whatsapp on public.dawanear_orders;
create trigger dawanear_orders_verified_customer_whatsapp
before insert or update of user_id, whatsapp on public.dawanear_orders
for each row execute function dawanear_private.dawanear_require_verified_customer_whatsapp();

-- Durable message outbox. Order and offer transactions only enqueue work;
-- network delivery is retried asynchronously by an Edge Function.
create table if not exists public.dawanear_whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 220),
  recipient_e164 text not null check (recipient_e164 ~ '^[1-9][0-9]{7,14}$'),
  kind text not null check (kind in ('pharmacy_request', 'customer_offer', 'pharmacy_selected')),
  order_id uuid not null references public.dawanear_orders(id) on delete cascade,
  pharmacy_id uuid references public.dawanear_pharmacies(id) on delete cascade,
  offer_id uuid references public.dawanear_offers(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'retry', 'sent', 'delivered', 'read', 'failed')),
  attempts smallint not null default 0 check (attempts between 0 and 8),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 8),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  whatsapp_message_id text unique,
  last_error_code text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dawanear_whatsapp_outbox_pending_idx
  on public.dawanear_whatsapp_outbox (available_at, created_at)
  where status in ('queued', 'retry');
create index if not exists dawanear_whatsapp_outbox_order_idx
  on public.dawanear_whatsapp_outbox (order_id, created_at desc);

alter table public.dawanear_whatsapp_outbox enable row level security;
revoke all on table public.dawanear_whatsapp_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.dawanear_whatsapp_outbox to service_role;

create or replace function dawanear_private.dawanear_enqueue_pharmacy_request_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact text;
  v_payload jsonb;
begin
  if new.kind <> 'new_request' then return new; end if;

  select contact.e164 into v_contact
  from public.dawanear_pharmacy_contacts as contact
  where contact.pharmacy_id = new.pharmacy_id
    and contact.contact_type = 'whatsapp'
    and contact.is_login_enabled
    and contact.verification_status in ('source_verified', 'admin_verified')
  order by contact.is_primary desc, contact.verified_at desc nulls last, contact.id
  limit 1;
  if v_contact is null then return new; end if;

  select jsonb_build_object(
    'reference', orders.reference,
    'delivery_preference', orders.delivery_preference,
    'has_prescription', orders.prescription_path is not null,
    'distance_m', recipient.distance_m,
    'portal_path', 'pharmacy-portal=open&request=' || orders.id::text,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product.id,
      'brand', product.brand_name,
      'generic', product.generic_name,
      'strength', product.strength,
      'form', product.dosage_form,
      'pack_size', product.pack_size,
      'quantity', item.quantity,
      'image_url', product.image_url
    ) order by item.created_at, item.id), '[]'::jsonb)
  ) into v_payload
  from public.dawanear_orders as orders
  join public.dawanear_order_recipients as recipient
    on recipient.order_id = orders.id and recipient.pharmacy_id = new.pharmacy_id
  join public.dawanear_order_items as item on item.order_id = orders.id
  join public.dawanear_products as product on product.id = item.product_id
  where orders.id = new.order_id
  group by orders.id, orders.reference, orders.delivery_preference,
           orders.prescription_path, recipient.distance_m;

  insert into public.dawanear_whatsapp_outbox (
    dedupe_key, recipient_e164, kind, order_id, pharmacy_id, payload
  ) values (
    'pharmacy-request:' || new.id::text || ':' || v_contact,
    v_contact, 'pharmacy_request', new.order_id, new.pharmacy_id, v_payload
  ) on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

drop trigger if exists dawanear_pharmacy_request_whatsapp_enqueue on public.dawanear_pharmacy_notifications;
create trigger dawanear_pharmacy_request_whatsapp_enqueue
after insert on public.dawanear_pharmacy_notifications
for each row execute function dawanear_private.dawanear_enqueue_pharmacy_request_message();

create or replace function dawanear_private.dawanear_enqueue_customer_offer_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_payload jsonb;
begin
  if new.status <> 'submitted' or new.complete is distinct from true then return new; end if;
  if tg_op = 'UPDATE'
     and old.submitted_at is not distinct from new.submitted_at
     and old.total_rwf is not distinct from new.total_rwf
     and old.complete is not distinct from new.complete then
    return new;
  end if;

  select orders.whatsapp into v_phone
  from public.dawanear_orders as orders
  join public.dawanear_customer_profiles as profile on profile.user_id = orders.user_id
  where orders.id = new.order_id
    and profile.whatsapp = orders.whatsapp
    and profile.whatsapp_verified_at is not null;
  if v_phone is null then return new; end if;

  select jsonb_build_object(
    'reference', orders.reference,
    'pharmacy_name', pharmacy.name,
    'complete', new.complete,
    'total_rwf', new.total_rwf,
    'ready_in_minutes', new.ready_in_minutes,
    'fulfilment_method', new.fulfilment_method,
    'portal_path', 'request=' || orders.id::text,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'available', offer_item.available,
      'is_substitute', offer_item.is_substitute,
      'brand', product.brand_name,
      'strength', product.strength,
      'pack_size', product.pack_size,
      'quantity', offer_item.quantity,
      'unit_price_rwf', offer_item.unit_price_rwf,
      'image_url', product.image_url
    ) order by offer_item.id), '[]'::jsonb)
  ) into v_payload
  from public.dawanear_orders as orders
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = new.pharmacy_id
  join public.dawanear_offer_items as offer_item on offer_item.offer_id = new.id
  left join public.dawanear_products as product on product.id = offer_item.offered_product_id
  where orders.id = new.order_id
  group by orders.id, orders.reference, pharmacy.name;

  insert into public.dawanear_whatsapp_outbox (
    dedupe_key, recipient_e164, kind, order_id, pharmacy_id, offer_id, payload
  ) values (
    'customer-offer:' || new.id::text || ':' || extract(epoch from new.submitted_at)::bigint::text,
    v_phone, 'customer_offer', new.order_id, new.pharmacy_id, new.id, v_payload
  ) on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

drop trigger if exists dawanear_customer_offer_whatsapp_enqueue on public.dawanear_offers;
create trigger dawanear_customer_offer_whatsapp_enqueue
after insert or update of status, total_rwf, complete, submitted_at on public.dawanear_offers
for each row execute function dawanear_private.dawanear_enqueue_customer_offer_message();

create or replace function public.dawanear_claim_whatsapp_outbox(p_limit integer default 20)
returns table (
  id uuid,
  recipient_e164 text,
  kind text,
  payload jsonb,
  attempt_number smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 100 then
    raise exception 'WhatsApp claim limit must be between 1 and 100' using errcode = '22023';
  end if;

  -- Recover work abandoned by an interrupted function invocation.
  update public.dawanear_whatsapp_outbox as stale
  set status = 'retry', locked_at = null, available_at = now(), updated_at = now()
  where stale.status = 'sending' and stale.locked_at < now() - interval '5 minutes';

  return query
  with candidates as (
    select queued.id
    from public.dawanear_whatsapp_outbox as queued
    where queued.status in ('queued', 'retry')
      and queued.available_at <= now()
      and queued.attempts < queued.max_attempts
    order by queued.available_at, queued.created_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.dawanear_whatsapp_outbox as outgoing
    set status = 'sending',
        attempts = outgoing.attempts + 1,
        locked_at = now(),
        updated_at = now()
    from candidates
    where outgoing.id = candidates.id
    returning outgoing.id, outgoing.recipient_e164, outgoing.kind,
              outgoing.payload, outgoing.attempts
  )
  select claimed.id, claimed.recipient_e164, claimed.kind,
         claimed.payload, claimed.attempts
  from claimed;
end;
$$;

create or replace function public.dawanear_finish_whatsapp_outbox(
  p_id uuid,
  p_succeeded boolean,
  p_message_id text default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts smallint;
  v_max_attempts smallint;
begin
  select outgoing.attempts, outgoing.max_attempts
  into v_attempts, v_max_attempts
  from public.dawanear_whatsapp_outbox as outgoing
  where outgoing.id = p_id and outgoing.status = 'sending'
  for update;
  if not found then return; end if;

  if p_succeeded and nullif(btrim(p_message_id), '') is not null then
    update public.dawanear_whatsapp_outbox
    set status = 'sent', whatsapp_message_id = btrim(p_message_id),
        last_error_code = null, sent_at = now(), locked_at = null, updated_at = now()
    where id = p_id;
  elsif v_attempts >= v_max_attempts then
    update public.dawanear_whatsapp_outbox
    set status = 'failed', last_error_code = left(nullif(btrim(p_error_code), ''), 120),
        failed_at = now(), locked_at = null, updated_at = now()
    where id = p_id;
  else
    update public.dawanear_whatsapp_outbox
    set status = 'retry', last_error_code = left(nullif(btrim(p_error_code), ''), 120),
        available_at = now() + (power(2, greatest(v_attempts - 1, 0))::text || ' minutes')::interval,
        locked_at = null, updated_at = now()
    where id = p_id;
  end if;
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
  if p_status not in ('sent', 'delivered', 'read', 'failed') then return; end if;
  update public.dawanear_whatsapp_outbox
  set status = p_status,
      sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      read_at = case when p_status = 'read' then coalesce(read_at, now()) else read_at end,
      failed_at = case when p_status = 'failed' then coalesce(failed_at, now()) else failed_at end,
      last_error_code = case when p_status = 'failed' then left(nullif(btrim(p_error_code), ''), 120) else last_error_code end,
      updated_at = now()
  where whatsapp_message_id = p_message_id;
end;
$$;

revoke all on function public.dawanear_claim_whatsapp_outbox(integer)
  from public, anon, authenticated;
revoke all on function public.dawanear_finish_whatsapp_outbox(uuid, boolean, text, text)
  from public, anon, authenticated;
revoke all on function public.dawanear_record_whatsapp_delivery(text, text, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_claim_whatsapp_outbox(integer) to service_role;
grant execute on function public.dawanear_finish_whatsapp_outbox(uuid, boolean, text, text) to service_role;
grant execute on function public.dawanear_record_whatsapp_delivery(text, text, text) to service_role;

comment on table public.dawanear_customer_otp_challenges is
  'Service-only hashed OTP challenges used to verify customer WhatsApp ownership.';
comment on table public.dawanear_whatsapp_outbox is
  'Service-only durable outbox for WhatsApp Cloud API utility notifications.';

commit;

-- Schedule the outbox worker without placing its authentication token in
-- cron.job. Operators provide the endpoint and token through Supabase Vault.
begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

create or replace function dawanear_private.dawanear_invoke_whatsapp_dispatch()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_endpoint text;
  v_cron_token text;
  v_request_id bigint;
begin
  select secret.decrypted_secret into v_endpoint
  from vault.decrypted_secrets as secret
  where secret.name = 'med250_whatsapp_dispatch_url'
  order by secret.updated_at desc limit 1;

  select secret.decrypted_secret into v_cron_token
  from vault.decrypted_secrets as secret
  where secret.name = 'med250_whatsapp_dispatch_token'
  order by secret.updated_at desc limit 1;

  if nullif(pg_catalog.btrim(v_endpoint), '') is null
     or nullif(pg_catalog.btrim(v_cron_token), '') is null then
    raise exception 'MED+250 WhatsApp dispatch Vault configuration is incomplete'
      using errcode = 'P0001';
  end if;
  if v_endpoint !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/dispatch-whatsapp-notifications$' then
    raise exception 'MED+250 WhatsApp dispatch endpoint is invalid' using errcode = '22023';
  end if;

  select net.http_post(
    url := v_endpoint,
    body := '{"batch_limit":20}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'X-DawaNear-Cron-Token', v_cron_token
    ),
    timeout_milliseconds := 55000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function dawanear_private.dawanear_invoke_whatsapp_dispatch()
  from public, anon, authenticated, service_role;

select cron.unschedule(job.jobid)
from cron.job as job
where job.jobname = 'med250-whatsapp-dispatch';

select cron.schedule(
  'med250-whatsapp-dispatch',
  '* * * * *',
  'select dawanear_private.dawanear_invoke_whatsapp_dispatch();'
);

commit;
