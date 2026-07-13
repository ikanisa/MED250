begin;

-- Pharmacy staff authenticate only through a verified WhatsApp number. These
-- service-only tables are deliberately separate from customer anonymous auth.
create table if not exists public.dawanear_pharmacy_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^2507[2389][0-9]{7}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 5),
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued', 'sent', 'suppressed', 'failed')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create index if not exists dawanear_pharmacy_otp_phone_created_idx
  on public.dawanear_pharmacy_otp_challenges (phone, created_at desc);
create index if not exists dawanear_pharmacy_otp_source_created_idx
  on public.dawanear_pharmacy_otp_challenges (source_hash, created_at desc);
create index if not exists dawanear_pharmacy_otp_expiry_idx
  on public.dawanear_pharmacy_otp_challenges (expires_at)
  where used_at is null;

create table if not exists public.dawanear_pharmacy_identities (
  phone text primary key check (phone ~ '^2507[2389][0-9]{7}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dawanear_pharmacy_otp_challenges enable row level security;
alter table public.dawanear_pharmacy_identities enable row level security;

revoke all on table public.dawanear_pharmacy_otp_challenges from public, anon, authenticated;
revoke all on table public.dawanear_pharmacy_identities from public, anon, authenticated;
grant select, insert, update, delete on table public.dawanear_pharmacy_otp_challenges to service_role;
grant select, insert, update, delete on table public.dawanear_pharmacy_identities to service_role;

-- Code verification is one atomic, row-locked operation so the same OTP cannot
-- be accepted twice under concurrent requests.
create or replace function public.dawanear_consume_pharmacy_otp(
  p_challenge_id uuid,
  p_phone text,
  p_code_hash text
)
returns table (accepted boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.dawanear_pharmacy_otp_challenges%rowtype;
begin
  if p_phone !~ '^2507[2389][0-9]{7}$' or p_code_hash !~ '^[0-9a-f]{64}$' then
    return query select false, 'invalid';
    return;
  end if;

  select *
    into v_challenge
    from public.dawanear_pharmacy_otp_challenges
   where id = p_challenge_id
     and phone = p_phone
   for update;

  if not found or v_challenge.used_at is not null then
    return query select false, 'invalid';
    return;
  end if;

  if v_challenge.expires_at <= now() then
    update public.dawanear_pharmacy_otp_challenges
       set used_at = now()
     where id = p_challenge_id;
    return query select false, 'expired';
    return;
  end if;

  if v_challenge.attempts >= v_challenge.max_attempts then
    update public.dawanear_pharmacy_otp_challenges
       set used_at = now()
     where id = p_challenge_id;
    return query select false, 'locked';
    return;
  end if;

  if v_challenge.code_hash <> p_code_hash then
    update public.dawanear_pharmacy_otp_challenges
       set attempts = attempts + 1,
           used_at = case when attempts + 1 >= max_attempts then now() else used_at end
     where id = p_challenge_id;
    return query select false, 'invalid';
    return;
  end if;

  update public.dawanear_pharmacy_otp_challenges
     set attempts = attempts + 1,
         used_at = now()
   where id = p_challenge_id;

  return query select true, 'accepted';
end;
$$;

revoke all on function public.dawanear_consume_pharmacy_otp(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_consume_pharmacy_otp(uuid, text, text)
  to service_role;

comment on table public.dawanear_pharmacy_otp_challenges is
  'Service-only hashed WhatsApp OTP challenges for MED+250 pharmacy staff.';
comment on table public.dawanear_pharmacy_identities is
  'Service-only mapping between verified pharmacy WhatsApp numbers and permanent Supabase users.';

commit;
