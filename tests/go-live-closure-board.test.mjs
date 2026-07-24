import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createLaunchEvidenceHandoff,
  discoverPreparedLaunchEvidence,
} from "../scripts/create-launch-evidence-template.mjs";
import { buildGoLiveClosureBoard } from "../scripts/create-go-live-closure-board.mjs";
import { buildGoLiveReadinessReport } from "../scripts/report-go-live-readiness.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/launch-evidence.json", import.meta.url), "utf8"));
const handoff = createLaunchEvidenceHandoff(manifest, await discoverPreparedLaunchEvidence());
const readinessReport = await buildGoLiveReadinessReport();
const board = buildGoLiveClosureBoard({ manifest, handoff, readinessReport });

test("builds an owner closure board without promoting pending gates", () => {
  assert.equal(board.release, "med250-production");
  assert.equal(board.classification, "go-live closure board; execution aid only, not evidence or approval");
  assert.equal(board.production_ready, false);
  assert.equal(board.summary.gate_count, 11);
  assert.equal(board.summary.confirmed_gates, 0);
  assert.equal(board.summary.approval_pending_gates, 0);
  assert.equal(board.summary.prepared_evidence_pending_gates, 10);
  assert.equal(board.summary.missing_evidence_gates, 0);
  assert.equal(board.summary.stale_release_evidence_gates, 1);
  assert.equal(board.summary.duplicate_register_pending_groups, 51);
  assert.equal(board.summary.physical_uat_pending_scenarios, 12);
  assert.equal(board.summary.prepared_handoff_artifacts, 15);
  assert.equal(board.summary.required_handoff_artifacts, 15);
  assert.equal(board.gates.length, 11);
  assert.ok(board.gates.every((gate) => gate.current_status === "pending"));
  assert.ok(board.gates.every((gate) => gate.approval.required));
  assert.ok(board.gates.every((gate) => gate.approval.complete === false));
});

test("orders closure work so source review and operations precede final UAT", () => {
  assert.deepEqual(board.closure_order, [
    "MED250_GATE_DUPLICATE_REGISTER_REVIEWED",
    "MED250_GATE_GPS_READY",
    "MED250_GATE_WHATSAPP_READY",
    "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
    "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
    "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
    "MED250_GATE_AUTH_RATE_LIMITS_APPROVED",
    "MED250_GATE_PRESCRIPTION_RETENTION_APPROVED",
    "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED",
    "MED250_GATE_DOMAIN_DNS_VERIFIED",
    "MED250_GATE_PHYSICAL_UAT_PASSED",
  ]);
  assert.deepEqual(board.gates.map((gate) => gate.gate), board.closure_order);
});

test("binds every gate to actionable owner commands and prepared evidence", () => {
  const byGate = new Map(board.gates.map((gate) => [gate.gate, gate]));
  const gps = byGate.get("MED250_GATE_GPS_READY");
  const duplicate = byGate.get("MED250_GATE_DUPLICATE_REGISTER_REVIEWED");
  const security = byGate.get("MED250_GATE_SECURITY_HARDENING_DEPLOYED");
  const domain = byGate.get("MED250_GATE_DOMAIN_DNS_VERIFIED");
  const uat = byGate.get("MED250_GATE_PHYSICAL_UAT_PASSED");

  assert.equal(gps.workstream, "operations");
  assert.deepEqual(gps.evidence.missing_types, ["review_ledger"]);
  assert.equal(gps.evidence.prepared_pending[0].reference, "docs/launch/evidence/gps-readiness-review-ledger-pending-2026-07-16.json");
  assert.match(gps.evidence.prepared_pending[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(gps.evidence.prepared_pending[0].byte_length > 0);
  assert.ok(gps.commands.includes("npm run ops:readiness:packet"));

  assert.equal(duplicate.workstream, "register-data");
  assert.match(duplicate.blockers.join("\n"), /51 duplicate-register group/);
  assert.ok(duplicate.commands.includes("npm run data:duplicates:verify -- --strict"));

  assert.equal(security.readiness, "prepared_evidence_pending");
  assert.deepEqual(security.evidence.missing_types, ["deployment_receipt", "test_record"]);
  assert.match(security.blockers.join("\n"), /Missing required evidence type\(s\): deployment_receipt, test_record/);
  assert.ok(security.commands.some((command) => /launch:evidence:handoff/.test(command)));

  assert.equal(domain.readiness, "stale_release_evidence");
  assert.match(domain.blockers.join("\n"), /Release-bound evidence is stale/);
  assert.ok(domain.commands.some((command) => /domain:evidence:refresh/.test(command)));
  assert.ok(domain.commands.some((command) => /launch:gate:approve -- --gate MED250_GATE_DOMAIN_DNS_VERIFIED/.test(command)));

  assert.equal(uat.workstream, "qa");
  assert.match(uat.blockers.join("\n"), /12 physical-device UAT scenario/);
  assert.ok(uat.commands.includes("npm run uat:verify:live"));
});

test("binds prepared-pending evidence to its current source digest", async () => {
  const byGate = new Map(board.gates.map((gate) => [gate.gate, gate]));
  const duplicate = byGate.get("MED250_GATE_DUPLICATE_REGISTER_REVIEWED");
  const prepared = duplicate.evidence.prepared_pending[0];
  const source = await readFile(new URL(`../${prepared.reference}`, import.meta.url), "utf8");
  assert.equal(prepared.sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(prepared.byte_length, Buffer.byteLength(source, "utf8"));
});

test("keeps the closure board privacy-safe", () => {
  const serialized = JSON.stringify(board).replaceAll(/"sha256":"[a-f0-9]{64}"/g, '"sha256":"redacted-digest"');
  assert.doesNotMatch(serialized, /(?:\+?250)?7\d{8}/);
  assert.doesNotMatch(serialized, /access[_-]?token|authorization:\s*bearer|password|service[_-]?role/i);
  assert.doesNotMatch(serialized, /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i);
  assert.ok(board.gates.every((gate) => gate.safety_rules.some((rule) => /Do not store credentials/.test(rule))));
});
