import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260717093825_mirror_verified_mobile_phones_as_whatsapp_contacts.sql",
    import.meta.url,
  ),
  "utf8",
);

test("verified Rwanda mobile phones are mirrored as non-login WhatsApp contacts", () => {
  assert.match(migration, /phone\.contact_type = 'phone'/);
  assert.match(migration, /phone\.verification_status in \('source_verified', 'admin_verified'\)/);
  assert.match(migration, /phone\.e164 ~ '\^2507\[2389\]\[0-9\]\{7\}\$'/);
  assert.match(migration, /'whatsapp'/);
  assert.match(migration, /'\+' \|\| phone\.e164/);
  assert.match(migration, /\n  false,\n  phone\.verification_status/);
  assert.match(migration, /derived_from_contact_id/);
  assert.match(migration, /OTP login remains disabled/);
});

test("migration proves coverage and rejects unsafe formatting or login elevation", () => {
  assert.match(migration, /Every verified mobile phone must have a matching verified WhatsApp contact/);
  assert.match(migration, /display_number is distinct from '\+' \|\| e164/);
  assert.match(migration, /Phone-derived WhatsApp contacts must not receive OTP login authority/);
  assert.match(migration, /on conflict \(pharmacy_id, contact_type, e164\) do nothing/);
});
