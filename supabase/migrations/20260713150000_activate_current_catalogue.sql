-- Activate products that remain current in the imported Rwanda FDA source.
-- Inactive or non-current records stay blocked from customer orders.

update public.dawanear_products
set is_orderable = true,
    updated_at = now()
where is_active
  and regulatory_status in ('valid', 'grace_period', 'expiring_soon')
  and not is_orderable;

update public.dawanear_products
set is_orderable = false,
    updated_at = now()
where is_orderable
  and (
    not is_active
    or regulatory_status not in ('valid', 'grace_period', 'expiring_soon')
  );
