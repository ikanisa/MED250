import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPIRING_STORAGE_VERSION,
  readExpiringStorage,
  writeExpiringStorage,
} from "../lib/expiring-storage.mjs";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("expires sensitive browser state and removes invalid envelopes", () => {
  const storage = memoryStorage();
  writeExpiringStorage(storage, "preferences", { phone: "2507" }, 1_000, 10_000);

  const envelope = JSON.parse(storage.getItem("preferences"));
  assert.equal(envelope.version, EXPIRING_STORAGE_VERSION);
  assert.deepEqual(readExpiringStorage(storage, "preferences", 10_999), { phone: "2507" });
  assert.equal(readExpiringStorage(storage, "preferences", 11_000), null);
  assert.equal(storage.getItem("preferences"), null);

  storage.setItem("legacy", JSON.stringify([{ id: "medicine" }]));
  assert.equal(readExpiringStorage(storage, "legacy", 10_000), null);
  assert.equal(storage.getItem("legacy"), null);
});

test("keeps basket state bounded and precise customer details session-only", async () => {
  const [marketplace, css] = await Promise.all([
    read("../app/marketplace.tsx"),
    read("../app/globals.css"),
  ]);

  assert.match(marketplace, /CART_STORAGE_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(marketplace, /CUSTOMER_PREFERENCES_TTL_MS = 30 \* 60 \* 1000/);
  assert.match(marketplace, /readExpiringStorage\(window\.localStorage, CART_STORAGE_KEY\)/);
  assert.match(marketplace, /writeExpiringStorage\(\s*window\.sessionStorage/);
  assert.doesNotMatch(
    marketplace,
    /localStorage\.setItem\(CUSTOMER_PREFERENCES_STORAGE_KEY/,
  );
  assert.doesNotMatch(marketplace, /rail\.scrollLeft \+=/);
  assert.match(css, /\.subcategory-rail \{[\s\S]*scroll-snap-type:inline proximity/);
  assert.match(css, /\.subcategory-rail button \{[\s\S]*scroll-snap-align:start/);
});

test("closes offer-item, pharmacy-login, description, and image publication gaps", async () => {
  const [migration, verifyOtp] = await Promise.all([
    read("../supabase/migrations/20260723120000_marketplace_go_live_hardening.sql"),
    read("../supabase/functions/dawanear-pharmacy-verify-otp/index.ts"),
  ]);

  assert.match(migration, /dawanear_pharmacy_contacts_one_login_authority_idx/);
  assert.match(migration, /set local med250\.allow_product_image_governance_ddl = 'on'/);
  assert.match(migration, /verified_by is not null/);
  assert.match(migration, /dawanear_bind_pharmacy_identity/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /\^\[1-9\]\[0-9\]\{7,14\}\$/);
  assert.doesNotMatch(migration, /\^2507\[2389\]\[0-9\]\{7\}\$/);
  assert.match(migration, /customer_order\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /membership\.status = 'active'/);
  assert.match(migration, /null::text as description/);
  assert.match(
    migration,
    /revoke select on table public\.dawanear_products from anon, authenticated/,
  );
  assert.match(migration, /grant select \([\s\S]*indicative_price_updated_at/);
  assert.doesNotMatch(
    migration.match(/grant select \([\s\S]*?\) on table public\.dawanear_products/)?.[0] ?? "",
    /description/,
  );
  assert.match(migration, /product_id = 'rwanda-fda-hm-1594'/);
  assert.match(migration, /'contract_version', '2026-07-23\.1'/);
  assert.match(migration, /'expected_function_count', 32/);
  assert.match(migration, /pharmacy_identity_binding/);

  assert.match(verifyOtp, /pharmacies\.length !== 1/);
  assert.match(verifyOtp, /\.rpc\("dawanear_bind_pharmacy_identity"/);
  assert.doesNotMatch(verifyOtp, /\.from\("dawanear_pharmacy_memberships"\)/);
  assert.doesNotMatch(verifyOtp, /\.from\("dawanear_pharmacy_identities"\)\.insert/);
});
