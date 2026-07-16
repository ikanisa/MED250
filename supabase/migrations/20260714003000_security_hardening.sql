begin;

-- OTP issuance is one serialised transaction. The global lock is intentional:
-- the configured global ceiling is only 60 requests/minute, so serialising the
-- short counter-and-insert section gives a deterministic budget without
-- holding a lock across the external WhatsApp request.
create or replace function public.dawanear_issue_pharmacy_otp(
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
  if p_phone !~ '^2507[2389][0-9]{7}$'
     or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_source_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= v_now
     or p_expires_at > v_now + interval '10 minutes' then
    raise exception 'Invalid OTP challenge input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med250:otp:global', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med250:otp:phone:' || p_phone, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med250:otp:source:' || p_source_hash, 0));

  if (select count(*) from public.dawanear_pharmacy_otp_challenges where phone = p_phone and created_at >= v_now - interval '1 minute') >= 1 then
    return query select null::uuid, null::timestamptz, 'Please wait 60 seconds before requesting another code.'::text, 60;
    return;
  end if;
  if (select count(*) from public.dawanear_pharmacy_otp_challenges where phone = p_phone and created_at >= v_now - interval '1 hour') >= 5 then
    return query select null::uuid, null::timestamptz, 'Too many codes requested for this number. Try again later.'::text, 900;
    return;
  end if;
  if (select count(*) from public.dawanear_pharmacy_otp_challenges where source_hash = p_source_hash and created_at >= v_now - interval '5 minutes') >= 10
     or (select count(*) from public.dawanear_pharmacy_otp_challenges where source_hash = p_source_hash and created_at >= v_now - interval '1 hour') >= 30
     or (select count(*) from public.dawanear_pharmacy_otp_challenges where created_at >= v_now - interval '1 minute') >= 60 then
    return query select null::uuid, null::timestamptz, 'Too many verification requests. Try again shortly.'::text, 300;
    return;
  end if;

  update public.dawanear_pharmacy_otp_challenges
  set used_at = v_now
  where phone = p_phone and used_at is null;

  insert into public.dawanear_pharmacy_otp_challenges (
    phone, code_hash, source_hash, expires_at
  ) values (
    p_phone, p_code_hash, p_source_hash, p_expires_at
  ) returning id into v_challenge_id;

  return query select v_challenge_id, p_expires_at, null::text, null::integer;
end;
$$;

