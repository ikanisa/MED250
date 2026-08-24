begin;

-- These rows came from a browser-observation candidate packet that was later
-- quarantined for named owner review. They were never valid login or WhatsApp
-- contacts and must not remain in the production contact table.
delete from public.dawanear_pharmacy_contacts
where contact_type = 'phone'
  and verification_status = 'candidate'
  and source_type = 'google_places'
  and source_reference =
    'Free Selenium browser observation; requires operator verification'
  and not is_login_enabled
  and verified_at is null
  and verified_by is null
  and verified_by_label is null;

do $$
begin
  if exists (
    select 1
    from public.dawanear_pharmacy_contacts
    where verification_status = 'candidate'
      and source_type = 'google_places'
      and source_reference =
        'Free Selenium browser observation; requires operator verification'
  ) then
    raise exception
      'Quarantined browser-observation phone candidates remain in production';
  end if;
end;
$$;

commit;
