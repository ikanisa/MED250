-- MED+250 live-database integration UAT.
--
-- Run this only against an authorised MED+250 Supabase project. The entire
-- fixture and workflow are executed inside one transaction and rolled back.
-- A successful run returns one JSON row after the rollback. Any failed
-- invariant raises an exception and PostgreSQL aborts the transaction.
--
-- This exercises the deployed functions rather than a copied test model:
--   * exactly 10 nearest eligible-pharmacy dispatch recipients
--   * idempotent customer retries
--   * recipient-only pharmacy visibility
--   * complete pharmacy confirmation with an optional private price
--   * pre-selection contact privacy
--   * customer ownership isolation
--   * selected-pharmacy contact release
--   * terminal order closure and active-order cleanup

begin;

do $med250_live_rollback_uat$
declare
  v_customer_id uuid := gen_random_uuid();
  v_other_customer_id uuid := gen_random_uuid();
  v_staff_id uuid := gen_random_uuid();
  v_staff_b_id uuid := gen_random_uuid();
  v_pharmacy_a uuid := gen_random_uuid();
  v_pharmacy_b uuid := gen_random_uuid();
  v_client_request_id uuid := gen_random_uuid();
  v_product_id text;
  v_order_id uuid;
  v_retry_order_id uuid;
  v_order_item_id uuid;
  v_offer_id uuid;
  v_selected_pharmacy_id uuid;
  v_recipient_count integer;
  v_retry_recipient_count integer;
  v_request_count integer;
  v_offer_count integer;
  v_active_count integer;
  v_notification_count integer;
  v_total_rwf bigint;
  v_complete boolean;
  v_distance_m double precision;
  v_contact_whatsapp text;
  v_status text;
  v_has_private_contact boolean;
  v_precontact_eligible_count integer;
  v_dispatch_eligible_count integer;
  v_automatic_approval_count integer;
  v_online_flag_count integer;
  v_cancel_order_id uuid;
  v_stale_order_id uuid;
  v_replacement_order_id uuid;
  v_stale_selected_order_id uuid;
  v_stale_selected_item_id uuid;
  v_stale_selected_offer_id uuid;
  v_recovered_order_id uuid;
  v_recovery_status text;
  v_expired_offer_status text;
