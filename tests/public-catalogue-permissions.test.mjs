import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260718110500_restore_public_catalogue_base_permissions.sql",
    import.meta.url,
  ),
  "utf8",
);

test("security-invoker catalogue restores only its governed product columns", () => {
  assert.match(
    migration,
    /grant select \([\s\S]*id,[\s\S]*description_approved[\s\S]*\) on table public\.dawanear_products to anon, authenticated;/,
  );
  assert.match(migration, /has_column_privilege\([\s\S]*'select'/);
  assert.match(migration, /med250\.allow_product_image_governance_ddl/);
  assert.doesNotMatch(
    migration,
    /grant select on (table )?public\.dawanear_products/i,
  );
  assert.doesNotMatch(
    migration,
    /grant (insert|update|delete|truncate|references|trigger|all)/i,
  );
});
