-- The customer experience is product-first. Pharmacies become visible only
-- through complete confirmations returned by dawanear_my_confirmed_offers.
revoke all on table public.dawanear_pharmacy_directory
  from public, anon, authenticated;

grant select on table public.dawanear_pharmacy_directory to service_role;

comment on view public.dawanear_pharmacy_directory is
  'Internal registry view. Never expose as a public vendor directory; customers see only pharmacies that confirm their order.';
-- Filename aligned with the migration version recorded by the production project.
