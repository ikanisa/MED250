begin;

-- Product-image governance is protected by a database-wide DDL event trigger.
-- This reviewed migration does not change that subsystem.
set local med250.allow_product_image_governance_ddl = 'on';

-- Dispatch and portal access are deliberately separate:
--   * every source/admin-verified WhatsApp contact may receive an order;
--   * only an admin/pharmacy-submission contact with durable review evidence
--     may request a pharmacy-portal OTP.
create or replace function dawanear_private.dawanear_pharmacy_is_dispatch_eligible(
  p_pharmacy_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.dawanear_pharmacies as pharmacy
    where pharmacy.id = p_pharmacy_id
      and pharmacy.is_active
      and pharmacy.marketplace_approved
      and pharmacy.license_expires_on >= current_date
      and exists (
        select 1
        from public.dawanear_pharmacy_contacts as contact
        where contact.pharmacy_id = pharmacy.id
          and contact.contact_type = 'whatsapp'
          and contact.verification_status in ('source_verified', 'admin_verified')
          and contact.verified_at is not null
      )
  );
$$;

revoke all on function dawanear_private.dawanear_pharmacy_is_dispatch_eligible(uuid)
  from public, anon, authenticated;

comment on function dawanear_private.dawanear_pharmacy_is_dispatch_eligible(uuid) is
  'MED+250 dispatch boundary: an active, approved, current pharmacy with a source/admin-verified WhatsApp destination. Portal OTP authority is intentionally independent.';

-- The legacy denormalized pharmacy.whatsapp summary must support the same
-- international E.164 format as the authoritative contact table.
alter table public.dawanear_pharmacies
  drop constraint if exists dawanear_pharmacies_whatsapp_check;
alter table public.dawanear_pharmacies
  add constraint dawanear_pharmacies_whatsapp_check
  check (whatsapp is null or whatsapp ~ '^[1-9][0-9]{7,14}$');

-- An administrator may approve a portal number through the dedicated
-- review workflow even when the operator is not represented by an auth.users
-- row. The named reviewer label and evidence note remain mandatory.
alter table public.dawanear_pharmacy_contacts
  drop constraint if exists dawanear_pharmacy_contacts_login_authority;
alter table public.dawanear_pharmacy_contacts
  add constraint dawanear_pharmacy_contacts_login_authority
  check (
    not is_login_enabled
    or (
      contact_type = 'whatsapp'
      and verification_status in ('source_verified', 'admin_verified')
      and verified_at is not null
      and source_type in ('admin', 'pharmacy_submission')
      and verified_by_label is not null
      and char_length(btrim(verified_by_label)) between 3 and 200
      and verification_note is not null
      and char_length(btrim(verification_note)) between 10 and 2000
    )
  );

-- Keep the existing hardened identity-binding transaction, changing only the
-- obsolete requirements for an auth.users reviewer row and the unrelated
-- online-premises flag. Admin evidence remains enforced by the table check.
do $rewrite_portal_binding$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure(
    'public.dawanear_bind_pharmacy_identity(text,uuid)'
  );
  v_definition text;
  v_rewritten text;
begin
  if v_procedure is null then
    raise exception 'MED+250 pharmacy identity binding function is missing'
      using errcode = 'P0002';
  end if;

  select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
  v_rewritten := replace(
    replace(
      v_definition,
      E'    and contact.verified_by is not null\n',
      ''
    ),
    E'    and pharmacy.online_license_verified\n',
    ''
  );

  if v_rewritten = v_definition
     or position('and contact.verified_by is not null' in v_rewritten) > 0
     or position('and pharmacy.online_license_verified' in v_rewritten) > 0 then
    raise exception 'MED+250 portal binding predicates did not match the guarded version'
      using errcode = 'P0002';
  end if;
  execute v_rewritten;
end;
$rewrite_portal_binding$;

-- Orders go to the ten closest eligible pharmacies. Verified GPS coordinates
-- rank first by real distance; the existing deterministic national fallback
-- remains available where coordinates are absent.
alter table public.dawanear_orders
  drop constraint if exists dawanear_orders_broadcast_limit_check;
update public.dawanear_orders set broadcast_limit = 10 where broadcast_limit <> 10;
alter table public.dawanear_orders alter column broadcast_limit set default 10;
alter table public.dawanear_orders
  add constraint dawanear_orders_broadcast_limit_check check (broadcast_limit = 10);

do $rewrite_order_limit$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure(
    'public.dawanear_create_order(double precision,double precision,jsonb,uuid,numeric,text,text,boolean,text)'
  );
  v_definition text;
  v_rewritten text;
