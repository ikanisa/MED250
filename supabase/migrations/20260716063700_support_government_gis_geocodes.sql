begin;

-- Keep the original Google-specific columns for compatibility while recording
-- provider-neutral provenance for verified government geospatial evidence.
alter table public.dawanear_pharmacies
  add column if not exists geocode_provider text
    check (geocode_provider in ('google_places', 'rwanda_government_gis', 'admin')),
  add column if not exists geocode_source_id text,
  add column if not exists geocode_source_url text;

alter table public.dawanear_pharmacies
  drop constraint if exists dawanear_pharmacies_geocode_source_ck,
  add constraint dawanear_pharmacies_geocode_source_ck check (
    (geocode_provider is null and geocode_source_id is null and geocode_source_url is null)
    or (
      geocode_provider is not null
      and nullif(btrim(geocode_source_id), '') is not null
      and nullif(btrim(geocode_source_url), '') is not null
    )
  );

create unique index if not exists dawanear_pharmacies_verified_geocode_source_uidx
  on public.dawanear_pharmacies (geocode_provider, geocode_source_id)
  where geocode_status = 'verified';

comment on column public.dawanear_pharmacies.geocode_provider is
  'Provider of the verified premises point: Google Places, Rwanda government GIS, or an evidenced admin source.';
comment on column public.dawanear_pharmacies.geocode_source_id is
  'Provider-owned durable feature/place identifier for the premises point.';
comment on column public.dawanear_pharmacies.geocode_source_url is
  'Evidence URL from which the staged premises point was obtained.';
comment on column public.dawanear_pharmacies.google_place_id is
  'Legacy compatibility identifier. Google rows store a Place ID; other providers use a namespaced durable source identifier and are disambiguated by geocode_provider.';

-- Preserve the existing optimistic-locking Google approval API and ensure new
-- Google approvals also populate the provider-neutral provenance columns.
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
      geocode_provider = 'google_places',
      geocode_source_id = p_google_place_id,
      geocode_source_url = coalesce(google_maps_url, 'https://www.google.com/maps/place/?q=place_id:' || p_google_place_id),
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
-- Filename aligned with the migration version recorded by the production project.
