import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPhysicalUatLaunchEvidence } from "../scripts/create-physical-uat-launch-evidence.mjs";
import { buildPhysicalUatPacket } from "../scripts/create-physical-uat-packet.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";
import { validatePhysicalUat } from "../scripts/validate-physical-uat.mjs";

const ledger = JSON.parse(await readFile(new URL("../data/physical-device-uat.json", import.meta.url), "utf8"));

test("keeps the complete pending physical-device UAT ledger valid but not production-ready", () => {
  const result = validatePhysicalUat(ledger, { rootDir: new URL("..", import.meta.url).pathname });
  assert.equal(result.valid, true);
  assert.equal(result.scenarioCount, 12);
  assert.equal(result.statusCounts.pending, 12);
  const strict = validatePhysicalUat(ledger, { strict: true, rootDir: new URL("..", import.meta.url).pathname });
  assert.equal(strict.valid, false);
  assert.equal(strict.errors.filter((error) => /production UAT requires passed evidence/.test(error)).length, 12);
});

test("builds a deterministic privacy-safe UAT execution packet", () => {
  const packet = buildPhysicalUatPacket(ledger, {
    ledgerPath: "data/physical-device-uat.json",
    ledgerSha256: "a".repeat(64),
  });

  assert.equal(packet.source_ledger.scenario_count, 12);
  assert.equal(packet.source_ledger.status_counts.pending, 12);
  assert.equal(packet.scenarios.length, 12);
  assert.deepEqual(packet.required_run_metadata, [
    "customer_identity_label",
    "pharmacy_identity_label",
    "unrelated_pharmacy_identity_label",
    "executed_by",
    "started_at",
    "completed_at",
    "approved_by",
    "approved_role",
    "approved_at",
  ]);
  const serialized = JSON.stringify(packet);
  assert.match(serialized, /No unintended pharmacy/);
  assert.doesNotMatch(serialized, /(?:\\+?250)?7\\d{8}|OTP:\\s*\\d{6}|order id:/i);
});

test("accepts a complete redacted UAT record with evidence and named approval", () => {
  const complete = structuredClone(ledger);
  complete.status = "passed";
  complete.customer_identity_label = "customer-uat-a";
  complete.pharmacy_identity_label = "pharmacy-uat-a";
  complete.unrelated_pharmacy_identity_label = "pharmacy-control-b";
  complete.executed_by = "Named QA operator";
  complete.started_at = "2026-07-14T08:00:00Z";
  complete.completed_at = "2026-07-14T09:00:00Z";
  complete.approved_by = "Named QA approver";
  complete.approved_role = "QA owner";
  complete.approved_at = "2026-07-14T09:30:00Z";
  for (const scenario of Object.values(complete.scenarios)) {
    scenario.status = "passed";
    scenario.evidence_reference = "README.md";
    scenario.note = "Redacted controlled-device outcome retained for verification.";
  }
  const result = validatePhysicalUat(complete, {
    strict: true,
    rootDir: new URL("..", import.meta.url).pathname,
    now: new Date("2026-07-14T10:00:00Z"),
  });
  assert.equal(result.valid, true);
  assert.equal(result.statusCounts.passed, 12);
});

test("builds strict launch evidence only from a completed physical UAT ledger", () => {
  assert.throws(
    () => buildPhysicalUatLaunchEvidence(ledger, {
      ledgerSha256: "a".repeat(64),
      now: new Date("2026-07-14T10:00:00Z"),
    }),
    /Physical UAT ledger is not production-ready/,
  );

  const complete = structuredClone(ledger);
  complete.status = "passed";
  complete.customer_identity_label = "customer-uat-a";
  complete.pharmacy_identity_label = "pharmacy-uat-a";
  complete.unrelated_pharmacy_identity_label = "pharmacy-control-b";
  complete.executed_by = "Named QA operator";
  complete.started_at = "2026-07-14T08:00:00Z";
  complete.completed_at = "2026-07-14T09:00:00Z";
  complete.approved_by = "Named QA approver";
  complete.approved_role = "QA owner";
  complete.approved_at = "2026-07-14T09:30:00Z";
  for (const scenario of Object.values(complete.scenarios)) {
    scenario.status = "passed";
    scenario.evidence_reference = "README.md";
    scenario.note = "Redacted controlled-device outcome retained for verification.";
  }

  const { testRecord, signedApproval } = buildPhysicalUatLaunchEvidence(complete, {
    ledgerSha256: "a".repeat(64),
    now: new Date("2026-07-14T10:00:00Z"),
  });

  assert.equal(testRecord.evidence_type, "test_record");
  assert.equal(testRecord.checks.length, 12);
  assert.equal(testRecord.passed_scenarios, 12);
  assert.equal(testRecord.pending_scenarios, 0);
  assert.equal(signedApproval.evidence_type, "signed_approval");
  assert.equal(signedApproval.decision, "approved");
  assert.equal(signedApproval.approved_by, "Named QA approver");
  for (const artifact of [testRecord, signedApproval]) {
    const validation = validateLaunchEvidenceArtifact(artifact, {
      expectedGate: "MED250_GATE_PHYSICAL_UAT_PASSED",
      expectedType: artifact.evidence_type,
      now: new Date("2026-07-14T10:00:00Z"),
    });
    assert.equal(validation.valid, true, validation.errors.join("; "));
  }
});

test("rejects phone numbers, OTPs, UUID order IDs, secrets and incomplete evidence", () => {
  const unsafe = structuredClone(ledger);
  unsafe.customer_identity_label = "+250788123456";
  unsafe.scenarios.WHATSAPP_OTP_LIFECYCLE.status = "passed";
  unsafe.scenarios.WHATSAPP_OTP_LIFECYCLE.evidence_reference = "https://evidence.example/run?token=secret";
  unsafe.scenarios.WHATSAPP_OTP_LIFECYCLE.note = "OTP: 123456; order id: 123e4567-e89b-12d3-a456-426614174000; -1.944100, 30.061900";
  const result = validatePhysicalUat(unsafe, { rootDir: new URL("..", import.meta.url).pathname });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /customer_identity_label contains/.test(error)));
  assert.ok(result.errors.some((error) => /evidence contains secret-like material/.test(error)));
  assert.ok(result.errors.some((error) => /note contains a prohibited identifier/.test(error)));
});
