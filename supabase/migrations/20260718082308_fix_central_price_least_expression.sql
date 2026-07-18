begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.dawanear_contribute_central_price(uuid,text,integer)'::regprocedure
  ) into strict v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    'pg_catalog.least(v_previous, p_price_rwf)',
    'least(v_previous, p_price_rwf)'
  );
  execute v_definition;
end;
$$;

commit;
