begin;

-- DawaNear is intentionally isolated from pre-existing project data. All exposed
-- relations use a dawanear_ prefix; privileged helpers live in an unexposed schema.
create extension if not exists postgis with schema extensions;

create schema if not exists dawanear_private;
revoke all on schema dawanear_private from public, anon, authenticated;

create table if not exists public.dawanear_customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  whatsapp text check (whatsapp is null or whatsapp ~ '^2507[2389][0-9]{7}$'),
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'rw', 'fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dawanear_pharmacies (
  id uuid primary key default gen_random_uuid(),
  registry_entry_key text unique,
  registry_type text not null default 'retail'
    check (registry_type in ('retail', 'online', 'hospital', 'wholesale', 'other')),
  fda_source_serial integer,
  license_number text unique,
  name text not null,
  responsible_professional text,
  responsible_professional_registration text,
  province text,
  district text,
  sector text,
  cell text,
  sector_cell_raw text,
  google_place_id text unique,
  google_maps_url text,
  google_formatted_address text,
  location extensions.geography(point, 4326),
  location_confidence numeric(4, 3)
    check (location_confidence is null or location_confidence between 0 and 1),
  geocode_status text not null default 'pending'
    check (geocode_status in ('pending', 'candidate', 'verified', 'rejected')),
  geocode_checked_at timestamptz,
  whatsapp text check (whatsapp is null or whatsapp ~ '^2507[2389][0-9]{7}$'),
  momo_code text check (momo_code is null or char_length(momo_code) between 2 and 64),
  rating numeric(2, 1) check (rating is null or rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  license_expires_on date,
  marketplace_approved boolean not null default false,
  online_license_verified boolean not null default false,
  is_active boolean not null default true,
  source_name text not null default 'Rwanda FDA',
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dawanear_pharmacies_location_gix
  on public.dawanear_pharmacies using gist (location);
create index if not exists dawanear_pharmacies_dispatch_idx
  on public.dawanear_pharmacies
  (is_active, marketplace_approved, online_license_verified, geocode_status, license_expires_on);
create index if not exists dawanear_pharmacies_source_idx
  on public.dawanear_pharmacies (registry_type, fda_source_serial);

create table if not exists public.dawanear_pharmacy_memberships (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.dawanear_pharmacies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'revoked')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pharmacy_id, user_id)
);

create index if not exists dawanear_memberships_pharmacy_fk_idx
  on public.dawanear_pharmacy_memberships (pharmacy_id);
create index if not exists dawanear_memberships_user_fk_idx
  on public.dawanear_pharmacy_memberships (user_id);
create index if not exists dawanear_memberships_created_by_fk_idx
  on public.dawanear_pharmacy_memberships (created_by);

create table if not exists public.dawanear_pharmacy_claims (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.dawanear_pharmacies(id) on delete cascade,
  claimant_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  contact_email text not null
    check (contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  contact_phone text check (contact_phone is null or contact_phone ~ '^2507[2389][0-9]{7}$'),
  note text check (note is null or char_length(note) <= 2000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dawanear_claims_pharmacy_fk_idx
  on public.dawanear_pharmacy_claims (pharmacy_id);
create index if not exists dawanear_claims_claimant_fk_idx
  on public.dawanear_pharmacy_claims (claimant_user_id);
create index if not exists dawanear_claims_reviewer_fk_idx
  on public.dawanear_pharmacy_claims (reviewed_by);
create unique index if not exists dawanear_claims_one_pending_idx
  on public.dawanear_pharmacy_claims (pharmacy_id, claimant_user_id)
  where status = 'pending';

create table if not exists public.dawanear_products (
  id text primary key,
  source_register text,
  source_serial integer,
  registration_number text,
  brand_name text not null,
  generic_name text,
  strength text,
  dosage_form text,
  pack_size text,
  shelf_life text,
  product_type text not null default 'human_medicine',
  category text not null default 'Medicines',
  prescription_status text not null default 'unclassified'
    check (prescription_status in ('prescription', 'non_prescription', 'pharmacist_only', 'unclassified')),
  regulatory_status text not null default 'unclassified'
    check (regulatory_status in ('unclassified', 'valid', 'expiring_soon', 'grace_period', 'expired', 'withdrawn', 'suspended')),
  manufacturer text,
  manufacturer_country text,
  marketing_authorization_holder text,
  local_technical_representative text,
  registration_date date,
  expiry_date date,
  image_url text,
  image_source text,
  is_orderable boolean not null default false,
  is_active boolean not null default true,
  source_name text not null default 'Rwanda FDA',
  source_url text,
  source_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_register, source_serial)
);

-- Keep reruns safe if an earlier draft of this migration created the table
-- before pharmacist-only classification was introduced.
alter table public.dawanear_products
  drop constraint if exists dawanear_products_prescription_status_check;
alter table public.dawanear_products
  add constraint dawanear_products_prescription_status_check
  check (prescription_status in ('prescription', 'non_prescription', 'pharmacist_only', 'unclassified'));

create index if not exists dawanear_products_registration_idx
  on public.dawanear_products (registration_number);
create index if not exists dawanear_products_status_idx
  on public.dawanear_products (is_active, is_orderable, regulatory_status);
create index if not exists dawanear_products_search_idx
  on public.dawanear_products using gin (
    to_tsvector(
      'simple',
      coalesce(brand_name, '') || ' ' || coalesce(generic_name, '') || ' ' ||
      coalesce(strength, '') || ' ' || coalesce(registration_number, '')
    )
  );

create table if not exists public.dawanear_pharmacy_prices (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.dawanear_pharmacies(id) on delete cascade,
  product_id text not null references public.dawanear_products(id) on delete cascade,
  price_rwf integer not null check (price_rwf between 1 and 100000000),
  is_current boolean not null default true,
  contributed_by uuid not null references auth.users(id) on delete restrict,
  observed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pharmacy_id, product_id)
);

create index if not exists dawanear_prices_pharmacy_fk_idx
  on public.dawanear_pharmacy_prices (pharmacy_id);
create index if not exists dawanear_prices_product_fk_idx
  on public.dawanear_pharmacy_prices (product_id);
create index if not exists dawanear_prices_contributor_fk_idx
  on public.dawanear_pharmacy_prices (contributed_by);
create index if not exists dawanear_prices_current_product_idx
  on public.dawanear_pharmacy_prices (product_id, price_rwf)
  where is_current;

create table if not exists public.dawanear_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default
    ('DN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft', 'broadcast', 'offers_received', 'selected', 'completed', 'cancelled', 'expired')),
  customer_location extensions.geography(point, 4326) not null,
  location_accuracy_m numeric(10, 2) not null
    check (location_accuracy_m > 0 and location_accuracy_m <= 5000),
  whatsapp text check (whatsapp is null or whatsapp ~ '^2507[2389][0-9]{7}$'),
  delivery_preference text not null default 'either'
    check (delivery_preference in ('pickup', 'delivery', 'either')),
  substitutes_allowed boolean not null default true,
  prescription_path text,
  broadcast_radius_m integer not null default 10000 check (broadcast_radius_m = 10000),
  broadcast_limit integer not null default 20 check (broadcast_limit = 20),
  selected_offer_id uuid,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  broadcast_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

alter table public.dawanear_orders
  add column if not exists selected_at timestamptz;
alter table public.dawanear_orders
  add column if not exists client_request_id uuid;

update public.dawanear_orders
set client_request_id = gen_random_uuid()
where client_request_id is null;

alter table public.dawanear_orders
  alter column client_request_id set not null;

update public.dawanear_orders
set selected_at = updated_at
where selected_offer_id is not null
  and selected_at is null;

create index if not exists dawanear_orders_user_fk_idx
  on public.dawanear_orders (user_id, created_at desc);
create unique index if not exists dawanear_orders_user_client_request_uidx
  on public.dawanear_orders (user_id, client_request_id);

do $dawanear_active_order_preflight$
begin
  if exists (
    select 1
    from public.dawanear_orders as o
    where o.status in ('draft', 'broadcast', 'offers_received', 'selected')
    group by o.user_id
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce one active DawaNear order per customer: resolve existing duplicate active orders first'
      using errcode = '23505';
  end if;
end;
$dawanear_active_order_preflight$;

create unique index if not exists dawanear_orders_one_active_per_user_uidx
  on public.dawanear_orders (user_id)
  where status in ('draft', 'broadcast', 'offers_received', 'selected');
create index if not exists dawanear_orders_selected_offer_fk_idx
  on public.dawanear_orders (selected_offer_id);
create index if not exists dawanear_orders_status_idx
  on public.dawanear_orders (status, expires_at);
create index if not exists dawanear_orders_prescription_path_idx
  on public.dawanear_orders (prescription_path)
  where prescription_path is not null;

create table if not exists public.dawanear_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.dawanear_orders(id) on delete cascade,
  product_id text not null references public.dawanear_products(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 99),
  customer_min_rwf integer check (customer_min_rwf is null or customer_min_rwf >= 0),
  customer_max_rwf integer check (customer_max_rwf is null or customer_max_rwf >= 0),
  substitutes_allowed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (order_id, product_id),
  check (
    customer_min_rwf is null or customer_max_rwf is null or
    customer_min_rwf <= customer_max_rwf
  )
);

create index if not exists dawanear_order_items_order_fk_idx
  on public.dawanear_order_items (order_id);
create index if not exists dawanear_order_items_product_fk_idx
  on public.dawanear_order_items (product_id);

create table if not exists public.dawanear_order_recipients (
  order_id uuid not null references public.dawanear_orders(id) on delete cascade,
  pharmacy_id uuid not null references public.dawanear_pharmacies(id) on delete cascade,
  distance_m double precision not null check (distance_m >= 0 and distance_m <= 10000),
  notified_at timestamptz not null default now(),
  viewed_at timestamptz,
  primary key (order_id, pharmacy_id)
);

create index if not exists dawanear_recipients_order_fk_idx
  on public.dawanear_order_recipients (order_id);
create index if not exists dawanear_recipients_pharmacy_fk_idx
  on public.dawanear_order_recipients (pharmacy_id);

create table if not exists public.dawanear_pharmacy_notifications (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.dawanear_pharmacies(id) on delete cascade,
  order_id uuid not null references public.dawanear_orders(id) on delete cascade,
  kind text not null check (kind in ('new_request', 'order_selected', 'order_closed')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pharmacy_id, order_id, kind)
);

alter table public.dawanear_pharmacy_notifications
  drop constraint if exists dawanear_pharmacy_notifications_kind_check;
alter table public.dawanear_pharmacy_notifications
  add constraint dawanear_pharmacy_notifications_kind_check
  check (kind in ('new_request', 'order_selected', 'order_closed'));

create index if not exists dawanear_notifications_pharmacy_created_idx
  on public.dawanear_pharmacy_notifications (pharmacy_id, created_at desc);
create index if not exists dawanear_notifications_order_fk_idx
  on public.dawanear_pharmacy_notifications (order_id);

