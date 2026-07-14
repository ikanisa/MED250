-- Returned table columns are PL/pgSQL OUT variables. The lifecycle RPCs return
-- an `order_id`, so bare `ON CONFLICT (..., order_id, ...)` targets are
-- ambiguous when PostgreSQL compiles the statement. Use the named unique
-- constraint instead. This migration repairs an already-installed project;
-- the base migration contains the corrected deterministic definitions for a
-- clean replay.

do $med250_fix_notification_conflicts$
declare
  v_signature regprocedure;
  v_definition text;
  v_ambiguous constant text :=
    'on conflict (pharmacy_id, order_id, kind)';
  v_explicit constant text :=
    'on conflict on constraint dawanear_pharmacy_notifications_pharmacy_id_order_id_kind_key';
begin
  foreach v_signature in array array[
    'public.dawanear_create_order(double precision,double precision,jsonb,uuid,numeric,text,text,boolean,text)'::regprocedure,
    'public.dawanear_select_offer(uuid,uuid)'::regprocedure,
    'public.dawanear_close_order(uuid,text)'::regprocedure,
    'public.dawanear_expire_timed_out_selected_orders(integer)'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(v_signature::oid)
      into v_definition;

    if position(v_ambiguous in lower(v_definition)) > 0 then
      v_definition := replace(
        v_definition,
        v_ambiguous,
        v_explicit
      );
      execute v_definition;
    elsif position(v_explicit in lower(v_definition)) = 0 then
      raise exception 'Unexpected MED250 lifecycle function definition: %', v_signature;
    end if;
  end loop;
end;
$med250_fix_notification_conflicts$;

-- Preserve the least-privilege grants after replacing function bodies.
revoke all on function public.dawanear_create_order(
  double precision, double precision, jsonb, uuid, numeric, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.dawanear_create_order(
  double precision, double precision, jsonb, uuid, numeric, text, text, boolean, text
) to authenticated;

revoke all on function public.dawanear_select_offer(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.dawanear_select_offer(uuid, uuid)
  to authenticated;

revoke all on function public.dawanear_close_order(uuid, text)
  from public, anon, authenticated;
grant execute on function public.dawanear_close_order(uuid, text)
  to authenticated;

revoke all on function public.dawanear_expire_timed_out_selected_orders(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.dawanear_expire_timed_out_selected_orders(integer)
  to service_role;
