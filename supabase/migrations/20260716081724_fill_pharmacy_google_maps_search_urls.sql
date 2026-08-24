begin;

-- A canonical Google place page is preferred when one has been verified.
-- For every remaining pharmacy, provide a deterministic Google Maps search
-- URL built from the current FDA registry name and locality. This requires no
-- Google API key and does not claim that a place/geocode has been verified.
create function pg_temp.med250_urlencode(value text)
returns text
language plpgsql
immutable
strict
parallel safe
as $$
declare
  bytes bytea := convert_to(value, 'UTF8');
  byte_value integer;
  index integer;
  output text := '';
begin
  if length(bytes) = 0 then
    return output;
  end if;

  for index in 0 .. length(bytes) - 1 loop
    byte_value := get_byte(bytes, index);
    if (byte_value between 48 and 57)
       or (byte_value between 65 and 90)
       or (byte_value between 97 and 122)
       or byte_value in (45, 46, 95, 126) then
      output := output || chr(byte_value);
    elsif byte_value = 32 then
      output := output || '+';
    else
      output := output || '%' || upper(lpad(to_hex(byte_value), 2, '0'));
    end if;
  end loop;

  return output;
end;
$$;

update public.dawanear_pharmacies as pharmacy
set google_maps_url =
      'https://www.google.com/maps/search/?api=1&query='
      || pg_temp.med250_urlencode(
        concat_ws(
          ', ',
          pharmacy.name,
          nullif(btrim(pharmacy.sector_cell_raw), ''),
          nullif(btrim(pharmacy.district), ''),
          nullif(btrim(pharmacy.province), ''),
          'Rwanda'
        )
      ),
    updated_at = now()
where pharmacy.google_maps_url is null
   or btrim(pharmacy.google_maps_url) = '';

do $$
begin
  if exists (
    select 1
    from public.dawanear_pharmacies
    where google_maps_url is null
       or btrim(google_maps_url) = ''
  ) then
    raise exception 'Every pharmacy must have a Google Maps URL after enrichment';
  end if;
end;
$$;

commit;
