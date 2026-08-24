import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  MED250_SUPABASE_PROJECT_REF,
  buildDashboardRecovery,
  parseDashboardCsv,
  parsePostgisPoint,
  prepareDashboardManifest,
  verifyRecoveryPreflight,
  verifyRecoveryReadback,
} from "../scripts/dashboard-recovery.mjs";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;
const wrangler = new URL("../node_modules/.bin/wrangler", import.meta.url).pathname;
const exportedAt = "2026-08-23T12:00:00.000Z";
const importedAt = "2026-08-23T12:30:00.000Z";

function csv(headers, rows) {
  const cell = (value) => {
    if (value === null || value === undefined) return "";
    const source = String(value);
    return /[",\r\n]/.test(source) ? `"${source.replaceAll('"', '""')}"` : source;
  };
  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => cell(row[header])).join(",")).join("\n")}\n`;
}

async function writeTable(directory, table, headers, rows) {
  await writeFile(join(directory, `${table}.csv`), csv(headers, rows));
}

async function fixtureBundle(directory) {
  const pharmacyId = "10000000-0000-4000-8000-000000000001";
  const contactId = "20000000-0000-4000-8000-000000000001";
  const userId = "30000000-0000-4000-8000-000000000001";
  const orderId = "40000000-0000-4000-8000-000000000001";
  const itemId = "50000000-0000-4000-8000-000000000001";
  const offerId = "60000000-0000-4000-8000-000000000001";
  const offerItemId = "70000000-0000-4000-8000-000000000001";
  const productId = "RWA-FDA-HM-0001";
  await writeTable(directory, "dawanear_pharmacies", [
    "id", "name", "location", "license_expires_on", "marketplace_approved", "is_active",
    "geocode_status", "geocode_provider", "registry_type", "fda_source_serial", "source_name",
    "created_at", "updated_at",
  ], [{
    id: pharmacyId, name: "Kigali Recovery Pharmacy", location: "SRID=4326;POINT(30.0619 -1.9441)",
    license_expires_on: "2027-12-31", marketplace_approved: true, is_active: true,
    geocode_status: "verified", geocode_provider: "governed_registry_import", registry_type: "retail",
    fda_source_serial: 1, source_name: "Rwanda FDA", created_at: exportedAt, updated_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_pharmacy_contacts", [
    "id", "pharmacy_id", "contact_type", "e164", "is_primary", "is_login_enabled",
    "verification_status", "source_type", "source_name", "verified_at", "created_at", "updated_at",
  ], [{
    id: contactId, pharmacy_id: pharmacyId, contact_type: "whatsapp", e164: "250788000001",
    is_primary: true, is_login_enabled: true, verification_status: "admin_verified", source_type: "admin",
    source_name: "MED250 governed registry", verified_at: exportedAt, created_at: exportedAt, updated_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_products", [
    "id", "source_register", "source_serial", "brand_name", "generic_name", "product_type", "category",
    "prescription_status", "regulatory_status", "is_orderable", "is_active", "source_name", "created_at", "updated_at",
  ], [{
    id: productId, source_register: "Rwanda FDA Human Medicines", source_serial: 1,
    brand_name: "Recovery Medicine", generic_name: "Paracetamol", product_type: "human_medicine",
    category: "Medicines", prescription_status: "non_prescription", regulatory_status: "valid",
    is_orderable: true, is_active: true, source_name: "Rwanda FDA", created_at: exportedAt, updated_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_product_images", [
    "product_id", "position", "public_url", "source_page_url", "source_image_url", "source_domain",
    "source_kind", "rights_basis", "width", "height", "quality_score", "content_sha256",
    "perceptual_hash", "background_removed", "approved", "checked_at", "created_at",
  ], [{
    product_id: productId, position: 1, public_url: "https://legacy.invalid/recovery.webp",
    source_page_url: "https://manufacturer.invalid/recovery", source_image_url: "https://manufacturer.invalid/recovery.webp",
    source_domain: "manufacturer.invalid", source_kind: "manufacturer", rights_basis: "Manufacturer product media",
    width: 800, height: 800, quality_score: 90, content_sha256: "a".repeat(64),
    perceptual_hash: "b".repeat(16), background_removed: true, approved: true,
    checked_at: exportedAt, created_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_customer_profiles", [
    "user_id", "whatsapp", "whatsapp_verified_at", "preferred_language", "created_at", "updated_at",
  ], [{
    user_id: userId, whatsapp: "250788900001", whatsapp_verified_at: exportedAt,
    preferred_language: "en", created_at: exportedAt, updated_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_orders", [
    "id", "reference", "user_id", "client_request_id", "status", "customer_location", "location_accuracy_m",
    "whatsapp", "delivery_preference", "substitutes_allowed", "prescription_path", "selected_offer_id",
    "selected_at", "created_at", "broadcast_at", "expires_at", "updated_at",
  ], [{
    id: orderId, reference: "DN-RECOVERY1", user_id: userId,
    client_request_id: "80000000-0000-4000-8000-000000000001", status: "offers_received",
    customer_location: "POINT(30.0600 -1.9500)", location_accuracy_m: 15, whatsapp: "250788900001",
    delivery_preference: "either", substitutes_allowed: true, prescription_path: null,
    selected_offer_id: null, selected_at: null, created_at: exportedAt, broadcast_at: exportedAt,
    expires_at: "2026-08-23T14:00:00.000Z", updated_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_order_items", [
    "id", "order_id", "product_id", "quantity", "customer_min_rwf", "customer_max_rwf",
    "substitutes_allowed", "created_at",
  ], [{
    id: itemId, order_id: orderId, product_id: productId, quantity: 2,
    customer_min_rwf: 1000, customer_max_rwf: 3000, substitutes_allowed: true, created_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_order_recipients", [
    "order_id", "pharmacy_id", "distance_m", "notified_at", "viewed_at",
  ], [{ order_id: orderId, pharmacy_id: pharmacyId, distance_m: 1200, notified_at: exportedAt, viewed_at: null }]);
  await writeTable(directory, "dawanear_offers", [
    "id", "order_id", "pharmacy_id", "status", "complete", "total_rwf", "fulfilment_method",
    "ready_in_minutes", "note", "created_at", "submitted_at", "updated_at",
  ], [{
    id: offerId, order_id: orderId, pharmacy_id: pharmacyId, status: "submitted", complete: true,
    total_rwf: 4000, fulfilment_method: "pickup", ready_in_minutes: 20, note: "Available",
    created_at: exportedAt, submitted_at: exportedAt, updated_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_offer_items", [
    "id", "offer_id", "order_item_id", "offered_product_id", "available", "is_substitute",
    "unit_price_rwf", "quantity", "note", "created_at",
  ], [{
    id: offerItemId, offer_id: offerId, order_item_id: itemId, offered_product_id: productId,
    available: true, is_substitute: false, unit_price_rwf: 2000, quantity: 2, note: null, created_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_central_price_contributions", [
    "id", "product_id", "pharmacy_id", "submitted_price_rwf", "previous_central_price_rwf",
    "resulting_central_price_rwf", "outcome", "created_at",
  ], [{
    id: "90000000-0000-4000-8000-000000000001", product_id: productId, pharmacy_id: pharmacyId,
    submitted_price_rwf: 2000, previous_central_price_rwf: null, resulting_central_price_rwf: 2000,
    outcome: "initialized", created_at: exportedAt,
  }]);
  await writeTable(directory, "dawanear_public_metric_approvals", [
    "metric_key", "approved", "reviewed_by", "evidence_reference", "approved_at", "expires_at", "updated_at",
  ], [{
    metric_key: "ready_pharmacy_count", approved: true, reviewed_by: "Operations owner",
    evidence_reference: "recovery-fixture", approved_at: exportedAt, expires_at: "2026-09-23T12:00:00.000Z",
    updated_at: exportedAt,
  }]);
}

test("parses browser CSV quoting and supported PostGIS points without losing nulls", () => {
  const parsed = parseDashboardCsv('id,note,empty\n1,"line one\nline ""two""",\n2,"",value\n');
  assert.equal(parsed.rows[0].payload.note, 'line one\nline "two"');
  assert.equal(parsed.rows[0].payload.empty, null);
  assert.equal(parsed.rows[1].payload.note, "");
  assert.deepEqual(parsePostgisPoint("SRID=4326;POINT(30.0619 -1.9441)"), { longitude: 30.0619, latitude: -1.9441 });
});

test("builds, imports, and readback-verifies a checksum-bound D1 recovery bundle", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "med250-dashboard-recovery-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, "source");
  const output = join(temp, "output");
  const persistTo = join(temp, "d1");
  await mkdir(source);
  await fixtureBundle(source);
  const manifestPath = join(source, "manifest.json");
  const manifest = await prepareDashboardManifest({
    sourceDir: source, projectRef: MED250_SUPABASE_PROJECT_REF, exportedAt, outputPath: manifestPath,
  });
  assert.equal(manifest.tables.length, 12);
  const plan = await buildDashboardRecovery({ manifestPath, target: "staging", importedAt, outputDir: output });
  assert.equal(plan.canonical_table_counts.med250_client_requests, 1);
  assert.equal(plan.canonical_table_counts.med250_known_pharmacy_numbers, 1);

  await execFileAsync(wrangler, [
    "d1", "migrations", "apply", "med250-local", "--local", "--config", "wrangler.jsonc", "--persist-to", persistTo,
  ], { cwd: root });
  const preflight = await execFileAsync(wrangler, [
    "d1", "execute", "med250-local", "--local", "--json", "--config", "wrangler.jsonc", "--persist-to", persistTo,
    "--file", join(output, "preflight-readback.sql"),
  ], { cwd: root });
  const preflightPath = join(output, "preflight.json");
  await writeFile(preflightPath, preflight.stdout);
  await verifyRecoveryPreflight({ planPath: join(output, "recovery-plan.json"), readbackPath: preflightPath });

  await execFileAsync(wrangler, [
    "d1", "execute", "med250-local", "--local", "--config", "wrangler.jsonc", "--persist-to", persistTo,
    "--file", join(output, "recovery-import.sql"),
  ], { cwd: root });
  const postimport = await execFileAsync(wrangler, [
    "d1", "execute", "med250-local", "--local", "--json", "--config", "wrangler.jsonc", "--persist-to", persistTo,
    "--file", join(output, "postimport-readback.sql"),
  ], { cwd: root });
  const postimportPath = join(output, "postimport.json");
  await writeFile(postimportPath, postimport.stdout);
  const receiptPath = join(output, "verification-receipt.sql");
  await verifyRecoveryReadback({
    planPath: join(output, "recovery-plan.json"), readbackPath: postimportPath,
    verifiedAt: "2026-08-23T12:40:00.000Z", receiptOutput: receiptPath,
  });
  await execFileAsync(wrangler, [
    "d1", "execute", "med250-local", "--local", "--config", "wrangler.jsonc", "--persist-to", persistTo,
    "--file", receiptPath,
  ], { cwd: root });

  const result = await execFileAsync(wrangler, [
    "d1", "execute", "med250-local", "--local", "--json", "--config", "wrangler.jsonc", "--persist-to", persistTo,
    "--command", `SELECT
      (SELECT COUNT(*) FROM med250_dashboard_recovery_rows) AS raw_rows,
      (SELECT COUNT(*) FROM med250_dashboard_recovery_verifications) AS verifications,
      (SELECT dispatch_limit FROM med250_client_requests LIMIT 1) AS dispatch_limit,
      (SELECT actor_type FROM med250_actors WHERE e164 = '250788900001') AS client_type,
      (SELECT resolution_status FROM med250_known_pharmacy_numbers WHERE e164 = '250788000001') AS pharmacy_number_status,
      (SELECT approved FROM med250_product_images LIMIT 1) AS recovered_image_approved`,
  ], { cwd: root });
  const row = JSON.parse(result.stdout)[0].results[0];
  assert.equal(row.raw_rows, 12);
  assert.equal(row.verifications, 1);
  assert.equal(row.dispatch_limit, 10);
  assert.equal(row.client_type, "client");
  assert.equal(row.pharmacy_number_status, "resolved");
  assert.equal(row.recovered_image_approved, 0);
});

test("fails closed on tampered exports and prohibited OTP tables", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "med250-dashboard-recovery-tamper-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await fixtureBundle(temp);
  const manifestPath = join(temp, "manifest.json");
  await prepareDashboardManifest({
    sourceDir: temp, projectRef: MED250_SUPABASE_PROJECT_REF, exportedAt, outputPath: manifestPath,
  });
  await writeFile(join(temp, "dawanear_products.csv"), `${await readFile(join(temp, "dawanear_products.csv"), "utf8")}\n`);
  await assert.rejects(
    buildDashboardRecovery({ manifestPath, target: "staging", importedAt, outputDir: join(temp, "out") }),
    /changed after the manifest/,
  );

  const sensitive = join(temp, "sensitive");
  await mkdir(sensitive);
  await writeTable(sensitive, "dawanear_pharmacies", ["id", "name"], [{ id: "p1", name: "Pharmacy" }]);
  await writeTable(sensitive, "dawanear_pharmacy_contacts", ["id", "pharmacy_id", "contact_type", "e164"], []);
  await writeTable(sensitive, "dawanear_products", ["id", "brand_name"], [{ id: "x", brand_name: "Medicine" }]);
  await writeTable(sensitive, "dawanear_customer_otp_challenges", ["id", "code_hash"], [{ id: "o1", code_hash: "a".repeat(64) }]);
  await assert.rejects(
    prepareDashboardManifest({
      sourceDir: sensitive, projectRef: MED250_SUPABASE_PROJECT_REF,
      exportedAt, outputPath: join(sensitive, "manifest.json"),
    }),
    /prohibited/,
  );
});
