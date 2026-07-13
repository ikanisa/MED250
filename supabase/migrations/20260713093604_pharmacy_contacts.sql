begin;

alter table public.dawanear_pharmacies
  add column if not exists phone_numbers text[] not null default '{}'::text[],
  add column if not exists whatsapp_numbers text[] not null default '{}'::text[];

-- A pharmacy may publish and authenticate with more than one contact number.
-- Contact data stays service-only because a phone number is also an account
-- recovery/authentication factor for the pharmacy portal.
create table public.dawanear_pharmacy_contacts (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.dawanear_pharmacies(id) on delete cascade,
  contact_type text not null check (contact_type in ('phone', 'whatsapp')),
  e164 text not null check (e164 ~ '^2507[2389][0-9]{7}$'),
  display_number text,
  is_primary boolean not null default false,
  is_login_enabled boolean not null default false,
  verification_status text not null default 'candidate'
    check (verification_status in ('candidate', 'source_verified', 'admin_verified', 'rejected', 'stale')),
  source_type text not null
    check (source_type in ('rwanda_fda', 'pharmacy_submission', 'google_places', 'admin', 'legacy')),
  source_name text not null check (btrim(source_name) <> ''),
  source_url text,
  source_reference text,
  google_place_id text,
  derived_from_contact_id uuid references public.dawanear_pharmacy_contacts(id) on delete set null,
  source_observed_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pharmacy_id, contact_type, e164),
  check (
    not is_login_enabled
    or (
      contact_type = 'whatsapp'
      and verification_status in ('source_verified', 'admin_verified')
      and verified_at is not null
    )
  ),
  check (
    verification_status not in ('source_verified', 'admin_verified')
    or verified_at is not null
  )
);

create index dawanear_pharmacy_contacts_lookup_idx
  on public.dawanear_pharmacy_contacts (e164, contact_type, verification_status)
  where is_login_enabled;
create index dawanear_pharmacy_contacts_pharmacy_idx
  on public.dawanear_pharmacy_contacts (pharmacy_id, contact_type, is_primary desc);
create unique index dawanear_pharmacy_contacts_one_primary_idx
  on public.dawanear_pharmacy_contacts (pharmacy_id, contact_type)
  where is_primary and verification_status not in ('rejected', 'stale');

create table public.dawanear_pharmacy_contact_edit_requests (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.dawanear_pharmacies(id) on delete cascade,
  requested_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid references public.dawanear_pharmacy_contacts(id) on delete set null,
  requested_action text not null check (requested_action in ('add', 'update', 'remove')),
  requested_contact_type text not null check (requested_contact_type in ('phone', 'whatsapp')),
  requested_e164 text check (requested_e164 is null or requested_e164 ~ '^2507[2389][0-9]{7}$'),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (requested_action in ('add', 'update') and requested_e164 is not null)
    or (requested_action = 'remove' and contact_id is not null)
  )
);

create index dawanear_pharmacy_contact_edits_pharmacy_idx
  on public.dawanear_pharmacy_contact_edit_requests (pharmacy_id, status, created_at desc);
create index dawanear_pharmacy_contact_edits_requester_idx
  on public.dawanear_pharmacy_contact_edit_requests (requested_by, created_at desc);

alter table public.dawanear_pharmacy_contacts enable row level security;
alter table public.dawanear_pharmacy_contact_edit_requests enable row level security;

revoke all on table public.dawanear_pharmacy_contacts from public, anon, authenticated;
revoke all on table public.dawanear_pharmacy_contact_edit_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.dawanear_pharmacy_contacts to service_role;
grant select, insert, update, delete on table public.dawanear_pharmacy_contact_edit_requests to service_role;

drop trigger if exists dawanear_pharmacy_contacts_touch on public.dawanear_pharmacy_contacts;
create trigger dawanear_pharmacy_contacts_touch
before update on public.dawanear_pharmacy_contacts
for each row execute function dawanear_private.dawanear_touch_updated_at();

drop trigger if exists dawanear_pharmacy_contact_edits_touch on public.dawanear_pharmacy_contact_edit_requests;
create trigger dawanear_pharmacy_contact_edits_touch
before update on public.dawanear_pharmacy_contact_edit_requests
for each row execute function dawanear_private.dawanear_touch_updated_at();

-- Existing manually verified WhatsApp values, if any, become both a phone
-- contact and a login-enabled WhatsApp contact. No Google candidate is promoted.
insert into public.dawanear_pharmacy_contacts (
  pharmacy_id, contact_type, e164, display_number, is_primary,
  is_login_enabled, verification_status, source_type, source_name,
  source_reference, source_observed_at, verified_at
)
select
  p.id, contact_kind, p.whatsapp, '+' || p.whatsapp, true,
  contact_kind = 'whatsapp', 'admin_verified', 'legacy',
  'MED+250 legacy verified pharmacy contact', 'dawanear_pharmacies.whatsapp',
  p.updated_at, now()
