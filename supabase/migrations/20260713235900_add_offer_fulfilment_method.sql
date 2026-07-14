begin;

-- A customer chooses among confirmations, so each pharmacy confirmation must
-- state what the pharmacy is actually offering rather than echoing the
-- customer's preference.
alter table public.dawanear_offers
  add column if not exists fulfilment_method text not null default 'either';

alter table public.dawanear_offers
  drop constraint if exists dawanear_offers_fulfilment_method_check;
alter table public.dawanear_offers
  add constraint dawanear_offers_fulfilment_method_check
  check (fulfilment_method in ('pickup', 'delivery', 'either'));

update public.dawanear_offers as offer
set fulfilment_method = customer_order.delivery_preference
from public.dawanear_orders as customer_order
where customer_order.id = offer.order_id
  and customer_order.delivery_preference in ('pickup', 'delivery')
  and offer.fulfilment_method = 'either';

-- Keep the proven submission implementation private and expose one unique RPC
-- signature. Supabase's Data API does not support overloaded function names.
alter function public.dawanear_submit_offer(uuid, uuid, jsonb, integer, text)
  set schema dawanear_private;
revoke all on function dawanear_private.dawanear_submit_offer(uuid, uuid, jsonb, integer, text)
  from public, anon, authenticated, service_role;

create function public.dawanear_submit_offer(
  p_pharmacy_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_fulfilment_method text,
  p_ready_in_minutes integer default null,
  p_note text default null
)
returns table (
  offer_id uuid,
  total_rwf bigint,
  complete boolean,
  distance_m double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer_id uuid;
  v_total_rwf bigint;
  v_complete boolean;
  v_distance_m double precision;
  v_order_preference text;
begin
  if p_fulfilment_method not in ('pickup', 'delivery', 'either') then
    raise exception 'Fulfilment method is invalid' using errcode = '22023';
  end if;

  select submitted.offer_id, submitted.total_rwf, submitted.complete, submitted.distance_m
    into v_offer_id, v_total_rwf, v_complete, v_distance_m
  from dawanear_private.dawanear_submit_offer(
    p_pharmacy_id,
    p_order_id,
    p_items,
    p_ready_in_minutes,
    p_note
  ) as submitted;

  if v_offer_id is null then
    raise exception 'Offer submission did not return a receipt' using errcode = 'P0002';
  end if;

  select customer_order.delivery_preference
    into v_order_preference
  from public.dawanear_orders as customer_order
  where customer_order.id = p_order_id;

  if v_order_preference in ('pickup', 'delivery')
     and p_fulfilment_method <> v_order_preference then
    raise exception 'Fulfilment method does not match the customer preference'
      using errcode = '22023';
  end if;

  update public.dawanear_offers as submitted_offer
  set fulfilment_method = p_fulfilment_method,
      updated_at = now()
  where submitted_offer.id = v_offer_id;

  return query select v_offer_id, v_total_rwf, v_complete, v_distance_m;
end;
$$;

revoke all on function public.dawanear_submit_offer(uuid, uuid, jsonb, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_submit_offer(uuid, uuid, jsonb, text, integer, text)
  to authenticated;

drop function if exists public.dawanear_my_confirmed_offers(uuid);
create function public.dawanear_my_confirmed_offers(p_order_id uuid)
returns table (
  offer_id uuid,
  order_id uuid,
  pharmacy_id uuid,
  pharmacy_name text,
  status text,
  complete boolean,
  total_rwf bigint,
  fulfilment_method text,
  distance_m double precision,
  ready_in_minutes integer,
  note text,
  created_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.dawanear_orders as owned_order
    where owned_order.id = p_order_id
      and owned_order.user_id = v_user_id
      and (
        (owned_order.status in ('broadcast', 'offers_received') and owned_order.expires_at > now())
        or (
          owned_order.status in ('selected', 'completed')
          and owned_order.selected_at is not null
          and owned_order.selected_at > now() - interval '24 hours'
        )
      )
  ) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  return query
  select
    offer.id,
    offer.order_id,
    offer.pharmacy_id,
    pharmacy.name,
    offer.status,
    offer.complete,
    offer.total_rwf,
    offer.fulfilment_method,
    offer.distance_m,
    offer.ready_in_minutes,
    offer.note,
    offer.created_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', offer_item.id,
            'order_item_id', offer_item.order_item_id,
            'offered_product_id', offer_item.offered_product_id,
            'available', offer_item.available,
            'is_substitute', offer_item.is_substitute,
            'unit_price_rwf', offer_item.unit_price_rwf,
            'quantity', offer_item.quantity,
            'note', offer_item.note,
            'brand_name', product.brand_name,
            'generic_name', product.generic_name,
            'strength', product.strength,
            'dosage_form', product.dosage_form,
            'pack_size', product.pack_size,
            'prescription_status', product.prescription_status,
            'regulatory_status', product.regulatory_status,
            'is_orderable', product.is_orderable
          )
          order by offer_item.created_at, offer_item.id
        )
        from public.dawanear_offer_items as offer_item
        left join public.dawanear_products as product
          on product.id = offer_item.offered_product_id
        where offer_item.offer_id = offer.id
      ),
      '[]'::jsonb
    )
  from public.dawanear_offers as offer
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = offer.pharmacy_id
  where offer.order_id = p_order_id
    and offer.complete
    and offer.status in ('submitted', 'selected')
    and pharmacy.is_active
    and pharmacy.marketplace_approved
    and pharmacy.geocode_status = 'verified'
    and pharmacy.location is not null
  order by offer.distance_m, offer.total_rwf, offer.submitted_at, offer.id;
end;
$$;

revoke all on function public.dawanear_my_confirmed_offers(uuid)
  from public, anon, authenticated;
grant execute on function public.dawanear_my_confirmed_offers(uuid)
  to authenticated;

-- The connected project already has the aggregate backend contract. Update its
-- function allowlist in-place without copying or weakening the contract body.
do $contract$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.dawanear_backend_contract()')
  ) into v_definition;

  if v_definition is null then
    raise exception 'MED+250 backend contract is missing' using errcode = 'P0002';
  end if;

  v_definition := replace(
    v_definition,
    'public.dawanear_submit_offer(uuid,uuid,jsonb,integer,text)',
    'public.dawanear_submit_offer(uuid,uuid,jsonb,text,integer,text)'
  );
  execute v_definition;
end;
$contract$;

comment on column public.dawanear_offers.fulfilment_method is
  'Pickup, delivery, or either as explicitly confirmed by the responding pharmacy.';
comment on function public.dawanear_submit_offer(uuid, uuid, jsonb, text, integer, text) is
  'Submits one complete pharmacy confirmation with an explicit customer-compatible fulfilment method.';

commit;
