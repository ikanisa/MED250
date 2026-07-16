alter table public.dawanear_marketplace_products
  drop constraint dawanear_marketplace_products_source_check;

alter table public.dawanear_marketplace_products
  add constraint dawanear_marketplace_products_source_check check (
    source_platform = 'Amazon.com'
    and amazon_product_url ~ '^https://(www[.])?amazon[.]com/'
    and amazon_category_url ~ '^https://(www[.])?amazon[.]com/'
  );
