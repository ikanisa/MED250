begin;

set local med250.allow_product_image_governance_ddl = 'on';

-- Customer offer delivery is a two-step transaction: the private submitter
-- writes the submitted offer, then the public wrapper records the pharmacy's
-- final fulfilment method. Keep the durable WhatsApp/customer signal aligned
-- with that final row, and let the second trigger pass refresh the queued
-- payload before the worker can see it.
create or replace function dawanear_private.dawanear_enqueue_customer_offer_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_payload jsonb;
  v_dedupe_key text;
begin
  if new.status <> 'submitted' or new.complete is distinct from true then return new; end if;
  if tg_op = 'UPDATE'
     and old.submitted_at is not distinct from new.submitted_at
     and old.total_rwf is not distinct from new.total_rwf
     and old.complete is not distinct from new.complete
     and old.fulfilment_method is not distinct from new.fulfilment_method then
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

  v_dedupe_key := 'customer-offer:' || new.id::text || ':'
    || extract(epoch from coalesce(new.submitted_at, now()))::bigint::text;

  insert into public.dawanear_whatsapp_outbox (
    dedupe_key, recipient_e164, kind, order_id, pharmacy_id, offer_id, payload
  ) values (
    v_dedupe_key,
    v_phone, 'customer_offer', new.order_id, new.pharmacy_id, new.id, v_payload
  ) on conflict (dedupe_key) do update
    set recipient_e164 = excluded.recipient_e164,
        payload = excluded.payload,
        status = case
          when public.dawanear_whatsapp_outbox.status = 'failed' then 'retry'
          else public.dawanear_whatsapp_outbox.status
        end,
        available_at = case
          when public.dawanear_whatsapp_outbox.status in ('queued', 'retry', 'failed')
          then least(public.dawanear_whatsapp_outbox.available_at, now())
          else public.dawanear_whatsapp_outbox.available_at
        end,
        updated_at = now()
    where public.dawanear_whatsapp_outbox.whatsapp_message_id is null
      and public.dawanear_whatsapp_outbox.status in ('queued', 'retry', 'failed');
  return new;
end;
$$;

drop trigger if exists dawanear_customer_offer_whatsapp_enqueue on public.dawanear_offers;
create trigger dawanear_customer_offer_whatsapp_enqueue
after insert or update of status, total_rwf, complete, submitted_at, fulfilment_method
on public.dawanear_offers
for each row execute function dawanear_private.dawanear_enqueue_customer_offer_message();

-- WhatsApp fan-out should match the operational rule: notify only the nearest
-- ten recipients that actually have a verified login-enabled WhatsApp channel.
-- The in-app pharmacy notification can still exist for every selected
-- recipient, but WhatsApp delivery is intentionally capped here.
create or replace function dawanear_private.dawanear_enqueue_pharmacy_request_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact text;
  v_payload jsonb;
  v_dedupe_key text;
begin
  if new.kind <> 'new_request' then return new; end if;

  select ranked.e164 into v_contact
  from (
    select
      recipient.pharmacy_id,
      contact.e164,
      row_number() over (
        order by
          case when recipient.distance_m is not null and recipient.distance_m >= 0 then 0 else 1 end,
          recipient.distance_m nulls last,
          recipient.pharmacy_id
      ) as dispatch_rank
    from public.dawanear_order_recipients as recipient
    join lateral (
      select pharmacy_contact.e164
      from public.dawanear_pharmacy_contacts as pharmacy_contact
      where pharmacy_contact.pharmacy_id = recipient.pharmacy_id
        and pharmacy_contact.contact_type = 'whatsapp'
        and pharmacy_contact.verification_status in ('source_verified', 'admin_verified')
        and pharmacy_contact.verified_at is not null
      order by pharmacy_contact.is_primary desc, pharmacy_contact.verified_at desc nulls last, pharmacy_contact.id
      limit 1
    ) as contact on true
    where recipient.order_id = new.order_id
  ) as ranked
  where ranked.pharmacy_id = new.pharmacy_id
    and ranked.dispatch_rank <= 10
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

  v_dedupe_key := 'pharmacy-request:' || new.order_id::text || ':' || new.pharmacy_id::text || ':' || v_contact;

  insert into public.dawanear_whatsapp_outbox (
    dedupe_key, recipient_e164, kind, order_id, pharmacy_id, payload
  ) values (
    v_dedupe_key,
    v_contact, 'pharmacy_request', new.order_id, new.pharmacy_id, v_payload
  ) on conflict (dedupe_key) do update
    set recipient_e164 = excluded.recipient_e164,
        payload = excluded.payload,
        status = case
          when public.dawanear_whatsapp_outbox.status = 'failed' then 'retry'
          else public.dawanear_whatsapp_outbox.status
        end,
        available_at = case
          when public.dawanear_whatsapp_outbox.status in ('queued', 'retry', 'failed')
          then least(public.dawanear_whatsapp_outbox.available_at, now())
          else public.dawanear_whatsapp_outbox.available_at
        end,
        updated_at = now()
    where public.dawanear_whatsapp_outbox.whatsapp_message_id is null
      and public.dawanear_whatsapp_outbox.status in ('queued', 'retry', 'failed');
  return new;
