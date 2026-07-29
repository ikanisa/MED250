begin;

-- The database-wide product-image DDL guard remains enabled. This reviewed
-- migration changes only execution planning for existing contract functions.
set local med250.allow_product_image_governance_ddl = 'on';

-- Each contract layer extends its predecessor. PostgreSQL may inline an
-- unmaterialized CTE and reevaluate the predecessor for every JSON reference,
-- multiplying full-catalogue scans across the wrapper chain. Preserve the
-- deployed definitions and privileges, changing only the base CTE boundary.
do $migration$
declare
  contract_functions constant regprocedure[] := array[
    'dawanear_private.dawanear_backend_contract_v20()'::regprocedure,
    'dawanear_private.dawanear_backend_contract_v21()'::regprocedure,
    'dawanear_private.dawanear_backend_contract_v22()'::regprocedure,
    'public.dawanear_backend_contract()'::regprocedure
  ];
  contract_function regprocedure;
  definition text;
begin
  foreach contract_function in array contract_functions loop
    definition := pg_catalog.pg_get_functiondef(contract_function);
    if position('with base as materialized (' in lower(definition)) > 0 then
      continue;
    end if;
    if position('with base as (' in lower(definition)) = 0 then
      raise exception 'Expected one unmaterialized base CTE in %', contract_function
        using errcode = '55000';
    end if;
    definition := pg_catalog.regexp_replace(
      definition,
      'with base as \(',
      'WITH base AS MATERIALIZED (',
      'i'
    );
    execute definition;
  end loop;
end;
$migration$;

commit;
