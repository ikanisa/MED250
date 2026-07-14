alter table public.dawanear_pharmacies
  add column if not exists geocode_review_place_id text,
  add column if not exists geocode_reviewed_by text,
  add column if not exists geocode_reviewed_at timestamptz,
  add column if not exists geocode_review_note text;

-- A historic "verified" flag without a durable reviewer record is not enough
-- to route a health-related order. Demote any such row for re-review before the
-- constraint is installed. The current MED+250 dataset has no verified rows.
update public.dawanear_pharmacies
set
  geocode_status = 'candidate',
  geocode_review_place_id = null,
  geocode_reviewed_by = null,
  geocode_reviewed_at = null,
  geocode_review_note = null
where geocode_status = 'verified'
  and (
    geocode_reviewed_at is null
    or nullif(btrim(geocode_reviewed_by), '') is null
    or nullif(btrim(geocode_review_note), '') is null
    or geocode_review_place_id is distinct from google_place_id
  );

alter table public.dawanear_pharmacies
  drop constraint if exists dawanear_pharmacies_verified_geocode_review_ck,
  add constraint dawanear_pharmacies_verified_geocode_review_ck check (
    geocode_status <> 'verified'
    or (
      location is not null
      and google_place_id is not null
      and geocode_review_place_id is not null
      and geocode_review_place_id = google_place_id
      and nullif(btrim(geocode_reviewed_by), '') is not null
      and char_length(btrim(geocode_reviewed_by)) between 3 and 200
      and geocode_reviewed_at is not null
      and nullif(btrim(geocode_review_note), '') is not null
      and char_length(btrim(geocode_review_note)) between 10 and 2000
    )
  );

create unique index if not exists dawanear_pharmacies_verified_google_place_uidx
  on public.dawanear_pharmacies (google_place_id)
  where geocode_status = 'verified';

comment on column public.dawanear_pharmacies.geocode_review_place_id is
  'Exact staged Google Place ID approved by a named human reviewer.';
comment on column public.dawanear_pharmacies.geocode_reviewed_by is
  'Reviewer identity recorded before coordinates become dispatch eligible.';
comment on column public.dawanear_pharmacies.geocode_reviewed_at is
  'Timezone-qualified timestamp when the staged Google Maps candidate was approved.';
comment on column public.dawanear_pharmacies.geocode_review_note is
  'Human evidence note supporting the premises-coordinate approval.';
