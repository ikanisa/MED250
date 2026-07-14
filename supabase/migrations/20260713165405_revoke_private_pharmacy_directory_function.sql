begin;

-- MED+250 is product-first. Customers must discover pharmacies only after
-- those pharmacies confirm a specific order, so even the former internal
-- directory helper must not remain executable by browser roles.
revoke execute on function dawanear_private.dawanear_public_pharmacy_directory()
  from public, anon, authenticated;

grant execute on function dawanear_private.dawanear_public_pharmacy_directory()
  to service_role;

commit;
