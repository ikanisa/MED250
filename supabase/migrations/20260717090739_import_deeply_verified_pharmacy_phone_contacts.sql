begin;

-- Google Maps supplied the discovery candidates only. These two phones were
-- independently matched to the same pharmacy name on reviewed non-Google
-- public sources, have no contradictory evidence, and have no live
-- cross-pharmacy phone conflict.
-- Verification audit SHA-256:
-- 89e01bbff3a8f061df3fec3a963b3e8842f987505cd97a465057e400e68833e3

with source_rows(registry_entry_key, e164) as (
  values
    ('retail-2026-05-110', '250788473857'),
    ('retail-2026-05-284', '250788456665')
)
select count(*) as source_row_count from source_rows;

do $$
declare
  missing_registry_keys text[];
  conflicting_contacts text[];
begin
  select array_agg(source.registry_entry_key order by source.registry_entry_key)
  into missing_registry_keys
  from (
    values
      ('retail-2026-05-110', '250788473857'),
      ('retail-2026-05-284', '250788456665')
  ) as source(registry_entry_key, e164)
  left join public.dawanear_pharmacies as pharmacy
    on pharmacy.registry_entry_key = source.registry_entry_key
  where pharmacy.id is null;

  if missing_registry_keys is not null then
    raise exception 'Deep phone verification registry keys are missing: %', missing_registry_keys;
  end if;

  select array_agg(
    contact.e164 || ':' || pharmacy.registry_entry_key
    order by contact.e164, pharmacy.registry_entry_key
  )
  into conflicting_contacts
  from (
    values
      ('retail-2026-05-110', '250788473857'),
      ('retail-2026-05-284', '250788456665')
  ) as source(registry_entry_key, e164)
  join public.dawanear_pharmacy_contacts as contact
    on contact.e164 = source.e164
   and contact.contact_type = 'phone'
   and contact.verification_status not in ('rejected', 'stale')
  join public.dawanear_pharmacies as pharmacy
    on pharmacy.id = contact.pharmacy_id
  where pharmacy.registry_entry_key <> source.registry_entry_key;

  if conflicting_contacts is not null then
    raise exception 'Deep phone verification found cross-pharmacy conflicts: %', conflicting_contacts;
  end if;
end;
$$;

with source_rows as (
  select *
  from jsonb_to_recordset(
    '[
      {
        "registry_entry_key": "retail-2026-05-110",
        "e164": "250788473857",
        "source_name": "Rwanda Bar Association contracted-pharmacy directory",
        "source_url": "http://www.rwandabar.org.rw/attached_pdf/Pharmacies%20in%20Partnership%7C%20RBA-1611919150.pdf",
        "source_reference": "Exact Pharmacie l''Experience / 250788473857 row in the Rwanda Bar Association contracted-pharmacy PDF; independently repeated by another public directory; no contradictory evidence.",
        "source_observed_at": "2026-07-17T09:07:57Z"
      },
      {
        "registry_entry_key": "retail-2026-05-284",
        "e164": "250788456665",
        "source_name": "UBIPHARM Rwanda pharmacy directory",
        "source_url": "https://rwanda.ubipharm.com/en/Spec-annulist,AnnuairePharmacies",
        "source_reference": "Exact ADVANCED PHARMACY / 0788456665 entry on the UBIPHARM Rwanda industry directory; independently indexed in both English and French directory views; no contradictory evidence.",
        "source_observed_at": "2026-07-17T09:07:57Z"
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
  'MED+250 deep independent public-source verification',
  'Promoted after exact phone/name verification on reviewed non-Google evidence. Google Maps was discovery evidence only. This contact is phone-only and cannot authenticate.'
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
    from (
      values
        ('retail-2026-05-110', '250788473857'),
        ('retail-2026-05-284', '250788456665')
    ) as source(registry_entry_key, e164)
    join public.dawanear_pharmacies as pharmacy
      on pharmacy.registry_entry_key = source.registry_entry_key
    join public.dawanear_pharmacy_contacts as contact
      on contact.pharmacy_id = pharmacy.id
     and contact.contact_type = 'phone'
     and contact.e164 = source.e164
    where contact.verification_status = 'admin_verified'
      and not contact.is_login_enabled
  ) <> 2 then
    raise exception 'Expected two deeply verified phone-only contacts';
  end if;
end;
$$;

commit;