begin
  select product.id
    into v_product_id
  from public.dawanear_products as product
  where product.is_active
    and product.is_orderable
    and product.prescription_status <> 'prescription'
  order by product.id
  limit 1;

  if v_product_id is null then
    raise exception 'UAT requires one active, orderable, non-prescription product';
  end if;

  insert into auth.users (
    id, aud, role, raw_app_meta_data, raw_user_meta_data,
    is_anonymous, created_at, updated_at
  ) values
    (v_customer_id, 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, true, now(), now()),
    (v_other_customer_id, 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, true, now(), now()),
    (v_staff_id, 'authenticated', 'authenticated',
      '{"provider":"whatsapp_cloud_otp","role":"pharmacy_staff"}'::jsonb,
      '{}'::jsonb, false, now(), now()),
    (v_staff_b_id, 'authenticated', 'authenticated',
      '{"provider":"whatsapp_cloud_otp","role":"pharmacy_staff"}'::jsonb,
      '{}'::jsonb, false, now(), now());

  insert into public.dawanear_pharmacies (
    id, registry_entry_key, registry_type, license_number, name,
    google_place_id, geocode_review_place_id, geocode_reviewed_by,
    geocode_reviewed_at, geocode_review_note,
    location, location_confidence, geocode_status, geocode_checked_at,
    momo_code, license_expires_on, online_license_verified,
    is_active, source_name, source_url
  ) values
    (
      v_pharmacy_a, 'uat-rollback-a-' || v_pharmacy_a::text, 'retail',
      'UAT-A-' || v_pharmacy_a::text, 'MED250 rollback pharmacy A',
      'uat-place-a-' || v_pharmacy_a::text,
      'uat-place-a-' || v_pharmacy_a::text,
      'MED250 rollback UAT reviewer', now(),
      'Transaction-only exact premises approval for lifecycle UAT.',
      extensions.st_setsrid(extensions.st_makepoint(30.0605, -1.9505), 4326)::extensions.geography,
      1, 'verified', now(), '123456', current_date + 365,
      false, true, 'MED250 rollback UAT', 'https://med250.rw'
    ),
    (
      v_pharmacy_b, 'uat-rollback-b-' || v_pharmacy_b::text, 'retail',
      'UAT-B-' || v_pharmacy_b::text, 'MED250 rollback pharmacy B',
      'uat-place-b-' || v_pharmacy_b::text,
      'uat-place-b-' || v_pharmacy_b::text,
      'MED250 rollback UAT reviewer', now(),
      'Transaction-only exact premises approval for lifecycle UAT.',
      extensions.st_setsrid(extensions.st_makepoint(30.0650, -1.9550), 4326)::extensions.geography,
      1, 'verified', now(), '654321', current_date + 365,
      false, true, 'MED250 rollback UAT', 'https://med250.rw'
    );

  select count(*)::integer
    into v_precontact_eligible_count
  from (values (v_pharmacy_a), (v_pharmacy_b)) as fixture(pharmacy_id)
  where dawanear_private.dawanear_pharmacy_is_dispatch_eligible(fixture.pharmacy_id);

  if v_precontact_eligible_count <> 0 then
    raise exception 'A pharmacy became dispatch eligible before WhatsApp evidence existed';
  end if;

  insert into public.dawanear_pharmacy_contacts (
    pharmacy_id, contact_type, e164, display_number, is_primary,
    is_login_enabled, verification_status, source_type, source_name,
    source_reference, source_observed_at, verified_at,
    verified_by_label, verification_note
  ) values
    (
      v_pharmacy_a, 'whatsapp', '250788000001', '+250 788 000 001', true,
      true, 'admin_verified', 'admin', 'MED250 rollback UAT',
      'uat-contact-a', now(), now(), 'MED250 rollback UAT reviewer',
      'Transaction-only verified WhatsApp contact for lifecycle UAT.'
    ),
    (
      v_pharmacy_a, 'phone', '250788000001', '+250 788 000 001', true,
      false, 'admin_verified', 'admin', 'MED250 rollback UAT',
      'uat-phone-a', now(), now(), 'MED250 rollback UAT reviewer',
      'Transaction-only verified phone contact for lifecycle UAT.'
    ),
    (
      v_pharmacy_b, 'whatsapp', '250788000002', '+250 788 000 002', true,
      true, 'admin_verified', 'admin', 'MED250 rollback UAT',
      'uat-contact-b', now(), now(), 'MED250 rollback UAT reviewer',
      'Transaction-only verified WhatsApp contact for lifecycle UAT.'
    ),
    (
      v_pharmacy_b, 'phone', '250788000002', '+250 788 000 002', true,
      false, 'admin_verified', 'admin', 'MED250 rollback UAT',
      'uat-phone-b', now(), now(), 'MED250 rollback UAT reviewer',
      'Transaction-only verified phone contact for lifecycle UAT.'
    );

  select
    count(*) filter (
      where dawanear_private.dawanear_pharmacy_is_dispatch_eligible(fixture.pharmacy_id)
    )::integer,
    count(*) filter (
      where pharmacy.marketplace_approved
    )::integer,
    count(*) filter (
      where pharmacy.online_license_verified
    )::integer
    into v_dispatch_eligible_count, v_automatic_approval_count, v_online_flag_count
  from (values (v_pharmacy_a), (v_pharmacy_b)) as fixture(pharmacy_id)
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = fixture.pharmacy_id;

  if v_dispatch_eligible_count <> 2 then
    raise exception 'Expected two GPS/contact-ready rollback pharmacies, received %',
      v_dispatch_eligible_count;
  end if;
  if v_automatic_approval_count <> 2 or v_online_flag_count <> 0 then
    raise exception 'Retail marketplace approval still depends on the online-premises flag';
  end if;

  insert into public.dawanear_pharmacy_memberships (
    pharmacy_id, user_id, role, status
  ) values
    (v_pharmacy_a, v_staff_id, 'manager', 'active'),
    (v_pharmacy_b, v_staff_b_id, 'manager', 'active');

  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_customer_id, 'role', 'authenticated')::text,
    true
  );

  select created.order_id, created.recipient_count
    into v_order_id, v_recipient_count
  from public.dawanear_create_order(
    -1.9500,
    30.0600,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 1,
      'customer_min_rwf', 1000,
      'customer_max_rwf', 4000,
      'substitutes_allowed', false
    )),
    v_client_request_id,
    15,
    '250788999999',
    'pickup',
    false,
    null
  ) as created;

  if v_recipient_count <> 10 then
    raise exception 'Expected exactly ten rollback recipients, received %', v_recipient_count;
  end if;

  select retried.order_id, retried.recipient_count
    into v_retry_order_id, v_retry_recipient_count
  from public.dawanear_create_order(
    -1.9500,
    30.0600,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 1,
      'customer_min_rwf', 1000,
      'customer_max_rwf', 4000,
      'substitutes_allowed', false
    )),
    v_client_request_id,
    15,
    '250788999999',
    'pickup',
    false,
    null
  ) as retried;

  if v_retry_order_id <> v_order_id or v_retry_recipient_count <> v_recipient_count then
    raise exception 'Idempotent retry did not return the original order receipt';
  end if;

  select item.id
    into v_order_item_id
  from public.dawanear_order_items as item
  where item.order_id = v_order_id
    and item.product_id = v_product_id;

  if v_order_item_id is null then
    raise exception 'Order item was not committed atomically with the order';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_staff_id, 'role', 'authenticated')::text,
    true
  );

  select count(*)::integer
    into v_request_count
  from public.dawanear_pharmacy_requests(v_pharmacy_a);

  if v_request_count <> 1 then
    raise exception 'Recipient pharmacy could not see its assigned order';
  end if;

  begin
    perform 1 from public.dawanear_pharmacy_requests(v_pharmacy_b);
    raise exception 'Staff could read an order for a pharmacy without membership' using errcode = 'P0001';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform 1
    from public.dawanear_contribute_price(v_pharmacy_a, v_product_id, 2500);
    raise exception 'Pharmacy-specific catalogue price was accepted' using errcode = 'P0001';
  exception
    when sqlstate '0A000' then null;
  end;

  if exists (
    select 1 from public.dawanear_pharmacy_prices
    where product_id = v_product_id and is_current
  ) then
    raise exception 'Rejected pharmacy-specific catalogue price created a current record';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_staff_id, 'role', 'authenticated')::text,
    true
  );

  select submitted.offer_id, submitted.total_rwf, submitted.complete, submitted.distance_m
    into v_offer_id, v_total_rwf, v_complete, v_distance_m
  from public.dawanear_submit_offer(
    v_pharmacy_a,
    v_order_id,
    jsonb_build_array(jsonb_build_object(
      'order_item_id', v_order_item_id,
      'offered_product_id', v_product_id,
      'available', true,
      'is_substitute', false,
      'unit_price_rwf', null,
      'quantity', 1,
      'note', null
    )),
    'pickup',
    20,
    'Rollback-only integration confirmation'
  ) as submitted;

  if not v_complete or v_total_rwf <> 0 or v_distance_m <= 0 then
    raise exception 'Price-optional complete confirmation receipt was invalid';
  end if;

  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_customer_id, 'role', 'authenticated')::text,
    true
  );

  select count(*)::integer
    into v_precontact_eligible_count
  from public.dawanear_selected_contact(v_order_id);

  if v_precontact_eligible_count <> 0 then
    raise exception 'Pharmacy contact was exposed before customer selection';
  end if;

  select
    count(*)::integer,
    coalesce(bool_or(to_jsonb(confirmed) ? 'whatsapp' or to_jsonb(confirmed) ? 'momo_code'), false)
    into v_offer_count, v_has_private_contact
  from public.dawanear_my_confirmed_offers(v_order_id) as confirmed;

  if v_offer_count <> 1 then
    raise exception 'Customer should see only the one pharmacy that confirmed';
  end if;
  if v_has_private_contact then
    raise exception 'Confirmed-offer payload exposed contact details before selection';
  end if;

  perform set_config('request.jwt.claim.sub', v_other_customer_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_other_customer_id, 'role', 'authenticated')::text,
    true
  );

  begin
    select count(*)::integer
      into v_offer_count
    from public.dawanear_my_confirmed_offers(v_order_id);

    if v_offer_count <> 0 then
      raise exception 'Another customer could read the order confirmations'
        using errcode = 'P0001';
    end if;
  exception
    when sqlstate 'P0002' then null;
  end;

  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_customer_id, 'role', 'authenticated')::text,
    true
  );

  select selected.pharmacy_id
    into v_selected_pharmacy_id
  from public.dawanear_select_offer(v_order_id, v_offer_id) as selected;

  if v_selected_pharmacy_id <> v_pharmacy_a then
    raise exception 'Customer selection did not lock the confirmed pharmacy';
  end if;

  select contact.pharmacy_id, contact.whatsapp
    into v_selected_pharmacy_id, v_contact_whatsapp
  from public.dawanear_selected_contact(v_order_id) as contact;

  if v_selected_pharmacy_id <> v_pharmacy_a or v_contact_whatsapp <> '250788000001' then
    raise exception 'Only the selected pharmacy contact should be released';
  end if;

  select closed.status
    into v_status
  from public.dawanear_close_order(v_order_id, 'completed') as closed;

  if v_status <> 'completed' then
    raise exception 'Selected order did not reach the completed terminal state';
  end if;

  select count(*)::integer
    into v_active_count
  from public.dawanear_my_active_orders();

  if v_active_count <> 0 then
    raise exception 'Completed order remained in the active-order recovery feed';
  end if;

  -- Cancellation must free the customer's one-active-order slot immediately.
  select created.order_id
    into v_cancel_order_id
  from public.dawanear_create_order(
    -1.9500,
    30.0600,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 1,
      'customer_min_rwf', 1000,
      'customer_max_rwf', 4000,
      'substitutes_allowed', false
    )),
    gen_random_uuid(),
    15,
    '250788999999',
    'pickup',
    false,
    null
  ) as created;

  select closed.status
    into v_recovery_status
  from public.dawanear_close_order(v_cancel_order_id, 'cancelled') as closed;

  if v_recovery_status <> 'cancelled' then
    raise exception 'Customer cancellation did not reach its terminal state';
  end if;

  -- A replacement order must expire this same customer's stale no-response
  -- order without waiting for a background job.
  select created.order_id
    into v_stale_order_id
  from public.dawanear_create_order(
    -1.9500,
    30.0600,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 1,
      'customer_min_rwf', 1000,
      'customer_max_rwf', 4000,
      'substitutes_allowed', false
    )),
    gen_random_uuid(),
    15,
    null,
    'pickup',
    false,
    null
  ) as created;

  update public.dawanear_orders
  set created_at = now() - interval '3 hours',
      broadcast_at = now() - interval '3 hours',
      updated_at = now() - interval '3 hours',
      expires_at = now() - interval '1 minute'
  where id = v_stale_order_id;

  select created.order_id
    into v_replacement_order_id
  from public.dawanear_create_order(
    -1.9500,
    30.0600,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 1,
      'customer_min_rwf', 1000,
      'customer_max_rwf', 4000,
      'substitutes_allowed', false
    )),
    gen_random_uuid(),
    15,
    null,
    'pickup',
    false,
    null
  ) as created;

  select status into v_recovery_status
  from public.dawanear_orders where id = v_stale_order_id;
  if v_recovery_status <> 'expired' then
    raise exception 'Stale no-response order did not expire during recovery';
  end if;
  perform 1 from public.dawanear_close_order(v_replacement_order_id, 'cancelled');

  -- A selected order older than the 24-hour contact window must also expire
  -- customer-scoped before a replacement order is accepted.
  select created.order_id
    into v_stale_selected_order_id
  from public.dawanear_create_order(
    -1.9500,
    30.0600,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 1,
      'customer_min_rwf', 1000,
      'customer_max_rwf', 4000,
      'substitutes_allowed', false
    )),
    gen_random_uuid(),
    15,
    null,
    'pickup',
    false,
    null
  ) as created;

  select item.id into v_stale_selected_item_id
  from public.dawanear_order_items as item
  where item.order_id = v_stale_selected_order_id;

  perform set_config('request.jwt.claim.sub', v_staff_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_staff_id, 'role', 'authenticated')::text,
    true
  );

  select submitted.offer_id
    into v_stale_selected_offer_id
  from public.dawanear_submit_offer(
    v_pharmacy_a,
    v_stale_selected_order_id,
    jsonb_build_array(jsonb_build_object(
      'order_item_id', v_stale_selected_item_id,
      'offered_product_id', v_product_id,
      'available', true,
      'is_substitute', false,
      'unit_price_rwf', 2500,
      'quantity', 1,
      'note', null
    )),
    'pickup',
    20,
    'Rollback-only timeout confirmation'
  ) as submitted;

  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_customer_id, 'role', 'authenticated')::text,
    true
  );
  perform 1 from public.dawanear_select_offer(
    v_stale_selected_order_id,
    v_stale_selected_offer_id
  );

  update public.dawanear_orders
  set created_at = now() - interval '26 hours',
      broadcast_at = now() - interval '26 hours',
      selected_at = now() - interval '25 hours',
      updated_at = now() - interval '25 hours'
  where id = v_stale_selected_order_id;

  select created.order_id
    into v_recovered_order_id
  from public.dawanear_create_order(
    -1.9500,
    30.0600,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 1,
      'customer_min_rwf', 1000,
      'customer_max_rwf', 4000,
      'substitutes_allowed', false
    )),
    gen_random_uuid(),
    15,
    null,
    'pickup',
    false,
    null
  ) as created;

  select order_row.status, offer.status
    into v_recovery_status, v_expired_offer_status
  from public.dawanear_orders as order_row
  join public.dawanear_offers as offer
    on offer.id = v_stale_selected_offer_id
  where order_row.id = v_stale_selected_order_id;

  if v_recovery_status <> 'expired' or v_expired_offer_status <> 'expired' then
    raise exception 'Timed-out selected order and confirmation did not expire atomically';
  end if;
  perform 1 from public.dawanear_close_order(v_recovered_order_id, 'cancelled');

  select count(*)::integer
    into v_notification_count
  from public.dawanear_pharmacy_notifications as notification
  where notification.order_id = v_order_id
    and (
      (notification.kind = 'new_request' and notification.pharmacy_id in (v_pharmacy_a, v_pharmacy_b))
      or (notification.kind = 'order_closed' and notification.pharmacy_id in (v_pharmacy_a, v_pharmacy_b))
      or (notification.kind = 'order_selected' and notification.pharmacy_id = v_pharmacy_a)
    );

  if v_notification_count <> 5 then
    raise exception 'Expected five deduplicated lifecycle notifications, received %', v_notification_count;
  end if;
end;
$med250_live_rollback_uat$;

rollback;

select jsonb_build_object(
  'status', 'passed',
  'persistence', 'rolled_back',
  'workflow', array[
    'automatic_marketplace_approval', 'eligibility_fail_closed',
    'dispatch', 'idempotent_retry', 'membership_isolation',
    'central_price_boundary', 'optional_confirmation_price', 'customer_cancellation',
    'no_response_recovery', 'selected_timeout_recovery',
    'complete_confirmation', 'preselection_privacy', 'ownership_isolation',
    'selection_contact_release', 'completion', 'notification_lifecycle'
  ]
) as med250_live_rollback_uat;
