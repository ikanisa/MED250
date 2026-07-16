begin;

alter table public.dawanear_pharmacy_contacts
  add column if not exists verified_by_label text,
  add column if not exists verification_note text;

alter table public.dawanear_pharmacy_contact_edit_requests
  add column if not exists reviewed_by_label text,
  add column if not exists review_note text;

alter table public.dawanear_pharmacy_contacts
  drop constraint if exists dawanear_pharmacy_contacts_admin_evidence_ck,
  add constraint dawanear_pharmacy_contacts_admin_evidence_ck check (
    verification_status <> 'admin_verified'
    or (
      verified_at is not null
      and verified_by_label is not null
      and char_length(btrim(verified_by_label)) between 3 and 200
      and verification_note is not null
      and char_length(btrim(verification_note)) between 10 and 2000
    )
  );

alter table public.dawanear_pharmacy_contact_edit_requests
  drop constraint if exists dawanear_pharmacy_contact_edit_update_target_ck,
  add constraint dawanear_pharmacy_contact_edit_update_target_ck check (
    requested_action <> 'update' or contact_id is not null
  ),
  drop constraint if exists dawanear_pharmacy_contact_edit_review_evidence_ck,
  add constraint dawanear_pharmacy_contact_edit_review_evidence_ck check (
    status not in ('approved', 'rejected')
    or (
      reviewed_at is not null
      and reviewed_by_label is not null
      and char_length(btrim(reviewed_by_label)) between 3 and 200
      and review_note is not null
      and char_length(btrim(review_note)) between 10 and 2000
    )
  );

create or replace function public.dawanear_review_pharmacy_contact_edit(
  p_request_id uuid,
  p_decision text,
  p_reviewed_by_label text,
  p_review_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.dawanear_pharmacy_contact_edit_requests%rowtype;
  v_contact_id uuid;
  v_phone_contact_id uuid;
  v_is_primary boolean;
begin
  if p_request_id is null
     or p_decision not in ('approve', 'reject')
     or char_length(btrim(coalesce(p_reviewed_by_label, ''))) not between 3 and 200
     or char_length(btrim(coalesce(p_review_note, ''))) not between 10 and 2000 then
    raise exception 'A request, approve/reject decision, reviewer identity and 10-2000 character evidence note are required'
      using errcode = '22023';
  end if;

  select request.*
  into v_request
  from public.dawanear_pharmacy_contact_edit_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Contact edit request was not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Contact edit request has already been reviewed' using errcode = '55000';
  end if;

  if p_decision = 'reject' then
    update public.dawanear_pharmacy_contact_edit_requests
    set status = 'rejected',
        reviewed_at = now(),
        reviewed_by_label = btrim(p_reviewed_by_label),
        review_note = btrim(p_review_note)
    where id = v_request.id;
    return jsonb_build_object('request_id', v_request.id, 'status', 'rejected');
  end if;

  if v_request.requested_action = 'remove' then
    update public.dawanear_pharmacy_contacts
    set verification_status = 'stale',
        is_login_enabled = false,
        is_primary = false,
        verified_at = now(),
        verified_by_label = btrim(p_reviewed_by_label),
        verification_note = btrim(p_review_note)
    where id = v_request.contact_id
      and pharmacy_id = v_request.pharmacy_id
    returning id into v_contact_id;
    if v_contact_id is null then
      raise exception 'Requested contact no longer belongs to this pharmacy' using errcode = '55000';
    end if;
  else
    if v_request.requested_action = 'update' then
      select contact.is_primary
      into v_is_primary
      from public.dawanear_pharmacy_contacts as contact
      where contact.id = v_request.contact_id
        and contact.pharmacy_id = v_request.pharmacy_id
        and contact.contact_type = v_request.requested_contact_type
      for update;
      if not found then
        raise exception 'Requested contact no longer belongs to this pharmacy' using errcode = '55000';
      end if;
      update public.dawanear_pharmacy_contacts
      set verification_status = 'stale', is_login_enabled = false, is_primary = false
      where id = v_request.contact_id;
    else
      select not exists (
        select 1
        from public.dawanear_pharmacy_contacts as contact
        where contact.pharmacy_id = v_request.pharmacy_id
          and contact.contact_type = v_request.requested_contact_type
          and contact.is_primary
          and contact.verification_status not in ('rejected', 'stale')
      ) into v_is_primary;
    end if;

    insert into public.dawanear_pharmacy_contacts (
      pharmacy_id, contact_type, e164, display_number, is_primary,
      is_login_enabled, verification_status, source_type, source_name,
      source_reference, source_observed_at, verified_at,
      verified_by_label, verification_note, derived_from_contact_id
    ) values (
      v_request.pharmacy_id, v_request.requested_contact_type, v_request.requested_e164,
      '+' || v_request.requested_e164, coalesce(v_is_primary, false),
      v_request.requested_contact_type = 'whatsapp', 'admin_verified',
      'pharmacy_submission', 'MED+250 pharmacy contact correction',
      v_request.id::text, now(), now(), btrim(p_reviewed_by_label),
      btrim(p_review_note), case when v_request.requested_action = 'update' then v_request.contact_id else null end
    )
    on conflict (pharmacy_id, contact_type, e164) do update
    set display_number = excluded.display_number,
        is_primary = excluded.is_primary,
        is_login_enabled = excluded.is_login_enabled,
        verification_status = excluded.verification_status,
        source_type = excluded.source_type,
        source_name = excluded.source_name,
        source_reference = excluded.source_reference,
        source_observed_at = excluded.source_observed_at,
        verified_at = excluded.verified_at,
        verified_by_label = excluded.verified_by_label,
        verification_note = excluded.verification_note
    returning id into v_contact_id;

    if v_request.requested_contact_type = 'whatsapp' then
      insert into public.dawanear_pharmacy_contacts (
        pharmacy_id, contact_type, e164, display_number, is_primary,
        is_login_enabled, verification_status, source_type, source_name,
        source_reference, source_observed_at, verified_at,
        verified_by_label, verification_note, derived_from_contact_id
      ) values (
        v_request.pharmacy_id, 'phone', v_request.requested_e164,
        '+' || v_request.requested_e164,
        not exists (
          select 1 from public.dawanear_pharmacy_contacts as existing_phone
          where existing_phone.pharmacy_id = v_request.pharmacy_id
            and existing_phone.contact_type = 'phone'
            and existing_phone.is_primary
            and existing_phone.verification_status not in ('rejected', 'stale')
        ),
        false, 'admin_verified', 'pharmacy_submission',
        'MED+250 approved WhatsApp mirrored as phone', v_request.id::text,
        now(), now(), btrim(p_reviewed_by_label), btrim(p_review_note), v_contact_id
      )
      on conflict (pharmacy_id, contact_type, e164) do update
      set is_primary = excluded.is_primary,
          verification_status = excluded.verification_status,
          source_type = excluded.source_type,
          source_name = excluded.source_name,
          source_reference = excluded.source_reference,
          source_observed_at = excluded.source_observed_at,
          verified_at = excluded.verified_at,
          verified_by_label = excluded.verified_by_label,
          verification_note = excluded.verification_note,
          derived_from_contact_id = excluded.derived_from_contact_id
      returning id into v_phone_contact_id;
    end if;
  end if;

  update public.dawanear_pharmacy_contact_edit_requests
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by_label = btrim(p_reviewed_by_label),
      review_note = btrim(p_review_note)
  where id = v_request.id;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', 'approved',
    'contact_id', v_contact_id,
    'mirrored_phone_contact_id', v_phone_contact_id
  );
