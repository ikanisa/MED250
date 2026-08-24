begin;

select pg_catalog.set_config(
  'med250.allow_product_image_governance_ddl',
  'on',
  true
);

alter table public.dawanear_product_images
  drop constraint if exists dawanear_product_images_source_kind_check;

alter table public.dawanear_product_images
  add constraint dawanear_product_images_source_kind_check
  check (
    source_kind = any (
      array[
        'licensed_feed'::text,
        'manufacturer'::text,
        'amazon_creators_api'::text,
        'specialist_retailer'::text,
        'marketplace_api'::text,
        'generated_catalogue'::text
      ]
    )
  );

comment on constraint dawanear_product_images_source_kind_check
  on public.dawanear_product_images is
  'Generated catalogue images are permitted only with explicit illustrative provenance; they must never be attributed to a manufacturer or retailer.';

commit;
