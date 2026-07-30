begin;

-- Customer WhatsApp is a delivery/contact destination, not a portal identity.
-- Pharmacy portal access remains protected by the separate pharmacy OTP and
-- reviewed contact-binding controls.
set local med250.allow_product_image_governance_ddl = 'on';

drop trigger if exists dawanear_orders_verified_customer_whatsapp
  on public.dawanear_orders;

drop function if exists
  dawanear_private.dawanear_require_verified_customer_whatsapp();

create or replace function dawanear_private.dawanear_enqueue_customer_offer_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_payload jsonb;
begin
  if new.status <> 'submitted' or new.complete is distinct from true then return new; end if;
  if tg_op = 'UPDATE'
     and old.submitted_at is not distinct from new.submitted_at
     and old.total_rwf is not distinct from new.total_rwf
     and old.complete is not distinct from new.complete then
    return new;
  end if;

  select orders.whatsapp into v_phone
  from public.dawanear_orders as orders
  where orders.id = new.order_id;
  if v_phone is null then return new; end if;

  select jsonb_build_object(
    'reference', orders.reference,
    'pharmacy_name', pharmacy.name,
    'complete', new.complete,
    'total_rwf', new.total_rwf,
    'ready_in_minutes', new.ready_in_minutes,
    'fulfilment_method', new.fulfilment_method,
    'portal_path', 'request=' || orders.id::text,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'available', offer_item.available,
      'is_substitute', offer_item.is_substitute,
      'brand', product.brand_name,
      'strength', product.strength,
      'pack_size', product.pack_size,
      'quantity', offer_item.quantity,
      'unit_price_rwf', offer_item.unit_price_rwf,
      'image_url', product.image_url
    ) order by offer_item.id), '[]'::jsonb)
  ) into v_payload
  from public.dawanear_orders as orders
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = new.pharmacy_id
  join public.dawanear_offer_items as offer_item on offer_item.offer_id = new.id
  left join public.dawanear_products as product on product.id = offer_item.offered_product_id
  where orders.id = new.order_id
  group by orders.id, orders.reference, pharmacy.name;

  insert into public.dawanear_whatsapp_outbox (
    dedupe_key, recipient_e164, kind, order_id, pharmacy_id, offer_id, payload
  ) values (
    'customer-offer:' || new.id::text || ':' || extract(epoch from new.submitted_at)::bigint::text,
    v_phone, 'customer_offer', new.order_id, new.pharmacy_id, new.id, v_payload
  ) on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

comment on column public.dawanear_orders.whatsapp is
  'Customer-provided WhatsApp contact for this availability request. Customer OTP verification is not required; pharmacy portal OTP authority is governed separately.';

comment on column public.dawanear_customer_profiles.whatsapp_verified_at is
  'Legacy optional customer-contact verification timestamp. It does not authorize pharmacy portal access and does not gate customer order creation.';

do $verify_customer_contact_boundary$
begin
  if exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'dawanear_orders'
      and trigger.tgname = 'dawanear_orders_verified_customer_whatsapp'
      and not trigger.tgisinternal
  ) then
    raise exception 'Customer order WhatsApp verification trigger remains installed'
      using errcode = 'P0002';
  end if;

  if pg_catalog.to_regprocedure(
    'dawanear_private.dawanear_require_verified_customer_whatsapp()'
  ) is not null then
    raise exception 'Customer order WhatsApp verification function remains installed'
      using errcode = 'P0002';
  end if;
end;
$verify_customer_contact_boundary$;

commit;
