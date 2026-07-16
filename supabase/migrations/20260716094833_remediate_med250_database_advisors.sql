-- Remove legacy catalogue exposure that is no longer part of the centralized
-- indicative-price model, and retain one copy of an identical order index.

drop policy if exists dawanear_prices_current_select
on public.dawanear_pharmacy_prices;

revoke select on table public.dawanear_pharmacy_prices
from anon, authenticated;

drop index if exists public.dawanear_orders_user_fk_idx;
