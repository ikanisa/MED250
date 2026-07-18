import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260718102955_remove_amazon_from_public_product_content.sql",
    import.meta.url,
  ),
  "utf8",
);

test("cleans and prevents prohibited references in every product-name field", () => {
  assert.match(migration, /update public\.dawanear_marketplace_products/);
  assert.match(migration, /update public\.dawanear_products/);
  assert.match(migration, /product_name = dawanear_private\.dawanear_clean_public_product_text/);
  assert.match(migration, /position\('amazon' in lower\(concat_ws/);
  assert.match(migration, /Product names still contain a prohibited marketplace reference/);
});

test("removes marketplace source values from the public catalogue projection", () => {
  assert.match(migration, /'MED\+250 consumer catalogue'::text as source_name/);
  assert.match(migration, /null::text as source_url/);
  assert.match(migration, /null::text as amazon_product_url/);
  assert.match(migration, /jsonb_each_text\(to_jsonb\(product\)\)/);
  assert.match(migration, /public product catalogue still exposes a prohibited marketplace reference/i);
});