create table if not exists public.dawanear_maintenance_state (
  task_key text primary key
    check (task_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  folder_cursor text,
  updated_at timestamptz not null default now()
);

-- A durable, service-only lease closes the gap between the database cleanup
-- decision and the Storage API deletion. While a path is claimed, the order
-- trigger below prevents any new order from attaching that object.
create table if not exists dawanear_private.dawanear_prescription_cleanup_claims (
  prescription_path text primary key
    check (btrim(prescription_path) <> ''),
  claim_token uuid not null,
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  check (lease_expires_at > claimed_at)
);

alter table dawanear_private.dawanear_prescription_cleanup_claims
  enable row level security;
revoke all on table dawanear_private.dawanear_prescription_cleanup_claims
  from public, anon, authenticated, service_role;

create table if not exists public.dawanear_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.dawanear_orders(id) on delete cascade,
  pharmacy_id uuid not null references public.dawanear_pharmacies(id) on delete cascade,
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'selected', 'withdrawn', 'expired')),
  complete boolean not null default false,
  total_rwf bigint not null default 0 check (total_rwf >= 0),
  distance_m double precision not null check (distance_m >= 0 and distance_m <= 10000),
  ready_in_minutes integer check (ready_in_minutes is null or ready_in_minutes between 0 and 1440),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, pharmacy_id)
);

create index if not exists dawanear_offers_order_fk_idx
  on public.dawanear_offers (order_id);
create index if not exists dawanear_offers_pharmacy_fk_idx
  on public.dawanear_offers (pharmacy_id);

create table if not exists public.dawanear_offer_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.dawanear_offers(id) on delete cascade,
  order_item_id uuid not null references public.dawanear_order_items(id) on delete cascade,
  offered_product_id text references public.dawanear_products(id) on delete restrict,
  available boolean not null,
  is_substitute boolean not null default false,
  unit_price_rwf integer check (unit_price_rwf is null or unit_price_rwf between 1 and 100000000),
  quantity integer check (quantity is null or quantity between 1 and 99),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  unique (offer_id, order_item_id),
  check (
    (available and offered_product_id is not null and unit_price_rwf is not null and quantity is not null)
    or
    (not available and offered_product_id is null and unit_price_rwf is null and quantity is null and not is_substitute)
  )
);

create index if not exists dawanear_offer_items_offer_fk_idx
  on public.dawanear_offer_items (offer_id);
create index if not exists dawanear_offer_items_order_item_fk_idx
  on public.dawanear_offer_items (order_item_id);
create index if not exists dawanear_offer_items_product_fk_idx
  on public.dawanear_offer_items (offered_product_id);

do $dawanear_selected_offer_fk$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'dawanear_orders_selected_offer_fk'
      and conrelid = 'public.dawanear_orders'::regclass
  ) then
    alter table public.dawanear_orders
      add constraint dawanear_orders_selected_offer_fk
      foreign key (selected_offer_id)
      references public.dawanear_offers(id)
      on delete set null;
  end if;
end;
$dawanear_selected_offer_fk$;

-- Private helpers -----------------------------------------------------------

create or replace function dawanear_private.dawanear_is_permanent_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from auth.users as u
    where u.id = p_user_id
      and coalesce(u.is_anonymous, false) = false
  );
$$;

revoke all on function dawanear_private.dawanear_is_permanent_user(uuid)
  from public, anon, authenticated;

create or replace function dawanear_private.dawanear_prescription_reference_is_cleanup_eligible(
  p_status text,
  p_selected_at timestamptz,
  p_expires_at timestamptz,
  p_updated_at timestamptz
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      p_status = 'expired'
      and p_selected_at is not null
      and p_selected_at <= now() - interval '24 hours'
    )
    or (
      p_status in ('draft', 'broadcast', 'offers_received', 'cancelled', 'expired')
      and p_expires_at < now() - interval '24 hours'
    )
    or (
      p_status = 'completed'
      and p_updated_at < now() - interval '30 days'
    ),
    false
  );
$$;

revoke all on function dawanear_private.dawanear_prescription_reference_is_cleanup_eligible(
  text, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create or replace function dawanear_private.dawanear_guard_prescription_cleanup_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.prescription_path is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.prescription_path is not distinct from old.prescription_path then
      return new;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'dawanear-prescription:' || new.prescription_path,
      0
    )
  );

  if exists (
    select 1
    from dawanear_private.dawanear_prescription_cleanup_claims as c
    where c.prescription_path = new.prescription_path
  ) then
    raise exception 'Prescription object is being retired; upload a new file'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_guard_prescription_cleanup_claim()
  from public, anon, authenticated, service_role;

drop trigger if exists dawanear_orders_guard_prescription_cleanup
  on public.dawanear_orders;
create trigger dawanear_orders_guard_prescription_cleanup
before insert or update of prescription_path
on public.dawanear_orders
for each row execute function dawanear_private.dawanear_guard_prescription_cleanup_claim();

create or replace function dawanear_private.dawanear_require_permanent_membership_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not dawanear_private.dawanear_is_permanent_user(new.user_id) then
    raise exception 'Pharmacy memberships require a permanent authenticated user'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_require_permanent_membership_user()
  from public, anon, authenticated;

drop trigger if exists dawanear_memberships_permanent_user
  on public.dawanear_pharmacy_memberships;
create trigger dawanear_memberships_permanent_user
before insert or update of user_id
on public.dawanear_pharmacy_memberships
for each row execute function dawanear_private.dawanear_require_permanent_membership_user();

create or replace function dawanear_private.dawanear_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_touch_updated_at()
  from public, anon, authenticated;

drop trigger if exists dawanear_customer_profiles_touch
  on public.dawanear_customer_profiles;
create trigger dawanear_customer_profiles_touch
before update on public.dawanear_customer_profiles
for each row execute function dawanear_private.dawanear_touch_updated_at();

drop trigger if exists dawanear_pharmacies_touch
  on public.dawanear_pharmacies;
create trigger dawanear_pharmacies_touch
before update on public.dawanear_pharmacies
for each row execute function dawanear_private.dawanear_touch_updated_at();

drop trigger if exists dawanear_memberships_touch
  on public.dawanear_pharmacy_memberships;
create trigger dawanear_memberships_touch
before update on public.dawanear_pharmacy_memberships
for each row execute function dawanear_private.dawanear_touch_updated_at();

drop trigger if exists dawanear_claims_touch
  on public.dawanear_pharmacy_claims;
create trigger dawanear_claims_touch
before update on public.dawanear_pharmacy_claims
for each row execute function dawanear_private.dawanear_touch_updated_at();

drop trigger if exists dawanear_products_touch
  on public.dawanear_products;
create trigger dawanear_products_touch
before update on public.dawanear_products
for each row execute function dawanear_private.dawanear_touch_updated_at();

drop trigger if exists dawanear_prices_touch
  on public.dawanear_pharmacy_prices;
create trigger dawanear_prices_touch
before update on public.dawanear_pharmacy_prices
for each row execute function dawanear_private.dawanear_touch_updated_at();

drop trigger if exists dawanear_orders_touch
  on public.dawanear_orders;
create trigger dawanear_orders_touch
before update on public.dawanear_orders
for each row execute function dawanear_private.dawanear_touch_updated_at();

drop trigger if exists dawanear_offers_touch
  on public.dawanear_offers;
create trigger dawanear_offers_touch
before update on public.dawanear_offers
for each row execute function dawanear_private.dawanear_touch_updated_at();

-- This trigger protects the price invariant even from trusted bulk writers.
-- The advisory lock serializes contributions for one product across sessions.
create or replace function dawanear_private.dawanear_enforce_price_spread()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_min integer;
  v_max integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dawanear-price:' || new.product_id, 0)
  );

  select min(candidate.price_rwf), max(candidate.price_rwf)
    into v_min, v_max
  from (
    select pp.price_rwf
    from public.dawanear_pharmacy_prices as pp
    where pp.product_id = new.product_id
      and pp.is_current
      -- Exclude this pharmacy's previous row so INSERT .. ON CONFLICT UPDATE
      -- validates the replacement price, not the old and new prices together.
      and pp.pharmacy_id <> new.pharmacy_id
    union all
    select new.price_rwf
    where new.is_current
  ) as candidate;

  if v_min is not null and v_max - v_min > v_min then
    raise exception 'Price contribution would make the range exceed 100%% of the minimum price'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_enforce_price_spread()
  from public, anon, authenticated;

drop trigger if exists dawanear_prices_spread_guard
  on public.dawanear_pharmacy_prices;
create trigger dawanear_prices_spread_guard
before insert or update of product_id, price_rwf, is_current
on public.dawanear_pharmacy_prices
for each row execute function dawanear_private.dawanear_enforce_price_spread();

-- Safe, security-invoker views ---------------------------------------------

create or replace view public.dawanear_product_catalog
with (security_invoker = true)
as
select
  p.id,
  p.registration_number,
  p.brand_name,
  p.generic_name,
  p.strength,
  p.dosage_form,
  p.pack_size,
  p.product_type,
  p.category,
  p.prescription_status,
  p.regulatory_status,
  p.manufacturer,
  p.manufacturer_country,
  p.expiry_date,
  p.image_url,
  p.is_orderable,
  p.source_name,
  p.source_url,
  min(pp.price_rwf) filter (where pp.is_current) as price_min_rwf,
  max(pp.price_rwf) filter (where pp.is_current) as price_max_rwf,
  count(pp.product_id) filter (where pp.is_current) as price_contributors
from public.dawanear_products as p
left join public.dawanear_pharmacy_prices as pp on pp.product_id = p.id
where p.is_active
group by p.id;

create or replace view public.dawanear_pharmacy_directory
with (security_barrier = true, security_invoker = false)
as
select
  p.id,
  p.registry_entry_key,
  p.registry_type,
  p.name,
  p.license_number,
  p.responsible_professional,
  p.responsible_professional_registration,
  p.province,
  p.district,
  case when p.geocode_status = 'verified' then p.sector end as sector,
  case when p.geocode_status = 'verified' then p.cell end as cell,
  case when p.geocode_status = 'verified' then p.sector_cell_raw end as area,
  case
    when p.geocode_status = 'verified'
    then coalesce(p.google_formatted_address, p.sector_cell_raw)
  end as address,
  case when p.geocode_status = 'verified' then p.google_maps_url end as google_maps_url,
  case when p.geocode_status = 'verified' then p.rating end as rating,
  case when p.geocode_status = 'verified' then p.review_count end as review_count,
  case
    when p.geocode_status = 'verified' and p.location is not null
    then extensions.st_y(p.location::extensions.geometry)
  end as latitude,
  case
    when p.geocode_status = 'verified' and p.location is not null
    then extensions.st_x(p.location::extensions.geometry)
  end as longitude,
  p.license_expires_on,
  p.online_license_verified,
  (
    p.is_active
    and p.marketplace_approved
    and p.online_license_verified
    and p.geocode_status = 'verified'
    and p.location is not null
    and p.license_expires_on >= current_date
  ) as is_verified,
  p.source_url
from public.dawanear_pharmacies as p
where p.is_active;

-- Row-level security --------------------------------------------------------

