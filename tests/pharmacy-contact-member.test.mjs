import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [client, marketplace, migration] = await Promise.all([
  readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260713203240_expose_member_owned_pharmacy_contacts.sql", import.meta.url), "utf8"),
]);

test("loads contacts only through the member-scoped RPC", () => {
  assert.match(client, /loadMyPharmacyContacts/);
  assert.match(client, /rpc\("dawanear_my_pharmacy_contacts"/);
  assert.match(client, /requestPharmacyContactEdit/);
  assert.doesNotMatch(client, /from\("dawanear_pharmacy_contacts"\)/);
  assert.match(migration, /dawanear_is_permanent_user/);
  assert.match(migration, /membership\.user_id = v_user_id/);
  assert.match(migration, /membership\.pharmacy_id = p_pharmacy_id/);
});

test("supports real add, replacement and removal requests in the pharmacy profile", () => {
  assert.match(marketplace, /Linked phone and WhatsApp contacts/);
  assert.match(marketplace, /Request removal/);
  assert.match(marketplace, /Request a contact replacement/);
  assert.match(marketplace, /action: contactEditAction/);
  assert.match(marketplace, /action: "remove"/);
  assert.match(marketplace, /pendingContactEdits/);
  assert.doesNotMatch(marketplace, /Request a WhatsApp update/);
});
