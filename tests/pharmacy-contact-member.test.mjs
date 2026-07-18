import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [client, marketplace, css, migration, runtimeCatalogJson] = await Promise.all([
  readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260713203240_expose_member_owned_pharmacy_contacts.sql", import.meta.url), "utf8"),
  readFile(new URL("../data/localization/runtime-messages.en-RW.json", import.meta.url), "utf8"),
]);
const profileMigration = await readFile(new URL("../supabase/migrations/20260718150000_extend_member_pharmacy_profile.sql", import.meta.url), "utf8");
const runtimeMessages = JSON.parse(runtimeCatalogJson).messages;

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
  assert.equal(runtimeMessages["inventory.6ed73037f10e"], "Linked phone and WhatsApp contacts");
  assert.equal(runtimeMessages["inventory.6b0bc4eca709"], "Request removal");
  assert.equal(runtimeMessages["inventory.6679d4e5fc66"], "Request a contact replacement");
  assert.match(marketplace, /marketplaceMessage\("inventory\.6ed73037f10e"\)/);
  assert.match(marketplace, /marketplaceMessage\("inventory\.6b0bc4eca709"\)/);
  assert.match(marketplace, /marketplaceMessage\("inventory\.6679d4e5fc66"\)/);
  assert.match(marketplace, /action: contactEditAction/);
  assert.match(marketplace, /requestContactRemoval[\s\S]*action: "remove"/);
  assert.match(marketplace, /pendingContactEdits/);
  assert.doesNotMatch(marketplace, /contactEditNote/);
  assert.match(marketplace, /disabled=\{portalLoading \|\| !\/\^7\[2389\]\\d\{7\}\$\/\.test\(contactEditWhatsapp\)\}/);
  assert.doesNotMatch(marketplace, /Request a WhatsApp update/);
});

test("shows member-owned MoMo and verified map details without exposing other pharmacies", () => {
  assert.match(profileMigration, /dawanear_my_pharmacies\(\)/);
  assert.match(profileMigration, /membership\.user_id = v_user_id/);
  assert.match(profileMigration, /pharmacy\.momo_code/);
  assert.match(profileMigration, /coalesce\(pharmacy\.google_formatted_address, pharmacy\.sector_cell_raw\)/);
  assert.match(profileMigration, /pharmacy\.google_maps_url/);
  assert.match(profileMigration, /extensions\.st_y/);
  assert.match(profileMigration, /extensions\.st_x/);
  assert.match(client, /address: nullableString\(row, "address"\)/);
  assert.match(client, /googleMapsUrl: nullableString\(row, "google_maps_url"\)/);
  assert.match(marketplace, /activeMembership\.role\.charAt\(0\)\.toUpperCase\(\)/);
  assert.match(marketplace, /activeMembership\?\.momoCode/);
  assert.match(marketplace, /activeMembership\.googleMapsUrl/);
  assert.match(marketplace, /activeMembership\.latitude\.toFixed\(6\)/);
});

test("keeps the pharmacy desk label readable on the light portal sidebar", () => {
  assert.match(css, /\.portal-sidebar>small,\s*\n\.portal-sidebar \.text-action \{ color:var\(--color-ink-soft\); \}/);
});
