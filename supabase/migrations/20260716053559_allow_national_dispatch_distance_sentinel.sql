begin;

-- -1 is the explicit, non-geographic sentinel for a verified pharmacy that is
-- eligible to receive a national request but has no approved premises point.
-- Positive distances remain bounded to Rwanda-scale routing values.
alter table public.dawanear_order_recipients
  drop constraint if exists dawanear_order_recipients_distance_m_check;

alter table public.dawanear_order_recipients
  add constraint dawanear_order_recipients_distance_m_check
  check (
    distance_m = -1.0
    or (distance_m >= 0.0 and distance_m <= 500000.0)
  );

comment on column public.dawanear_order_recipients.distance_m is
  'Verified distance in metres when approved GPS exists; -1 means national service area with no approved premises distance.';

-- Never calculate or present distance from an unreviewed point. Location may
-- improve routing only after the existing GPS review workflow marks it verified.
do $harden_national_routing$
declare
  v_procedure regprocedure := pg_catalog.to_regprocedure(
    'public.dawanear_create_order(double precision,double precision,jsonb,uuid,numeric,text,text,boolean,text)'
  );
  v_definition text;
  v_rewritten text;
begin
  if v_procedure is null then
    raise exception 'MED+250 order function is missing' using errcode = 'P0002';
  end if;

  select pg_catalog.pg_get_functiondef(v_procedure::oid) into v_definition;
  v_rewritten := replace(
    v_definition,
    'when pharmacy.location is not null',
    E'when pharmacy.geocode_status = ''verified''\n        and pharmacy.location is not null'
  );

  if v_rewritten = v_definition then
    raise exception 'National routing GPS boundary was not installed'
      using errcode = 'P0002';
  end if;
  execute v_rewritten;
end;
$harden_national_routing$;

commit;
-- Filename aligned with the migration version recorded by the production project.
