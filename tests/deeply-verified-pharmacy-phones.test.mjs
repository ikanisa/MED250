import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260717090739_import_deeply_verified_pharmacy_phone_contacts.sql",
    import.meta.url,
  ),
  "utf8",
);

test("promotes only the two deeply corroborated phone-only contacts", () => {
  assert.match(migration, /retail-2026-05-110/);
  assert.match(migration, /250788473857/);
  assert.match(migration, /retail-2026-05-284/);
  assert.match(migration, /250788456665/);
  assert.match(migration, /'phone'/i);
  assert.match(migration, /'admin_verified'/i);
  assert.match(migration, /is_login_enabled,[\s\S]*false/i);
  assert.doesNotMatch(migration, /'whatsapp'/i);
  assert.doesNotMatch(migration, /'google_places'/i);
});

test("uses reviewed non-Google sources and fails closed on conflicts", () => {
  assert.match(migration, /Rwanda Bar Association contracted-pharmacy/i);
  assert.match(migration, /UBIPHARM Rwanda pharmacy directory/i);
  assert.match(migration, /cross-pharmacy conflicts/i);
  assert.match(migration, /Expected two deeply verified phone-only contacts/i);
  assert.match(migration, /89e01bbff3a8f061df3fec3a963b3e8842f987505cd97a465057e400e68833e3/);
});