from public.dawanear_pharmacies as p
cross join (values ('phone'), ('whatsapp')) as kinds(contact_kind)
where p.whatsapp ~ '^2507[2389][0-9]{7}$'
on conflict (pharmacy_id, contact_type, e164) do nothing;

create or replace function dawanear_private.dawanear_refresh_pharmacy_contact_summary(
  p_pharmacy_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.dawanear_pharmacies as pharmacy
  set phone_numbers = coalesce((
        select array_agg(contact.e164 order by contact.is_primary desc, contact.created_at, contact.e164)
        from public.dawanear_pharmacy_contacts as contact
        where contact.pharmacy_id = pharmacy.id
          and contact.contact_type = 'phone'
          and contact.verification_status not in ('rejected', 'stale')
      ), '{}'::text[]),
      whatsapp_numbers = coalesce((
        select array_agg(contact.e164 order by contact.is_primary desc, contact.created_at, contact.e164)
        from public.dawanear_pharmacy_contacts as contact
        where contact.pharmacy_id = pharmacy.id
          and contact.contact_type = 'whatsapp'
          and contact.verification_status not in ('rejected', 'stale')
      ), '{}'::text[]),
      whatsapp = (
        select contact.e164
        from public.dawanear_pharmacy_contacts as contact
        where contact.pharmacy_id = pharmacy.id
          and contact.contact_type = 'whatsapp'
          and contact.verification_status not in ('rejected', 'stale')
        order by contact.is_primary desc, contact.created_at, contact.e164
        limit 1
      )
  where pharmacy.id = p_pharmacy_id;
$$;

revoke all on function dawanear_private.dawanear_refresh_pharmacy_contact_summary(uuid)
  from public, anon, authenticated;
grant execute on function dawanear_private.dawanear_refresh_pharmacy_contact_summary(uuid)
  to service_role;

create or replace function dawanear_private.dawanear_sync_pharmacy_contact_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.pharmacy_id <> new.pharmacy_id) then
    perform dawanear_private.dawanear_refresh_pharmacy_contact_summary(old.pharmacy_id);
  end if;
  if tg_op <> 'DELETE' then
    perform dawanear_private.dawanear_refresh_pharmacy_contact_summary(new.pharmacy_id);
    return new;
  end if;
  return old;
end;
$$;

revoke all on function dawanear_private.dawanear_sync_pharmacy_contact_summary()
  from public, anon, authenticated;

drop trigger if exists dawanear_pharmacy_contacts_sync_summary on public.dawanear_pharmacy_contacts;
create trigger dawanear_pharmacy_contacts_sync_summary
after insert or update or delete on public.dawanear_pharmacy_contacts
for each row execute function dawanear_private.dawanear_sync_pharmacy_contact_summary();

select dawanear_private.dawanear_refresh_pharmacy_contact_summary(pharmacy.id)
from public.dawanear_pharmacies as pharmacy;

create or replace function public.dawanear_request_pharmacy_contact_edit(
  p_pharmacy_id uuid,
  p_requested_action text,
  p_requested_contact_type text,
  p_contact_id uuid default null,
  p_requested_e164 text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_requested_action not in ('add', 'update', 'remove')
     or p_requested_contact_type not in ('phone', 'whatsapp') then
    raise exception 'Invalid contact edit request' using errcode = '22023';
  end if;
  if p_requested_action in ('add', 'update')
     and coalesce(p_requested_e164, '') !~ '^2507[2389][0-9]{7}$' then
    raise exception 'Enter a valid Rwanda mobile number' using errcode = '22023';
  end if;
  if p_requested_action = 'remove' and p_contact_id is null then
    raise exception 'Choose a contact to remove' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.dawanear_pharmacy_memberships as membership
    where membership.pharmacy_id = p_pharmacy_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  ) then
    raise exception 'Active pharmacy membership is required' using errcode = '42501';
  end if;
  if p_contact_id is not null and not exists (
    select 1
    from public.dawanear_pharmacy_contacts as contact
    where contact.id = p_contact_id
      and contact.pharmacy_id = p_pharmacy_id
      and contact.contact_type = p_requested_contact_type
  ) then
    raise exception 'The selected contact does not belong to this pharmacy' using errcode = '22023';
  end if;

  insert into public.dawanear_pharmacy_contact_edit_requests (
    pharmacy_id, requested_by, contact_id, requested_action,
    requested_contact_type, requested_e164, note
  ) values (
    p_pharmacy_id, auth.uid(), p_contact_id, p_requested_action,
    p_requested_contact_type, p_requested_e164, nullif(btrim(p_note), '')
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.dawanear_request_pharmacy_contact_edit(uuid, text, text, uuid, text, text)
  from public, anon;
grant execute on function public.dawanear_request_pharmacy_contact_edit(uuid, text, text, uuid, text, text)
  to authenticated;

comment on table public.dawanear_pharmacy_contacts is
  'Private, provenance-aware phone and WhatsApp contacts linked to licensed MED+250 pharmacies.';
comment on table public.dawanear_pharmacy_contact_edit_requests is
  'Pharmacy-staff requests to add, update, or remove a linked contact; admin review is required.';

commit;
