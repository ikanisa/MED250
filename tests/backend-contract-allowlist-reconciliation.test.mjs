import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260729154500_reconcile_backend_contract_allowlists.sql",
    import.meta.url,
  ),
  "utf8",
);

test("reconciles the production backend contract without weakening its boundaries", () => {
  assert.match(
    migration,
    /revoke all on function public\.dawanear_normalize_marketplace_query\(text\)\s+from public/i,
  );
  assert.match(migration, /with base as materialized/i);
  assert.match(migration, /dawanear_backend_contract_v23/);
  assert.match(migration, /'expected_function_count', 41/);
  assert.match(
    migration,
    /'expected_authenticated_security_definer_count',\s+\(select count\(\*\) from expected_authenticated_definers\)/,
  );
  assert.match(migration, /'expected_table_count', 27/);
  assert.match(
    migration,
    /coalesce\(description_review\.proconfig, '\{\}'::text\[\]\)\s+@> array\['search_path=""'\]/,
  );
  assert.match(
    migration,
    /coalesce\(identity_binding\.proconfig, '\{\}'::text\[\]\)\s+@> array\['search_path=""'\]/,
  );
  assert.match(
    migration,
    /public\.dawanear_contribute_central_price\(uuid,text,integer\)/,
  );
  assert.match(
    migration,
    /revoke all on function public\.dawanear_backend_contract\(\)\s+from public, anon, authenticated/i,
  );
});
