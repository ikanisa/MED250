import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLaunchEvidenceHandoff,
  createLaunchEvidenceTemplate,
  discoverPreparedLaunchEvidence,
} from "../scripts/create-launch-evidence-template.mjs";
import { validateLaunchEvidence } from "../scripts/validate-launch-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/launch-evidence.json", import.meta.url), "utf8"));

function completeArtifact(gate, type) {
  const artifact = createLaunchEvidenceTemplate(gate, type);
  Object.assign(artifact, {
    status: "complete",
    title: "Completed controlled production evidence",
    summary: "Redacted controlled production evidence confirms every stated acceptance check.",
    recorded_at: "2026-07-14T09:00:00Z",
    recorded_by: "Named evidence recorder",
    recorded_role: "Evidence custodian",
    redactions_confirmed: true,
    checks: [{ name: "Acceptance verification", status: "passed", detail: "All gate-specific acceptance checks passed with redacted evidence." }],
  });
  if (type === "signed_approval") Object.assign(artifact, { decision: "approved", approved_by: "Named approver", approved_role: "Accountable owner", approved_at: "2026-07-14T09:30:00Z" });
  if (type === "test_record") Object.assign(artifact, { executed_by: "Named test operator", executor_role: "QA operator", started_at: "2026-07-14T08:00:00Z", completed_at: "2026-07-14T08:45:00Z" });
  if (type === "review_ledger") Object.assign(artifact, { reviewed_by: "Named reviewer", reviewer_role: "Regulatory data reviewer", reviewed_at: "2026-07-14T09:00:00Z", total_records: 51, pending_records: 0, blocked_records: 0, source_digests: { source: "a".repeat(64) } });
  if (type === "deployment_receipt") Object.assign(artifact, { deployed_by: "Named deployment operator", deployer_role: "Backend owner", deployed_at: "2026-07-14T08:50:00Z", environment: "controlled production", release_identifier: "release-2026-07-14-1" });
  if (type === "account_verification") Object.assign(artifact, { verified_by: "Named account verifier", verifier_role: "Infrastructure owner", verified_at: "2026-07-14T09:00:00Z", account_label: "redacted-production-account", least_privilege_confirmed: true });
  if (type === "domain_verification") Object.assign(artifact, { verified_by: "Named domain verifier", verifier_role: "Infrastructure owner", verified_at: "2026-07-14T09:00:00Z", dns_passed: true, tls_passed: true, routes_passed: true });
  if (type === "operations_snapshot") Object.assign(artifact, { captured_by: "Named operations operator", capturer_role: "Operations lead", captured_at: "2026-07-14T09:00:00Z", critical_count: 0, metrics: { dispatch_ready_pharmacies: 769 } });
  return artifact;
}

test("validates complete type-specific artifacts for every supported evidence category", () => {
  const examples = [
    ["MED250_GATE_REGULATORY_APPROVED", "signed_approval"],
    ["MED250_GATE_PHYSICAL_UAT_PASSED", "test_record"],
    ["MED250_GATE_DUPLICATE_REGISTER_REVIEWED", "review_ledger"],
    ["MED250_GATE_SECURITY_HARDENING_DEPLOYED", "deployment_receipt"],
    ["MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED", "account_verification"],
    ["MED250_GATE_DOMAIN_DNS_VERIFIED", "domain_verification"],
    ["MED250_GATE_GPS_READY", "operations_snapshot"],
  ];
  for (const [gate, type] of examples) {
    const result = validateLaunchEvidenceArtifact(completeArtifact(gate, type), {
      expectedGate: gate,
      expectedType: type,
      now: new Date("2026-07-14T12:00:00Z"),
    });
    assert.equal(result.valid, true, `${type}: ${result.errors.join("; ")}`);
  }
});

