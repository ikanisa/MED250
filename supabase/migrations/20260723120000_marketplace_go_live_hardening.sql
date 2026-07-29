begin;

-- Production protects product-image governance behind a database-wide DDL
-- event trigger. This reviewed transaction changes adjacent catalogue and
-- authorization surfaces while leaving the guard enabled, so use only its
-- documented transaction-local override.
set local med250.allow_product_image_governance_ddl = 'on';

-- A public directory phone number is not sufficient evidence for portal
-- authority. Login remains disabled until a named Supabase reviewer approves
-- exactly one WhatsApp contact for exactly one pharmacy.
create or replace function dawanear_private.dawanear_retire_contact_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.contact_type = 'whatsapp'
     and old.is_login_enabled
     and (
       not new.is_login_enabled
       or new.verification_status in ('rejected', 'stale')
       or new.e164 is distinct from old.e164
     ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('med250:pharmacy-login:' || old.e164, 0)
    );

    update public.dawanear_pharmacy_contacts
    set verification_status = 'stale',
        is_login_enabled = false,
        is_primary = false,
        verified_at = now(),
        verification_note = coalesce(verification_note, 'Parent WhatsApp contact retired')
    where derived_from_contact_id = old.id
      and verification_status not in ('rejected', 'stale');

    update public.dawanear_pharmacy_memberships as membership
    set status = 'suspended', updated_at = now()
    from public.dawanear_pharmacy_identities as identity
    where identity.phone = old.e164
      and membership.user_id = identity.user_id
      and membership.pharmacy_id = old.pharmacy_id
      and membership.status = 'active';
  end if;
  return new;
end;
$function$;

with ranked_login_contacts as (
  select
    contact.id,
    row_number() over (
      partition by contact.e164
      order by contact.verified_at desc nulls last, contact.updated_at desc, contact.id
    ) as authority_rank
  from public.dawanear_pharmacy_contacts as contact
  where contact.contact_type = 'whatsapp'
    and contact.is_login_enabled
    and contact.verification_status in ('source_verified', 'admin_verified')
    and contact.verified_by is not null
    and contact.source_type in ('admin', 'pharmacy_submission')
)
update public.dawanear_pharmacy_contacts as contact
set is_login_enabled = false,
    verification_note = concat_ws(
      ' ',
      nullif(btrim(contact.verification_note), ''),
      'Portal login disabled by the 2026-07-23 named-review authority hardening.'
    )
where contact.contact_type = 'whatsapp'
  and contact.is_login_enabled
  and (
    contact.verified_by is null
    or contact.source_type not in ('admin', 'pharmacy_submission')
    or not exists (
      select 1
      from ranked_login_contacts as ranked
      where ranked.id = contact.id
        and ranked.authority_rank = 1
    )
  );

alter table public.dawanear_pharmacy_contacts
  drop constraint if exists dawanear_pharmacy_contacts_login_authority;
alter table public.dawanear_pharmacy_contacts
  add constraint dawanear_pharmacy_contacts_login_authority
  check (
    not is_login_enabled
    or (
      contact_type = 'whatsapp'
      and verification_status in ('source_verified', 'admin_verified')
      and verified_at is not null
      and verified_by is not null
      and source_type in ('admin', 'pharmacy_submission')
    )
  );

create unique index if not exists dawanear_pharmacy_contacts_one_login_authority_idx
  on public.dawanear_pharmacy_contacts (e164)
  where contact_type = 'whatsapp' and is_login_enabled;

