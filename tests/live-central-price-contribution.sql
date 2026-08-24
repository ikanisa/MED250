begin;

do $$
declare
  v_user_id uuid;
  v_pharmacy_id uuid;
  v_product_id text;
  v_existing integer;
  v_audit_before bigint;
  v_audit_after bigint;
  v_not_lower record;
  v_lowered record;
  v_public_price integer;
begin
  select membership.user_id, membership.pharmacy_id
    into strict v_user_id, v_pharmacy_id
  from public.dawanear_pharmacy_memberships as membership
  join public.dawanear_pharmacies as pharmacy
    on pharmacy.id = membership.pharmacy_id
  where pharmacy.registry_entry_key = 'dev-test-whatsapp-250788767816'
    and membership.status = 'active'
  limit 1;

  select product.id, product.indicative_price_rwf
    into strict v_product_id, v_existing
  from public.dawanear_products as product
  where product.is_active
    and product.indicative_price_rwf > 1
  order by product.id
  limit 1;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);

  select count(*) into v_audit_before
  from public.dawanear_central_price_contributions;

  select * into strict v_not_lower
  from public.dawanear_contribute_central_price(
    v_pharmacy_id,
    v_product_id,
    v_existing + 100
  );

  if v_not_lower.contribution_status <> 'not_lower'
    or v_not_lower.became_lowest
    or v_not_lower.central_price_rwf <> v_existing then
    raise exception 'A higher contribution changed the central price: %',
      pg_catalog.row_to_json(v_not_lower);
  end if;

  select * into strict v_lowered
  from public.dawanear_contribute_central_price(
    v_pharmacy_id,
    v_product_id,
    v_existing - 1
  );

  if v_lowered.contribution_status <> 'lowered'
    or not v_lowered.became_lowest
    or v_lowered.central_price_rwf <> v_existing - 1 then
    raise exception 'A lower contribution did not lower the central price: %',
      pg_catalog.row_to_json(v_lowered);
  end if;

  select count(*) into v_audit_after
  from public.dawanear_central_price_contributions;
  if v_audit_after <> v_audit_before + 2 then
    raise exception 'Expected both contributions to be recorded';
  end if;

  select catalogue.indicative_price_rwf into strict v_public_price
  from public.dawanear_all_product_catalog as catalogue
  where catalogue.id = v_product_id;
  if v_public_price <> v_existing - 1 then
    raise exception 'Public catalogue did not expose the new central lowest price';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.dawanear_central_price_contributions', 'select')
    or pg_catalog.has_table_privilege('authenticated', 'public.dawanear_central_price_contributions', 'select') then
    raise exception 'Private contribution audit is publicly readable';
  end if;
end;
$$;

rollback;