begin
  if v_procedure is null then
    raise exception 'MED+250 order function is missing' using errcode = 'P0002';
  end if;

  select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  limit 20;\n\n  get diagnostics v_recipient_count = row_count;',
    E'  limit 10;\n\n  get diagnostics v_recipient_count = row_count;'
  );

  if v_rewritten = v_definition
     or position(E'  limit 20;\n\n  get diagnostics v_recipient_count' in v_rewritten) > 0 then
    raise exception 'MED+250 order broadcast limit did not match the guarded version'
      using errcode = 'P0002';
  end if;
  execute v_rewritten;
end;
$rewrite_order_limit$;

-- Enqueue the primary verified WhatsApp destination without granting that
-- destination portal authority. The message carries enough request detail for
-- a dispatch-only pharmacy to receive and respond over WhatsApp.
create or replace function dawanear_private.dawanear_enqueue_pharmacy_request_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact text;
  v_payload jsonb;
begin
  if new.kind <> 'new_request' then return new; end if;

  select contact.e164 into v_contact
  from public.dawanear_pharmacy_contacts as contact
  where contact.pharmacy_id = new.pharmacy_id
    and contact.contact_type = 'whatsapp'
    and contact.verification_status in ('source_verified', 'admin_verified')
    and contact.verified_at is not null
  order by contact.is_primary desc, contact.verified_at desc nulls last, contact.id
  limit 1;
  if v_contact is null then return new; end if;

  select jsonb_build_object(
    'reference', orders.reference,
    'delivery_preference', orders.delivery_preference,
    'has_prescription', orders.prescription_path is not null,
    'distance_m', recipient.distance_m,
    'portal_path', 'pharmacy-portal=open&request=' || orders.id::text,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product.id,
      'brand', product.brand_name,
      'generic', product.generic_name,
      'strength', product.strength,
      'form', product.dosage_form,
      'pack_size', product.pack_size,
      'quantity', item.quantity,
      'image_url', product.image_url
    ) order by item.created_at, item.id), '[]'::jsonb)
  ) into v_payload
  from public.dawanear_orders as orders
  join public.dawanear_order_recipients as recipient
    on recipient.order_id = orders.id and recipient.pharmacy_id = new.pharmacy_id
  join public.dawanear_order_items as item on item.order_id = orders.id
  join public.dawanear_products as product on product.id = item.product_id
  where orders.id = new.order_id
  group by orders.id, orders.reference, orders.delivery_preference,
           orders.prescription_path, recipient.distance_m;

  insert into public.dawanear_whatsapp_outbox (
    dedupe_key, recipient_e164, kind, order_id, pharmacy_id, payload
  ) values (
    'pharmacy-request:' || new.id::text || ':' || v_contact,
    v_contact, 'pharmacy_request', new.order_id, new.pharmacy_id, v_payload
  ) on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

-- Owner-authorized development pharmacies. These records are visibly marked
-- as test data and use stable registry keys; no generated database identifier
-- is embedded in this migration.
insert into public.dawanear_pharmacies (
  registry_entry_key,
  registry_type,
  name,
  province,
  district,
  sector,
  google_place_id,
  google_maps_url,
  google_formatted_address,
  location,
  location_confidence,
  geocode_status,
  geocode_checked_at,
  geocode_review_place_id,
  geocode_reviewed_by,
  geocode_reviewed_at,
  geocode_review_note,
  geocode_provider,
  geocode_source_id,
  geocode_source_url,
  license_expires_on,
  marketplace_approved,
  online_license_verified,
  is_active,
  source_name,
  source_url
)
select
  test.registry_entry_key,
  'other',
  test.name,
  test.province,
  test.district,
  test.sector,
  test.place_id,
  'https://www.google.com/maps?q=' || test.latitude::text || ',' || test.longitude::text,
  test.address,
  extensions.st_setsrid(
    extensions.st_makepoint(test.longitude, test.latitude),
    4326
  )::extensions.geography,
  0.500,
  'verified',
  now(),
  test.place_id,
  'MED250 marketplace owner',
  now(),
  'Owner-authorized approximate coordinate for live development dispatch testing.',
  'admin',
  test.place_id,
  'https://med-250.com',
  date '2099-12-31',
  true,
  false,
  true,
  'MED250 owner-authorized development testing',
  'https://med-250.com'
