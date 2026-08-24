import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildOperationsLaunchEvidence } from "../scripts/create-operations-launch-evidence.mjs";
import { evaluateOperationalHealth } from "../scripts/monitor-operational-health.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";

const healthySnapshot = {
  generated_at: "2026-07-14T10:00:00Z",
  privacy: { aggregate_only: true },
  pharmacies: {
    gps_ready: 1,
    dispatch_ready: 1,
    login_enabled_whatsapp_contacts: 1,
  },
  prescription_cleanup: { stale: false, expired_claims: 0 },
  orders: { waiting_without_confirmation_over_30m: 0 },
  pharmacy_auth: { otp_failed_24h: 0 },
  catalogue: { products_with_central_indicative_prices: 1, pharmacy_specific_price_records_in_use: 0 },
};

test("classifies a complete aggregate production snapshot as healthy", () => {
  const result = evaluateOperationalHealth(healthySnapshot);
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.critical, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.generatedAt, healthySnapshot.generated_at);
});

test("raises every fail-closed pharmacy and cleanup launch condition", () => {
  const result = evaluateOperationalHealth({
    ...healthySnapshot,
    privacy: { aggregate_only: false },
    pharmacies: { gps_ready: 0, dispatch_ready: 0, login_enabled_whatsapp_contacts: 0 },
    prescription_cleanup: { stale: true, expired_claims: 0 },
  });
  assert.equal(result.status, "critical");
  assert.equal(result.critical.length, 5);
  assert.ok(result.critical.some((message) => /approved GPS/.test(message)));
  assert.ok(result.critical.some((message) => /dispatch eligibility/.test(message)));
  assert.ok(result.critical.some((message) => /WhatsApp login/.test(message)));
  assert.ok(result.critical.some((message) => /cleanup/.test(message)));
});

test("reports recoverable operations, request, OTP and central-price issues as degraded", () => {
  const result = evaluateOperationalHealth({
    ...healthySnapshot,
    prescription_cleanup: { stale: false, expired_claims: 2 },
    orders: { waiting_without_confirmation_over_30m: 3 },
    pharmacy_auth: { otp_failed_24h: 4 },
    catalogue: { products_with_central_indicative_prices: 0, pharmacy_specific_price_records_in_use: 0 },
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.critical.length, 0);
  assert.equal(result.warnings.length, 4);
});

test("fails closed if operational health reports pharmacy-specific prices in use", () => {
  const result = evaluateOperationalHealth({
    ...healthySnapshot,
    catalogue: { products_with_central_indicative_prices: 2168, pharmacy_specific_price_records_in_use: 1 },
  });
  assert.equal(result.status, "critical");
  assert.ok(result.critical.some((message) => /pharmacy-specific catalogue prices/.test(message)));
});

test("builds GPS and WhatsApp launch evidence only from completed aggregate operations review results", async () => {
  const pendingGps = JSON.parse(await readFile(
    new URL("../docs/launch/evidence/gps-readiness-review-ledger-pending-2026-07-16.json", import.meta.url),
    "utf8",
  ));
  assert.throws(
    () => buildOperationsLaunchEvidence(pendingGps, { now: new Date("2026-07-17T10:00:00Z") }),
    /review_type must be gps_readiness|review result status must be complete/,
  );

  const common = {
    schema_version: "1",
    status: "complete",
    reviewed_by: "Named operations reviewer",
    reviewer_role: "Operations owner",
    reviewed_at: "2026-07-17T09:00:00Z",
    total_records: 769,
    pending_records: 0,
    blocked_records: 0,
    excluded_records: 100,
    private_ledger_reference: "controlled-operations-ledger-2026-07-17",
    source_digests: {
      retail_registry: "a".repeat(64),
      operational_health_snapshot: "b".repeat(64),
      private_review_summary: "c".repeat(64),
    },
  };
  const cases = [
    {
      ...common,
      gate: "MED250_GATE_GPS_READY",
      review_type: "gps_readiness",
      approved_records: 669,
    },
    {
      ...common,
      gate: "MED250_GATE_WHATSAPP_READY",
      review_type: "whatsapp_readiness",
      approved_pharmacies: 669,
      approved_login_contacts: 700,
    },
  ];

  for (const result of cases) {
    const artifact = buildOperationsLaunchEvidence(result, { now: new Date("2026-07-17T10:00:00Z") });
    assert.equal(artifact.evidence_type, "review_ledger");
    assert.equal(artifact.total_records, 769);
    assert.equal(artifact.pending_records, 0);
    assert.equal(artifact.blocked_records, 0);
    assert.equal(artifact.checks.every((check) => check.status === "passed"), true);
    const validation = validateLaunchEvidenceArtifact(artifact, {
      expectedGate: result.gate,
      expectedType: "review_ledger",
      now: new Date("2026-07-17T10:00:00Z"),
    });
    assert.equal(validation.valid, true, validation.errors.join("; "));
  }
});

test("rejects operational review results that expose private phone or coordinate details", () => {
  assert.throws(
    () => buildOperationsLaunchEvidence({
      schema_version: "1",
      gate: "MED250_GATE_WHATSAPP_READY",
      review_type: "whatsapp_readiness",
      status: "complete",
      reviewed_by: "Named operations reviewer",
      reviewer_role: "Operations owner",
      reviewed_at: "2026-07-17T09:00:00Z",
      total_records: 769,
      pending_records: 0,
      blocked_records: 0,
      approved_pharmacies: 669,
      approved_login_contacts: 700,
      excluded_records: 100,
      private_ledger_reference: "controlled-operations-ledger-2026-07-17",
      source_digests: { retail_registry: "a".repeat(64) },
      unsafe_note: "phone: 0781234567",
    }, { now: new Date("2026-07-17T10:00:00Z") }),
    /prohibited operational identifiers/,
  );
});
