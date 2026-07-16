import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260716174000_remove_quarantined_browser_phone_candidates.sql",
    import.meta.url,
  ),
  "utf8",
);

test("removes only quarantined browser-observation phone candidates", () => {
  assert.match(migration, /delete from public\.dawanear_pharmacy_contacts/i);
  assert.match(migration, /contact_type = 'phone'/i);
  assert.match(migration, /verification_status = 'candidate'/i);
  assert.match(migration, /source_type = 'google_places'/i);
  assert.match(
    migration,
    /Free Selenium browser observation; requires operator verification/i,
  );
  assert.match(migration, /not is_login_enabled/i);
  assert.match(migration, /verified_at is null/i);
  assert.match(migration, /verified_by is null/i);
  assert.doesNotMatch(migration, /verification_status = 'source_verified'/i);
  assert.doesNotMatch(migration, /contact_type = 'whatsapp'/i);
});

test("fails the migration if a quarantined candidate survives", () => {
  assert.match(
    migration,
    /Quarantined browser-observation phone candidates remain in production/i,
  );
});