test("rejects incomplete, mislabelled, unredacted and secret-bearing artifacts", () => {
  const artifact = completeArtifact("MED250_GATE_TURNSTILE_SERVER_VERIFIED", "test_record");
  artifact.gate = "MED250_GATE_GPS_READY";
  artifact.status = "pending";
  artifact.redactions_confirmed = false;
  artifact.summary = "Phone +250788123456 and access_token=do-not-store";
  artifact.checks[0].status = "pending";
  const result = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
    expectedType: "test_record",
    now: new Date("2026-07-14T12:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /artifact gate must be/.test(error)));
  assert.ok(result.errors.some((error) => /status must be complete/.test(error)));
  assert.ok(result.errors.some((error) => /secret-like material/.test(error)));
  assert.ok(result.errors.some((error) => /prohibited personal/.test(error)));
  assert.ok(result.errors.some((error) => /check 1 must be passed/.test(error)));
});

test("builds one owner-ready handoff using every prepared pending artifact", async () => {
  const prepared = await discoverPreparedLaunchEvidence(new URL("../docs/launch/evidence", import.meta.url));
  const handoff = createLaunchEvidenceHandoff(manifest, prepared);
  assert.equal(handoff.release, "med250-production");
  assert.equal(handoff.gate_count, 15);
  assert.equal(handoff.missing_evidence_artifact_count, 17);
  assert.equal(handoff.prepared_pending_artifact_count, 17);
  assert.equal(handoff.unprepared_evidence_artifact_count, 0);
  const security = handoff.gates.find((gate) => gate.gate === "MED250_GATE_SECURITY_HARDENING_DEPLOYED");
  assert.deepEqual(security.missing_evidence_types, []);
  assert.equal(security.approval_required.approved_by, null);
  const credentials = handoff.gates.find((gate) => gate.gate === "MED250_GATE_CREDENTIALS_ROTATED");
  assert.deepEqual(credentials.missing_evidence_types, ["deployment_receipt", "signed_approval"]);
  assert.deepEqual(credentials.unprepared_evidence_types, []);
  assert.deepEqual(credentials.evidence_templates, {});
  assert.match(credentials.suggested_filenames.signed_approval, /credentials-rotation-approval-pending-2026-07-16\.json$/);
  assert.equal(credentials.prepared_pending_evidence.signed_approval.template_valid, true);
  assert.ok(credentials.prepared_pending_evidence.signed_approval.unresolved_checks.length > 0);
  const duplicates = handoff.gates.find((gate) => gate.gate === "MED250_GATE_DUPLICATE_REGISTER_REVIEWED");
  assert.match(duplicates.suggested_filenames.review_ledger, /duplicate-register-review-ledger-pending-2026-07-16\.json$/);
  assert.equal(duplicates.prepared_pending_evidence.review_ledger.check_status_counts.blocked, 1);
});

test("registry validates hashed local JSON artifacts and rejects artifact metadata drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "med250-evidence-"));
  const evidenceDir = join(root, "docs", "launch", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const localManifest = structuredClone(manifest);
  for (const candidate of Object.values(localManifest.gates)) candidate.evidence = [];
  const gateName = "MED250_GATE_GPS_READY";
  const gate = localManifest.gates[gateName];
  gate.status = "confirmed";
  gate.approved_by = "Named operations approver";
  gate.approved_role = "Operations owner";
  gate.approved_at = "2026-07-14T10:00:00Z";
  gate.evidence = [];
  for (const type of gate.required_evidence_types) {
    const artifact = completeArtifact(gateName, type);
    const reference = `docs/launch/evidence/gps-${type}.json`;
    const source = `${JSON.stringify(artifact, null, 2)}\n`;
    await writeFile(join(root, reference), source);
    gate.evidence.push({
      type,
      reference,
      sha256: createHash("sha256").update(source).digest("hex"),
      recorded_at: artifact.recorded_at,
      summary: "Controlled gate-specific local evidence retained with an exact digest.",
    });
  }
  const accepted = validateLaunchEvidence(localManifest, { rootDir: root, now: new Date("2026-07-17T12:00:00Z") });
  assert.equal(accepted.valid, true, accepted.errors.join("; "));
  const artifactPath = join(root, gate.evidence[0].reference);
  const drifted = JSON.parse(await readFile(artifactPath, "utf8"));
  drifted.gate = "MED250_GATE_WHATSAPP_READY";
  const driftedSource = `${JSON.stringify(drifted, null, 2)}\n`;
  await writeFile(artifactPath, driftedSource);
  gate.evidence[0].sha256 = createHash("sha256").update(driftedSource).digest("hex");
  const rejected = validateLaunchEvidence(localManifest, { rootDir: root, now: new Date("2026-07-17T12:00:00Z") });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((error) => /artifact gate must be MED250_GATE_GPS_READY/.test(error)));
  await rm(root, { recursive: true, force: true });
});
