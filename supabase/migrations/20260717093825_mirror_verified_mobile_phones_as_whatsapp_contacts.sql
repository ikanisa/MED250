begin;

-- Mirror every active, verified Rwanda mobile phone as a WhatsApp messaging
-- contact. This does not grant OTP/login authority: public business contact
-- evidence is not proof that the pharmacy controls the WhatsApp account.
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
  google_place_id,
  derived_from_contact_id,
  source_observed_at,
  verified_at,
  verified_by,
  verified_by_label,
  verification_note
)
select
  phone.pharmacy_id,
  'whatsapp',
  phone.e164,
  '+' || phone.e164,
  not exists (
    select 1
    from public.dawanear_pharmacy_contacts as current_primary
    where current_primary.pharmacy_id = phone.pharmacy_id
      and current_primary.contact_type = 'whatsapp'
      and current_primary.is_primary
      and current_primary.verification_status not in ('rejected', 'stale')
  ),
  false,
  phone.verification_status,
  phone.source_type,
  phone.source_name,
  phone.source_url,
  phone.source_reference,
  phone.google_place_id,
  phone.id,
  phone.source_observed_at,
  phone.verified_at,
  phone.verified_by,
  phone.verified_by_label,
  'Mirrored from a verified mobile phone for WhatsApp messaging; OTP login remains disabled pending ownership verification.'
from public.dawanear_pharmacy_contacts as phone
where phone.contact_type = 'phone'
  and phone.verification_status in ('source_verified', 'admin_verified')
  and phone.e164 ~ '^2507[2389][0-9]{7}$'
  and not exists (
    select 1
    from public.dawanear_pharmacy_contacts as whatsapp
    where whatsapp.pharmacy_id = phone.pharmacy_id
      and whatsapp.contact_type = 'whatsapp'
      and whatsapp.e164 = phone.e164
  )
on conflict (pharmacy_id, contact_type, e164) do nothing;

do $$
begin
  if exists (
    select 1
    from public.dawanear_pharmacy_contacts as phone
    where phone.contact_type = 'phone'
      and phone.verification_status in ('source_verified', 'admin_verified')
      and phone.e164 ~ '^2507[2389][0-9]{7}$'
      and not exists (
        select 1
        from public.dawanear_pharmacy_contacts as whatsapp
        where whatsapp.pharmacy_id = phone.pharmacy_id
          and whatsapp.contact_type = 'whatsapp'
          and whatsapp.e164 = phone.e164
          and whatsapp.verification_status in ('source_verified', 'admin_verified')
      )
  ) then
    raise exception 'Every verified mobile phone must have a matching verified WhatsApp contact';
  end if;

  if exists (
    select 1
    from public.dawanear_pharmacy_contacts
    where e164 !~ '^2507[2389][0-9]{7}$'
       or display_number is distinct from '+' || e164
  ) then
    raise exception 'All pharmacy contacts must use canonical Rwanda mobile formatting';
  end if;

  if exists (
    select 1
    from public.dawanear_pharmacy_contacts as whatsapp
    join public.dawanear_pharmacy_contacts as phone
      on phone.id = whatsapp.derived_from_contact_id
    where whatsapp.contact_type = 'whatsapp'
      and phone.contact_type = 'phone'
      and whatsapp.is_login_enabled
  ) then
    raise exception 'Phone-derived WhatsApp contacts must not receive OTP login authority';
  end if;
end;
$$;

commit;
