import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260716094321_schedule_med250_prescription_cleanup.sql",
    import.meta.url,
  ),
  "utf8",
);

test("schedules prescription cleanup without exposing its token in cron history", () => {
  assert.match(
    migration,
    /create or replace function dawanear_private\.dawanear_invoke_prescription_cleanup\(\)/i,
  );
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog/i);
  assert.match(
    migration,
    /from vault\.decrypted_secrets[\s\S]*med250_cleanup_prescriptions_token/i,
  );
  assert.match(migration, /X-DawaNear-Cron-Token[\s\S]*v_cron_token/i);
  assert.match(migration, /cron\.schedule\([\s\S]*med250-prescription-cleanup/i);
  assert.match(migration, /15 \*\/6 \* \* \*/);
  assert.doesNotMatch(migration, /X-DawaNear-Cron-Token['"]\s*,\s*['"][A-Za-z0-9_-]{24,}/);
  assert.match(
    migration,
    /revoke all on function dawanear_private\.dawanear_invoke_prescription_cleanup\(\)[\s\S]*service_role/i,
  );
});
