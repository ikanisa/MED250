import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";

import {
  PharmacyRecoveryError,
  buildPharmacyRecoveryBundle,
  readPharmacyRecoveryBundle,
  verifyPharmacyRecoveryBundle,
  writePharmacyRecoveryBundle,
} from "../scripts/cloudflare-pharmacy-recovery.mjs";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const workRoot = new URL("../work/", import.meta.url).pathname;
const importedAt = "2026-08-23T18:00:00.000Z";
let builtPromise;

function built() {
  builtPromise ??= buildPharmacyRecoveryBundle({ target: "staging", importedAt });
  return builtPromise;
}

test("builds the governed Cloudflare D1 pharmacy identity and location source pack", async () => {
  const recovery = await built();
  assert.equal(recovery.bundle.database_name, "med250-staging");
  assert.deepEqual(recovery.bundle.counts, {
    pharmacies: 769,
    retail_pharmacies: 766,
    online_pharmacies: 3,
    geocoded_pharmacies: 93,
    known_numbers: 309,
    resolved_numbers: 280,
    ambiguous_numbers: 26,
    retired_numbers: 3,
    contacts: 283,
    login_enabled_contacts: 78,
    contact_pharmacies: 264,
    dispatch_eligible_pharmacies: 33,
  });
  assert.equal(recovery.pharmacies.length, 769);
  assert.equal(recovery.contacts.length, 283);
  assert.equal(recovery.knownNumbers.length, 309);
  assert.equal(new Set(recovery.contacts.map((row) => row.e164)).size, 283);
  assert.equal(new Set(recovery.knownNumbers.map((row) => row.e164)).size, 309);
  assert.match(recovery.bundle.source_snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.match(recovery.bundle.bundle_sha256, /^[a-f0-9]{64}$/);
  assert.match(recovery.sql, /med250_pharmacy_registry_import_receipts/);
  assert.match(recovery.sql, /resolution_status = 'ambiguous'/);
  assert.match(recovery.sql, /resolution_status = 'retired'/);
  assert.equal(recovery.contacts.filter((row) => row.active === 0 && row.dispatch_enabled === 0).length, 3);
  assert.equal(recovery.knownNumbers.filter((row) => row.resolution_status === "retired").length, 3);
  assert.match(recovery.sql, /source LIKE 'MED250 governed registry recovery:%'/);
  assert.doesNotMatch(recovery.sql, /\bBEGIN\b|\bCOMMIT\b|\bSAVEPOINT\b/);
  assert.doesNotMatch(recovery.sql, /@neondatabase|NEON_DATABASE_URL|supabase\.co|@supabase/i);
  await verifyPharmacyRecoveryBundle(recovery.bundle, recovery.sql);
});

test("executes against the canonical D1 schema, quarantines conflicts, and is idempotent", async () => {
  const recovery = await built();
  const database = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../db/d1/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((value) => value.endsWith(".sql")).sort()) {
      database.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    database.exec(recovery.sql);
    database.exec(recovery.sql);
    const counts = database.prepare(`
      SELECT
        (SELECT count(*) FROM med250_pharmacies) AS pharmacies,
        (SELECT count(*) FROM med250_pharmacies WHERE geocode_status = 'verified') AS geocoded,
        (SELECT count(*) FROM med250_pharmacies WHERE dispatch_enabled = 1) AS dispatch_eligible,
        (SELECT count(*) FROM med250_pharmacy_contacts) AS contacts,
        (SELECT count(*) FROM med250_pharmacy_contacts WHERE login_enabled = 1) AS login_contacts,
        (SELECT count(*) FROM med250_known_pharmacy_numbers) AS known_numbers,
        (SELECT count(*) FROM med250_known_pharmacy_numbers WHERE resolution_status = 'ambiguous') AS ambiguous_numbers,
        (SELECT count(*) FROM med250_known_pharmacy_numbers WHERE resolution_status = 'retired') AS retired_numbers,
        (SELECT count(*) FROM med250_pharmacy_registry_import_receipts) AS receipts
    `).get();
    assert.deepEqual({ ...counts }, {
      pharmacies: 769,
      geocoded: 93,
      dispatch_eligible: 33,
      contacts: 283,
      login_contacts: 78,
      known_numbers: 309,
      ambiguous_numbers: 26,
      retired_numbers: 3,
      receipts: 1,
    });
    const invariants = database.prepare(`
      SELECT
        (SELECT count(*) FROM med250_pharmacy_contacts contact
          LEFT JOIN med250_known_pharmacy_numbers number ON number.e164 = contact.e164
          WHERE contact.active = 1 AND (number.resolution_status <> 'resolved' OR number.pharmacy_id <> contact.pharmacy_id)) AS contact_classification_errors,
        (SELECT count(*) FROM med250_known_pharmacy_numbers number
          JOIN med250_pharmacy_contacts contact ON contact.e164 = number.e164
          WHERE number.resolution_status = 'ambiguous') AS ambiguous_contact_errors,
        (SELECT count(*) FROM med250_known_pharmacy_numbers number
          JOIN med250_pharmacy_contacts contact ON contact.e164 = number.e164
          WHERE number.resolution_status = 'retired'
            AND (contact.active <> 0 OR contact.dispatch_enabled <> 0 OR contact.login_enabled <> 0)) AS retired_contact_errors,
        (SELECT count(*) FROM med250_pharmacies pharmacy WHERE pharmacy.dispatch_enabled = 1 AND NOT (
          pharmacy.marketplace_approved = 1 AND pharmacy.licence_status = 'current'
          AND pharmacy.geocode_status = 'verified' AND pharmacy.latitude IS NOT NULL AND pharmacy.longitude IS NOT NULL
          AND EXISTS (SELECT 1 FROM med250_pharmacy_contacts contact
            WHERE contact.pharmacy_id = pharmacy.id AND contact.channel = 'whatsapp'
              AND contact.verified_at IS NOT NULL AND contact.active = 1 AND contact.dispatch_enabled = 1)
        )) AS dispatch_eligibility_errors,
        (SELECT count(*) FROM med250_pharmacy_contacts
          WHERE login_enabled = 1 AND source NOT IN (
            'MED250 governed registry recovery:fda_exact_roster',
            'MED250 governed registry recovery:mmi_exact_directory'
          )) AS login_authority_errors
    `).get();
    assert.deepEqual({ ...invariants }, {
      contact_classification_errors: 0,
      ambiguous_contact_errors: 0,
      retired_contact_errors: 0,
      dispatch_eligibility_errors: 0,
      login_authority_errors: 0,
    });
  } finally {
    database.close();
  }
});

