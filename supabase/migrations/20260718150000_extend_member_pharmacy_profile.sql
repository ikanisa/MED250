begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

drop function if exists public.dawanear_my_pharmacies();
create function public.dawanear_my_pharmacies()
returns table (
  membership_id uuid,
  pharmacy_id uuid,
  pharmacy_name text,
  license_number text,
  role text,
  status text,
  whatsapp text,
  momo_code text,
  address text,
  google_maps_url text,
  latitude double precision,
  longitude double precision,
  online_license_verified boolean,
  marketplace_approved boolean,
  geocode_status text,
  license_expires_on date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not dawanear_private.dawanear_is_permanent_user(v_user_id) then
    raise exception 'A permanent pharmacy account is required' using errcode = '42501';
  end if;

  return query
  select
    membership.id,
    pharmacy.id,
    pharmacy.name,
    pharmacy.license_number,
    membership.role,
    membership.status,
    pharmacy.whatsapp,
    pharmacy.momo_code,
    coalesce(pharmacy.google_formatted_address, pharmacy.sector_cell_raw),
    pharmacy.google_maps_url,
    case when pharmacy.location is not null then extensions.st_y(pharmacy.location::extensions.geometry) end,
    case when pharmacy.location is not null then extensions.st_x(pharmacy.location::extensions.geometry) end,
    pharmacy.online_license_verified,
    pharmacy.marketplace_approved,
    pharmacy.geocode_status,
    pharmacy.license_expires_on
  from public.dawanear_pharmacy_memberships as membership
  join public.dawanear_pharmacies as pharmacy on pharmacy.id = membership.pharmacy_id
  where membership.user_id = v_user_id
    and membership.status = 'active'
  order by pharmacy.name, membership.id;
end;
$$;

revoke all on function public.dawanear_my_pharmacies()
  from public, anon, authenticated;
grant execute on function public.dawanear_my_pharmacies() to authenticated;

commit;
