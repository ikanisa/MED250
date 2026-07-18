begin;

-- The deployed project protects product-image governance with a database-wide
-- DDL event trigger. This transaction does not modify that subsystem, so use
-- its documented transaction-local override while these unrelated constraints
-- and functions are replaced.
set local med250.allow_product_image_governance_ddl = 'on';

-- Pharmacy staff and pharmacy contact numbers may be international. Keep the
-- canonical representation as E.164 digits without a leading plus sign.
alter table public.dawanear_pharmacy_otp_challenges
  drop constraint if exists dawanear_pharmacy_otp_challenges_phone_check;
alter table public.dawanear_pharmacy_otp_challenges
  add constraint dawanear_pharmacy_otp_challenges_phone_check
  check (phone ~ '^[1-9][0-9]{7,14}$');

alter table public.dawanear_pharmacy_identities
  drop constraint if exists dawanear_pharmacy_identities_phone_check;
alter table public.dawanear_pharmacy_identities
  add constraint dawanear_pharmacy_identities_phone_check
  check (phone ~ '^[1-9][0-9]{7,14}$');

alter table public.dawanear_pharmacy_contacts
  drop constraint if exists dawanear_pharmacy_contacts_e164_check;
alter table public.dawanear_pharmacy_contacts
  add constraint dawanear_pharmacy_contacts_e164_check
  check (e164 ~ '^[1-9][0-9]{7,14}$');

alter table public.dawanear_pharmacy_contact_edit_requests
  drop constraint if exists dawanear_pharmacy_contact_edit_requests_requested_e164_check;
alter table public.dawanear_pharmacy_contact_edit_requests
  add constraint dawanear_pharmacy_contact_edit_requests_requested_e164_check
  check (requested_e164 is null or requested_e164 ~ '^[1-9][0-9]{7,14}$');

-- Preserve the deployed, security-definer implementations and change only
-- their phone-number validation. Fail closed if an unexpected definition is
-- present instead of replacing unknown privileged code.
do $migration$
declare
  function_signatures constant text[] := array[
    'public.dawanear_issue_pharmacy_otp(text,text,text,timestamptz)',
    'public.dawanear_consume_pharmacy_otp(uuid,text,text)',
    'public.dawanear_request_pharmacy_contact_edit(uuid,text,text,uuid,text,text)'
  ];
  function_signature text;
  function_oid regprocedure;
  function_definition text;
begin
  foreach function_signature in array function_signatures loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is null then
      raise exception 'Required pharmacy phone function is missing: %', function_signature;
    end if;

    select pg_get_functiondef(function_oid::oid)
      into function_definition;

    if position('^2507[2389][0-9]{7}$' in function_definition) > 0 then
      function_definition := replace(
        function_definition,
        '^2507[2389][0-9]{7}$',
        '^[1-9][0-9]{7,14}$'
      );
      function_definition := replace(
        function_definition,
        'Enter a valid Rwanda mobile number',
        'Enter a valid international mobile number'
      );
      execute function_definition;
    elsif position('^[1-9][0-9]{7,14}$' in function_definition) = 0 then
      raise exception 'Pharmacy phone validation does not match the expected guarded version: %', function_signature;
    end if;
  end loop;
end;
$migration$;

commit;