-- The Edge Function delegates the final authority check and identity binding
-- to this single locked transaction. It cannot create cross-pharmacy manager
-- access from duplicated or revoked directory data.
create or replace function public.dawanear_bind_pharmacy_identity(
  p_phone text,
  p_user_id uuid
)
returns table (bound_pharmacy_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pharmacy_id uuid;
  v_existing_user_id uuid;
  v_existing_phone text;
  v_target_status text;
begin
  if p_phone !~ '^[1-9][0-9]{7,14}$' or p_user_id is null then
    raise exception 'Invalid pharmacy identity binding input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('med250:pharmacy-login:' || p_phone, 0)
  );

  select contact.pharmacy_id
    into v_pharmacy_id
  from public.dawanear_pharmacy_contacts as contact
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = contact.pharmacy_id
  where contact.contact_type = 'whatsapp'
    and contact.e164 = p_phone
    and contact.is_login_enabled
    and contact.verification_status in ('source_verified', 'admin_verified')
    and contact.verified_at is not null
    and contact.verified_by is not null
    and contact.source_type in ('admin', 'pharmacy_submission')
    and pharmacy.is_active
    and pharmacy.marketplace_approved
    and pharmacy.online_license_verified
    and pharmacy.license_expires_on >= current_date
  for update of contact;

  if v_pharmacy_id is null then
    raise exception 'No current named-review portal authority exists for this number'
      using errcode = '42501';
  end if;

  select identity.user_id
    into v_existing_user_id
  from public.dawanear_pharmacy_identities as identity
  where identity.phone = p_phone
  for update;
  if v_existing_user_id is not null and v_existing_user_id <> p_user_id then
    raise exception 'This phone is already bound to another identity'
      using errcode = '23505';
  end if;

  select identity.phone
    into v_existing_phone
  from public.dawanear_pharmacy_identities as identity
  where identity.user_id = p_user_id
  for update;
  if v_existing_phone is not null and v_existing_phone <> p_phone then
    raise exception 'This identity is already bound to another phone'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.dawanear_pharmacy_memberships as membership
    where membership.user_id = p_user_id
      and membership.pharmacy_id <> v_pharmacy_id
      and membership.status = 'active'
  ) then
    raise exception 'Cross-pharmacy manager binding is not permitted'
      using errcode = '42501';
  end if;

  select membership.status
    into v_target_status
  from public.dawanear_pharmacy_memberships as membership
  where membership.pharmacy_id = v_pharmacy_id
    and membership.user_id = p_user_id
  for update;
  if v_target_status in ('suspended', 'revoked') then
    raise exception 'This pharmacy access has been suspended'
      using errcode = '42501';
  end if;

  insert into public.dawanear_pharmacy_identities (
    phone, user_id, verified_at, last_login_at, updated_at
  ) values (
    p_phone, p_user_id, now(), now(), now()
  )
  on conflict (phone) do update
  set verified_at = now(),
      last_login_at = now(),
      updated_at = now()
  where public.dawanear_pharmacy_identities.user_id = excluded.user_id;

  insert into public.dawanear_pharmacy_memberships (
    pharmacy_id, user_id, role, status, created_by, updated_at
  ) values (
    v_pharmacy_id, p_user_id, 'manager', 'active', p_user_id, now()
  )
  on conflict on constraint dawanear_pharmacy_memberships_pharmacy_id_user_id_key
  do update
  set role = case
        when public.dawanear_pharmacy_memberships.role = 'owner' then 'owner'
        else 'manager'
      end,
      status = 'active',
      updated_at = now()
  where public.dawanear_pharmacy_memberships.status in ('invited', 'active');

  update public.dawanear_pharmacy_contacts
  set last_login_at = now()
  where pharmacy_id = v_pharmacy_id
    and contact_type = 'whatsapp'
    and e164 = p_phone
    and is_login_enabled;

  return query select v_pharmacy_id;
end;
$function$;

revoke all on function public.dawanear_bind_pharmacy_identity(text, uuid)
  from public, anon, authenticated;
grant execute on function public.dawanear_bind_pharmacy_identity(text, uuid)
  to service_role;

comment on function public.dawanear_bind_pharmacy_identity(text, uuid) is
  'Service-only, transaction-locked binding from one named-review WhatsApp authority to one pharmacy identity and membership.';

-- Offer-item visibility follows the parent order/customer or the active,
-- non-anonymous pharmacy membership. Merely knowing an offer UUID is not an
-- authorization condition.
drop policy if exists dawanear_offer_items_participant_select
  on public.dawanear_offer_items;
