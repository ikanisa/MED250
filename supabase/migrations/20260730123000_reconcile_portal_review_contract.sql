begin;

-- The portal-authority migration replaced auth.users reviewer UUIDs with
-- durable named-review evidence. Keep the service-only deployment contract
-- aligned with that enforced constraint so valid owner-authorized contacts do
-- not appear as unreviewed.
set local med250.allow_product_image_governance_ddl = 'on';

alter function public.dawanear_backend_contract() set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v24;
revoke all on function dawanear_private.dawanear_backend_contract_v24()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with base as materialized (
  select dawanear_private.dawanear_backend_contract_v24() as contract
), portal_authority as (
  select count(*) as enabled_without_named_review_count
  from public.dawanear_pharmacy_contacts as contact
  where contact.is_login_enabled
    and (
      contact.contact_type <> 'whatsapp'
      or contact.verification_status not in ('source_verified', 'admin_verified')
      or contact.verified_at is null
      or contact.source_type not in ('admin', 'pharmacy_submission')
      or contact.verified_by_label is null
      or char_length(btrim(contact.verified_by_label)) not between 3 and 200
      or contact.verification_note is null
      or char_length(btrim(contact.verification_note)) not between 10 and 2000
    )
)
select base.contract
  || jsonb_build_object(
    'pharmacy_identity_binding',
      coalesce(base.contract->'pharmacy_identity_binding', '{}'::jsonb)
      || jsonb_build_object(
        'enabled_without_named_review_count',
        portal_authority.enabled_without_named_review_count
      )
  )
from base
cross join portal_authority;
$function$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 release contract aligned with named portal-review evidence and the complete production allowlists.';

do $verify$
declare
  v_contract jsonb;
begin
  select public.dawanear_backend_contract() into v_contract;
  if (v_contract #>> '{pharmacy_identity_binding,enabled_without_named_review_count}')::integer <> 0 then
    raise exception 'MED+250 enabled portal contacts do not satisfy named-review evidence';
  end if;
end;
$verify$;

commit;
