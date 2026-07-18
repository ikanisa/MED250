import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260716203323_import_independently_verified_pharmacy_phone_contacts.sql",
    import.meta.url,
  ),
  "utf8",
);

test("promotes only the two independently corroborated phone contacts", () => {
  assert.match(migration, /retail-2026-05-71/);
  assert.match(migration, /250784632776/);
  assert.match(migration, /retail-2026-05-693/);
  assert.match(migration, /250788406475/);
  assert.match(migration, /contact_type,[\s\S]*'phone'/i);
  assert.match(migration, /'admin_verified'/i);
  assert.match(migration, /'admin'/i);
  assert.match(migration, /is_login_enabled,[\s\S]*false/i);
  assert.doesNotMatch(migration, /'whatsapp'/i);
  assert.doesNotMatch(migration, /'google_places'/i);
  assert.doesNotMatch(
    migration,
    /select[\s\S]*'candidate'[\s\S]*'google_places'/i,
  );
});

test("records independent sources and guards cross-pharmacy conflicts", () => {
  assert.match(migration, /Ruhengeri Level 2 Teaching Hospital/i);
  assert.match(migration, /Rwanda Bar Association and UBIPHARM Rwanda/i);
  assert.match(migration, /cross-pharmacy conflicts/i);
  assert.match(migration, /Expected two independently verified/i);
});
