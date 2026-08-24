import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260716094833_remediate_med250_database_advisors.sql",
    import.meta.url,
  ),
  "utf8",
);

test("removes obsolete public pharmacy-price access and the duplicate order index", () => {
  assert.match(
    migration,
    /drop policy if exists dawanear_prices_current_select[\s\S]*dawanear_pharmacy_prices/i,
  );
  assert.match(
    migration,
    /revoke select on table public\.dawanear_pharmacy_prices[\s\S]*anon,\s*authenticated/i,
  );
  assert.match(
    migration,
    /drop index if exists public\.dawanear_orders_user_fk_idx/i,
  );
});
