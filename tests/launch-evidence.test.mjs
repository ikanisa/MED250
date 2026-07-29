import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  expectedLaunchGateNames,
  validateLaunchEvidence,
} from "../scripts/validate-launch-evidence.mjs";

const manifest = JSON.parse(await readFile(
  new URL("../data/launch-evidence.json", import.meta.url),
  "utf8",
));

test("keeps all eleven production gates in a structurally valid evidence registry", () => {
  const result = validateLaunchEvidence(manifest, {
    rootDir: new URL("..", import.meta.url).pathname,
    now: new Date("2026-07-29T15:00:00Z"),
  });
  assert.equal(result.valid, true);
  assert.equal(result.gateCount, 11);
  assert.deepEqual(Object.keys(manifest.gates).sort(), [...expectedLaunchGateNames].sort());
  assert.deepEqual(result.statusCounts, { pending: 11, confirmed: 0, rejected: 0, invalid: 0 });
  assert.match(manifest.gates.MED250_GATE_DOMAIN_DNS_VERIFIED.acceptance, /med-250\.com/);
  assert.doesNotMatch(manifest.gates.MED250_GATE_DOMAIN_DNS_VERIFIED.acceptance, /med250\.gikundiro\.com/);
});

test("blocks production while any launch evidence remains pending", () => {
  const result = validateLaunchEvidence(manifest, {
    strict: true,
    rootDir: new URL("..", import.meta.url).pathname,
    now: new Date("2026-07-29T15:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.filter((error) => /production requires confirmed evidence/.test(error)).length, 11);
});

test("accepts confirmed gates only with durable evidence and named approval", () => {
  const confirmed = structuredClone(manifest);
  for (const [gateName, gate] of Object.entries(confirmed.gates)) {
    gate.status = "confirmed";
    gate.approved_by = "Named release approver";
    gate.approved_role = "Release owner";
    gate.approved_at = "2026-07-14T10:00:00Z";
    gate.evidence = gate.required_evidence_types.map((type, index) => ({
      type,
      reference: `https://evidence.example/${gateName.toLowerCase()}/${index + 1}`,
      recorded_at: "2026-07-14T09:00:00Z",
      summary: "Controlled release evidence retained for the regression test.",
      remote_verified_by: "Named evidence verifier",
      remote_verifier_role: "Evidence custodian",
      remote_verified_at: "2026-07-14T09:30:00Z",
    }));
  }
  const result = validateLaunchEvidence(confirmed, {
    strict: true,
    rootDir: new URL("..", import.meta.url).pathname,
    now: new Date("2026-07-14T12:00:00Z"),
  });
  assert.equal(result.valid, true);
  assert.equal(result.statusCounts.confirmed, 11);
});

test("rejects missing gates, evidence-free confirmations and secret-like references", () => {
  const unsafe = structuredClone(manifest);
  delete unsafe.gates.MED250_GATE_GPS_READY;
  const whatsapp = unsafe.gates.MED250_GATE_WHATSAPP_READY;
  whatsapp.status = "confirmed";
  whatsapp.approved_by = "Approver";
  whatsapp.approved_role = "Security owner";
  whatsapp.approved_at = "2026-07-14T10:00:00Z";
  whatsapp.evidence = [{
    type: "account_verification",
    reference: "https://example.com/receipt?token=do-not-store-this",
    recorded_at: "2026-07-14T09:00:00Z",
    summary: "Redacted verification receipt for the intended account.",
  }];
  const result = validateLaunchEvidence(unsafe, {
    rootDir: new URL("..", import.meta.url).pathname,
    now: new Date("2026-07-14T12:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /missing launch evidence gate MED250_GATE_GPS_READY/.test(error)));
  assert.ok(result.errors.some((error) => /contains secret-like material/.test(error)));
});

test("requires gate-specific evidence, approver roles, and matching repository digests", () => {
  const unsafe = structuredClone(manifest);
  const gps = unsafe.gates.MED250_GATE_GPS_READY;
  gps.status = "confirmed";
  gps.approved_by = "Operations approver";
  gps.approved_role = "Operations lead";
  gps.approved_at = "2026-07-14T10:00:00Z";
  gps.evidence = [{
    type: "operations_snapshot",
    reference: "README.md",
    sha256: "0".repeat(64),
    recorded_at: "2026-07-14T09:00:00Z",
    summary: "Controlled operations snapshot for the approved pharmacy set.",
  }];
  const result = validateLaunchEvidence(unsafe, {
    rootDir: new URL("..", import.meta.url).pathname,
    now: new Date("2026-07-14T12:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /without required review_ledger evidence/.test(error)));
  assert.ok(result.errors.some((error) => /SHA-256 digest does not match/.test(error)));
});

test("rejects evidence and approval timestamps without an explicit timezone", () => {
  const unsafe = structuredClone(manifest);
  const turnstile = unsafe.gates.MED250_GATE_TURNSTILE_SERVER_VERIFIED;
  turnstile.status = "confirmed";
  turnstile.approved_by = "Security approver";
  turnstile.approved_role = "Security owner";
  turnstile.approved_at = "2026-07-14T10:00:00";
  turnstile.evidence = [{
    type: "test_record",
    reference: "https://evidence.example/turnstile-test",
    recorded_at: "2026-07-14T09:00:00",
    summary: "Controlled Turnstile rejection and acceptance test record.",
  }];
  const result = validateLaunchEvidence(unsafe, {
    rootDir: new URL("..", import.meta.url).pathname,
    now: new Date("2026-07-14T12:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /needs a timezone-qualified recorded_at timestamp/.test(error)));
  assert.ok(result.errors.some((error) => /without a timezone-qualified approved_at timestamp/.test(error)));
});
