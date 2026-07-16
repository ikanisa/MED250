begin;

-- Contract v7 delegates the privileged-function allowlist to the preserved v4
-- implementation, so update that durable definition after the RPC signature
-- change. Accept an already-updated fresh install, but fail closed on an
-- unknown contract shape.
do $contract$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('dawanear_private.dawanear_backend_contract_v4()')
  ) into v_definition;

  if v_definition is null then
    raise exception 'MED+250 backend contract v4 is missing' using errcode = 'P0002';
  end if;

  if position(
    'public.dawanear_submit_offer(uuid,uuid,jsonb,integer,text)' in v_definition
  ) > 0 then
    v_definition := replace(
      v_definition,
      'public.dawanear_submit_offer(uuid,uuid,jsonb,integer,text)',
      'public.dawanear_submit_offer(uuid,uuid,jsonb,text,integer,text)'
    );
    execute v_definition;
  elsif position(
    'public.dawanear_submit_offer(uuid,uuid,jsonb,text,integer,text)' in v_definition
  ) = 0 then
    raise exception 'MED+250 backend contract submit-offer allowlist is unrecognized'
      using errcode = 'P0002';
  end if;
end;
$contract$;

commit;
-- Filename aligned with the migration version recorded by the production project.
