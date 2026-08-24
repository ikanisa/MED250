begin;

-- A pharmacy is automatically marketplace-approved by the import and approval
-- migrations. Dispatch readiness is a separate operational boundary: the
-- pharmacy must still have a current licence, approved GPS evidence and at
-- least one verified WhatsApp number that can authenticate a responder.
create or replace function dawanear_private.dawanear_pharmacy_is_dispatch_eligible(
  p_pharmacy_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.dawanear_pharmacies as pharmacy
    where pharmacy.id = p_pharmacy_id
      and pharmacy.is_active
      and pharmacy.marketplace_approved
      and pharmacy.geocode_status = 'verified'
      and pharmacy.location is not null
      and pharmacy.license_expires_on >= current_date
      and exists (
        select 1
        from public.dawanear_pharmacy_contacts as contact
        where contact.pharmacy_id = pharmacy.id
          and contact.contact_type = 'whatsapp'
          and contact.is_login_enabled
          and contact.verification_status in ('source_verified', 'admin_verified')
      )
  );
$$;

revoke all on function dawanear_private.dawanear_pharmacy_is_dispatch_eligible(uuid)
  from public, anon, authenticated;

comment on function dawanear_private.dawanear_pharmacy_is_dispatch_eligible(uuid) is
  'Central MED+250 order-routing boundary. Marketplace approval is automatic; dispatch additionally requires current licence, approved GPS and a verified login-enabled WhatsApp contact.';

comment on column public.dawanear_pharmacies.online_license_verified is
  'Informational source-register attribute only. It is not a MED+250 marketplace approval, routing, response or fulfilment gate.';

-- Replace the obsolete online-premises predicate in every live routing and
-- fulfilment function. Rebuilding from pg_get_functiondef preserves the
-- current function signatures, grants and later hotfixes without copying old
-- business logic into another migration.
do $rewrite_dispatch_functions$
declare
  v_signature text;
  v_procedure regprocedure;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'dawanear_private.dawanear_public_pharmacy_directory()',
    'dawanear_private.dawanear_selected_pharmacy_can_read(text)',
    'dawanear_private.dawanear_submit_offer(uuid,uuid,jsonb,integer,text)',
    'public.dawanear_create_order(double precision,double precision,jsonb,uuid,numeric,text,text,boolean,text)',
    'public.dawanear_my_active_orders()',
    'public.dawanear_operational_health()',
    'public.dawanear_pharmacy_requests(uuid)',
    'public.dawanear_pharmacy_selected_orders(uuid)',
    'public.dawanear_select_offer(uuid,uuid)',
    'public.dawanear_selected_contact(uuid)'
  ] loop
    v_procedure := pg_catalog.to_regprocedure(v_signature);
    if v_procedure is null then
      raise exception 'Required MED+250 function is missing: %', v_signature
        using errcode = 'P0002';
    end if;

    select pg_catalog.pg_get_functiondef(v_procedure::oid)
      into v_definition;

    v_rewritten := replace(
      replace(
        replace(
          v_definition,
          'and p.online_license_verified',
          'and dawanear_private.dawanear_pharmacy_is_dispatch_eligible(p.id)'
        ),
        'and pharmacy.online_license_verified',
        'and dawanear_private.dawanear_pharmacy_is_dispatch_eligible(pharmacy.id)'
      ),
      'and count_pharmacy.online_license_verified',
      'and dawanear_private.dawanear_pharmacy_is_dispatch_eligible(count_pharmacy.id)'
    );

    if v_rewritten = v_definition then
      raise exception 'Obsolete eligibility predicate was not found in %', v_signature
        using errcode = 'P0002';
    end if;

    execute v_rewritten;
  end loop;
end;
$rewrite_dispatch_functions$;

-- The product-first confirmation function was introduced after the original
-- marketplace functions and already omitted the online-premises flag. Bring
-- it under the same complete dispatch invariant explicitly.
do $rewrite_customer_confirmations$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure(
    'public.dawanear_my_confirmed_offers(uuid)'
  );
  v_definition text;
  v_rewritten text;
begin
  if v_procedure is null then
    raise exception 'MED+250 customer confirmation function is missing'
      using errcode = 'P0002';
  end if;

  select pg_catalog.pg_get_functiondef(v_procedure::oid)
    into v_definition;

  v_rewritten := replace(
    v_definition,
    'and pharmacy.location is not null',
    'and pharmacy.location is not null
    and dawanear_private.dawanear_pharmacy_is_dispatch_eligible(pharmacy.id)'
  );

  if v_rewritten = v_definition then
    raise exception 'Customer confirmation eligibility predicate was not found'
      using errcode = 'P0002';
  end if;

  execute v_rewritten;
end;
$rewrite_customer_confirmations$;

commit;
-- Filename aligned with the migration version recorded by the production project.
