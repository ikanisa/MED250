begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

-- Pharmacy staff contribute evidence to one central catalogue price. The
-- contributor and pharmacy remain private audit provenance and are never
-- exposed as a pharmacy-specific public price or stock claim.
create table public.dawanear_central_price_contributions (
  id uuid primary key default gen_random_uuid(),
  product_id text not null
    references public.dawanear_products(id) on delete restrict,
  pharmacy_id uuid not null
    references public.dawanear_pharmacies(id) on delete restrict,
  contributed_by uuid not null
    references auth.users(id) on delete restrict,
  submitted_price_rwf integer not null
    check (submitted_price_rwf between 1 and 100000000),
  previous_central_price_rwf integer
    check (previous_central_price_rwf is null or previous_central_price_rwf between 1 and 100000000),
  resulting_central_price_rwf integer not null
    check (resulting_central_price_rwf between 1 and 100000000),
  outcome text not null
    check (outcome in ('initialized', 'lowered', 'not_lower')),
  created_at timestamptz not null default now(),
  check (resulting_central_price_rwf <= submitted_price_rwf),
  check (
    previous_central_price_rwf is null
    or resulting_central_price_rwf <= previous_central_price_rwf
  )
);

create index dawanear_central_price_contributions_product_created_idx
  on public.dawanear_central_price_contributions (product_id, created_at desc);
create index dawanear_central_price_contributions_pharmacy_created_idx
  on public.dawanear_central_price_contributions (pharmacy_id, created_at desc);
create index dawanear_central_price_contributions_contributor_idx
  on public.dawanear_central_price_contributions (contributed_by);

alter table public.dawanear_central_price_contributions enable row level security;

revoke all on table public.dawanear_central_price_contributions
  from public, anon, authenticated;
grant select, insert on table public.dawanear_central_price_contributions
  to service_role;

comment on table public.dawanear_central_price_contributions is
  'Private audit evidence for the shared MED+250 From price. Never expose rows as pharmacy-specific prices or stock.';

alter table public.dawanear_products
  drop constraint if exists dawanear_products_indicative_price_metadata_check;

alter table public.dawanear_products
  add constraint dawanear_products_indicative_price_metadata_check check (
    (
      indicative_price_rwf is null
      and indicative_price_basis is null
      and indicative_price_source_url is null
      and indicative_price_updated_at is null
    )
    or (
      indicative_price_rwf is not null
      and indicative_price_basis in (
        'rwanda_observed_catalogue',
        'central_manual',
        'pharmacy_contributed_lowest'
      )
      and indicative_price_source_url ~ '^https://'
      and indicative_price_updated_at is not null
    )
  );

create function public.dawanear_contribute_central_price(
  p_pharmacy_id uuid,
  p_product_id text,
  p_price_rwf integer
)
returns table (
  contribution_id uuid,
  product_id text,
  submitted_price_rwf integer,
  previous_price_rwf integer,
  central_price_rwf integer,
  became_lowest boolean,
  contribution_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_previous integer;
  v_resulting integer;
  v_outcome text;
  v_contribution_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    raise exception 'A permanent pharmacy account is required' using errcode = '42501';
  end if;
  if p_price_rwf is null or p_price_rwf not between 1 and 100000000 then
    raise exception 'Price must be between 1 and 100000000 RWF' using errcode = '22023';
  end if;
  if p_product_id is null or pg_catalog.btrim(p_product_id) = '' then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.dawanear_pharmacy_memberships as membership
    join public.dawanear_pharmacies as pharmacy
      on pharmacy.id = membership.pharmacy_id
    where membership.pharmacy_id = p_pharmacy_id
      and membership.user_id = v_user_id
      and membership.status = 'active'
      and membership.role in ('owner', 'manager', 'staff')
      and pharmacy.is_active
  ) then
    raise exception 'An active pharmacy membership is required'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dawanear-central-price:' || p_product_id, 0)
  );

  select product.indicative_price_rwf
    into v_previous
  from public.dawanear_products as product
  where product.id = p_product_id
    and product.is_active
  for update;

  if not found then
    raise exception 'Product is not available in the active catalogue'
      using errcode = '22023';
  end if;

  v_resulting := case
    when v_previous is null then p_price_rwf
    else least(v_previous, p_price_rwf)
  end;
  v_outcome := case
    when v_previous is null then 'initialized'
    when p_price_rwf < v_previous then 'lowered'
    else 'not_lower'
  end;

  if v_previous is null or p_price_rwf < v_previous then
    update public.dawanear_products as product
    set indicative_price_rwf = v_resulting,
        indicative_price_basis = 'pharmacy_contributed_lowest',
        indicative_price_source_url = 'https://med250.gikundiro.com/terms',
        indicative_price_updated_at = now(),
        updated_at = now()
    where product.id = p_product_id;
  end if;

  insert into public.dawanear_central_price_contributions (
    product_id,
    pharmacy_id,
    contributed_by,
    submitted_price_rwf,
    previous_central_price_rwf,
    resulting_central_price_rwf,
    outcome
  ) values (
    p_product_id,
    p_pharmacy_id,
    v_user_id,
    p_price_rwf,
    v_previous,
    v_resulting,
    v_outcome
  )
  returning id into v_contribution_id;

  return query select
    v_contribution_id,
    p_product_id,
    p_price_rwf,
    v_previous,
    v_resulting,
    v_outcome in ('initialized', 'lowered'),
    v_outcome;
end;
$$;

revoke all on function public.dawanear_contribute_central_price(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.dawanear_contribute_central_price(uuid, text, integer)
  to authenticated;

comment on function public.dawanear_contribute_central_price(uuid, text, integer) is
  'Records private pharmacy evidence and atomically lowers the single central MED+250 From price when appropriate.';

-- A later Rwanda catalogue refresh may lower the central price, but must never
-- replace a lower pharmacy contribution with a higher source value.
create or replace function dawanear_private.dawanear_sync_marketplace_indicative_price()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate integer;
begin
  v_candidate := case
    when new.observed_price_rwf > 0
      and new.rwanda_product_url ~ '^https://'
      then pg_catalog.round(new.observed_price_rwf)::integer
    else null
  end;

  if v_candidate is null then
    return new;
  end if;

  update public.dawanear_products as product
  set indicative_price_rwf = v_candidate,
      indicative_price_basis = 'rwanda_observed_catalogue',
      indicative_price_source_url = new.rwanda_product_url,
      indicative_price_updated_at = new.source_refreshed_at,
      updated_at = now()
  where product.id = new.id
    and (
      product.indicative_price_rwf is null
      or v_candidate < product.indicative_price_rwf
    );
  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_sync_marketplace_indicative_price()
  from public, anon, authenticated, service_role;

commit;
