begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

-- Anonymous catalogue access is served exclusively through approved public
-- views and RPCs. The private schema is retained for authenticated storage
-- policies and service-side operations only.
revoke usage on schema dawanear_private from anon;

-- Trigger functions run through their owning triggers and must never be
-- callable as client RPCs. Revoke PostgreSQL's default PUBLIC execute grant
-- as well as any direct grants inherited by API roles.
revoke all on function dawanear_private.dawanear_enforce_order_rolling_quota()
  from public, anon, authenticated;
revoke all on function dawanear_private.dawanear_enqueue_customer_offer_message()
  from public, anon, authenticated;
revoke all on function dawanear_private.dawanear_enqueue_pharmacy_request_message()
  from public, anon, authenticated;
revoke all on function dawanear_private.dawanear_guard_product_description_review()
  from public, anon, authenticated;
revoke all on function dawanear_private.dawanear_invalidate_changed_customer_whatsapp()
  from public, anon, authenticated;
revoke all on function dawanear_private.dawanear_require_current_offered_product()
  from public, anon, authenticated;
revoke all on function dawanear_private.dawanear_retire_contact_authority()
  from public, anon, authenticated;
revoke all on function dawanear_private.dawanear_revalidate_selected_offer_products()
  from public, anon, authenticated;

do $$
declare
  helper regprocedure;
begin
  if pg_catalog.has_schema_privilege('anon', 'dawanear_private', 'usage') then
    raise exception 'anon must not have usage on dawanear_private';
  end if;

  if not pg_catalog.has_schema_privilege(
    'authenticated',
    'dawanear_private',
    'usage'
  ) then
    raise exception 'authenticated requires private-schema usage for storage RLS';
  end if;

  foreach helper in array array[
    'dawanear_private.dawanear_enforce_order_rolling_quota()'::regprocedure,
    'dawanear_private.dawanear_enqueue_customer_offer_message()'::regprocedure,
    'dawanear_private.dawanear_enqueue_pharmacy_request_message()'::regprocedure,
    'dawanear_private.dawanear_guard_product_description_review()'::regprocedure,
    'dawanear_private.dawanear_invalidate_changed_customer_whatsapp()'::regprocedure,
    'dawanear_private.dawanear_require_current_offered_product()'::regprocedure,
    'dawanear_private.dawanear_retire_contact_authority()'::regprocedure,
    'dawanear_private.dawanear_revalidate_selected_offer_products()'::regprocedure
  ]
  loop
    if pg_catalog.has_function_privilege('public', helper, 'execute')
      or pg_catalog.has_function_privilege('anon', helper, 'execute')
      or pg_catalog.has_function_privilege('authenticated', helper, 'execute') then
      raise exception 'client execute privilege remains on %', helper;
    end if;
  end loop;
end;
$$;

commit;
