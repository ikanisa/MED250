import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../supabase/migrations/20260716053053_activate_verified_pharmacy_national_dispatch.sql",
  import.meta.url,
), "utf8");
const sentinelMigration = await readFile(new URL(
  "../supabase/migrations/20260716053559_allow_national_dispatch_distance_sentinel.sql",
  import.meta.url,
), "utf8");

test("activates verified-contact pharmacies without inventing GPS or contact data", () => {
  assert.match(migration, /license_expires_on >= current_date/);
  assert.match(migration, /contact_type = 'whatsapp'/);
  assert.match(migration, /is_login_enabled/);
  assert.match(migration, /verification_status in \('source_verified', 'admin_verified'\)/);
  const helper = migration.slice(
    migration.indexOf("create or replace function dawanear_private.dawanear_pharmacy_is_dispatch_eligible"),
    migration.indexOf("revoke all on function dawanear_private.dawanear_pharmacy_is_dispatch_eligible"),
  );
  assert.doesNotMatch(helper, /geocode_status|location is not null/);
});

test("uses a bounded national fallback while preserving real-distance priority", () => {
  assert.match(migration, /extensions\.st_dwithin\(pharmacy\.location, v_location, 10000\)/);
  assert.match(migration, /else -1\.0/);
  assert.match(migration, /md5\(v_order_id::text \|\| ':' \|\| pharmacy\.id::text\)/);
  assert.match(migration, /limit 20/);
  assert.match(migration, /No operational eligibility predicate was updated/);
  assert.match(migration, /Operational dispatch-ready metric was not updated/);
  assert.match(sentinelMigration, /distance_m = -1\.0/);
  assert.match(sentinelMigration, /geocode_status = ''verified''/);
  assert.match(sentinelMigration, /National routing GPS boundary was not installed/);
});