end;
$$;

revoke all on function public.dawanear_review_pharmacy_contact_edit(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_review_pharmacy_contact_edit(uuid, text, text, text)
  to service_role;

comment on function public.dawanear_review_pharmacy_contact_edit(uuid, text, text, text) is
  'Service-only atomic approval or rejection of one pharmacy contact edit request with durable operator evidence.';

-- Preserve the complete v5 contract privately and extend it with contact-review
-- evidence plus the new service-only review function.
alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v5;
revoke all on function dawanear_private.dawanear_backend_contract_v5()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select dawanear_private.dawanear_backend_contract_v5() as contract
  ), contact_governance as (
    select
      pg_catalog.to_regprocedure(
        'public.dawanear_review_pharmacy_contact_edit(uuid,text,text,text)'
      ) is not null as review_function_exists,
      pg_catalog.has_function_privilege(
        'service_role',
        'public.dawanear_review_pharmacy_contact_edit(uuid,text,text,text)',
        'execute'
      ) as service_role_can_review,
      pg_catalog.has_function_privilege(
        'anon',
        'public.dawanear_review_pharmacy_contact_edit(uuid,text,text,text)',
        'execute'
      ) as anon_can_review,
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.dawanear_review_pharmacy_contact_edit(uuid,text,text,text)',
        'execute'
      ) as authenticated_can_review,
      (
        select count(*) from public.dawanear_pharmacy_contact_edit_requests as request
        where request.status in ('approved', 'rejected')
          and (
            request.reviewed_at is null
            or request.reviewed_by_label is null
            or request.review_note is null
          )
      ) as reviewed_without_evidence_count,
      (
        select count(*) from public.dawanear_pharmacy_contacts as contact
        where contact.verification_status = 'admin_verified'
          and (
            contact.verified_at is null
            or contact.verified_by_label is null
            or contact.verification_note is null
          )
      ) as admin_verified_without_evidence_count
  )
  select jsonb_set(
      base.contract,
      '{api_surface,expected_function_count}',
      '23'::jsonb,
      true
    ) || jsonb_build_object(
      'contract_version', '2026-07-13.6',
      'contact_governance', jsonb_build_object(
        'review_function_exists', contact_governance.review_function_exists,
        'service_role_can_review', contact_governance.service_role_can_review,
        'anon_can_review', contact_governance.anon_can_review,
        'authenticated_can_review', contact_governance.authenticated_can_review,
        'reviewed_without_evidence_count', contact_governance.reviewed_without_evidence_count,
        'admin_verified_without_evidence_count', contact_governance.admin_verified_without_evidence_count
      )
    )
  from base cross join contact_governance;
$$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 aggregate deployment contract including API, table, GPS-review and contact-review governance.';

commit;
