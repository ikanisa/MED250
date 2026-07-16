begin;

-- Preserve the complete v4 aggregate contract as a private implementation,
-- then add GPS review governance without increasing the public MED+250 API
-- surface. The returned values remain aggregate-only.
alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v4;

revoke all on function dawanear_private.dawanear_backend_contract_v4()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with geocode_governance as (
    select
      (
        select count(*)
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'dawanear_pharmacies'
          and column_name in (
            'geocode_review_place_id',
            'geocode_reviewed_by',
            'geocode_reviewed_at',
            'geocode_review_note'
          )
      ) as review_column_count,
      exists (
        select 1
        from pg_catalog.pg_constraint as constraint_state
        where constraint_state.conrelid = pg_catalog.to_regclass('public.dawanear_pharmacies')
          and constraint_state.conname = 'dawanear_pharmacies_verified_geocode_review_ck'
      ) as review_constraint_exists,
      coalesce((
        select constraint_state.convalidated
        from pg_catalog.pg_constraint as constraint_state
        where constraint_state.conrelid = pg_catalog.to_regclass('public.dawanear_pharmacies')
          and constraint_state.conname = 'dawanear_pharmacies_verified_geocode_review_ck'
      ), false) as review_constraint_validated,
      exists (
        select 1
        from pg_catalog.pg_index as index_state
        join pg_catalog.pg_class as index_relation on index_relation.oid = index_state.indexrelid
        where index_relation.relnamespace = pg_catalog.to_regnamespace('public')
          and index_relation.relname = 'dawanear_pharmacies_verified_google_place_uidx'
          and index_state.indisunique
          and index_state.indisvalid
          and index_state.indisready
      ) as unique_verified_place_index,
      (
        select count(*)
        from public.dawanear_pharmacies as pharmacy
        where pharmacy.geocode_status = 'verified'
          and (
            pharmacy.location is null
            or pharmacy.google_place_id is null
            or pharmacy.geocode_review_place_id is distinct from pharmacy.google_place_id
            or pharmacy.geocode_reviewed_by is null
            or pharmacy.geocode_reviewed_at is null
            or pharmacy.geocode_review_note is null
          )
      ) as verified_without_review_count
  )
  select dawanear_private.dawanear_backend_contract_v4()
    || jsonb_build_object(
      'contract_version', '2026-07-13.5',
      'geocode_governance', jsonb_build_object(
        'review_column_count', geocode_governance.review_column_count,
        'expected_review_column_count', 4,
        'review_constraint_exists', geocode_governance.review_constraint_exists,
        'review_constraint_validated', geocode_governance.review_constraint_validated,
        'unique_verified_place_index', geocode_governance.unique_verified_place_index,
        'verified_without_review_count', geocode_governance.verified_without_review_count
      )
    )
  from geocode_governance;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 aggregate deployment contract including API, table and human-reviewed GPS governance invariants.';

commit;
-- Filename aligned with the migration version recorded by the production project.
