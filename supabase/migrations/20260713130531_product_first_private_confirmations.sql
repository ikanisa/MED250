-- MED+250 is product-first: customers discover pharmacies only after a pharmacy
-- confirms the complete order. The pharmacy directory is not a public surface.

drop policy if exists dawanear_pharmacies_directory_select on public.dawanear_pharmacies;
revoke select on table public.dawanear_pharmacies from anon, authenticated;

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

comment on function public.dawanear_my_confirmed_offers(uuid) is
  'Returns complete confirmations for one customer-owned order without exposing a public pharmacy directory or pre-selection contact details.';
-- Filename aligned with the migration version recorded by the production project.
