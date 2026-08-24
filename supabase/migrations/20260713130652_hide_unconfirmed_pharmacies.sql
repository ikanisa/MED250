-- Customers may inspect only pharmacies that confirmed the complete order.
-- Routing recipients remain an internal dispatch detail.

drop policy if exists dawanear_pharmacies_no_public_select on public.dawanear_pharmacies;
create policy dawanear_pharmacies_no_public_select
on public.dawanear_pharmacies for select to anon, authenticated
using (false);

drop policy if exists dawanear_recipients_owner_select on public.dawanear_order_recipients;
revoke select on table public.dawanear_order_recipients from anon, authenticated;

drop policy if exists dawanear_offers_participant_select on public.dawanear_offers;
create policy dawanear_offers_participant_select
on public.dawanear_offers for select to authenticated
using (
  (
    complete
    and status in ('submitted', 'selected')
    and exists (
      select 1
      from public.dawanear_orders as customer_order
      where customer_order.id = order_id
        and customer_order.user_id = (select auth.uid())
    )
  )
  or (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    and exists (
      select 1
      from public.dawanear_pharmacy_memberships as membership
      where membership.pharmacy_id = dawanear_offers.pharmacy_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  )
);

comment on policy dawanear_offers_participant_select on public.dawanear_offers is
  'Customers can read complete confirmations only; pharmacy staff can read their own response.';
-- Filename aligned with the migration version recorded by the production project.