from (values
  (
    'med250-test-kigali-01',
    'MED250 Test Pharmacy Kigali',
    'Kigali City',
    'Gasabo',
    'Kacyiru',
    'med250-test-kigali-01',
    'Development test coordinate — Kacyiru, Kigali',
    -1.944000::double precision,
    30.061900::double precision
  ),
  (
    'med250-test-musanze-01',
    'MED250 Test Pharmacy Musanze A',
    'Northern Province',
    'Musanze',
    'Muhoza',
    'med250-test-musanze-01',
    'Development test coordinate — Muhoza, Musanze',
    -1.497700::double precision,
    29.634600::double precision
  ),
  (
    'med250-test-musanze-02',
    'MED250 Test Pharmacy Musanze B',
    'Northern Province',
    'Musanze',
    'Cyuve',
    'med250-test-musanze-02',
    'Development test coordinate — Cyuve, Musanze',
    -1.501500::double precision,
    29.630200::double precision
  )
) as test(
  registry_entry_key,
  name,
  province,
  district,
  sector,
  place_id,
  address,
  latitude,
  longitude
)
on conflict (registry_entry_key) do update
set registry_type = excluded.registry_type,
    name = excluded.name,
    province = excluded.province,
    district = excluded.district,
    sector = excluded.sector,
    google_place_id = excluded.google_place_id,
    google_maps_url = excluded.google_maps_url,
    google_formatted_address = excluded.google_formatted_address,
    location = excluded.location,
    location_confidence = excluded.location_confidence,
    geocode_status = excluded.geocode_status,
    geocode_checked_at = excluded.geocode_checked_at,
    geocode_review_place_id = excluded.geocode_review_place_id,
    geocode_reviewed_by = excluded.geocode_reviewed_by,
    geocode_reviewed_at = excluded.geocode_reviewed_at,
    geocode_review_note = excluded.geocode_review_note,
    geocode_provider = excluded.geocode_provider,
    geocode_source_id = excluded.geocode_source_id,
    geocode_source_url = excluded.geocode_source_url,
    license_expires_on = excluded.license_expires_on,
    marketplace_approved = excluded.marketplace_approved,
    online_license_verified = excluded.online_license_verified,
    is_active = excluded.is_active,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    updated_at = now();

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
  pharmacy.id,
  'whatsapp',
  test.e164,
  '+' || test.e164,
  true,
  true,
  'admin_verified',
  'admin',
  'MED250 owner-authorized development testing',
  'https://med-250.com',
  'Marketplace owner instruction recorded 2026-07-30',
  now(),
  now(),
  'MED250 marketplace owner',
  'Owner instructed MED250 to add this number for live pharmacy dispatch and portal OTP testing.'
from (values
  ('med250-test-kigali-01', '250788767816'),
  ('med250-test-musanze-01', '35677186193'),
  ('med250-test-musanze-02', '35699742524')
) as test(registry_entry_key, e164)
join public.dawanear_pharmacies as pharmacy
  on pharmacy.registry_entry_key = test.registry_entry_key
on conflict (pharmacy_id, contact_type, e164) do update
set display_number = excluded.display_number,
    is_primary = excluded.is_primary,
    is_login_enabled = excluded.is_login_enabled,
    verification_status = excluded.verification_status,
    source_type = excluded.source_type,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    source_reference = excluded.source_reference,
    source_observed_at = excluded.source_observed_at,
    verified_at = excluded.verified_at,
    verified_by_label = excluded.verified_by_label,
    verification_note = excluded.verification_note,
    updated_at = now();

do $verify_policy$
declare
  v_test_pharmacies integer;
  v_test_contacts integer;
begin
  select count(*) into v_test_pharmacies
  from public.dawanear_pharmacies
  where registry_entry_key in (
    'med250-test-kigali-01',
    'med250-test-musanze-01',
    'med250-test-musanze-02'
  )
    and dawanear_private.dawanear_pharmacy_is_dispatch_eligible(id);

  select count(*) into v_test_contacts
  from public.dawanear_pharmacy_contacts as contact
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = contact.pharmacy_id
  where pharmacy.registry_entry_key in (
    'med250-test-kigali-01',
    'med250-test-musanze-01',
    'med250-test-musanze-02'
  )
    and contact.contact_type = 'whatsapp'
    and contact.is_login_enabled
    and contact.verification_status = 'admin_verified';

  if v_test_pharmacies <> 3 or v_test_contacts <> 3 then
    raise exception 'MED+250 test pharmacy installation did not produce three dispatch and portal contacts'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.dawanear_pharmacy_contacts as contact
    where contact.contact_type = 'whatsapp'
      and contact.verification_status in ('source_verified', 'admin_verified')
      and contact.verified_at is not null
      and not contact.is_login_enabled
      and not dawanear_private.dawanear_pharmacy_is_dispatch_eligible(contact.pharmacy_id)
      and exists (
        select 1
        from public.dawanear_pharmacies as pharmacy
        where pharmacy.id = contact.pharmacy_id
          and pharmacy.is_active
          and pharmacy.marketplace_approved
          and pharmacy.license_expires_on >= current_date
      )
  ) then
    raise exception 'A current verified dispatch-only WhatsApp contact remains ineligible'
      using errcode = 'P0002';
  end if;
end;
$verify_policy$;

commit;
