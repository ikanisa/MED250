import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;
const wrangler = new URL("../node_modules/.bin/wrangler", import.meta.url).pathname;
const migrationsDirectory = new URL("../db/d1/migrations", import.meta.url);

test("applies every canonical migration to an isolated local D1 database", async (t) => {
  const persistTo = await mkdtemp(join(tmpdir(), "med250-d1-test-"));
  t.after(() => rm(persistTo, { recursive: true, force: true }));

  const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(files, [
    "0001_initial.sql",
    "0002_catalogue_marketplace.sql",
    "0003_operations_governance.sql",
    "0004_otp_redemption_guard.sql",
    "0005_prescription_attachment_guard.sql",
    "0006_inbound_failure_evidence.sql",
    "0007_operator_contact_evidence.sql",
    "0008_dashboard_recovery_reconciliation.sql",
    "0009_product_image_rights_gate.sql",
    "0010_expand_product_image_partner_portfolio.sql",
    "0011_admin_whatsapp_auth.sql",
  ]);

  await execFileAsync(wrangler, [
    "d1", "migrations", "apply", "med250-local", "--local",
    "--config", "wrangler.jsonc", "--persist-to", persistTo,
  ], { cwd: root });

  const { stdout } = await execFileAsync(wrangler, [
    "d1", "execute", "med250-local", "--local", "--json",
    "--config", "wrangler.jsonc", "--persist-to", persistTo,
    "--command", "SELECT expected_migration, expected_applied_count FROM med250_runtime_contract WHERE contract_key = 'worker_runtime'",
  ], { cwd: root });
  const result = JSON.parse(stdout);
  assert.equal(result[0].results[0].expected_migration, "0011_admin_whatsapp_auth");
  assert.equal(result[0].results[0].expected_applied_count, 11);

  const initial = await readFile(new URL("../db/d1/migrations/0001_initial.sql", import.meta.url), "utf8");
  assert.match(initial, /med250_known_pharmacy_numbers/);
  assert.match(initial, /actor_type TEXT NOT NULL CHECK \(actor_type IN \('pharmacy', 'client'\)\)/);
  assert.match(initial, /dispatch_limit INTEGER NOT NULL DEFAULT 10 CHECK \(dispatch_limit = 10\)/);
});
