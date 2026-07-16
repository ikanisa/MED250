begin;

create or replace function public.dawanear_my_pharmacy_contacts(p_pharmacy_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    raise exception 'A permanent pharmacy account is required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.dawanear_pharmacy_memberships as membership
    where membership.user_id = v_user_id
      and membership.pharmacy_id = p_pharmacy_id
      and membership.status = 'active'
  ) then
    raise exception 'Active pharmacy membership is required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', contact.id,
        'contact_type', contact.contact_type,
        'e164', contact.e164,
        'display_number', coalesce(contact.display_number, '+' || contact.e164),
        'is_primary', contact.is_primary,
        'is_login_enabled', contact.is_login_enabled,
        'verification_status', contact.verification_status
      ) order by contact.contact_type, contact.is_primary desc, contact.created_at, contact.e164)
      from public.dawanear_pharmacy_contacts as contact
      where contact.pharmacy_id = p_pharmacy_id
        and contact.verification_status not in ('rejected', 'stale')
    ), '[]'::jsonb),
    'pending_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'contact_id', request.contact_id,
        'requested_action', request.requested_action,
        'requested_contact_type', request.requested_contact_type,
        'requested_e164', request.requested_e164,
        'note', request.note,
        'created_at', request.created_at
      ) order by request.created_at desc)
      from public.dawanear_pharmacy_contact_edit_requests as request
      where request.pharmacy_id = p_pharmacy_id
        and request.status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.dawanear_my_pharmacy_contacts(uuid)
  from public, anon, authenticated;
grant execute on function public.dawanear_my_pharmacy_contacts(uuid)
  to authenticated;

comment on function public.dawanear_my_pharmacy_contacts(uuid) is
  'Returns private contacts and pending contact edits only to permanent active members of the requested pharmacy.';

alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v6;
revoke all on function dawanear_private.dawanear_backend_contract_v6()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select dawanear_private.dawanear_backend_contract_v6() as contract
  ), member_contacts as (
    select
      function.oid is not null as function_exists,
      coalesce(function.prosecdef, false) as security_definer,
      coalesce(function.proconfig, '{}'::text[]) @> array['search_path=""'] as search_path_locked,
      pg_catalog.has_function_privilege(
        'authenticated', 'public.dawanear_my_pharmacy_contacts(uuid)', 'execute'
      ) as authenticated_can_execute,
      pg_catalog.has_function_privilege(
        'anon', 'public.dawanear_my_pharmacy_contacts(uuid)', 'execute'
      ) as anon_can_execute
    from (values (pg_catalog.to_regprocedure('public.dawanear_my_pharmacy_contacts(uuid)'))) as resolved(oid)
    left join pg_catalog.pg_proc as function on function.oid = resolved.oid
  )
  select jsonb_set(
      jsonb_set(
        jsonb_set(
          base.contract,
          '{api_surface,expected_function_count}',
          '24'::jsonb,
          true
        ),
        '{api_surface,expected_authenticated_security_definer_count}',
        '13'::jsonb,
        true
      ),
      '{api_surface,unexpected_authenticated_security_definer_count}',
      to_jsonb(greatest(
        coalesce((base.contract #>> '{api_surface,unexpected_authenticated_security_definer_count}')::integer, 0)
        - case
            when member_contacts.function_exists
              and member_contacts.security_definer
              and member_contacts.search_path_locked
              and member_contacts.authenticated_can_execute
              and not member_contacts.anon_can_execute
            then 1
            else 0
          end,
        0
      )),
      true
    ) || jsonb_build_object(
      'contract_version', '2026-07-13.7',
      'member_contacts', jsonb_build_object(
        'function_exists', member_contacts.function_exists,
        'security_definer', member_contacts.security_definer,
        'search_path_locked', member_contacts.search_path_locked,
        'authenticated_can_execute', member_contacts.authenticated_can_execute,
        'anon_can_execute', member_contacts.anon_can_execute
      )
    )
  from base cross join member_contacts;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 aggregate deployment contract including member-owned contact access and administrative review governance.';

commit;
