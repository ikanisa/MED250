begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

-- Product descriptions are optional until an accountable source-and-rights
-- review exists. Draft content may be retained privately, but the public
-- catalogue projects only a description whose exact source bytes, reuse
-- basis, clinical review state and named approval are all recorded.
alter table public.dawanear_products
  add column if not exists description text,
  add column if not exists description_source_name text,
  add column if not exists description_source_url text,
  add column if not exists description_source_sha256 text,
  add column if not exists description_rights_basis text,
  add column if not exists description_rights_reference text,
  add column if not exists description_rights_verified boolean not null default false,
  add column if not exists description_clinical_review_status text not null default 'not_reviewed',
  add column if not exists description_review_note text,
  add column if not exists description_reviewed_by text,
  add column if not exists description_reviewed_role text,
  add column if not exists description_reviewed_at timestamptz,
  add column if not exists description_approved boolean not null default false;

alter table public.dawanear_products
  drop constraint if exists dawanear_products_description_review_status,
  drop constraint if exists dawanear_products_approved_description_evidence,
  drop constraint if exists dawanear_products_description_no_prohibited_reference;

alter table public.dawanear_products
  add constraint dawanear_products_description_review_status check (
    description_clinical_review_status in (
      'not_reviewed', 'not_required', 'approved', 'rejected'
    )
  ),
  add constraint dawanear_products_approved_description_evidence check (
    not description_approved
    or (
      description is not null
      and description = btrim(description)
      and char_length(description) between 40 and 2000
      and description !~ '[[:cntrl:]]'
      and nullif(btrim(description_source_name), '') is not null
      and char_length(btrim(description_source_name)) between 2 and 160
      and description_source_url ~ '^https://'
      and description_source_sha256 ~ '^[a-f0-9]{64}$'
      and nullif(btrim(description_rights_basis), '') is not null
      and char_length(btrim(description_rights_basis)) between 20 and 500
      and nullif(btrim(description_rights_reference), '') is not null
      and char_length(btrim(description_rights_reference)) between 12 and 500
      and description_rights_verified
      and description_clinical_review_status in ('not_required', 'approved')
      and nullif(btrim(description_review_note), '') is not null
      and char_length(btrim(description_review_note)) between 20 and 1000
      and nullif(btrim(description_reviewed_by), '') is not null
      and char_length(btrim(description_reviewed_by)) between 2 and 160
      and nullif(btrim(description_reviewed_role), '') is not null
      and char_length(btrim(description_reviewed_role)) between 2 and 160
      and description_reviewed_at is not null
    )
  ),
  add constraint dawanear_products_description_no_prohibited_reference check (
    position('amazon' in lower(concat_ws(
      ' ', description, description_source_name, description_source_url,
      description_rights_basis, description_rights_reference,
      description_review_note
    ))) = 0
  );

create or replace function dawanear_private.dawanear_guard_product_description_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.description_approved and new.description_approved
     and row(
       new.description,
       new.description_source_name,
       new.description_source_url,
       new.description_source_sha256,
       new.description_rights_basis,
       new.description_rights_reference,
       new.description_rights_verified,
       new.description_clinical_review_status
     ) is distinct from row(
       old.description,
       old.description_source_name,
       old.description_source_url,
       old.description_source_sha256,
       old.description_rights_basis,
       old.description_rights_reference,
       old.description_rights_verified,
       old.description_clinical_review_status
     )
     and (
       new.description_reviewed_at is null
       or old.description_reviewed_at is null
       or new.description_reviewed_at <= old.description_reviewed_at
     ) then
    raise exception 'Changing an approved product description requires a newer accountable review'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists dawanear_products_description_review_guard
  on public.dawanear_products;
create trigger dawanear_products_description_review_guard
before update of
  description,
  description_source_name,
  description_source_url,
  description_source_sha256,
  description_rights_basis,
  description_rights_reference,
  description_rights_verified,
  description_clinical_review_status,
  description_review_note,
  description_reviewed_by,
  description_reviewed_role,
  description_reviewed_at,
  description_approved
on public.dawanear_products
for each row execute function dawanear_private.dawanear_guard_product_description_review();

comment on column public.dawanear_products.description is
  'Draft or approved customer-facing product description. Public projection is fail-closed until the complete evidence constraint passes.';
comment on column public.dawanear_products.description_source_sha256 is
  'SHA-256 of the exact source content reviewed for the public description.';
comment on column public.dawanear_products.description_rights_reference is
  'Durable reference to the accountable reuse-rights decision; this is not exposed publicly.';
comment on column public.dawanear_products.description_approved is
  'True only after source, rights, clinical applicability and named review evidence are complete.';

-- Append description fields to the existing public view. Search RPCs keep
-- their stable explicit return shapes; the single-product REST read can use
-- these additional fields without widening list/search responses.
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
  case when governed.description_approved then governed.description end as description,
  case when governed.description_approved then governed.description_source_name end as description_source_name,
  case when governed.description_approved then governed.description_source_url end as description_source_url