alter table public.dawanear_customer_profiles enable row level security;
alter table public.dawanear_pharmacies enable row level security;
alter table public.dawanear_pharmacy_memberships enable row level security;
alter table public.dawanear_pharmacy_claims enable row level security;
alter table public.dawanear_products enable row level security;
alter table public.dawanear_pharmacy_prices enable row level security;
alter table public.dawanear_orders enable row level security;
alter table public.dawanear_order_items enable row level security;
alter table public.dawanear_order_recipients enable row level security;
alter table public.dawanear_pharmacy_notifications enable row level security;
alter table public.dawanear_maintenance_state enable row level security;
alter table public.dawanear_offers enable row level security;
alter table public.dawanear_offer_items enable row level security;

drop policy if exists dawanear_profiles_owner_select on public.dawanear_customer_profiles;
create policy dawanear_profiles_owner_select
on public.dawanear_customer_profiles for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists dawanear_profiles_owner_insert on public.dawanear_customer_profiles;
create policy dawanear_profiles_owner_insert
on public.dawanear_customer_profiles for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists dawanear_profiles_owner_update on public.dawanear_customer_profiles;
create policy dawanear_profiles_owner_update
on public.dawanear_customer_profiles for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists dawanear_pharmacies_directory_select on public.dawanear_pharmacies;
create policy dawanear_pharmacies_directory_select
on public.dawanear_pharmacies for select to anon, authenticated
using (
  is_active
  and geocode_status = 'verified'
  and location is not null
);

drop policy if exists dawanear_memberships_own_select on public.dawanear_pharmacy_memberships;
create policy dawanear_memberships_own_select
on public.dawanear_pharmacy_memberships for select to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

drop policy if exists dawanear_claims_own_select on public.dawanear_pharmacy_claims;
create policy dawanear_claims_own_select
on public.dawanear_pharmacy_claims for select to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = claimant_user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

drop policy if exists dawanear_claims_own_insert on public.dawanear_pharmacy_claims;
create policy dawanear_claims_own_insert
on public.dawanear_pharmacy_claims for insert to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = claimant_user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
);

drop policy if exists dawanear_products_public_select on public.dawanear_products;
create policy dawanear_products_public_select
on public.dawanear_products for select to anon, authenticated
using (is_active);

drop policy if exists dawanear_prices_current_select on public.dawanear_pharmacy_prices;
create policy dawanear_prices_current_select
on public.dawanear_pharmacy_prices for select to anon, authenticated
using (is_current);

drop policy if exists dawanear_orders_owner_select on public.dawanear_orders;
create policy dawanear_orders_owner_select
on public.dawanear_orders for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists dawanear_order_items_owner_select on public.dawanear_order_items;
create policy dawanear_order_items_owner_select
on public.dawanear_order_items for select to authenticated
using (
  exists (
    select 1
    from public.dawanear_orders as o
    where o.id = order_id
      and o.user_id = (select auth.uid())
  )
);

drop policy if exists dawanear_recipients_owner_select on public.dawanear_order_recipients;
create policy dawanear_recipients_owner_select
on public.dawanear_order_recipients for select to authenticated
using (
  exists (
    select 1
    from public.dawanear_orders as o
    where o.id = order_id
      and o.user_id = (select auth.uid())
  )
);

drop policy if exists dawanear_notifications_member_select
  on public.dawanear_pharmacy_notifications;
create policy dawanear_notifications_member_select
on public.dawanear_pharmacy_notifications for select to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1
    from public.dawanear_pharmacy_memberships as m
    where m.pharmacy_id = dawanear_pharmacy_notifications.pharmacy_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  )
);

drop policy if exists dawanear_notifications_member_update
  on public.dawanear_pharmacy_notifications;
create policy dawanear_notifications_member_update
on public.dawanear_pharmacy_notifications for update to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1
    from public.dawanear_pharmacy_memberships as m
    where m.pharmacy_id = dawanear_pharmacy_notifications.pharmacy_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  )
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1
    from public.dawanear_pharmacy_memberships as m
    where m.pharmacy_id = dawanear_pharmacy_notifications.pharmacy_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  )
);

drop policy if exists dawanear_offers_participant_select on public.dawanear_offers;
create policy dawanear_offers_participant_select
on public.dawanear_offers for select to authenticated
using (
  exists (
    select 1
    from public.dawanear_orders as o
    where o.id = order_id
      and o.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.dawanear_pharmacy_memberships as m
    where m.pharmacy_id = dawanear_offers.pharmacy_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
);

drop policy if exists dawanear_offer_items_participant_select on public.dawanear_offer_items;
create policy dawanear_offer_items_participant_select
on public.dawanear_offer_items for select to authenticated
using (
  exists (
    select 1
    from public.dawanear_offers as f
    where f.id = offer_id
  )
);

-- Atomic public RPCs --------------------------------------------------------

drop function if exists public.dawanear_create_order(
  double precision, double precision, jsonb, numeric, text, text, boolean, text
);
drop function if exists public.dawanear_create_order(
  double precision, double precision, jsonb, uuid, numeric, text, text, boolean, text
);
create function public.dawanear_create_order(
  p_latitude double precision,
  p_longitude double precision,
  p_items jsonb,
  p_client_request_id uuid,
  p_location_accuracy_m numeric default null,
  p_whatsapp text default null,
  p_delivery_preference text default 'either',
  p_substitutes_allowed boolean default true,
  p_prescription_path text default null
)
returns table (order_id uuid, recipient_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_stale_order_id uuid;
  v_location extensions.geography(point, 4326);
  v_whatsapp text;
  v_item_count integer;
  v_distinct_item_count integer;
  v_recipient_count integer;
  v_requires_prescription boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if p_client_request_id is null then
    raise exception 'A client request ID is required' using errcode = '22023';
  end if;

  -- Serialize retries of one customer-generated request key. This makes an
  -- ambiguous network outcome safe: a retry returns the original receipt
  -- rather than creating a second order or deleting an attached prescription.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dawanear-active-order:' || v_user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'dawanear-order:' || v_user_id::text || ':' || p_client_request_id::text,
      0
    )
  );

  select o.id
    into v_order_id
  from public.dawanear_orders as o
  where o.user_id = v_user_id
    and o.client_request_id = p_client_request_id;

  if found then
    select count(*)::integer
      into v_recipient_count
    from public.dawanear_order_recipients as r
    where r.order_id = v_order_id;

    return query select v_order_id, v_recipient_count;
    return;
  end if;

  if p_prescription_path is not null then
    if position(v_user_id::text || '/' in p_prescription_path) <> 1 then
      raise exception 'Prescription path is not owned by this customer' using errcode = '42501';
    end if;

    -- Acquire the path lock before taking any stale-order row lock. Cleanup
    -- takes locks in the same path-then-row order, avoiding a lock cycle while
    -- still holding this lock through Storage validation and order insertion.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'dawanear-prescription:' || p_prescription_path,
        0
      )
    );

    if exists (
      select 1
      from dawanear_private.dawanear_prescription_cleanup_claims as c
      where c.prescription_path = p_prescription_path
    ) then
      raise exception 'Prescription object is being retired; upload a new file'
        using errcode = '55000';
    end if;
  end if;

  -- Cron is defense in depth, not a customer-facing lock. While holding the
  -- per-user advisory lock, close this customer's one stale active order so a
  -- delayed cleanup run cannot leave the partial unique index blocking them.
  select stale_order.id
    into v_stale_order_id
  from public.dawanear_orders as stale_order
  where stale_order.user_id = v_user_id
    and (
      (
        stale_order.status = 'selected'
        and coalesce(stale_order.selected_at, stale_order.updated_at)
          <= now() - interval '24 hours'
      )
      or (
        stale_order.status in ('broadcast', 'offers_received')
        and stale_order.expires_at <= now()
      )
      or (
        stale_order.status = 'draft'
        and stale_order.updated_at <= now() - interval '24 hours'
      )
    )
  order by stale_order.created_at
  limit 1
  for update;

  if found then
    update public.dawanear_orders as stale_order
    set status = 'expired',
        selected_at = case
          when stale_order.status = 'selected'
          then coalesce(stale_order.selected_at, stale_order.updated_at)
          else stale_order.selected_at
        end,
        updated_at = now()
    where stale_order.id = v_stale_order_id;

    update public.dawanear_offers as stale_offer
    set status = 'expired',
        updated_at = now()
    where stale_offer.order_id = v_stale_order_id
      and stale_offer.status in ('draft', 'submitted', 'selected');

    insert into public.dawanear_pharmacy_notifications (
      pharmacy_id,
      order_id,
      kind
    )
    select r.pharmacy_id, r.order_id, 'order_closed'
    from public.dawanear_order_recipients as r
    where r.order_id = v_stale_order_id
    on conflict (pharmacy_id, order_id, kind) do update
      set read_at = null,
          created_at = excluded.created_at;
  end if;

  if exists (
    select 1
    from public.dawanear_orders as active_order
    where active_order.user_id = v_user_id
      and active_order.status in ('draft', 'broadcast', 'offers_received', 'selected')
  ) then
    raise exception 'This customer already has an active order; resume or close it before creating another'
      using errcode = '23505';
  end if;

  if p_latitude is null or p_latitude < -3.0 or p_latitude > -0.8
     or p_longitude is null or p_longitude < 28.7 or p_longitude > 30.9 then
    raise exception 'Location must be inside the Rwanda service area' using errcode = '22023';
  end if;

  if p_location_accuracy_m is null
     or p_location_accuracy_m <= 0
     or p_location_accuracy_m > 5000 then
    raise exception 'Location accuracy must be between 0 and 5000 metres' using errcode = '22023';
  end if;

  if p_delivery_preference not in ('pickup', 'delivery', 'either') then
    raise exception 'Invalid delivery preference' using errcode = '22023';
  end if;

  if p_whatsapp is not null and p_whatsapp !~ '^2507[2389][0-9]{7}$' then
    raise exception 'Invalid Rwanda WhatsApp number' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Order items must be a JSON array' using errcode = '22023';
  end if;

  select count(*), count(distinct x.product_id)
    into v_item_count, v_distinct_item_count
  from jsonb_to_recordset(p_items) as x(
    product_id text,
    quantity integer,
    customer_min_rwf integer,
    customer_max_rwf integer,
    substitutes_allowed boolean
  );

  if v_item_count < 1 or v_item_count > 50 then
    raise exception 'An order must contain between 1 and 50 products' using errcode = '22023';
  end if;

  if v_distinct_item_count <> v_item_count then
    raise exception 'Order product IDs must be present and unique' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(
      product_id text,
      quantity integer,
      customer_min_rwf integer,
      customer_max_rwf integer,
      substitutes_allowed boolean
    )
    left join public.dawanear_products as p on p.id = x.product_id
    where p.id is null
      or not p.is_active
      or not p.is_orderable
      or x.quantity is null
      or x.quantity not between 1 and 99
      or (x.customer_min_rwf is not null and x.customer_min_rwf < 0)
      or (x.customer_max_rwf is not null and x.customer_max_rwf < 0)
      or (
        x.customer_min_rwf is not null
        and x.customer_max_rwf is not null
        and x.customer_min_rwf > x.customer_max_rwf
      )
  ) then
    raise exception 'One or more order items are invalid or not orderable' using errcode = '22023';
  end if;

  select coalesce(bool_or(p.prescription_status = 'prescription'), false)
    into v_requires_prescription
  from jsonb_to_recordset(p_items) as x(product_id text)
  join public.dawanear_products as p on p.id = x.product_id;

  if v_requires_prescription
     and (p_prescription_path is null or btrim(p_prescription_path) = '') then
    raise exception 'A prescription upload is required for one or more selected products'
      using errcode = '22023';
  end if;

  if p_whatsapp is not null then
    insert into public.dawanear_customer_profiles (user_id, whatsapp)
    values (v_user_id, p_whatsapp)
    on conflict (user_id) do update
      set whatsapp = excluded.whatsapp,
          updated_at = now();
    v_whatsapp := p_whatsapp;
  else
    select cp.whatsapp
      into v_whatsapp
    from public.dawanear_customer_profiles as cp
    where cp.user_id = v_user_id;
  end if;

  if p_prescription_path is not null then
    if not exists (
      select 1
      from storage.objects as so
      where so.bucket_id = 'dawanear-prescriptions'
        and so.name = p_prescription_path
        and so.owner_id::text = v_user_id::text
        and so.created_at >= now() - interval '24 hours'
    ) then
      raise exception 'Prescription object must be owned by this customer and uploaded within the last 24 hours'
        using errcode = '42501';
    end if;
  end if;

  v_location := extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude),
    4326
  )::extensions.geography;

  insert into public.dawanear_orders (
    user_id,
    client_request_id,
    status,
    customer_location,
    location_accuracy_m,
    whatsapp,
    delivery_preference,
    substitutes_allowed,
    prescription_path
  )
  values (
    v_user_id,
    p_client_request_id,
    'draft',
    v_location,
    p_location_accuracy_m,
    v_whatsapp,
    p_delivery_preference,
    p_substitutes_allowed,
    p_prescription_path
  )
  returning id into v_order_id;

  insert into public.dawanear_order_items (
    order_id,
    product_id,
    quantity,
    customer_min_rwf,
    customer_max_rwf,
    substitutes_allowed
  )
  select
    v_order_id,
    x.product_id,
    x.quantity,
    x.customer_min_rwf,
    x.customer_max_rwf,
    coalesce(x.substitutes_allowed, p_substitutes_allowed)
  from jsonb_to_recordset(p_items) as x(
    product_id text,
    quantity integer,
    customer_min_rwf integer,
    customer_max_rwf integer,
    substitutes_allowed boolean
  );

  insert into public.dawanear_order_recipients (order_id, pharmacy_id, distance_m)
  select
    v_order_id,
    p.id,
    extensions.st_distance(p.location, v_location)
  from public.dawanear_pharmacies as p
  where p.is_active
    and p.marketplace_approved
    and p.online_license_verified
    and p.geocode_status = 'verified'
    and p.location is not null
    and p.license_expires_on >= current_date
    and extensions.st_dwithin(p.location, v_location, 10000)
  order by p.location operator(extensions.<->) v_location, p.id
  limit 20;

  get diagnostics v_recipient_count = row_count;

  if v_recipient_count = 0 then
    -- Retain the reference until the customer deletes it through the guarded
    -- Storage policy. This keeps retries safe after an ambiguous RPC outcome.
    update public.dawanear_orders as o
    set status = 'cancelled',
        broadcast_at = null,
        updated_at = now()
    where o.id = v_order_id;
  else
    insert into public.dawanear_pharmacy_notifications (
      pharmacy_id,
      order_id,
      kind
    )
    select r.pharmacy_id, r.order_id, 'new_request'
    from public.dawanear_order_recipients as r
    where r.order_id = v_order_id
    on conflict (pharmacy_id, order_id, kind) do nothing;

    update public.dawanear_orders as o
    set status = 'broadcast',
        broadcast_at = now(),
        updated_at = now()
    where o.id = v_order_id;
  end if;

  return query select v_order_id, v_recipient_count;
