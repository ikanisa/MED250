begin;

-- The owner-authorized test fleet has exactly one pharmacy per test WhatsApp
-- number. A pre-governance development fixture reused the Kigali number but
-- has no location, membership, recipient, offer, or outbox history. Preserve
-- its audit trail while removing it from every active dispatch surface.
do $retire_duplicate_kigali_test_pharmacy$
declare
  v_legacy_pharmacy_id uuid;
  v_intended_pharmacy_id uuid;
  v_authorized_contact_count integer;
  v_portal_contact_count integer;
begin
  select pharmacy.id
    into v_intended_pharmacy_id
  from public.dawanear_pharmacies as pharmacy
  where pharmacy.registry_entry_key = 'med250-test-kigali-01';

  if v_intended_pharmacy_id is null then
    raise exception 'The intended Kigali test pharmacy is missing'
      using errcode = 'P0002';
  end if;

  select pharmacy.id
    into v_legacy_pharmacy_id
  from public.dawanear_pharmacies as pharmacy
  where pharmacy.registry_entry_key = 'dev-test-whatsapp-250788767816'
  for update;

  if v_legacy_pharmacy_id is not null then
    if exists (
      select 1
      from public.dawanear_pharmacy_memberships as membership
      where membership.pharmacy_id = v_legacy_pharmacy_id
        and membership.status = 'active'
    ) or exists (
      select 1
      from public.dawanear_order_recipients as recipient
      where recipient.pharmacy_id = v_legacy_pharmacy_id
    ) or exists (
      select 1
      from public.dawanear_offers as offer
      where offer.pharmacy_id = v_legacy_pharmacy_id
    ) or exists (
      select 1
      from public.dawanear_whatsapp_outbox as outbox
      where outbox.pharmacy_id = v_legacy_pharmacy_id
    ) then
      raise exception 'The duplicate Kigali development fixture has transaction history or active membership authority'
        using errcode = 'P0002';
    end if;

    update public.dawanear_pharmacy_contacts as contact
    set verification_status = 'stale',
        is_login_enabled = false,
        is_primary = false,
        verification_note = concat_ws(
          ' ',
          nullif(btrim(contact.verification_note), ''),
          'Retired because the owner-authorized med250-test-kigali-01 record is the sole test authority for this number.'
        ),
        updated_at = now()
    where contact.pharmacy_id = v_legacy_pharmacy_id
      and contact.e164 = '250788767816'
      and contact.contact_type = 'whatsapp';

    update public.dawanear_pharmacies as pharmacy
    set is_active = false,
        marketplace_approved = false,
        updated_at = now()
    where pharmacy.id = v_legacy_pharmacy_id;
  end if;

  select count(*)::integer
    into v_authorized_contact_count
  from public.dawanear_pharmacy_contacts as contact
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = contact.pharmacy_id
  where contact.e164 in ('250788767816', '35677186193', '35699742524')
    and contact.contact_type = 'whatsapp'
    and contact.verification_status = 'admin_verified'
    and contact.verified_at is not null
    and pharmacy.is_active
    and pharmacy.marketplace_approved
    and pharmacy.registry_entry_key in (
      'med250-test-kigali-01',
      'med250-test-musanze-01',
      'med250-test-musanze-02'
    );

  select count(*)::integer
    into v_portal_contact_count
  from public.dawanear_pharmacy_contacts as contact
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = contact.pharmacy_id
  where contact.e164 in ('250788767816', '35677186193', '35699742524')
    and contact.contact_type = 'whatsapp'
    and contact.is_login_enabled
    and contact.verification_status = 'admin_verified'
    and pharmacy.is_active
    and pharmacy.registry_entry_key in (
      'med250-test-kigali-01',
      'med250-test-musanze-01',
      'med250-test-musanze-02'
    );

  if v_authorized_contact_count <> 3 or v_portal_contact_count <> 3 then
    raise exception 'The owner-authorized three-pharmacy test fleet is incomplete after reconciliation'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.dawanear_pharmacy_contacts as contact
    join public.dawanear_pharmacies as pharmacy on pharmacy.id = contact.pharmacy_id
    where contact.e164 in ('250788767816', '35677186193', '35699742524')
      and contact.contact_type = 'whatsapp'
      and pharmacy.is_active
      and pharmacy.registry_entry_key not in (
        'med250-test-kigali-01',
        'med250-test-musanze-01',
        'med250-test-musanze-02'
      )
  ) then
    raise exception 'A test WhatsApp number remains attached to an unauthorized active pharmacy'
      using errcode = 'P0002';
  end if;
end;
$retire_duplicate_kigali_test_pharmacy$;

commit;
