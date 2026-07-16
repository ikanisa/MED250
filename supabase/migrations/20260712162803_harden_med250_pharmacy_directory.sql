begin;

create or replace function dawanear_private.dawanear_public_pharmacy_directory()
returns table (
  id uuid,
  registry_entry_key text,
  registry_type text,
  name text,
  license_number text,
  responsible_professional text,
  responsible_professional_registration text,
  province text,
  district text,
  sector text,
  cell text,
  area text,
  address text,
  google_maps_url text,
  rating numeric,
  review_count integer,
  latitude double precision,
  longitude double precision,
  license_expires_on date,
  online_license_verified boolean,
  is_verified boolean,
  source_url text
)
language sql
stable
security definer
set search_path = ''
as $$
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
    case when p.geocode_status = 'verified' then p.sector end,
    case when p.geocode_status = 'verified' then p.cell end,
    case when p.geocode_status = 'verified' then p.sector_cell_raw end,
    case
      when p.geocode_status = 'verified'
      then coalesce(p.google_formatted_address, p.sector_cell_raw)
    end,
    case when p.geocode_status = 'verified' then p.google_maps_url end,
    case when p.geocode_status = 'verified' then p.rating end,
    case when p.geocode_status = 'verified' then p.review_count end,
    case
      when p.geocode_status = 'verified' and p.location is not null
      then extensions.st_y(p.location::extensions.geometry)
    end,
    case
      when p.geocode_status = 'verified' and p.location is not null
      then extensions.st_x(p.location::extensions.geometry)
    end,
    p.license_expires_on,
    p.online_license_verified,
    (
      p.is_active
      and p.marketplace_approved
      and p.online_license_verified
      and p.geocode_status = 'verified'
      and p.location is not null
      and p.license_expires_on >= current_date
    ),
    p.source_url
  from public.dawanear_pharmacies as p
  where p.is_active;
$$;

revoke all on function dawanear_private.dawanear_public_pharmacy_directory()
  from public;
grant usage on schema dawanear_private to anon, authenticated, service_role;
grant execute on function dawanear_private.dawanear_public_pharmacy_directory()
  to anon, authenticated, service_role;

drop view if exists public.dawanear_pharmacy_directory;
create view public.dawanear_pharmacy_directory
with (security_barrier = true, security_invoker = true)
as
select *
from dawanear_private.dawanear_public_pharmacy_directory();

revoke all on table public.dawanear_pharmacy_directory
  from public, anon, authenticated;
grant select on table public.dawanear_pharmacy_directory
  to anon, authenticated, service_role;

commit;
-- Filename aligned with the migration version recorded by the production project.
