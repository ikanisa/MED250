begin;

-- Cover nullable relationship columns used by contact corrections and audit
-- attribution so deletes and reviewer lookups do not fall back to table scans.
create index if not exists dawanear_pharmacy_contacts_derived_from_idx
  on public.dawanear_pharmacy_contacts (derived_from_contact_id)
  where derived_from_contact_id is not null;

create index if not exists dawanear_pharmacy_contacts_verified_by_idx
  on public.dawanear_pharmacy_contacts (verified_by)
  where verified_by is not null;

create index if not exists dawanear_pharmacy_contact_edits_contact_idx
  on public.dawanear_pharmacy_contact_edit_requests (contact_id)
  where contact_id is not null;

create index if not exists dawanear_pharmacy_contact_edits_reviewer_idx
  on public.dawanear_pharmacy_contact_edit_requests (reviewed_by)
  where reviewed_by is not null;

commit;
-- Filename aligned with the migration version recorded by the production project.
