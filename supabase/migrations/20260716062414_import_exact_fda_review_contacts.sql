begin;
-- Generated from exact, locality-confirmed Rwanda FDA duty-roster review matches.
-- Review SHA-256: 358f242d5044a2f8bdeb236adaf81c33690965ef7f6f3e886f44f20677d899e5
-- Registry SHA-256: 977b4d35036d178b45191f98de55e574e848755f1153df252a7a621665b583a9
-- Promoted contacts SHA-256: 9a81e8c327cf7c399ea95cefe96bdc289efa9b8e5fd52b7841946835b4b53232
with source_rows as (
  select * from jsonb_to_recordset('[{"registry_entry_key":"retail-2026-05-50","e164":"250783615532","source_url":"https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kigali_City_for_JULY-AUGUST-SEPTEMBER_2026.pdf","source_reference":"kigali July-September 2026 duty roster"},{"registry_entry_key":"retail-2026-05-282","e164":"250788251677","source_url":"https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kigali_City_for_JULY-AUGUST-SEPTEMBER_2026.pdf","source_reference":"kigali July-September 2026 duty roster"},{"registry_entry_key":"retail-2026-05-282","e164":"250788300660","source_url":"https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kigali_City_for_JULY-AUGUST-SEPTEMBER_2026.pdf","source_reference":"kigali July-September 2026 duty roster"},{"registry_entry_key":"retail-2026-05-296","e164":"250788300660","source_url":"https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kigali_City_for_JULY-AUGUST-SEPTEMBER_2026.pdf","source_reference":"kigali July-September 2026 duty roster"},{"registry_entry_key":"retail-2026-05-296","e164":"250788565654","source_url":"https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kigali_City_for_JULY-AUGUST-SEPTEMBER_2026.pdf","source_reference":"kigali July-September 2026 duty roster"},{"registry_entry_key":"retail-2026-05-329","e164":"250788307358","source_url":"https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Musanze_JULY-AUGUST-SEPTEMBER_2026.pdf","source_reference":"musanze July-September 2026 duty roster"},{"registry_entry_key":"retail-2026-05-352","e164":"250788283954","source_url":"https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kigali_City_for_JULY-AUGUST-SEPTEMBER_2026.pdf","source_reference":"kigali July-September 2026 duty roster"}]'::jsonb) as source_row(
    registry_entry_key text, e164 text, source_url text, source_reference text
  )
), ranked as (
  select source_row.*, row_number() over (partition by registry_entry_key order by e164) = 1 as first_for_pharmacy
  from source_rows as source_row
), expanded as (
  select pharmacy.id as pharmacy_id, contact_kind.contact_type, ranked.*
  from ranked
  join public.dawanear_pharmacies as pharmacy on pharmacy.registry_entry_key = ranked.registry_entry_key
  cross join (values ('phone'), ('whatsapp')) as contact_kind(contact_type)
)
insert into public.dawanear_pharmacy_contacts (
  pharmacy_id, contact_type, e164, display_number, is_primary, is_login_enabled,
  verification_status, source_type, source_name, source_url, source_reference,
  source_observed_at, verified_at, verified_by_label, verification_note
)
select pharmacy_id, contact_type, e164, '+' || e164, first_for_pharmacy,
       contact_type = 'whatsapp', 'source_verified', 'rwanda_fda',
       'Rwanda FDA retail pharmacy duty roster July-September 2026', source_url,
       source_reference, '2026-07-01T00:00:00+02:00'::timestamptz, now(),
       'MED+250 exact FDA roster review',
       'Exact licensed name and locality match promoted from the governed review queue.'
from expanded
on conflict (pharmacy_id, contact_type, e164) do update
set display_number = excluded.display_number,
    is_login_enabled = excluded.is_login_enabled,
    verification_status = excluded.verification_status,
    source_type = excluded.source_type,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    source_reference = excluded.source_reference,
    source_observed_at = excluded.source_observed_at,
    verified_at = excluded.verified_at,
    verified_by_label = excluded.verified_by_label,
    verification_note = excluded.verification_note
where public.dawanear_pharmacy_contacts.verification_status not in ('rejected', 'stale');
commit;
-- Filename aligned with the migration version recorded by the production project.
