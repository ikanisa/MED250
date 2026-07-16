begin;

-- Customer contact numbers may be international. Pharmacy identity and OTP
-- contacts remain Rwanda-only and retain their stricter +250 validation.
alter table public.dawanear_customer_profiles
  drop constraint if exists dawanear_customer_profiles_whatsapp_check;
alter table public.dawanear_customer_profiles
  add constraint dawanear_customer_profiles_whatsapp_check
  check (whatsapp is null or whatsapp ~ '^[1-9][0-9]{7,14}$');

alter table public.dawanear_orders
  drop constraint if exists dawanear_orders_whatsapp_check;
alter table public.dawanear_orders
  add constraint dawanear_orders_whatsapp_check
  check (whatsapp is null or whatsapp ~ '^[1-9][0-9]{7,14}$');

-- Preserve the deployed, security-definer order implementation byte-for-byte
-- except for its customer WhatsApp validation. Fail closed if the expected
-- guarded implementation is not present instead of replacing an unknown body.
do $migration$
declare
  function_signature constant text :=
    'public.dawanear_create_order(double precision,double precision,jsonb,uuid,numeric,text,text,boolean,text)';
  function_oid regprocedure;
  function_definition text;
begin
  function_oid := to_regprocedure(function_signature);
  if function_oid is null then
    raise exception 'Required order function is missing: %', function_signature;
  end if;

  select pg_get_functiondef(function_oid::oid)
    into function_definition;

  if position('^2507[2389][0-9]{7}$' in function_definition) > 0
     and position('Invalid Rwanda WhatsApp number' in function_definition) > 0 then
    function_definition := replace(
      function_definition,
      '^2507[2389][0-9]{7}$',
      '^[1-9][0-9]{7,14}$'
    );
    function_definition := replace(
      function_definition,
      'Invalid Rwanda WhatsApp number',
      'Invalid international WhatsApp number'
    );
    execute function_definition;
  elsif position('^[1-9][0-9]{7,14}$' in function_definition) = 0
     or position('Invalid international WhatsApp number' in function_definition) = 0 then
    raise exception 'Order function WhatsApp validation does not match the expected guarded version';
  end if;
end;
$migration$;

commit;
-- Filename aligned with the migration version recorded by the production project.
