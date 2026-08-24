import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";

import {
  CatalogueRecoveryError,
  buildCatalogueRecoveryBundle,
  readCatalogueRecoveryBundle,
  verifyCatalogueRecoveryBundle,
  writeCatalogueRecoveryBundle,
} from "../scripts/cloudflare-catalogue-recovery.mjs";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const workRoot = new URL("../work/", import.meta.url).pathname;
const importedAt = "2026-08-23T15:00:00.000Z";
let builtPromise;

function built() {
  builtPromise ??= buildCatalogueRecoveryBundle({ target: "staging", importedAt });
  return builtPromise;
}

test("builds the complete governed Cloudflare D1 catalogue source pack", async () => {
  const recovery = await built();
  assert.equal(recovery.bundle.database_name, "med250-staging");
  assert.deepEqual(recovery.bundle.counts, {
    source_rows: 4_680,
    fda_rows: 2_480,
    fda_orderable_rows: 2_459,
    consumer_rows: 2_200,
    consumer_orderable_rows: 2_198,
    consumer_excluded_rows: 2,
    public_orderable_rows: 4_657,
    taxonomy_pairs: 25,
  });
  assert.equal(recovery.rows.length, 4_680);
  assert.equal(new Set(recovery.rows.map((row) => row.id)).size, 4_680);
  assert.match(recovery.bundle.source_snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.match(recovery.bundle.bundle_sha256, /^[a-f0-9]{64}$/);
  assert.match(recovery.sql, /med250_catalogue_import_receipts/);
  assert.match(recovery.sql, /INSERT OR IGNORE INTO med250_catalogue_import_receipts/);
  assert.ok(recovery.sql.lastIndexOf("med250_catalogue_import_receipts") > recovery.sql.lastIndexOf("ON CONFLICT(id) DO UPDATE"));
  assert.doesNotMatch(recovery.sql, /\bBEGIN\b|\bCOMMIT\b|\bSAVEPOINT\b/);
  assert.match(recovery.sql, /source_kind IN \('rwanda_fda', 'governed_consumer_catalogue', 'local_governed_snapshot'\)/);
  assert.doesNotMatch(recovery.sql, /amazon_price_usd|@supabase|@neondatabase|SUPABASE_URL|NEON_DATABASE_URL/i);
  await verifyCatalogueRecoveryBundle(recovery.bundle, recovery.sql);
});

test("executes completely against the canonical D1 schema and remains idempotent", async () => {
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
        count(*) AS source_rows,
        sum(CASE WHEN source_kind = 'rwanda_fda' THEN 1 ELSE 0 END) AS fda_rows,
        sum(CASE WHEN source_kind = 'rwanda_fda' AND is_orderable = 1 THEN 1 ELSE 0 END) AS fda_orderable_rows,
        sum(CASE WHEN source_kind = 'governed_consumer_catalogue' THEN 1 ELSE 0 END) AS consumer_rows,
        sum(CASE WHEN source_kind = 'governed_consumer_catalogue' AND is_orderable = 1 THEN 1 ELSE 0 END) AS consumer_orderable_rows,
        sum(CASE WHEN publication_status = 'approved' AND is_active = 1 AND is_orderable = 1 THEN 1 ELSE 0 END) AS public_orderable_rows,
        sum(CASE WHEN source_kind = 'governed_consumer_catalogue' AND publication_status = 'rejected' THEN 1 ELSE 0 END) AS consumer_excluded_rows
      FROM med250_catalogue_products
    `).get();
    assert.deepEqual({ ...counts }, {
      source_rows: 4_680,
      fda_rows: 2_480,
      fda_orderable_rows: 2_459,
      consumer_rows: 2_200,
      consumer_orderable_rows: 2_198,
      public_orderable_rows: 4_657,
      consumer_excluded_rows: 2,
    });
    const receipt = database.prepare("SELECT source_row_count, inserted_count, updated_count, target FROM med250_catalogue_import_receipts").get();
    assert.deepEqual({ ...receipt }, { source_row_count: 4_680, inserted_count: 4_680, updated_count: 0, target: "staging" });
  } finally {
    database.close();
  }
});

test("rejects bundle and SQL tampering before any Cloudflare command", async () => {
  const recovery = await built();
  await assert.rejects(
    verifyCatalogueRecoveryBundle({ ...recovery.bundle, database_name: "med250-production" }, recovery.sql),
    (error) => error instanceof CatalogueRecoveryError && error.code === "environment_mismatch",
  );
  await assert.rejects(
    verifyCatalogueRecoveryBundle(recovery.bundle, `${recovery.sql}\n-- tampered`),
    (error) => error instanceof CatalogueRecoveryError && error.code === "sql_checksum_mismatch",
  );
});

test("requires an explicit target-specific confirmation before remote apply", async (t) => {
  const recovery = await built();
  const directory = await mkdtemp(join(workRoot, "catalogue-recovery-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeCatalogueRecoveryBundle(directory, recovery.bundle, recovery.sql);
  await readCatalogueRecoveryBundle(directory);
  await assert.rejects(
    execFileAsync(process.execPath, [
      "scripts/cloudflare-catalogue-recovery.mjs", "apply", "--bundle", directory,
      "--confirm", "WRONG CONFIRMATION",
    ], { cwd: root }),
    (error) => {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      return /confirmation_required/.test(output) && /MED250 CLOUDFLARE CATALOGUE STAGING/.test(output);
    },
  );
});