test("preserves an operator-owned known-number decision and withholds completion receipt", async () => {
  const recovery = await built();
  const database = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../db/d1/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((value) => value.endsWith(".sql")).sort()) {
      database.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    const number = recovery.knownNumbers.find((row) => row.resolution_status === "resolved");
    database.prepare(`INSERT INTO med250_known_pharmacy_numbers (
      e164, resolution_status, pharmacy_id, source, source_evidence, reviewed_at, created_at, updated_at
    ) VALUES (?, 'ambiguous', NULL, 'operator_review', '{}', NULL, ?, ?)`)
      .run(number.e164, importedAt, importedAt);
    database.exec(recovery.sql);
    const observed = database.prepare("SELECT source, resolution_status FROM med250_known_pharmacy_numbers WHERE e164 = ?").get(number.e164);
    assert.deepEqual({ ...observed }, { source: "operator_review", resolution_status: "ambiguous" });
    assert.equal(database.prepare("SELECT count(*) AS count FROM med250_pharmacy_registry_import_receipts").get().count, 0);
  } finally {
    database.close();
  }
});

test("rejects bundle and SQL tampering before any Cloudflare command", async () => {
  const recovery = await built();
  await assert.rejects(
    verifyPharmacyRecoveryBundle({ ...recovery.bundle, database_name: "med250-production" }, recovery.sql),
    (error) => error instanceof PharmacyRecoveryError && error.code === "environment_mismatch",
  );
  await assert.rejects(
    verifyPharmacyRecoveryBundle(recovery.bundle, `${recovery.sql}\n-- tampered`),
    (error) => error instanceof PharmacyRecoveryError && error.code === "sql_checksum_mismatch",
  );
});

test("requires an explicit target-specific confirmation before remote apply", async (t) => {
  const recovery = await built();
  const directory = await mkdtemp(join(workRoot, "pharmacy-recovery-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writePharmacyRecoveryBundle(directory, recovery.bundle, recovery.sql);
  await readPharmacyRecoveryBundle(directory);
  await assert.rejects(
    execFileAsync(process.execPath, [
      "scripts/cloudflare-pharmacy-recovery.mjs", "apply", "--bundle", directory,
      "--confirm", "WRONG CONFIRMATION",
    ], { cwd: root }),
    (error) => {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      return /confirmation_required/.test(output) && /MED250 CLOUDFLARE PHARMACY STAGING/.test(output);
    },
  );
});
