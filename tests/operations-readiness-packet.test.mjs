import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildOperationsReadinessPacket } from "../scripts/create-operations-readiness-packet.mjs";
import { parseCsv } from "../scripts/import-data/verify-duplicate-register-review.mjs";

const [retailSource, onlineSource, gpsLedgerSource, whatsappLedgerSource] = await Promise.all([
  readFile(new URL("../data/imports/rwanda-fda-retail-pharmacies-may-2026.csv", import.meta.url), "utf8"),
  readFile(new URL("../data/imports/rwanda-fda-online-pharmacies-may-2026.csv", import.meta.url), "utf8"),
  readFile(new URL("../docs/launch/evidence/gps-readiness-review-ledger-pending-2026-07-16.json", import.meta.url), "utf8"),
  readFile(new URL("../docs/launch/evidence/whatsapp-readiness-review-ledger-pending-2026-07-16.json", import.meta.url), "utf8"),
]);

const packet = buildOperationsReadinessPacket({
  retailRows: parseCsv(retailSource).rows,
  onlineRows: parseCsv(onlineSource).rows,
  gpsLedger: JSON.parse(gpsLedgerSource),
  whatsappLedger: JSON.parse(whatsappLedgerSource),
  sourceDigests: {
    retail_registry: { path: "retail.csv", sha256: "a".repeat(64) },
    online_registry: { path: "online.csv", sha256: "b".repeat(64) },
  },
});

test("builds a complete operations readiness packet for GPS and WhatsApp review", () => {
  assert.equal(packet.release, "med250-production");
  assert.equal(packet.summary.registry_record_count, 769);
  assert.equal(packet.summary.retail_record_count, 766);
  assert.equal(packet.summary.online_record_count, 3);
  assert.equal(packet.review_sections.length, 2);
  assert.deepEqual(packet.review_sections.map((section) => section.gate), [
    "MED250_GATE_GPS_READY",
    "MED250_GATE_WHATSAPP_READY",
  ]);
  assert.ok(packet.review_sections.every((section) => section.rows.length === 769));
  assert.equal(packet.review_sections[0].current_artifact.pending_records, 676);
  assert.equal(packet.review_sections[1].current_artifact.pending_records, 469);
});

test("keeps operations packet decision-neutral and privacy-safe", () => {
  const serialized = JSON.stringify(packet);
  assert.ok(packet.review_sections.every((section) => section.rows.every((row) => row.decision === null)));
  assert.ok(packet.review_sections[0].allowed_decisions.includes("approved_authoritative_gps"));
  assert.ok(packet.review_sections[1].allowed_decisions.includes("approved_authorised_whatsapp"));
  assert.doesNotMatch(serialized, /(?:\+?250)?7\d{8}/);
  assert.doesNotMatch(serialized, /-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/);
  assert.doesNotMatch(serialized, /access[_-]?token|authorization:\s*bearer|password/i);
});