end;
$$;

revoke all on function public.dawanear_create_order(
  double precision, double precision, jsonb, uuid, numeric, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.dawanear_create_order(
  double precision, double precision, jsonb, uuid, numeric, text, text, boolean, text
) to authenticated;

drop function if exists public.dawanear_pharmacy_requests(uuid);
create function public.dawanear_pharmacy_requests(p_pharmacy_id uuid)
returns table (
  order_id uuid,
  reference text,
  status text,
  distance_m double precision,
  created_at timestamptz,
  expires_at timestamptz,
  delivery_preference text,
  substitutes_allowed boolean,
  has_prescription boolean,
  item_count integer,
  items jsonb
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
  if not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    raise exception 'A permanent pharmacy account is required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.dawanear_pharmacy_memberships as m
    join public.dawanear_pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = p_pharmacy_id
      and m.user_id = v_user_id
      and m.status = 'active'
      and p.is_active
      and p.marketplace_approved
      and p.online_license_verified
      and p.geocode_status = 'verified'
      and p.location is not null
      and p.license_expires_on >= current_date
  ) then
    raise exception 'An active membership at an eligible pharmacy is required'
      using errcode = '42501';
  end if;

  update public.dawanear_order_recipients as r
  set viewed_at = coalesce(r.viewed_at, now())
  where r.pharmacy_id = p_pharmacy_id
    and exists (
      select 1
      from public.dawanear_orders as visible_order
      where visible_order.id = r.order_id
        and visible_order.status in ('broadcast', 'offers_received')
        and visible_order.expires_at > now()
    );

  return query
  select
    o.id,
    o.reference,
    o.status,
    least(
      10000.0,
      greatest(500.0, ceil(r.distance_m / 500.0) * 500.0)
    )::double precision,
    o.created_at,
    o.expires_at,
    o.delivery_preference,
    o.substitutes_allowed,
    (o.prescription_path is not null),
    count(oi.id)::integer,
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', oi.id,
        'product_id', oi.product_id,
        'brand_name', p.brand_name,
        'generic_name', p.generic_name,
        'strength', p.strength,
        'dosage_form', p.dosage_form,
        'prescription_status', p.prescription_status,
        'quantity', oi.quantity,
        'customer_min_rwf', oi.customer_min_rwf,
        'customer_max_rwf', oi.customer_max_rwf,
        'substitutes_allowed', oi.substitutes_allowed
      )
      order by oi.created_at, oi.id
    )
  from public.dawanear_order_recipients as r
  join public.dawanear_orders as o on o.id = r.order_id
  join public.dawanear_order_items as oi on oi.order_id = o.id
  join public.dawanear_products as p on p.id = oi.product_id
  where r.pharmacy_id = p_pharmacy_id
    and o.status in ('broadcast', 'offers_received')
    and o.expires_at > now()
  group by o.id, r.distance_m
  order by o.created_at desc;
end;
$$;

revoke all on function public.dawanear_pharmacy_requests(uuid)
  from public, anon, authenticated;
grant execute on function public.dawanear_pharmacy_requests(uuid) to authenticated;

