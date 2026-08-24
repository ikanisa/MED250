begin;

-- Google Maps supplied the original candidates, but it is intentionally not
-- used as the verification source. Each promoted phone was independently
-- corroborated by named public sources and reviewed for cross-pharmacy reuse.
-- Verification audit SHA-256:
-- 78ae605c39f4db47219156e92cb40cbd5befb601269ea1301e3121746b4e17f7
with source_rows as (
  select *
  from jsonb_to_recordset(
    '[
      {
        "registry_entry_key": "retail-2026-05-71",
        "e164": "250784632776",
        "source_name": "Ruhengeri Level 2 Teaching Hospital duty-pharmacy announcements",
        "source_url": "https://x.com/Ruhengerirefer1/status/1947387769145184727",
        "source_reference": "Exact AMIRAH phone repeated in official hospital duty-pharmacy posts 1947387769145184727 and 1946654542172405999; the hospital website links @Ruhengerirefer1 as its account.",
        "source_observed_at": "2025-07-21T20:06:39.536Z"
      },
      {
        "registry_entry_key": "retail-2026-05-693",
        "e164": "250788406475",
        "source_name": "Rwanda Bar Association and UBIPHARM Rwanda pharmacy directories",
        "source_url": "https://rwandabar.org.rw/attached_pdf/Pharmacies%20partnered%7C%20RBA-1675930284.pdf",
        "source_reference": "Exact DENA PHARMACY Ltd phone in the Rwanda Bar Association contracted-pharmacy document and independently repeated at https://rwanda.ubipharm.com/en/Spec-annulist,AnnuairePharmacies?pageannu=6",
        "source_observed_at": "2023-02-09T08:11:24Z"
      }
    ]'::jsonb
  ) as source_row(
    registry_entry_key text,
    e164 text,
    source_name text,
    source_url text,
    source_reference text,
    source_observed_at timestamptz
  )
)
select count(*) as source_row_count
from source_rows;

do $$
declare
  missing_registry_keys text[];
  conflicting_contacts text[];
begin
  select array_agg(source.registry_entry_key order by source.registry_entry_key)
  into missing_registry_keys
  from (
    values
      ('retail-2026-05-71'),
      ('retail-2026-05-693')
  ) as source(registry_entry_key)
  left join public.dawanear_pharmacies as pharmacy
    on pharmacy.registry_entry_key = source.registry_entry_key
  where pharmacy.id is null;

  if missing_registry_keys is not null then
    raise exception
      'Independent phone verification registry keys are missing: %',
      missing_registry_keys;
  end if;

  select array_agg(
    contact.e164 || ':' || pharmacy.registry_entry_key
    order by contact.e164, pharmacy.registry_entry_key
  )
  into conflicting_contacts
  from public.dawanear_pharmacy_contacts as contact
  join public.dawanear_pharmacies as pharmacy
    on pharmacy.id = contact.pharmacy_id
  where contact.contact_type = 'phone'
    and contact.verification_status not in ('rejected', 'stale')
    and (
      (contact.e164 = '250784632776'
        and pharmacy.registry_entry_key <> 'retail-2026-05-71')
      or
      (contact.e164 = '250788406475'
        and pharmacy.registry_entry_key <> 'retail-2026-05-693')
    );

  if conflicting_contacts is not null then
    raise exception
      'Independent phone verification found cross-pharmacy conflicts: %',
      conflicting_contacts;
  end if;
end;
$$;

with source_rows as (
  select *
  from jsonb_to_recordset(
    '[
      {
        "registry_entry_key": "retail-2026-05-71",
        "e164": "250784632776",
        "source_name": "Ruhengeri Level 2 Teaching Hospital duty-pharmacy announcements",
        "source_url": "https://x.com/Ruhengerirefer1/status/1947387769145184727",
        "source_reference": "Exact AMIRAH phone repeated in official hospital duty-pharmacy posts 1947387769145184727 and 1946654542172405999; the hospital website links @Ruhengerirefer1 as its account.",
        "source_observed_at": "2025-07-21T20:06:39.536Z"
      },
      {
        "registry_entry_key": "retail-2026-05-693",
        "e164": "250788406475",
        "source_name": "Rwanda Bar Association and UBIPHARM Rwanda pharmacy directories",
        "source_url": "https://rwandabar.org.rw/attached_pdf/Pharmacies%20partnered%7C%20RBA-1675930284.pdf",
        "source_reference": "Exact DENA PHARMACY Ltd phone in the Rwanda Bar Association contracted-pharmacy document and independently repeated at https://rwanda.ubipharm.com/en/Spec-annulist,AnnuairePharmacies?pageannu=6",
        "source_observed_at": "2023-02-09T08:11:24Z"
      }
    ]'::jsonb
  ) as source_row(
    registry_entry_key text,
    e164 text,
    source_name text,
    source_url text,
    source_reference text,
    source_observed_at timestamptz
  )
), prepared as (
  select
    pharmacy.id as pharmacy_id,
    source.*,
    not exists (
      select 1
      from public.dawanear_pharmacy_contacts as current_primary
      where current_primary.pharmacy_id = pharmacy.id
        and current_primary.contact_type = 'phone'
        and current_primary.is_primary
        and current_primary.verification_status not in ('rejected', 'stale')
    ) as needs_primary
  from source_rows as source
  join public.dawanear_pharmacies as pharmacy
    on pharmacy.registry_entry_key = source.registry_entry_key
)
insert into public.dawanear_pharmacy_contacts (
  pharmacy_id,
  contact_type,
  e164,
  display_number,
  is_primary,
  is_login_enabled,
  verification_status,
  source_type,
  source_name,
  source_url,
  source_reference,
  source_observed_at,
  verified_at,
  verified_by_label,
  verification_note
)
select
  pharmacy_id,
  'phone',
  e164,
  '+' || e164,
  needs_primary,
  false,
  'admin_verified',
  'admin',
  source_name,
  source_url,
  source_reference,
  source_observed_at,
  now(),
  'MED+250 independent public-source verification',
  'Promoted only after an exact phone/name match on independent public evidence; Google Maps remained candidate discovery evidence and was not used as the verification authority.'
from prepared
on conflict (pharmacy_id, contact_type, e164) do update
set display_number = excluded.display_number,
    is_login_enabled = false,
    verification_status = excluded.verification_status,
    source_type = excluded.source_type,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    source_reference = excluded.source_reference,
    source_observed_at = excluded.source_observed_at,
    verified_at = excluded.verified_at,
    verified_by_label = excluded.verified_by_label,
    verification_note = excluded.verification_note
where public.dawanear_pharmacy_contacts.verification_status = 'candidate';

do $$
begin
  if (
    select count(*)
    from public.dawanear_pharmacy_contacts as contact
    join public.dawanear_pharmacies as pharmacy
      on pharmacy.id = contact.pharmacy_id
    where contact.contact_type = 'phone'
      and contact.verification_status = 'admin_verified'
      and (
        (pharmacy.registry_entry_key = 'retail-2026-05-71'
          and contact.e164 = '250784632776')
        or
        (pharmacy.registry_entry_key = 'retail-2026-05-693'
          and contact.e164 = '250788406475')
      )
  ) <> 2 then
    raise exception
      'Expected two independently verified pharmacy phone contacts';
  end if;
end;
$$;

commit;
