begin;

-- The function returns an OUT column named product_id. A bare conflict target
-- using the same identifier is ambiguous in PL/pgSQL, so use the table's named
-- unique constraint exactly as the order-notification lifecycle functions do.
do $repair_price_conflict$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.dawanear_contribute_price(uuid,text,integer)'
  );
  v_definition text;
  v_ambiguous constant text := 'on conflict (pharmacy_id, product_id)';
  v_explicit constant text :=
    'on conflict on constraint dawanear_pharmacy_prices_pharmacy_id_product_id_key';
begin
  if v_signature is null then
    raise exception 'MED+250 price contribution function is missing'
      using errcode = 'P0002';
  end if;

  select pg_catalog.pg_get_functiondef(v_signature::oid)
    into v_definition;

  if position(v_ambiguous in lower(v_definition)) > 0 then
    v_definition := replace(v_definition, v_ambiguous, v_explicit);
    execute v_definition;
  elsif position(v_explicit in lower(v_definition)) = 0 then
    raise exception 'Unexpected MED+250 price contribution function definition'
      using errcode = 'P0002';
  end if;
end;
$repair_price_conflict$;

revoke all on function public.dawanear_contribute_price(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.dawanear_contribute_price(uuid, text, integer)
  to authenticated;

comment on function public.dawanear_contribute_price(uuid, text, integer) is
  'Contributes one pharmacy price and atomically enforces max minus min not exceeding min.';

commit;