from public.dawanear_product_catalog as catalogue
left join public.dawanear_products as governed on governed.id = catalogue.id
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
  case when product.description_approved then product.description end as description,
  case when product.description_approved then product.description_source_name end as description_source_name,
  case when product.description_approved then product.description_source_url end as description_source_url
from public.dawanear_marketplace_products as marketplace
join public.dawanear_products as product on product.id = marketplace.id
where marketplace.publication_status = 'approved'
  and marketplace.is_active and marketplace.is_orderable;

revoke all on table public.dawanear_all_product_catalog
  from public, anon, authenticated;
grant select on table public.dawanear_all_product_catalog
  to anon, authenticated;

-- The public catalogue is a security-invoker view, so callers also need the
-- smallest possible access to the governed source table. Grant only the
-- columns projected by this view; all review notes, source digests, rights
-- evidence and reviewer identities remain inaccessible.
grant select (
  id,
  indicative_price_rwf,
  indicative_price_basis,
  indicative_price_source_url,
  indicative_price_updated_at,
  description,
  description_source_name,
  description_source_url,
  description_approved
) on table public.dawanear_products to anon, authenticated;

comment on view public.dawanear_all_product_catalog is
  'Unified central catalogue. Public descriptions appear only after source-byte, reuse-rights, clinical-applicability and named-review evidence is complete.';

-- Extend, rather than replace, the complete production contract. The private
-- predecessor retains every earlier invariant; this layer proves that the new
-- description fields remain fail-closed without changing the API/table counts.
alter function public.dawanear_backend_contract()
  set schema dawanear_private;
alter function dawanear_private.dawanear_backend_contract()
  rename to dawanear_backend_contract_v20;
revoke all on function dawanear_private.dawanear_backend_contract_v20()
  from public, anon, authenticated;

create function public.dawanear_backend_contract()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with base as (
  select dawanear_private.dawanear_backend_contract_v20() as contract
), governance as (
  select
    (
      select count(*) = 13
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'dawanear_products'
        and column_name in (
          'description', 'description_source_name', 'description_source_url',
          'description_source_sha256', 'description_rights_basis',
          'description_rights_reference', 'description_rights_verified',
          'description_clinical_review_status', 'description_review_note',
          'description_reviewed_by', 'description_reviewed_role',
          'description_reviewed_at', 'description_approved'
        )
    ) as columns_complete,
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.dawanear_products'::pg_catalog.regclass
        and conname = 'dawanear_products_approved_description_evidence'
        and convalidated
    ) as evidence_constraint_validated,
    exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.dawanear_products'::pg_catalog.regclass
        and tgname = 'dawanear_products_description_review_guard'
        and not tgisinternal
        and tgenabled <> 'D'
    ) as review_guard_enabled,
    (select count(*) from public.dawanear_products where description_approved)
      as approved_description_count,
    (
      select count(*)
      from public.dawanear_products as product
      where product.description_approved
        and (
          product.description is null
          or product.description_source_url !~ '^https://'
          or product.description_source_sha256 !~ '^[a-f0-9]{64}$'
          or not product.description_rights_verified
          or product.description_clinical_review_status not in ('not_required', 'approved')
          or product.description_reviewed_at is null
        )
    ) as approved_without_complete_evidence_count,
    (
      select count(*)
      from public.dawanear_all_product_catalog as catalogue
      join public.dawanear_products as product on product.id = catalogue.id
      where catalogue.description is not null
        and (
          not product.description_approved
          or catalogue.description is distinct from product.description
        )
    ) as public_projection_leak_count,
    (
      select count(*)
      from public.dawanear_all_product_catalog as catalogue
      join public.dawanear_products as product on product.id = catalogue.id
      where product.description_approved and catalogue.description is null
    ) as approved_projection_missing_count
)
select base.contract || jsonb_build_object(
  'contract_version', '2026-07-18.2',
  'product_descriptions', jsonb_build_object(
    'columns_complete', governance.columns_complete,
    'evidence_constraint_validated', governance.evidence_constraint_validated,
    'review_guard_enabled', governance.review_guard_enabled,
    'approved_description_count', governance.approved_description_count,
    'approved_without_complete_evidence_count', governance.approved_without_complete_evidence_count,
    'public_projection_leak_count', governance.public_projection_leak_count,
    'approved_projection_missing_count', governance.approved_projection_missing_count,
    'unapproved_descriptions_hidden', true,
    'rights_verification_required', true,
    'source_digest_required', true,
    'named_review_required', true
  )
)
from base
cross join governance;
$function$;

revoke all on function public.dawanear_backend_contract()
  from public, anon, authenticated;
grant execute on function public.dawanear_backend_contract()
  to service_role;

comment on function public.dawanear_backend_contract() is
  'Service-only MED+250 deployment contract including fail-closed, source-bound and rights-reviewed public product descriptions.';

commit;