revoke all on function public.dawanear_issue_pharmacy_otp(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.dawanear_issue_pharmacy_otp(text, text, text, timestamptz)
  to service_role;

-- A removed WhatsApp identity cannot keep an active membership. Derived phone
-- contacts are retired in the same database transaction.
create or replace function dawanear_private.dawanear_retire_contact_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.contact_type = 'whatsapp'
     and old.is_login_enabled
     and (
       not new.is_login_enabled
       or new.verification_status in ('rejected', 'stale')
       or new.e164 is distinct from old.e164
     ) then
    update public.dawanear_pharmacy_contacts
    set verification_status = 'stale',
        is_login_enabled = false,
        is_primary = false,
        verified_at = now(),
        verification_note = coalesce(verification_note, 'Parent WhatsApp contact retired')
    where derived_from_contact_id = old.id
      and verification_status not in ('rejected', 'stale');

    update public.dawanear_pharmacy_memberships as membership
    set status = 'suspended', updated_at = now()
    from public.dawanear_pharmacy_identities as identity
    where identity.phone = old.e164
      and membership.user_id = identity.user_id
      and membership.pharmacy_id = old.pharmacy_id
      and membership.status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists dawanear_contacts_retire_authority on public.dawanear_pharmacy_contacts;
create trigger dawanear_contacts_retire_authority
after update of e164, is_login_enabled, verification_status
on public.dawanear_pharmacy_contacts
for each row execute function dawanear_private.dawanear_retire_contact_authority();

-- Product lifecycle state is rechecked at each committing marketplace step.
create or replace function dawanear_private.dawanear_require_current_offered_product()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.available and not exists (
    select 1 from public.dawanear_products as product
    where product.id = new.offered_product_id
      and product.is_active
      and product.is_orderable
  ) then
    raise exception 'Offered product is no longer available for ordering' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists dawanear_offer_items_current_product on public.dawanear_offer_items;
create trigger dawanear_offer_items_current_product
before insert or update of offered_product_id, available
on public.dawanear_offer_items
for each row execute function dawanear_private.dawanear_require_current_offered_product();

create or replace function dawanear_private.dawanear_revalidate_selected_offer_products()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'selected' and old.status is distinct from new.status and exists (
    select 1
    from public.dawanear_offer_items as item
    left join public.dawanear_products as product on product.id = item.offered_product_id
    where item.offer_id = new.id
      and item.available
      and (product.id is null or not product.is_active or not product.is_orderable)
  ) then
    raise exception 'Offer contains a product that is no longer available for ordering' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists dawanear_offers_revalidate_products on public.dawanear_offers;
create trigger dawanear_offers_revalidate_products
before update of status on public.dawanear_offers
for each row execute function dawanear_private.dawanear_revalidate_selected_offer_products();

-- Sequential create/cancel churn is bounded independently of the one-active-
-- order constraint. Five routed orders per hour is ample for legitimate retry
-- while preventing one session from continuously notifying nearby pharmacies.
create index if not exists dawanear_orders_user_created_idx
  on public.dawanear_orders (user_id, created_at desc);

create or replace function dawanear_private.dawanear_enforce_order_rolling_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med250:order:' || new.user_id::text, 0));
  if (select count(*) from public.dawanear_orders as existing
      where existing.user_id = new.user_id
        and existing.created_at >= now() - interval '1 hour') >= 5 then
    raise exception 'Too many orders were placed recently. Please try again later.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists dawanear_orders_rolling_quota on public.dawanear_orders;
create trigger dawanear_orders_rolling_quota
before insert on public.dawanear_orders
for each row execute function dawanear_private.dawanear_enforce_order_rolling_quota();

-- Preserve the existing active-order implementation privately, then expose a
-- wrapper that never sends incomplete pharmacy drafts over the network.
alter function public.dawanear_my_active_orders() set schema dawanear_private;
alter function dawanear_private.dawanear_my_active_orders() rename to dawanear_my_active_orders_pre_security_v1;
revoke all on function dawanear_private.dawanear_my_active_orders_pre_security_v1()
  from public, anon, authenticated, service_role;

create function public.dawanear_my_active_orders()
returns table (
  order_id uuid,
  reference text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz,
  delivery_preference text,
  substitutes_allowed boolean,
  recipient_count integer,
  offer_count integer,
  selected_offer_id uuid,
  items jsonb,
  offers jsonb
)
language sql
security definer
set search_path = ''
as $$
  select
    active.order_id,
    active.reference,
    active.status,
    active.created_at,
    active.expires_at,
    active.updated_at,
    active.delivery_preference,
    active.substitutes_allowed,
    active.recipient_count,
    jsonb_array_length(filtered.offers)::integer,
    active.selected_offer_id,
    active.items,
    filtered.offers
  from dawanear_private.dawanear_my_active_orders_pre_security_v1() as active
  cross join lateral (
    select jsonb_path_query_array(coalesce(active.offers, '[]'::jsonb), '$[*] ? (@.complete == true)') as offers
  ) as filtered;
$$;

revoke all on function public.dawanear_my_active_orders() from public, anon, authenticated;
grant execute on function public.dawanear_my_active_orders() to authenticated;

-- Return the exact verified contact that satisfies pharmacy eligibility.
create or replace function public.dawanear_selected_contact(p_order_id uuid)
returns table (
  order_id uuid,
  offer_id uuid,
  pharmacy_id uuid,
  pharmacy_name text,
  whatsapp text,
  momo_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  return query
  select o.id, f.id, pharmacy.id, pharmacy.name, contact.e164, pharmacy.momo_code
  from public.dawanear_orders as o
  join public.dawanear_offers as f on f.id = o.selected_offer_id and f.order_id = o.id
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = f.pharmacy_id
  join lateral (
    select candidate.e164
    from public.dawanear_pharmacy_contacts as candidate
    where candidate.pharmacy_id = pharmacy.id
      and candidate.contact_type = 'whatsapp'
      and candidate.is_login_enabled
      and candidate.verification_status in ('source_verified', 'admin_verified')
    order by candidate.is_primary desc, candidate.verified_at desc nulls last, candidate.id
    limit 1
  ) as contact on true
  where o.id = p_order_id
    and o.user_id = v_user_id
    and o.status in ('selected', 'completed')
    and o.selected_at is not null
    and o.selected_at > now() - interval '24 hours'
    and f.status = 'selected'
    and f.complete
    and pharmacy.is_active
    and pharmacy.marketplace_approved
    and pharmacy.online_license_verified
    and pharmacy.geocode_status = 'verified'
    and pharmacy.location is not null
    and pharmacy.license_expires_on >= current_date;
end;
$$;

revoke all on function public.dawanear_selected_contact(uuid) from public, anon, authenticated;
grant execute on function public.dawanear_selected_contact(uuid) to authenticated;

-- Bind geocode promotion to the exact row version reviewed by the operator.
create or replace function public.dawanear_approve_geocode_candidate(
  p_pharmacy_id uuid,
  p_google_place_id text,
  p_expected_updated_at timestamptz,
  p_reviewed_by text,
  p_review_note text
)
returns table (pharmacy_id uuid, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pharmacy public.dawanear_pharmacies%rowtype;
  v_reviewed_at timestamptz := now();
begin
  if char_length(btrim(coalesce(p_reviewed_by, ''))) not between 3 and 200
     or char_length(btrim(coalesce(p_review_note, ''))) not between 10 and 2000 then
    raise exception 'Reviewer identity and evidence note are required' using errcode = '22023';
  end if;

  select * into v_pharmacy
  from public.dawanear_pharmacies
  where id = p_pharmacy_id
  for update;

  if not found
     or v_pharmacy.geocode_status <> 'candidate'
     or v_pharmacy.google_place_id is distinct from p_google_place_id
     or v_pharmacy.updated_at is distinct from p_expected_updated_at
     or v_pharmacy.location is null
     or coalesce(v_pharmacy.location_confidence, 0) < 0.8 then
    return;
  end if;

  update public.dawanear_pharmacies
  set geocode_status = 'verified',
      geocode_review_place_id = p_google_place_id,
      geocode_reviewed_by = btrim(p_reviewed_by),
      geocode_reviewed_at = v_reviewed_at,
      geocode_review_note = btrim(p_review_note)
  where id = p_pharmacy_id;

  return query select p_pharmacy_id, v_reviewed_at;
end;
$$;

revoke all on function public.dawanear_approve_geocode_candidate(uuid, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_approve_geocode_candidate(uuid, text, timestamptz, text, text)
  to service_role;

commit;