end;
$$;

drop trigger if exists dawanear_pharmacy_request_whatsapp_enqueue on public.dawanear_pharmacy_notifications;
create trigger dawanear_pharmacy_request_whatsapp_enqueue
after insert on public.dawanear_pharmacy_notifications
for each row execute function dawanear_private.dawanear_enqueue_pharmacy_request_message();

-- Backfill currently active live orders that were broadcast before this repair,
-- without duplicating any recipient that already has a queued/sent request.
with ranked_recipients as (
  select
    orders.id as order_id,
    recipient.pharmacy_id,
    recipient.distance_m,
    contact.e164,
    row_number() over (
      partition by orders.id
      order by
        case when recipient.distance_m is not null and recipient.distance_m >= 0 then 0 else 1 end,
        recipient.distance_m nulls last,
        recipient.pharmacy_id
    ) as dispatch_rank
  from public.dawanear_orders as orders
  join public.dawanear_order_recipients as recipient on recipient.order_id = orders.id
  join lateral (
    select pharmacy_contact.e164
    from public.dawanear_pharmacy_contacts as pharmacy_contact
    where pharmacy_contact.pharmacy_id = recipient.pharmacy_id
      and pharmacy_contact.contact_type = 'whatsapp'
      and pharmacy_contact.verification_status in ('source_verified', 'admin_verified')
      and pharmacy_contact.verified_at is not null
    order by pharmacy_contact.is_primary desc, pharmacy_contact.verified_at desc nulls last, pharmacy_contact.id
    limit 1
  ) as contact on true
  where orders.status in ('broadcast', 'offers_received')
    and orders.expires_at > now()
),
eligible_recipients as (
  select *
  from ranked_recipients
  where dispatch_rank <= 10
)
insert into public.dawanear_whatsapp_outbox (
  dedupe_key,
  recipient_e164,
  kind,
  order_id,
  pharmacy_id,
  payload
)
select
  'pharmacy-request:' || orders.id::text || ':' || eligible.pharmacy_id::text || ':' || eligible.e164,
  eligible.e164,
  'pharmacy_request',
  orders.id,
  eligible.pharmacy_id,
  jsonb_build_object(
    'reference', orders.reference,
    'delivery_preference', orders.delivery_preference,
    'has_prescription', orders.prescription_path is not null,
    'distance_m', recipient.distance_m,
    'portal_path', 'pharmacy-portal=open&request=' || orders.id::text,
    'items', coalesce(items.items, '[]'::jsonb)
  )
from eligible_recipients as eligible
join public.dawanear_orders as orders on orders.id = eligible.order_id
join public.dawanear_order_recipients as recipient
  on recipient.order_id = eligible.order_id
 and recipient.pharmacy_id = eligible.pharmacy_id
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'product_id', product.id,
    'brand', product.brand_name,
    'generic', product.generic_name,
    'strength', product.strength,
    'form', product.dosage_form,
    'pack_size', product.pack_size,
    'quantity', item.quantity,
    'image_url', product.image_url
  ) order by item.created_at, item.id) as items
  from public.dawanear_order_items as item
  join public.dawanear_products as product on product.id = item.product_id
  where item.order_id = orders.id
) as items on true
where not exists (
  select 1
  from public.dawanear_whatsapp_outbox as existing
  where existing.kind = 'pharmacy_request'
    and existing.order_id = orders.id
    and existing.pharmacy_id = eligible.pharmacy_id
    and existing.recipient_e164 = eligible.e164
)
on conflict (dedupe_key) do update
  set payload = excluded.payload,
      updated_at = now()
  where public.dawanear_whatsapp_outbox.whatsapp_message_id is null
    and public.dawanear_whatsapp_outbox.status in ('queued', 'retry', 'failed');

commit;