drop function if exists public.dawanear_submit_offer(uuid, uuid, jsonb, integer, text);
create function public.dawanear_submit_offer(
  p_pharmacy_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_ready_in_minutes integer default null,
  p_note text default null
)
returns table (
  offer_id uuid,
  total_rwf bigint,
  complete boolean,
  distance_m double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_user_id uuid;
  v_order_status text;
  v_order_expires_at timestamptz;
  v_order_substitutes_allowed boolean;
  v_order_prescription_path text;
  v_distance_m double precision;
  v_requested_count integer;
  v_payload_count integer;
  v_distinct_payload_count integer;
  v_offer_id uuid;
  v_total_rwf bigint;
  v_complete boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    raise exception 'A permanent pharmacy account is required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.dawanear_pharmacy_memberships as m
    join public.dawanear_pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = p_pharmacy_id
      and m.user_id = v_user_id
      and m.status = 'active'
      and p.is_active
      and p.marketplace_approved
      and p.online_license_verified
      and p.geocode_status = 'verified'
      and p.location is not null
      and p.license_expires_on >= current_date
  ) then
    raise exception 'An active membership at an eligible pharmacy is required'
      using errcode = '42501';
  end if;

  select o.user_id, o.status, o.expires_at, o.substitutes_allowed, o.prescription_path
    into v_order_user_id, v_order_status, v_order_expires_at,
         v_order_substitutes_allowed, v_order_prescription_path
  from public.dawanear_orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order_status not in ('broadcast', 'offers_received') or v_order_expires_at <= now() then
    raise exception 'Order is no longer accepting offers' using errcode = '22023';
  end if;

  select least(
      10000.0,
      greatest(500.0, ceil(r.distance_m / 500.0) * 500.0)
    )::double precision
    into v_distance_m
  from public.dawanear_order_recipients as r
  where r.order_id = p_order_id
    and r.pharmacy_id = p_pharmacy_id;

  if not found then
    raise exception 'Pharmacy was not a recipient of this order' using errcode = '42501';
  end if;

  if p_ready_in_minutes is not null and p_ready_in_minutes not between 0 and 1440 then
    raise exception 'Preparation time is invalid' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Offer note is too long' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Offer items must be a JSON array' using errcode = '22023';
  end if;

  select count(*) into v_requested_count
  from public.dawanear_order_items as oi
  where oi.order_id = p_order_id;

  select count(*), count(distinct x.order_item_id)
    into v_payload_count, v_distinct_payload_count
  from jsonb_to_recordset(p_items) as x(
    order_item_id uuid,
    offered_product_id text,
    available boolean,
    is_substitute boolean,
    unit_price_rwf integer,
    quantity integer,
    note text
  );

  if v_payload_count <> v_requested_count
     or v_distinct_payload_count <> v_payload_count then
    raise exception 'Offer must include each requested item exactly once' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(
      order_item_id uuid,
      offered_product_id text,
      available boolean,
      is_substitute boolean,
      unit_price_rwf integer,
      quantity integer,
      note text
    )
    left join public.dawanear_order_items as oi
      on oi.id = x.order_item_id and oi.order_id = p_order_id
    left join public.dawanear_products as requested_product
      on requested_product.id = oi.product_id
    left join public.dawanear_products as substitute_product
      on substitute_product.id = x.offered_product_id
    where oi.id is null
      or x.available is null
      or (x.note is not null and char_length(x.note) > 1000)
      or (
        x.available
        and (
          x.unit_price_rwf is null
          or x.unit_price_rwf not between 1 and 100000000
          or coalesce(x.quantity, oi.quantity) <> oi.quantity
          or (
            coalesce(x.is_substitute, false)
            and (
              not v_order_substitutes_allowed
              or not oi.substitutes_allowed
              or x.offered_product_id is null
              or x.offered_product_id = oi.product_id
              or substitute_product.id is null
              or not substitute_product.is_active
              or not substitute_product.is_orderable
              or nullif(
                regexp_replace(
                  lower(btrim(coalesce(requested_product.generic_name, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              ) is null
              or nullif(
                regexp_replace(
                  lower(btrim(coalesce(substitute_product.generic_name, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              ) is distinct from nullif(
                regexp_replace(
                  lower(btrim(coalesce(requested_product.generic_name, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              )
              or nullif(
                regexp_replace(
                  lower(btrim(coalesce(requested_product.strength, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              ) is null
              or nullif(
                regexp_replace(
                  lower(btrim(coalesce(substitute_product.strength, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              ) is distinct from nullif(
                regexp_replace(
                  lower(btrim(coalesce(requested_product.strength, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              )
              or nullif(
                regexp_replace(
                  lower(btrim(coalesce(requested_product.dosage_form, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              ) is null
              or nullif(
                regexp_replace(
                  lower(btrim(coalesce(substitute_product.dosage_form, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              ) is distinct from nullif(
                regexp_replace(
                  lower(btrim(coalesce(requested_product.dosage_form, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              )
              or nullif(
                regexp_replace(
                  lower(btrim(coalesce(requested_product.pack_size, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              ) is null
              or nullif(
                regexp_replace(
                  lower(btrim(coalesce(substitute_product.pack_size, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              ) is distinct from nullif(
                regexp_replace(
                  lower(btrim(coalesce(requested_product.pack_size, ''))),
                  '[[:space:]]+', ' ', 'g'
                ),
                ''
              )
              or (
                substitute_product.prescription_status = 'prescription'
                and (
                  v_order_prescription_path is null
                  or not exists (
                    select 1
                    from storage.objects as so
                    where so.bucket_id = 'dawanear-prescriptions'
                      and so.name = v_order_prescription_path
                      and so.owner_id::text = v_order_user_id::text
                  )
                )
              )
            )
          )
          or (
            not coalesce(x.is_substitute, false)
            and x.offered_product_id is not null
            and x.offered_product_id <> oi.product_id
          )
        )
      )
      or (
        not x.available
        and (
          x.offered_product_id is not null
          or x.unit_price_rwf is not null
          or x.quantity is not null
          or coalesce(x.is_substitute, false)
        )
      )
  ) then
    raise exception 'One or more offer items are invalid' using errcode = '22023';
  end if;

  insert into public.dawanear_offers (
    order_id,
    pharmacy_id,
    status,
    complete,
    total_rwf,
    distance_m,
    ready_in_minutes,
    note
  )
  values (
    p_order_id,
    p_pharmacy_id,
    'submitted',
    false,
    0,
    v_distance_m,
    p_ready_in_minutes,
    nullif(btrim(p_note), '')
  )
  on conflict (order_id, pharmacy_id) do update
    set status = 'submitted',
        complete = false,
        total_rwf = 0,
        distance_m = excluded.distance_m,
        ready_in_minutes = excluded.ready_in_minutes,
        note = excluded.note,
        submitted_at = now(),
        updated_at = now()
  returning id into v_offer_id;

  delete from public.dawanear_offer_items as fi
  where fi.offer_id = v_offer_id;

  insert into public.dawanear_offer_items (
    offer_id,
    order_item_id,
    offered_product_id,
    available,
    is_substitute,
    unit_price_rwf,
    quantity,
    note
  )
  select
    v_offer_id,
    oi.id,
    case
      when not x.available then null
      when coalesce(x.is_substitute, false) then x.offered_product_id
      else oi.product_id
    end,
    x.available,
    case when x.available then coalesce(x.is_substitute, false) else false end,
    case when x.available then x.unit_price_rwf else null end,
    case when x.available then coalesce(x.quantity, oi.quantity) else null end,
    nullif(btrim(x.note), '')
  from jsonb_to_recordset(p_items) as x(
    order_item_id uuid,
    offered_product_id text,
    available boolean,
    is_substitute boolean,
    unit_price_rwf integer,
    quantity integer,
    note text
  )
  join public.dawanear_order_items as oi
    on oi.id = x.order_item_id and oi.order_id = p_order_id;

  select
    coalesce(sum(fi.unit_price_rwf::bigint * fi.quantity::bigint) filter (where fi.available), 0),
    coalesce(bool_and(fi.available), false)
  into v_total_rwf, v_complete
  from public.dawanear_offer_items as fi
  where fi.offer_id = v_offer_id;

  if v_total_rwf <= 0 then
    raise exception 'An offer must include at least one available item' using errcode = '22023';
  end if;

  update public.dawanear_offers as f
  set total_rwf = v_total_rwf,
      complete = v_complete,
      status = 'submitted',
      submitted_at = now(),
      updated_at = now()
  where f.id = v_offer_id;

  update public.dawanear_orders as o
  set status = case when o.status = 'broadcast' then 'offers_received' else o.status end,
      updated_at = now()
  where o.id = p_order_id;

  return query select v_offer_id, v_total_rwf, v_complete, v_distance_m;
end;
$$;

revoke all on function public.dawanear_submit_offer(uuid, uuid, jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_submit_offer(uuid, uuid, jsonb, integer, text)
  to authenticated;

drop function if exists public.dawanear_select_offer(uuid, uuid);
create function public.dawanear_select_offer(p_order_id uuid, p_offer_id uuid)
returns table (
  order_id uuid,
  offer_id uuid,
  pharmacy_id uuid,
  status text,
  total_rwf bigint,
  distance_m double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_user_id uuid;
  v_order_status text;
  v_order_expires_at timestamptz;
  v_selected_offer_id uuid;
  v_pharmacy_id uuid;
  v_total_rwf bigint;
  v_distance_m double precision;
  v_offer_status text;
  v_complete boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select o.user_id, o.status, o.expires_at, o.selected_offer_id
    into v_order_user_id, v_order_status, v_order_expires_at, v_selected_offer_id
  from public.dawanear_orders as o
  where o.id = p_order_id
  for update;

  if not found or v_order_user_id <> v_user_id then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  select f.pharmacy_id, f.total_rwf, f.distance_m, f.status, f.complete
    into v_pharmacy_id, v_total_rwf, v_distance_m, v_offer_status, v_complete
  from public.dawanear_offers as f
  where f.id = p_offer_id
    and f.order_id = p_order_id;

  if not found then
    raise exception 'Offer not found for this order' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.dawanear_pharmacies as p
    where p.id = v_pharmacy_id
      and p.is_active
      and p.marketplace_approved
      and p.online_license_verified
      and p.geocode_status = 'verified'
      and p.location is not null
      and p.license_expires_on >= current_date
  ) then
    raise exception 'The offering pharmacy is no longer eligible for marketplace orders'
      using errcode = '22023';
  end if;

  if v_selected_offer_id is not null then
    if v_selected_offer_id <> p_offer_id then
      raise exception 'A different offer is already selected' using errcode = '22023';
    end if;
    return query
      select p_order_id, p_offer_id, v_pharmacy_id, 'selected'::text, v_total_rwf, v_distance_m;
    return;
  end if;

  if v_order_status not in ('broadcast', 'offers_received')
     or v_order_expires_at <= now()
     or v_offer_status <> 'submitted'
     or not v_complete then
    raise exception 'Only a complete submitted offer can be selected' using errcode = '22023';
  end if;

  update public.dawanear_orders as o
  set selected_offer_id = p_offer_id,
      status = 'selected',
      selected_at = now(),
      updated_at = now()
  where o.id = p_order_id;

  update public.dawanear_offers as f
  set status = case when f.id = p_offer_id then 'selected' else 'expired' end,
      updated_at = now()
  where f.order_id = p_order_id
    and (f.id = p_offer_id or f.status in ('draft', 'submitted'));

  insert into public.dawanear_pharmacy_notifications (
    pharmacy_id,
    order_id,
    kind
  )
  select r.pharmacy_id, r.order_id, 'order_closed'
  from public.dawanear_order_recipients as r
  where r.order_id = p_order_id
  on conflict (pharmacy_id, order_id, kind) do update
    set read_at = null,
        created_at = excluded.created_at;

  insert into public.dawanear_pharmacy_notifications (
    pharmacy_id,
    order_id,
    kind
  )
  values (v_pharmacy_id, p_order_id, 'order_selected')
  on conflict (pharmacy_id, order_id, kind) do nothing;

  return query
    select p_order_id, p_offer_id, v_pharmacy_id, 'selected'::text, v_total_rwf, v_distance_m;
end;
$$;

revoke all on function public.dawanear_select_offer(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.dawanear_select_offer(uuid, uuid) to authenticated;

drop function if exists public.dawanear_selected_contact(uuid);
create function public.dawanear_selected_contact(p_order_id uuid)
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

  if not exists (
    select 1
    from public.dawanear_orders as owned_order
    where owned_order.id = p_order_id
      and owned_order.user_id = v_user_id
      and owned_order.selected_offer_id is not null
      and owned_order.status in ('selected', 'completed')
      and owned_order.selected_at is not null
      and owned_order.selected_at > now() - interval '24 hours'
  ) then
    raise exception 'Selected order not found' using errcode = 'P0002';
  end if;

  return query
  select
    o.id,
    f.id,
    p.id,
    p.name,
    p.whatsapp,
    p.momo_code
  from public.dawanear_orders as o
  join public.dawanear_offers as f
    on f.id = o.selected_offer_id and f.order_id = o.id
  join public.dawanear_pharmacies as p on p.id = f.pharmacy_id
  where o.id = p_order_id
    and o.user_id = v_user_id
    and o.status in ('selected', 'completed')
    and o.selected_at is not null
    and o.selected_at > now() - interval '24 hours'
    and f.status = 'selected'
    and p.is_active
    and p.marketplace_approved
    and p.online_license_verified
    and p.geocode_status = 'verified'
    and p.location is not null
    and p.license_expires_on >= current_date;
end;
$$;

revoke all on function public.dawanear_selected_contact(uuid)
  from public, anon, authenticated;
grant execute on function public.dawanear_selected_contact(uuid) to authenticated;

drop function if exists public.dawanear_close_order(uuid, text);
create function public.dawanear_close_order(p_order_id uuid, p_outcome text)
returns table (
  order_id uuid,
  status text,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_outcome text := lower(btrim(p_outcome));
  v_current_status text;
  v_closed_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if v_outcome is null or v_outcome not in ('completed', 'cancelled') then
    raise exception 'Outcome must be completed or cancelled' using errcode = '22023';
  end if;

  select o.status, o.updated_at
    into v_current_status, v_closed_at
  from public.dawanear_orders as o
  where o.id = p_order_id
    and o.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if v_current_status = v_outcome then
    return query select p_order_id, v_outcome, v_closed_at;
    return;
  end if;

  if v_outcome = 'completed' and v_current_status <> 'selected' then
    raise exception 'Only a selected order can be completed' using errcode = '22023';
  end if;
  if v_outcome = 'cancelled'
     and v_current_status not in ('broadcast', 'offers_received', 'selected') then
    raise exception 'This order can no longer be cancelled' using errcode = '22023';
  end if;

  update public.dawanear_orders as o
  set status = v_outcome,
      updated_at = now()
  where o.id = p_order_id
  returning o.updated_at into v_closed_at;

  update public.dawanear_offers as f
  set status = case
        when v_outcome = 'cancelled' and f.status = 'selected' then 'withdrawn'
        when f.status in ('draft', 'submitted') then 'expired'
        else f.status
      end,
      updated_at = now()
  where f.order_id = p_order_id
    and (
      f.status in ('draft', 'submitted')
      or (v_outcome = 'cancelled' and f.status = 'selected')
    );

  insert into public.dawanear_pharmacy_notifications (
    pharmacy_id,
    order_id,
    kind
  )
  select r.pharmacy_id, r.order_id, 'order_closed'
  from public.dawanear_order_recipients as r
  where r.order_id = p_order_id
  on conflict (pharmacy_id, order_id, kind) do update
    set read_at = null,
        created_at = excluded.created_at;

  return query select p_order_id, v_outcome, v_closed_at;
end;
$$;

revoke all on function public.dawanear_close_order(uuid, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_close_order(uuid, text)
  to authenticated;

-- Selected pharmacy access is capped at 24 hours from selection. This
-- service-only function performs the matching terminal transition atomically,
-- frees the customer's active-order slot, expires offers, and emits refresh
-- notifications before the scheduled cleanup removes any prescription file.
drop function if exists public.dawanear_expire_timed_out_selected_orders(integer);
create function public.dawanear_expire_timed_out_selected_orders(
  p_limit integer default 50
)
returns table (
  order_id uuid,
  prescription_path text,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Cleanup limit must be between 1 and 200' using errcode = '22023';
  end if;

  for v_order in
    select
      o.id,
      o.prescription_path,
      coalesce(o.selected_at, o.updated_at) as effective_selected_at
    from public.dawanear_orders as o
    where o.status = 'selected'
      and coalesce(o.selected_at, o.updated_at) <= now() - interval '24 hours'
    order by coalesce(o.selected_at, o.updated_at), o.id
    limit p_limit
    for update skip locked
  loop
    update public.dawanear_orders as o
    set status = 'expired',
        selected_at = coalesce(o.selected_at, o.updated_at),
        updated_at = now()
    where o.id = v_order.id
      and o.status = 'selected';

    if not found then
      continue;
    end if;

    update public.dawanear_offers as f
    set status = 'expired',
        updated_at = now()
    where f.order_id = v_order.id
      and f.status in ('draft', 'submitted', 'selected');

    insert into public.dawanear_pharmacy_notifications (
      pharmacy_id,
      order_id,
      kind
    )
    select r.pharmacy_id, r.order_id, 'order_closed'
    from public.dawanear_order_recipients as r
    where r.order_id = v_order.id
    on conflict (pharmacy_id, order_id, kind) do update
      set read_at = null,
          created_at = excluded.created_at;

    order_id := v_order.id;
    prescription_path := v_order.prescription_path;
    status := 'expired';
    return next;
  end loop;
end;
$$;

revoke all on function public.dawanear_expire_timed_out_selected_orders(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.dawanear_expire_timed_out_selected_orders(integer)
  to service_role;

-- Claim cleanup by object path, not by order. The claim is committed before
-- the Edge Function calls the Storage API, and the order trigger rejects new
-- references until finalization removes the claim. SQL selects only paths for
-- which every reference is due, so a retained shared reference cannot starve
-- unrelated cleanup work. Expired claims are handled by the recovery RPC.
drop function if exists public.dawanear_claim_prescription_cleanup(text[], integer);
drop function if exists public.dawanear_claim_prescription_cleanup(integer);
create function public.dawanear_claim_prescription_cleanup(
  p_limit integer default 50
)
returns table (
  prescription_path text,
  claim_token uuid,
  reference_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_paths text[];
  v_token uuid;
  v_reference_count integer;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Cleanup limit must be between 1 and 200' using errcode = '22023';
  end if;
  select coalesce(pg_catalog.array_agg(paths.path order by paths.path), array[]::text[])
    into v_paths
  from (
    select o.prescription_path as path
    from public.dawanear_orders as o
    where o.prescription_path is not null
      and not exists (
        select 1
        from dawanear_private.dawanear_prescription_cleanup_claims as c
        where c.prescription_path = o.prescription_path
      )
      and not exists (
        select 1
        from storage.objects as so
        where so.bucket_id = 'dawanear-prescriptions'
          and so.name = o.prescription_path
          and so.created_at >= now() - interval '24 hours'
      )
    group by o.prescription_path
    having pg_catalog.bool_and(
      dawanear_private.dawanear_prescription_reference_is_cleanup_eligible(
        o.status,
        o.selected_at,
        o.expires_at,
        o.updated_at
      )
    )
    order by min(o.updated_at), o.prescription_path
    limit p_limit
  ) as paths;

  -- Acquire every path lock in one deterministic phase before taking any
  -- order-row lock. This preserves a global path-then-row lock order even when
  -- one invocation claims many paths and order creation closes a stale order.
  foreach v_path in array v_paths
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('dawanear-prescription:' || v_path, 0)
    );
  end loop;

  foreach v_path in array v_paths
  loop
    -- Lock every current reference while evaluating the whole path. A path is
    -- never claimed when even one order is still inside a retention window.
    perform 1
    from public.dawanear_orders as o
    where o.prescription_path = v_path
    for update;

    select count(*)::integer
      into v_reference_count
    from public.dawanear_orders as o
    where o.prescription_path = v_path;

    if v_reference_count = 0 then
      continue;
    end if;

    if exists (
      select 1
      from public.dawanear_orders as o
      where o.prescription_path = v_path
        and not dawanear_private.dawanear_prescription_reference_is_cleanup_eligible(
          o.status,
          o.selected_at,
          o.expires_at,
          o.updated_at
        )
    ) then
      continue;
    end if;

    if exists (
      select 1
      from dawanear_private.dawanear_prescription_cleanup_claims as c
      where c.prescription_path = v_path
    ) then
      continue;
    end if;

    v_token := gen_random_uuid();
    insert into dawanear_private.dawanear_prescription_cleanup_claims (
      prescription_path,
      claim_token,
      claimed_at,
      lease_expires_at
    )
    values (
      v_path,
      v_token,
      now(),
      now() + interval '15 minutes'
    )
    on conflict on constraint dawanear_prescription_cleanup_claims_pkey do update
      set claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at,
          lease_expires_at = excluded.lease_expires_at;

    prescription_path := v_path;
    claim_token := v_token;
    reference_count := v_reference_count;
    return next;
  end loop;
end;
$$;

revoke all on function public.dawanear_claim_prescription_cleanup(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.dawanear_claim_prescription_cleanup(integer)
  to service_role;

-- Orphan cleanup needs the same path lock because an order transaction may
-- have validated a just-under-24-hour upload but not committed its reference
-- when the scheduler observes the object just over the cutoff. This RPC makes
-- the no-reference decision only after taking that shared lock and also
-- verifies the Storage row is old enough.
drop function if exists public.dawanear_claim_orphan_prescription_cleanup(text[], integer);
create function public.dawanear_claim_orphan_prescription_cleanup(
  p_prescription_paths text[],
  p_limit integer default 50
)
returns table (
  prescription_path text,
  claim_token uuid,
  reference_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_paths text[];
  v_token uuid;
  v_claim_is_active boolean;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Cleanup limit must be between 1 and 200' using errcode = '22023';
  end if;
  if p_prescription_paths is null then
    raise exception 'Orphan cleanup paths are required' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(paths.path order by paths.path), array[]::text[])
    into v_paths
  from (
    select distinct candidate.path as path
    from pg_catalog.unnest(p_prescription_paths) as candidate(path)
    where candidate.path is not null
      and btrim(candidate.path) <> ''
    order by candidate.path
    limit p_limit
  ) as paths;

  foreach v_path in array v_paths
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('dawanear-prescription:' || v_path, 0)
    );
  end loop;

  foreach v_path in array v_paths
  loop
    perform 1
    from public.dawanear_orders as o
    where o.prescription_path = v_path
    for update;

    if found then
      continue;
    end if;

    if not exists (
      select 1
      from storage.objects as so
      where so.bucket_id = 'dawanear-prescriptions'
        and so.name = v_path
        and so.created_at < now() - interval '24 hours'
    ) then
      continue;
    end if;

    v_claim_is_active := false;
    select c.lease_expires_at > now()
      into v_claim_is_active
    from dawanear_private.dawanear_prescription_cleanup_claims as c
    where c.prescription_path = v_path
    for update;

    if found and v_claim_is_active then
      continue;
    end if;

    v_token := gen_random_uuid();
    insert into dawanear_private.dawanear_prescription_cleanup_claims (
      prescription_path,
      claim_token,
      claimed_at,
      lease_expires_at
    )
    values (
      v_path,
      v_token,
      now(),
      now() + interval '15 minutes'
    )
    on conflict on constraint dawanear_prescription_cleanup_claims_pkey do update
      set claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at,
          lease_expires_at = excluded.lease_expires_at;

    prescription_path := v_path;
    claim_token := v_token;
    reference_count := 0;
    return next;
  end loop;
end;
$$;

revoke all on function public.dawanear_claim_orphan_prescription_cleanup(text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.dawanear_claim_orphan_prescription_cleanup(text[], integer)
  to service_role;

-- Recover expired leases independently of order and Storage enumeration. This
-- is the durable retry source for an Edge invocation that stops after claiming
-- or after Storage deletion. Claims with neither an object nor a reference are
-- deleted here, preventing indefinite retention of an owner/path identifier.
drop function if exists public.dawanear_recover_expired_prescription_cleanup_claims(integer);
create function public.dawanear_recover_expired_prescription_cleanup_claims(
  p_limit integer default 50
)
returns table (
  prescription_path text,
  claim_token uuid,
  reference_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_paths text[];
  v_token uuid;
  v_reference_count integer;
  v_object_exists boolean;
  v_object_is_old boolean;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Cleanup limit must be between 1 and 200' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(claims.prescription_path order by claims.prescription_path), array[]::text[])
    into v_paths
  from (
    select c.prescription_path
    from dawanear_private.dawanear_prescription_cleanup_claims as c
    where c.lease_expires_at <= now()
    order by c.claimed_at, c.prescription_path
    limit p_limit
  ) as claims;

  foreach v_path in array v_paths
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('dawanear-prescription:' || v_path, 0)
    );
  end loop;

  foreach v_path in array v_paths
  loop
    perform 1
    from dawanear_private.dawanear_prescription_cleanup_claims as c
    where c.prescription_path = v_path
      and c.lease_expires_at <= now()
    for update;

    if not found then
      continue;
    end if;

    perform 1
    from public.dawanear_orders as o
    where o.prescription_path = v_path
    for update;

    select count(*)::integer
      into v_reference_count
    from public.dawanear_orders as o
    where o.prescription_path = v_path;

    select
      pg_catalog.bool_or(true),
      pg_catalog.bool_or(so.created_at < now() - interval '24 hours')
      into v_object_exists, v_object_is_old
    from storage.objects as so
    where so.bucket_id = 'dawanear-prescriptions'
      and so.name = v_path;

    v_object_exists := coalesce(v_object_exists, false);
    v_object_is_old := coalesce(v_object_is_old, false);

    if exists (
      select 1
      from public.dawanear_orders as o
      where o.prescription_path = v_path
        and not dawanear_private.dawanear_prescription_reference_is_cleanup_eligible(
          o.status,
          o.selected_at,
          o.expires_at,
          o.updated_at
        )
    ) or (v_object_exists and not v_object_is_old) then
      delete from dawanear_private.dawanear_prescription_cleanup_claims as c
      where c.prescription_path = v_path;
      continue;
    end if;

    if v_reference_count = 0 and not v_object_exists then
      delete from dawanear_private.dawanear_prescription_cleanup_claims as c
      where c.prescription_path = v_path;
      continue;
    end if;

    v_token := gen_random_uuid();
    update dawanear_private.dawanear_prescription_cleanup_claims as c
    set claim_token = v_token,
        claimed_at = now(),
        lease_expires_at = now() + interval '15 minutes'
    where c.prescription_path = v_path;

    prescription_path := v_path;
    claim_token := v_token;
    reference_count := v_reference_count;
    return next;
  end loop;
end;
$$;

revoke all on function public.dawanear_recover_expired_prescription_cleanup_claims(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.dawanear_recover_expired_prescription_cleanup_claims(integer)
  to service_role;

-- Called only after the Storage API confirms deletion. Rechecking all path
-- references inside this transaction makes the database clear all eligible
-- terminal references together or leave every reference and the lease intact.
drop function if exists public.dawanear_finalize_prescription_cleanup(text, uuid);
create function public.dawanear_finalize_prescription_cleanup(
  p_prescription_path text,
  p_claim_token uuid
)
returns table (cleared_reference_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleared_reference_count integer;
begin
  if p_prescription_path is null or btrim(p_prescription_path) = ''
     or p_claim_token is null then
    raise exception 'A prescription cleanup path and claim token are required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'dawanear-prescription:' || p_prescription_path,
      0
    )
  );

  perform 1
  from dawanear_private.dawanear_prescription_cleanup_claims as c
  where c.prescription_path = p_prescription_path
    and c.claim_token = p_claim_token
  for update;

  if not found then
    raise exception 'Prescription cleanup claim is missing or was superseded'
      using errcode = '55000';
  end if;

  perform 1
  from public.dawanear_orders as o
  where o.prescription_path = p_prescription_path
  for update;

  if exists (
    select 1
    from public.dawanear_orders as o
    where o.prescription_path = p_prescription_path
      and not dawanear_private.dawanear_prescription_reference_is_cleanup_eligible(
        o.status,
        o.selected_at,
        o.expires_at,
        o.updated_at
      )
  ) then
    raise exception 'Prescription cleanup is blocked by a retained order reference'
      using errcode = '55000';
  end if;

  update public.dawanear_orders as o
  set prescription_path = null
  where o.prescription_path = p_prescription_path;
  get diagnostics v_cleared_reference_count = row_count;

  delete from dawanear_private.dawanear_prescription_cleanup_claims as c
  where c.prescription_path = p_prescription_path
    and c.claim_token = p_claim_token;

  return query select v_cleared_reference_count;
end;
$$;

revoke all on function public.dawanear_finalize_prescription_cleanup(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.dawanear_finalize_prescription_cleanup(text, uuid)
  to service_role;

drop function if exists public.dawanear_my_active_orders();
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
  select
    o.id,
    o.reference,
    o.status,
    o.created_at,
    o.expires_at,
    o.updated_at,
    o.delivery_preference,
    o.substitutes_allowed,
    (
      select count(*)::integer
      from public.dawanear_order_recipients as r
      where r.order_id = o.id
    ),
    (
      select count(*)::integer
      from public.dawanear_offers as f_count
      join public.dawanear_pharmacies as count_pharmacy
        on count_pharmacy.id = f_count.pharmacy_id
      where f_count.order_id = o.id
        and f_count.status in ('submitted', 'selected')
        and count_pharmacy.is_active
        and count_pharmacy.marketplace_approved
        and count_pharmacy.online_license_verified
        and count_pharmacy.geocode_status = 'verified'
        and count_pharmacy.location is not null
        and count_pharmacy.license_expires_on >= current_date
    ),
    o.selected_offer_id,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'order_item_id', oi.id,
            'product_id', oi.product_id,
            'brand_name', p.brand_name,
            'generic_name', p.generic_name,
            'strength', p.strength,
            'dosage_form', p.dosage_form,
            'prescription_status', p.prescription_status,
            'quantity', oi.quantity,
            'customer_min_rwf', oi.customer_min_rwf,
            'customer_max_rwf', oi.customer_max_rwf,
            'substitutes_allowed', oi.substitutes_allowed
          )
          order by oi.created_at, oi.id
        )
        from public.dawanear_order_items as oi
        join public.dawanear_products as p on p.id = oi.product_id
        where oi.order_id = o.id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'offer_id', f.id,
            'pharmacy_id', f.pharmacy_id,
            'pharmacy_name', pharmacy.name,
            'status', f.status,
            'complete', f.complete,
            'total_rwf', f.total_rwf,
            'distance_m', f.distance_m,
            'ready_in_minutes', f.ready_in_minutes,
            'note', f.note,
            'submitted_at', f.submitted_at,
            'items', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'offer_item_id', fi.id,
                    'order_item_id', fi.order_item_id,
                    'offered_product_id', fi.offered_product_id,
                    'offered_product_name', offered_product.brand_name,
                    'available', fi.available,
                    'is_substitute', fi.is_substitute,
                    'unit_price_rwf', fi.unit_price_rwf,
                    'quantity', fi.quantity,
                    'note', fi.note
                  )
                  order by fi.created_at, fi.id
                )
                from public.dawanear_offer_items as fi
                left join public.dawanear_products as offered_product
                  on offered_product.id = fi.offered_product_id
                where fi.offer_id = f.id
              ),
              '[]'::jsonb
            )
          )
          order by f.total_rwf, f.submitted_at, f.id
        )
        from public.dawanear_offers as f
        join public.dawanear_pharmacies as pharmacy on pharmacy.id = f.pharmacy_id
        where f.order_id = o.id
          and f.status in ('submitted', 'selected')
          and pharmacy.is_active
          and pharmacy.marketplace_approved
          and pharmacy.online_license_verified
          and pharmacy.geocode_status = 'verified'
          and pharmacy.location is not null
          and pharmacy.license_expires_on >= current_date
      ),
      '[]'::jsonb
    )
  from public.dawanear_orders as o
  where o.user_id = v_user_id
    and (
      (o.status in ('broadcast', 'offers_received') and o.expires_at > now())
      or (
        o.status = 'selected'
        and o.selected_at is not null
        and o.selected_at > now() - interval '24 hours'
      )
    )
  order by o.created_at desc;
end;
$$;

revoke all on function public.dawanear_my_active_orders()
  from public, anon, authenticated;
grant execute on function public.dawanear_my_active_orders() to authenticated;

drop function if exists public.dawanear_my_pharmacies();
create function public.dawanear_my_pharmacies()
returns table (
  membership_id uuid,
  pharmacy_id uuid,
  pharmacy_name text,
  license_number text,
  role text,
  status text,
  whatsapp text,
  momo_code text,
  online_license_verified boolean,
  marketplace_approved boolean,
  geocode_status text,
  license_expires_on date
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
  if not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    raise exception 'A permanent pharmacy account is required' using errcode = '42501';
  end if;

  return query
  select
    m.id,
    p.id,
    p.name,
    p.license_number,
    m.role,
    m.status,
    p.whatsapp,
    p.momo_code,
    p.online_license_verified,
    p.marketplace_approved,
    p.geocode_status,
    p.license_expires_on
  from public.dawanear_pharmacy_memberships as m
  join public.dawanear_pharmacies as p on p.id = m.pharmacy_id
  where m.user_id = v_user_id
    and m.status = 'active'
  order by p.name, m.id;
end;
$$;

revoke all on function public.dawanear_my_pharmacies()
  from public, anon, authenticated;
grant execute on function public.dawanear_my_pharmacies() to authenticated;

drop function if exists public.dawanear_pharmacy_selected_orders(uuid);
create function public.dawanear_pharmacy_selected_orders(p_pharmacy_id uuid)
returns table (
  order_id uuid,
  reference text,
  customer_whatsapp text,
  delivery_preference text,
  prescription_path text,
  selected_at timestamptz,
  updated_at timestamptz,
  prescription_access_seconds_remaining integer
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
  if not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    raise exception 'A permanent pharmacy account is required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.dawanear_pharmacy_memberships as m
    join public.dawanear_pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = p_pharmacy_id
      and m.user_id = v_user_id
      and m.status = 'active'
      and p.is_active
      and p.marketplace_approved
      and p.online_license_verified
      and p.geocode_status = 'verified'
      and p.location is not null
      and p.license_expires_on >= current_date
  ) then
    raise exception 'An active membership at an eligible pharmacy is required'
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.reference,
    o.whatsapp,
    o.delivery_preference,
    o.prescription_path,
    coalesce(o.selected_at, o.updated_at),
    o.updated_at,
    greatest(
      0,
      least(
        86400,
        floor(
          extract(epoch from ((o.selected_at + interval '24 hours') - now()))
        )::integer
      )
    )
  from public.dawanear_orders as o
  join public.dawanear_offers as f
    on f.id = o.selected_offer_id
    and f.order_id = o.id
    and f.pharmacy_id = p_pharmacy_id
  where o.status = 'selected'
    and f.status = 'selected'
    and o.selected_at is not null
    and o.selected_at > now() - interval '24 hours'
  order by coalesce(o.selected_at, o.updated_at) desc, o.updated_at desc;
end;
$$;

revoke all on function public.dawanear_pharmacy_selected_orders(uuid)
  from public, anon, authenticated;
grant execute on function public.dawanear_pharmacy_selected_orders(uuid)
  to authenticated;

drop function if exists public.dawanear_contribute_price(uuid, text, integer);
create function public.dawanear_contribute_price(
  p_pharmacy_id uuid,
  p_product_id text,
  p_price_rwf integer
)
returns table (
  product_id text,
  price_min_rwf integer,
  price_max_rwf integer,
  price_contributors bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_min integer;
  v_max integer;
  v_count bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    raise exception 'A permanent pharmacy account is required' using errcode = '42501';
  end if;
  if p_price_rwf is null or p_price_rwf not between 1 and 100000000 then
    raise exception 'Price must be between 1 and 100000000 RWF' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.dawanear_pharmacy_memberships as m
    join public.dawanear_pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = p_pharmacy_id
      and m.user_id = v_user_id
      and m.status = 'active'
      and p.is_active
  ) then
    raise exception 'Active pharmacy membership is required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.dawanear_products as p
    where p.id = p_product_id and p.is_active
  ) then
    raise exception 'Product is not active' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dawanear-price:' || p_product_id, 0)
  );

  insert into public.dawanear_pharmacy_prices (
    pharmacy_id,
    product_id,
    price_rwf,
    is_current,
    contributed_by,
    observed_at
  )
  values (
    p_pharmacy_id,
    p_product_id,
    p_price_rwf,
    true,
    v_user_id,
    now()
  )
  on conflict (pharmacy_id, product_id) do update
    set price_rwf = excluded.price_rwf,
        is_current = true,
        contributed_by = excluded.contributed_by,
        observed_at = now(),
        updated_at = now();

  select min(pp.price_rwf), max(pp.price_rwf), count(*)
    into v_min, v_max, v_count
  from public.dawanear_pharmacy_prices as pp
  where pp.product_id = p_product_id
    and pp.is_current;

  if v_min is null or v_max - v_min > v_min then
    raise exception 'Price range invariant failed' using errcode = '23514';
  end if;

  return query select p_product_id, v_min, v_max, v_count;
end;
$$;

revoke all on function public.dawanear_contribute_price(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.dawanear_contribute_price(uuid, text, integer)
  to authenticated;

-- Storage: private owner uploads/reads; only the selected pharmacy may read. --

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'dawanear-prescriptions',
  'dawanear-prescriptions',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function dawanear_private.dawanear_selected_pharmacy_can_read(
  p_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;
  if not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    return false;
  end if;

  return exists (
    select 1
    from public.dawanear_orders as o
    join public.dawanear_offers as f
      on f.id = o.selected_offer_id and f.order_id = o.id
    join public.dawanear_pharmacy_memberships as m
      on m.pharmacy_id = f.pharmacy_id
    join public.dawanear_pharmacies as p
      on p.id = f.pharmacy_id
    where o.prescription_path = p_object_name
      and o.status in ('selected', 'completed')
      and o.selected_at is not null
      and o.selected_at > now() - interval '24 hours'
      and f.status = 'selected'
      and m.user_id = v_user_id
      and m.status = 'active'
      and p.is_active
      and p.marketplace_approved
      and p.online_license_verified
      and p.geocode_status = 'verified'
      and p.location is not null
      and p.license_expires_on >= current_date
  );
end;
$$;

revoke all on function dawanear_private.dawanear_selected_pharmacy_can_read(text)
  from public, anon, authenticated;
grant usage on schema dawanear_private to authenticated;
grant execute on function dawanear_private.dawanear_selected_pharmacy_can_read(text)
  to authenticated;

create or replace function dawanear_private.dawanear_customer_can_insert_prescription(
  p_object_name text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
     or p_object_name is null
     or position(v_user_id::text || '/' in p_object_name) <> 1 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dawanear-prescription:' || p_object_name, 0)
  );

  -- A name cannot be reused while claimed or still referenced because that
  -- could replace a file while cleanup is in flight.
  return not exists (
    select 1
    from dawanear_private.dawanear_prescription_cleanup_claims as c
    where c.prescription_path = p_object_name
  ) and not exists (
    select 1
    from public.dawanear_orders as o
    where o.prescription_path = p_object_name
  );
end;
$$;

revoke all on function dawanear_private.dawanear_customer_can_insert_prescription(text)
  from public, anon, authenticated, service_role;
grant execute on function dawanear_private.dawanear_customer_can_insert_prescription(text)
  to authenticated;

create or replace function dawanear_private.dawanear_customer_can_delete_prescription(
  p_object_name text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
     or p_object_name is null
     or position(v_user_id::text || '/' in p_object_name) <> 1 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dawanear-prescription:' || p_object_name, 0)
  );

  if exists (
    select 1
    from dawanear_private.dawanear_prescription_cleanup_claims as c
    where c.prescription_path = p_object_name
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from storage.objects as so
    where so.bucket_id = 'dawanear-prescriptions'
      and so.name = p_object_name
      and so.owner_id::text = v_user_id::text
  ) then
    return false;
  end if;

  -- A completed order remains a permanent blocker. Draft, broadcast,
  -- offers-received, and selected orders also block deletion. Only wholly
  -- terminal cancelled/expired references are safe to remove.
  return not exists (
    select 1
    from public.dawanear_orders as o
    where o.prescription_path = p_object_name
      and (
        o.user_id <> v_user_id
        or o.status not in ('cancelled', 'expired')
      )
  );
end;
$$;

revoke all on function dawanear_private.dawanear_customer_can_delete_prescription(text)
  from public, anon, authenticated;
grant execute on function dawanear_private.dawanear_customer_can_delete_prescription(text)
  to authenticated;

drop policy if exists dawanear_prescriptions_owner_insert on storage.objects;
create policy dawanear_prescriptions_owner_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'dawanear-prescriptions'
  and owner_id::text = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and dawanear_private.dawanear_customer_can_insert_prescription(name)
);

drop policy if exists dawanear_prescriptions_owner_select on storage.objects;
create policy dawanear_prescriptions_owner_select
on storage.objects for select to authenticated
using (
  bucket_id = 'dawanear-prescriptions'
  and owner_id::text = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists dawanear_prescriptions_owner_delete on storage.objects;
create policy dawanear_prescriptions_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'dawanear-prescriptions'
  and owner_id::text = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and dawanear_private.dawanear_customer_can_delete_prescription(name)
);

-- Restrictive policies make these invariants survive composition with any
-- pre-existing permissive storage.objects policies in a shared Supabase
-- project. They are neutral for every other bucket. Anonymous callers are
-- categorically denied writes to this private bucket, authenticated writes
-- must pass the path-lock helpers, and same-key UPDATE/upsert is prohibited.
drop policy if exists dawanear_prescriptions_anon_insert_guard on storage.objects;
create policy dawanear_prescriptions_anon_insert_guard
on storage.objects as restrictive for insert to anon
with check (bucket_id <> 'dawanear-prescriptions');

drop policy if exists dawanear_prescriptions_authenticated_insert_guard on storage.objects;
create policy dawanear_prescriptions_authenticated_insert_guard
on storage.objects as restrictive for insert to authenticated
with check (
  bucket_id <> 'dawanear-prescriptions'
  or (
    owner_id::text = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and dawanear_private.dawanear_customer_can_insert_prescription(name)
  )
);

drop policy if exists dawanear_prescriptions_anon_delete_guard on storage.objects;
create policy dawanear_prescriptions_anon_delete_guard
on storage.objects as restrictive for delete to anon
using (bucket_id <> 'dawanear-prescriptions');

drop policy if exists dawanear_prescriptions_authenticated_delete_guard on storage.objects;
create policy dawanear_prescriptions_authenticated_delete_guard
on storage.objects as restrictive for delete to authenticated
using (
  bucket_id <> 'dawanear-prescriptions'
  or (
    owner_id::text = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and dawanear_private.dawanear_customer_can_delete_prescription(name)
  )
);

drop policy if exists dawanear_prescriptions_no_client_update on storage.objects;
create policy dawanear_prescriptions_no_client_update
on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'dawanear-prescriptions')
with check (bucket_id <> 'dawanear-prescriptions');

drop policy if exists dawanear_prescriptions_selected_pharmacy_select on storage.objects;
create policy dawanear_prescriptions_selected_pharmacy_select
on storage.objects for select to authenticated
using (
  bucket_id = 'dawanear-prescriptions'
  and dawanear_private.dawanear_selected_pharmacy_can_read(name)
);

-- Explicit Data API grants (required by the 2026 Supabase exposure defaults). --

grant usage on schema public to anon, authenticated, service_role;

revoke all on table
  public.dawanear_customer_profiles,
  public.dawanear_pharmacies,
  public.dawanear_pharmacy_memberships,
  public.dawanear_pharmacy_claims,
  public.dawanear_products,
  public.dawanear_pharmacy_prices,
  public.dawanear_orders,
  public.dawanear_order_items,
  public.dawanear_order_recipients,
  public.dawanear_pharmacy_notifications,
  public.dawanear_maintenance_state,
  public.dawanear_offers,
  public.dawanear_offer_items
from public, anon, authenticated;

grant select on table public.dawanear_customer_profiles to authenticated;
grant insert (user_id, whatsapp, preferred_language)
  on table public.dawanear_customer_profiles to authenticated;
grant update (user_id, whatsapp, preferred_language)
  on table public.dawanear_customer_profiles to authenticated;

-- The pharmacy base table deliberately has no anon/authenticated grant. The
-- security-barrier directory view is the only public directory surface and
-- redacts all address, map, coordinates, and rating fields until verification.

grant select on table public.dawanear_pharmacy_memberships to authenticated;
grant select on table public.dawanear_pharmacy_claims to authenticated;
grant insert (pharmacy_id, contact_email, contact_phone, note)
  on table public.dawanear_pharmacy_claims to authenticated;

grant select (
  id,
  registration_number,
  brand_name,
  generic_name,
  strength,
  dosage_form,
  pack_size,
  product_type,
  category,
  prescription_status,
  regulatory_status,
  manufacturer,
  manufacturer_country,
  expiry_date,
  image_url,
  is_orderable,
  is_active,
  source_name,
  source_url
)
on table public.dawanear_products to anon, authenticated;

grant select (product_id, price_rwf, is_current)
  on table public.dawanear_pharmacy_prices to anon, authenticated;

grant select on table
  public.dawanear_orders,
  public.dawanear_order_items,
  public.dawanear_order_recipients,
  public.dawanear_offers,
  public.dawanear_offer_items
to authenticated;

grant select on table public.dawanear_pharmacy_notifications to authenticated;
grant update (read_at)
  on table public.dawanear_pharmacy_notifications to authenticated;

revoke all on table
  public.dawanear_product_catalog,
  public.dawanear_pharmacy_directory
from public, anon, authenticated;

grant select on table
  public.dawanear_product_catalog,
  public.dawanear_pharmacy_directory
to anon, authenticated;

grant all privileges on table
  public.dawanear_customer_profiles,
  public.dawanear_pharmacies,
  public.dawanear_pharmacy_memberships,
  public.dawanear_pharmacy_claims,
  public.dawanear_products,
  public.dawanear_pharmacy_prices,
  public.dawanear_orders,
  public.dawanear_order_items,
  public.dawanear_order_recipients,
  public.dawanear_pharmacy_notifications,
  public.dawanear_maintenance_state,
  public.dawanear_offers,
  public.dawanear_offer_items
to service_role;
grant select on table
  public.dawanear_product_catalog,
  public.dawanear_pharmacy_directory
to service_role;

-- Postgres Changes publication. Skip cleanly in environments where Realtime
-- has not created its publication yet.
do $dawanear_realtime$
declare
  v_table_name text;
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    foreach v_table_name in array array[
      'dawanear_orders',
      'dawanear_order_items',
      'dawanear_order_recipients',
      'dawanear_pharmacy_notifications',
      'dawanear_offers',
      'dawanear_offer_items',
      'dawanear_pharmacy_prices'
    ]
    loop
      if not exists (
        select 1
        from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table_name
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          v_table_name
        );
      end if;
    end loop;
  end if;
end;
$dawanear_realtime$;

commit;
