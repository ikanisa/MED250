import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260801160000_harden_private_trigger_privileges.sql",
    import.meta.url,
  ),
  "utf8",
);

const triggerHelpers = [
  "dawanear_enforce_order_rolling_quota",
  "dawanear_enqueue_customer_offer_message",
  "dawanear_enqueue_pharmacy_request_message",
  "dawanear_guard_product_description_review",
  "dawanear_invalidate_changed_customer_whatsapp",
  "dawanear_require_current_offered_product",
  "dawanear_retire_contact_authority",
  "dawanear_revalidate_selected_offer_products",
];

test("keeps the private schema unavailable to anonymous clients", () => {
  assert.match(
    migration,
    /revoke usage on schema dawanear_private from anon;/i,
  );
  assert.match(
    migration,
    /has_schema_privilege\('anon', 'dawanear_private', 'usage'\)/i,
  );
  assert.doesNotMatch(
    migration,
    /revoke usage on schema dawanear_private from authenticated;/i,
  );
});

test("removes client execute permission from every private trigger helper", () => {
  for (const helper of triggerHelpers) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function dawanear_private\\.${helper}\\(\\)\\s+from public, anon, authenticated;`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(`dawanear_private\\.${helper}\\(\\)'::regprocedure`, "i"),
    );
  }
  assert.match(migration, /has_function_privilege\('public', helper, 'execute'\)/i);
  assert.match(migration, /has_function_privilege\('anon', helper, 'execute'\)/i);
  assert.match(migration, /has_function_privilege\('authenticated', helper, 'execute'\)/i);
});
