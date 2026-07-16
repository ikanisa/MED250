begin;

-- The Rwanda FDA register proves that all 769 imported pharmacies are active,
-- marketplace-approved and currently licensed. Premises-level GPS evidence is
-- still incomplete, so use the verified pharmacy login channel as the
-- operational dispatch boundary and fall back to a national responder pool.
-- This never invents coordinates or contact details: only pharmacies with a
-- source/admin-verified, login-enabled WhatsApp contact can receive an order.
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
  'MED+250 operational routing boundary: active/current marketplace pharmacy with a verified login-enabled WhatsApp responder. GPS improves proximity ranking but is not required for national fallback dispatch.';

-- Remove the obsolete hard GPS/online-premises predicates from authenticated
-- pharmacy and customer flows. The central helper remains the single boundary.
do $rewrite_operational_flows$
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
    'dawanear_private.dawanear_my_active_orders_pre_security_v1()',
    'public.dawanear_my_confirmed_offers(uuid)',
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

    select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
    v_rewritten := v_definition;

    -- A later hardening migration restored the old selected-contact flag.
    v_rewritten := replace(
      v_rewritten,
      'and pharmacy.online_license_verified',
      'and dawanear_private.dawanear_pharmacy_is_dispatch_eligible(pharmacy.id)'
    );

    -- The helper already checks active status, marketplace approval, current
    -- licence and a verified responder. Remove only redundant location gates.
    v_rewritten := replace(v_rewritten, E'      and p.geocode_status = ''verified''\n', '');
    v_rewritten := replace(v_rewritten, E'      and p.location is not null\n', '');
    v_rewritten := replace(v_rewritten, E'      and p.license_expires_on >= current_date\n', '');
    v_rewritten := replace(v_rewritten, E'    and pharmacy.geocode_status = ''verified''\n', '');
    v_rewritten := replace(v_rewritten, E'    and pharmacy.location is not null\n', '');
    v_rewritten := replace(v_rewritten, E'    and pharmacy.license_expires_on >= current_date\n', '');

    if v_rewritten = v_definition then
      raise exception 'No operational eligibility predicate was updated in %', v_signature
        using errcode = 'P0002';
    end if;
    execute v_rewritten;
  end loop;
end;
$rewrite_operational_flows$;

-- Prefer verified pharmacies with an approved nearby point. When none exist,
-- dispatch to a stable, evenly distributed national set of verified responders.
-- distance_m = -1 explicitly means that proximity has not been verified; the
-- UI presents this as national service coverage, never as a fabricated distance.
do $rewrite_order_routing$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure(
    'public.dawanear_create_order(double precision,double precision,jsonb,uuid,numeric,text,text,boolean,text)'
  );
  v_definition text;
  v_rewritten text;
  v_replacement text := $routing$
  insert into public.dawanear_order_recipients (order_id, pharmacy_id, distance_m)
  select
    v_order_id,
    pharmacy.id,
    case
      when pharmacy.location is not null
        then extensions.st_distance(pharmacy.location, v_location)
      else -1.0
    end
  from public.dawanear_pharmacies as pharmacy
  where dawanear_private.dawanear_pharmacy_is_dispatch_eligible(pharmacy.id)
  order by
    case
      when pharmacy.location is not null
        and extensions.st_dwithin(pharmacy.location, v_location, 10000)
      then 0
      else 1
    end,
    case
      when pharmacy.location is not null
        then extensions.st_distance(pharmacy.location, v_location)
      else null
    end nulls last,
    md5(v_order_id::text || ':' || pharmacy.id::text),
    pharmacy.id
  limit 20;

  get diagnostics v_recipient_count = row_count;
$routing$;
begin
  if v_procedure is null then
    raise exception 'MED+250 order function is missing' using errcode = 'P0002';
  end if;

  select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
  v_rewritten := pg_catalog.regexp_replace(
    v_definition,
    E'  insert into public\\.dawanear_order_recipients[\\s\\S]*?  get diagnostics v_recipient_count = row_count;',
    v_replacement
  );

  if v_rewritten = v_definition then
    raise exception 'MED+250 order recipient routing block was not replaced'
      using errcode = 'P0002';
  end if;
  execute v_rewritten;
end;
$rewrite_order_routing$;

-- Keep GPS readiness as an independent quality metric while making dispatch
-- readiness reflect the operational verified-responder pool.
do $rewrite_health_dispatch$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure('public.dawanear_operational_health()');
  v_definition text;
  v_rewritten text;
begin
  if v_procedure is null then
    raise exception 'MED+250 operational health function is missing' using errcode = 'P0002';
  end if;
  select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'          and dawanear_private.dawanear_pharmacy_is_dispatch_eligible(p.id)\n          and p.geocode_status = ''verified''\n          and p.location is not null\n          and p.license_expires_on >= current_date',
    E'          and dawanear_private.dawanear_pharmacy_is_dispatch_eligible(p.id)'
  );
  if v_rewritten = v_definition then
    raise exception 'Operational dispatch-ready metric was not updated' using errcode = 'P0002';
  end if;
  execute v_rewritten;
end;
$rewrite_health_dispatch$;

commit;
-- Filename aligned with the migration version recorded by the production project.
