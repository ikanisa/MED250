begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

-- Keep foreign-key checks and operational joins bounded as the notification
-- outbox grows. The table is currently empty in production, so these indexes
-- can be installed without a data rewrite or a long-running table scan.
create index if not exists dawanear_whatsapp_outbox_offer_id_idx
  on public.dawanear_whatsapp_outbox (offer_id);

create index if not exists dawanear_whatsapp_outbox_pharmacy_id_idx
  on public.dawanear_whatsapp_outbox (pharmacy_id);

commit;
