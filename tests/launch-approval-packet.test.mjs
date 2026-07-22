import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildLaunchApprovalPacket } from "../scripts/create-launch-approval-packet.mjs";
import { buildGoLiveReadinessReport } from "../scripts/report-go-live-readiness.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/launch-evidence.json", import.meta.url), "utf8"));
const readinessReport = await buildGoLiveReadinessReport();

test("builds approval packets only for evidence-complete unapproved launch gates", () => {
  const packet = buildLaunchApprovalPacket(manifest, readinessReport);
  const gateNames = packet.gates.map((gate) => gate.gate);

  assert.equal(packet.release, "med250-production");
  assert.equal(packet.approval_pending_gate_count, 2);
  assert.equal(packet.blocked_approval_gate_count, 1);
  assert.deepEqual(gateNames, [
    "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
    "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
  ]);
  assert.deepEqual(packet.blocked_approvals.map((gate) => gate.gate), ["MED250_GATE_DOMAIN_DNS_VERIFIED"]);
  assert.match(packet.blocked_approvals[0].reason, /stale/);
  assert.ok(packet.blocked_approvals[0].release_revision_bindings.every((binding) => binding.matchesCurrentRevision === false));
  assert.ok(packet.gates.every((gate) => gate.evidence.length === gate.required_evidence_types.length));
  assert.ok(packet.gates.every((gate) => gate.confirmation_command.some((line) => /--confirm/.test(line))));
  assert.ok(packet.gates.every((gate) => gate.confirmation_command.some((line) => /--replace/.test(line))));
  assert.ok(packet.gates.every((gate) => gate.review_checks.some((check) => /acceptance criterion/.test(check))));
  assert.ok(!gateNames.includes("MED250_GATE_GPS_READY"));
  assert.ok(!gateNames.includes("MED250_GATE_PHYSICAL_UAT_PASSED"));
});

test("removes a gate from approval packet after it has named approval", () => {
  const approved = structuredClone(manifest);
  const gate = approved.gates.MED250_GATE_SECURITY_HARDENING_DEPLOYED;
  gate.status = "confirmed";
  gate.approved_by = "Named backend owner";
  gate.approved_role = "Backend owner";
  gate.approved_at = "2026-07-20T18:00:00+02:00";

  const packet = buildLaunchApprovalPacket(approved, readinessReport);
  assert.equal(packet.approval_pending_gate_count, 1);
  assert.ok(!packet.gates.some(({ gate }) => gate === "MED250_GATE_SECURITY_HARDENING_DEPLOYED"));
  assert.equal(packet.blocked_approval_gate_count, 1);
});
