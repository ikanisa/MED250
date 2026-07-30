import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20260730123000_reconcile_portal_review_contract.sql", import.meta.url),
  "utf8",
);

test("aligns the backend contract with enforced named portal-review evidence", () => {
  assert.match(migration, /dawanear_backend_contract_v24/);
  assert.match(migration, /contact\.verified_by_label is null/);
  assert.match(migration, /contact\.verification_note is null/);
  assert.match(migration, /contact\.source_type not in \('admin', 'pharmacy_submission'\)/);
  assert.doesNotMatch(
    migration.match(/portal_authority as \([\s\S]*?\n\)/)?.[0] ?? "",
    /contact\.verified_by is null/,
  );
  assert.match(migration, /enabled portal contacts do not satisfy named-review evidence/);
});