create policy dawanear_offer_items_participant_select
on public.dawanear_offer_items for select to authenticated
using (
  exists (
    select 1
    from public.dawanear_offers as offer
    join public.dawanear_orders as customer_order on customer_order.id = offer.order_id
    where offer.id = dawanear_offer_items.offer_id
      and customer_order.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.dawanear_offers as offer
    join public.dawanear_pharmacy_memberships as membership
      on membership.pharmacy_id = offer.pharmacy_id
    where offer.id = dawanear_offer_items.offer_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
);

-- Keep governed drafts private. The public catalogue retains a stable shape,
-- but description columns remain null until they are exposed through a
-- dedicated permission-safe projection.
create or replace view public.dawanear_all_product_catalog
with (security_invoker = true)
as
select
  catalogue.id, catalogue.registration_number, catalogue.brand_name,
  catalogue.generic_name, catalogue.strength, catalogue.dosage_form,
  catalogue.pack_size, catalogue.product_type, catalogue.category,
  catalogue.category as department, null::text as subcategory,
  catalogue.prescription_status, catalogue.regulatory_status,
  catalogue.manufacturer, catalogue.manufacturer_country,
  catalogue.expiry_date, catalogue.image_url, catalogue.is_orderable,
  catalogue.source_name, catalogue.source_url,
  catalogue.price_min_rwf, catalogue.price_max_rwf,
  catalogue.price_contributors, null::text as amazon_product_url,
  catalogue.indicative_price_rwf, catalogue.price_is_indicative,
  catalogue.indicative_price_basis, catalogue.indicative_price_source_url,
  catalogue.indicative_price_updated_at,
  null::text as description,
  null::text as description_source_name,
  null::text as description_source_url
from public.dawanear_product_catalog as catalogue
where not exists (
  select 1 from public.dawanear_marketplace_products as marketplace
  where marketplace.id = catalogue.id
)
union all
select
  marketplace.id, marketplace.registration_number, marketplace.product_name as brand_name,
  marketplace.generic_name, marketplace.strength, marketplace.dosage_form,
  marketplace.pack_size, marketplace.product_type, marketplace.category,
  marketplace.category as department, marketplace.subcategory,
  'non_prescription'::text as prescription_status,
  'unclassified'::text as regulatory_status, marketplace.manufacturer,
  marketplace.manufacturer_country, marketplace.expiry_date,
  marketplace.image_url, marketplace.is_orderable,
  'MED+250 consumer catalogue'::text as source_name,
  null::text as source_url, product.indicative_price_rwf as price_min_rwf,
  product.indicative_price_rwf as price_max_rwf,
  0::bigint as price_contributors, null::text as amazon_product_url,
  product.indicative_price_rwf,
  (product.indicative_price_rwf is not null) as price_is_indicative,
  product.indicative_price_basis, product.indicative_price_source_url,
  product.indicative_price_updated_at,
  null::text as description,
  null::text as description_source_name,
  null::text as description_source_url
from public.dawanear_marketplace_products as marketplace
join public.dawanear_products as product on product.id = marketplace.id
where marketplace.publication_status = 'approved'
  and marketplace.is_active and marketplace.is_orderable;

-- Remove any inherited table-wide or column-level read grant first. Regrant
-- only the non-draft catalogue projection needed by security-invoker views.
-- A column-only REVOKE would not override an accidental table-wide SELECT.
revoke select on table public.dawanear_products from anon, authenticated;
grant select (
  id,
  registration_number,
  brand_name,
  generic_name,
  strength,
  dosage_form,
  pack_size,
  product_type,
  category,
  prescription_status,
  regulatory_status,
  manufacturer,
  manufacturer_country,
  expiry_date,
  image_url,
  is_orderable,
  is_active,
  source_name,
  source_url,
  indicative_price_rwf,
  indicative_price_basis,
  indicative_price_source_url,
  indicative_price_updated_at
) on table public.dawanear_products to anon, authenticated;

comment on view public.dawanear_all_product_catalog is
  'Unified central catalogue with permission-safe fail-closed public description columns.';

-- The July 23 visual QA found that this suppository record displayed oral
-- suspension bottles. Remove the mismatched gallery immediately; the normal
-- governed image workflow may republish only after a product-specific review.
update public.dawanear_product_images
set approved = false,
    checked_at = now()
where product_id = 'rwanda-fda-hm-1594';

update public.dawanear_products
set image_url = null,
    image_source = null,
    updated_at = now()
where id = 'rwanda-fda-hm-1594';

update public.dawanear_marketplace_products
set image_url = null,
    image_source = null,
    updated_at = now()
where id = 'rwanda-fda-hm-1594';

-- Extend the aggregate deployment contract so the new service-only RPC is an
-- explicit allowlisted surface, not unexplained function-count drift.
alter function public.dawanear_backend_contract() set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v22;
revoke all on function dawanear_private.dawanear_backend_contract_v22()
  from public, anon, authenticated, service_role;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with base as (
  select dawanear_private.dawanear_backend_contract_v22() as contract
), binding_function as (
  select
    function.oid is not null as function_exists,
    coalesce(function.prosecdef, false) as security_definer,
    coalesce(function.proconfig @> array['search_path=']::text[], false) as search_path_locked,
    pg_catalog.has_function_privilege(
      'service_role',
      'public.dawanear_bind_pharmacy_identity(text,uuid)',
      'execute'
    ) as service_role_can_execute,
    pg_catalog.has_function_privilege(
      'anon',
      'public.dawanear_bind_pharmacy_identity(text,uuid)',
      'execute'
    ) as anon_can_execute,
    pg_catalog.has_function_privilege(
      'authenticated',
      'public.dawanear_bind_pharmacy_identity(text,uuid)',
      'execute'
    ) as authenticated_can_execute
  from pg_catalog.pg_proc as function
  where function.oid = pg_catalog.to_regprocedure(
    'public.dawanear_bind_pharmacy_identity(text,uuid)'
  )
), governance as (
  select
    pg_catalog.to_regclass(
      'public.dawanear_pharmacy_contacts_one_login_authority_idx'
    ) is not null as one_login_authority_index_exists,
    exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = 'public.dawanear_pharmacy_contacts'::pg_catalog.regclass
        and conname = 'dawanear_pharmacy_contacts_login_authority'
        and convalidated
    ) as login_authority_constraint_validated,
    (
      select count(*)
      from public.dawanear_pharmacy_contacts as contact
      where contact.is_login_enabled
        and (
          contact.verified_by is null
          or contact.source_type not in ('admin', 'pharmacy_submission')
        )
    ) as enabled_without_named_review_count,
    (
      select count(*)
      from (
        select contact.e164
        from public.dawanear_pharmacy_contacts as contact
        where contact.contact_type = 'whatsapp'
          and contact.is_login_enabled
        group by contact.e164
        having count(*) > 1
      ) as duplicate_authority
    ) as duplicate_enabled_phone_count,
    exists (
      select 1
      from pg_catalog.pg_policy
      where polrelid = 'public.dawanear_offer_items'::pg_catalog.regclass
        and polname = 'dawanear_offer_items_participant_select'
        and pg_catalog.pg_get_expr(polqual, polrelid) like '%dawanear_orders%'
        and pg_catalog.pg_get_expr(polqual, polrelid) like '%dawanear_pharmacy_memberships%'
    ) as offer_item_policy_binds_participants,
    (
      pg_catalog.has_column_privilege(
        'anon', 'public.dawanear_products', 'description', 'select'
      )
      or pg_catalog.has_column_privilege(
        'authenticated', 'public.dawanear_products', 'description', 'select'
      )
    ) as public_description_base_grant_exists,
    (
      select count(*)
      from public.dawanear_product_images as image
      where image.product_id = 'rwanda-fda-hm-1594'
        and image.approved
    ) as mismatched_image_published_count
)
select base.contract
  || jsonb_build_object(
    'contract_version', '2026-07-23.1',
    'pharmacy_identity_binding', jsonb_build_object(
      'function_exists', binding_function.function_exists,
      'security_definer', binding_function.security_definer,
      'search_path_locked', binding_function.search_path_locked,
      'service_role_can_execute', binding_function.service_role_can_execute,
      'anon_can_execute', binding_function.anon_can_execute,
      'authenticated_can_execute', binding_function.authenticated_can_execute,
      'one_login_authority_index_exists', governance.one_login_authority_index_exists,
      'login_authority_constraint_validated', governance.login_authority_constraint_validated,
      'enabled_without_named_review_count', governance.enabled_without_named_review_count,
      'duplicate_enabled_phone_count', governance.duplicate_enabled_phone_count
    ),
    'go_live_hardening', jsonb_build_object(
      'offer_item_policy_binds_participants', governance.offer_item_policy_binds_participants,
      'public_description_base_grant_exists', governance.public_description_base_grant_exists,
      'mismatched_image_published_count', governance.mismatched_image_published_count
    ),
    'api_surface', coalesce(base.contract->'api_surface', '{}'::jsonb)
      || jsonb_build_object('expected_function_count', 32)
  )
from base
cross join binding_function
cross join governance;
$function$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 contract including named-review pharmacy identity binding, participant-bound offer items, fail-closed descriptions and the mismatched-image hold.';

commit;
