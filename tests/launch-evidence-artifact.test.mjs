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
import { recordLaunchEvidence } from "../scripts/record-launch-evidence.mjs";
import { validateLaunchEvidence } from "../scripts/validate-launch-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/launch-evidence.json", import.meta.url), "utf8"));

function cleanManifest() {
  const localManifest = structuredClone(manifest);
  for (const gate of Object.values(localManifest.gates)) gate.evidence = [];
  return localManifest;
}

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
    ["MED250_GATE_AUTH_RATE_LIMITS_APPROVED", "signed_approval"],
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

test("rejects the retired production hostname for new domain verification", () => {
  const artifact = completeArtifact("MED250_GATE_DOMAIN_DNS_VERIFIED", "domain_verification");
  artifact.hostnames = ["med250.gikundiro.com"];
  const result = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: "MED250_GATE_DOMAIN_DNS_VERIFIED",
    expectedType: "domain_verification",
    now: new Date("2026-07-14T12:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /must include med-250\.com/.test(error)));
});

test("builds one owner-ready handoff using every prepared pending artifact", async () => {
  const prepared = await discoverPreparedLaunchEvidence(new URL("../docs/launch/evidence", import.meta.url));
  const handoff = createLaunchEvidenceHandoff(manifest, prepared);
  assert.equal(handoff.release, "med250-production");
  assert.equal(handoff.gate_count, 11);
  assert.equal(handoff.missing_evidence_artifact_count, 11);
  assert.equal(handoff.prepared_pending_artifact_count, 11);
  assert.equal(handoff.unprepared_evidence_artifact_count, 0);
  const security = handoff.gates.find((gate) => gate.gate === "MED250_GATE_SECURITY_HARDENING_DEPLOYED");
  assert.deepEqual(security.missing_evidence_types, []);
  assert.equal(security.approval_required.approved_by, null);
  const duplicates = handoff.gates.find((gate) => gate.gate === "MED250_GATE_DUPLICATE_REGISTER_REVIEWED");
  assert.match(duplicates.suggested_filenames.review_ledger, /duplicate-register-review-ledger-pending-2026-07-16\.json$/);
  assert.equal(duplicates.prepared_pending_evidence.review_ledger.check_status_counts.blocked, 1);
  const duplicateSource = await readFile(new URL("../docs/launch/evidence/duplicate-register-review-ledger-pending-2026-07-16.json", import.meta.url), "utf8");
  assert.equal(
    duplicates.prepared_pending_evidence.review_ledger.sha256,
    createHash("sha256").update(duplicateSource).digest("hex"),
  );
  assert.equal(duplicates.prepared_pending_evidence.review_ledger.byte_length, Buffer.byteLength(duplicateSource, "utf8"));
  const authRate = handoff.gates.find((gate) => gate.gate === "MED250_GATE_AUTH_RATE_LIMITS_APPROVED");
  assert.deepEqual(authRate.missing_evidence_types, ["signed_approval", "test_record"]);
  assert.equal(authRate.prepared_pending_evidence.signed_approval.template_valid, true);
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

test("records completed launch evidence without inventing gate approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "med250-record-evidence-"));
  const evidenceDir = join(root, "docs", "launch", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const localManifest = cleanManifest();
  const gateName = "MED250_GATE_TURNSTILE_SERVER_VERIFIED";
  const artifact = completeArtifact(gateName, "test_record");
  const reference = "docs/launch/evidence/turnstile-test.json";
  await writeFile(join(root, reference), `${JSON.stringify(artifact, null, 2)}\n`);

  const result = await recordLaunchEvidence({
    manifest: localManifest,
    artifactPath: reference,
    rootDir: root,
    now: new Date("2026-07-17T12:00:00Z"),
  });

  const gate = result.manifest.gates[gateName];
  assert.equal(result.recorded.confirmed, false);
  assert.equal(gate.status, "pending");
  assert.equal(gate.approved_by, null);
  assert.equal(gate.evidence.length, 1);
  assert.equal(gate.evidence[0].type, "test_record");
  assert.match(gate.evidence[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.recorded.missingEvidenceTypes, []);
  await rm(root, { recursive: true, force: true });
});

test("confirms a gate only after all required evidence and owner approval are present", async () => {
  const root = await mkdtemp(join(tmpdir(), "med250-confirm-evidence-"));
  const evidenceDir = join(root, "docs", "launch", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const localManifest = cleanManifest();
  const gateName = "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED";

  let nextManifest = localManifest;
  for (const type of ["account_verification", "signed_approval"]) {
    const artifact = completeArtifact(gateName, type);
    const reference = `docs/launch/evidence/cloudflare-${type}.json`;
    await writeFile(join(root, reference), `${JSON.stringify(artifact, null, 2)}\n`);
    const result = await recordLaunchEvidence({
      manifest: nextManifest,
      artifactPath: reference,
      rootDir: root,
      confirm: type === "signed_approval",
      approvedBy: type === "signed_approval" ? "Named infrastructure owner" : "",
      approvedRole: type === "signed_approval" ? "Infrastructure owner" : "",
      approvedAt: type === "signed_approval" ? "2026-07-17T10:00:00Z" : "",
      now: new Date("2026-07-17T12:00:00Z"),
    });
    nextManifest = result.manifest;
  }

  const gate = nextManifest.gates[gateName];
  assert.equal(gate.status, "confirmed");
  assert.equal(gate.approved_by, "Named infrastructure owner");
  assert.equal(gate.evidence.length, 2);
  const accepted = validateLaunchEvidence(nextManifest, { rootDir: root, now: new Date("2026-07-17T12:00:00Z") });
  assert.equal(accepted.valid, true, accepted.errors.join("; "));
  await rm(root, { recursive: true, force: true });
});

test("rejects confirmation when domain evidence targets the retired hostname", async () => {
  await assert.rejects(
    () => recordLaunchEvidence({
      manifest: structuredClone(manifest),
      artifactPath: "docs/launch/evidence/domain-deployment-test-2026-07-20.json",
      rootDir: new URL("..", import.meta.url).pathname,
      confirm: true,
      replace: true,
      approvedBy: "Named infrastructure owner",
      approvedRole: "Infrastructure owner",
      approvedAt: "2026-07-20T18:00:00Z",
      now: new Date("2026-07-21T12:00:00Z"),
    }),
    /domain verification must include med-250\.com/,
  );
});

test("rejects incomplete artifacts, duplicate evidence and approval metadata without confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "med250-reject-evidence-"));
  const evidenceDir = join(root, "docs", "launch", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const gateName = "MED250_GATE_TURNSTILE_SERVER_VERIFIED";
  const artifact = completeArtifact(gateName, "test_record");
  const reference = "docs/launch/evidence/turnstile-test.json";
  await writeFile(join(root, reference), `${JSON.stringify(artifact, null, 2)}\n`);

  const first = await recordLaunchEvidence({
    manifest: cleanManifest(),
    artifactPath: reference,
    rootDir: root,
    now: new Date("2026-07-17T12:00:00Z"),
  });
  await assert.rejects(
    () => recordLaunchEvidence({
      manifest: first.manifest,
      artifactPath: reference,
      rootDir: root,
      now: new Date("2026-07-17T12:00:00Z"),
    }),
    /already has test_record evidence/,
  );
  await assert.rejects(
    () => recordLaunchEvidence({
      manifest: cleanManifest(),
      artifactPath: reference,
      rootDir: root,
      approvedBy: "Named owner",
      now: new Date("2026-07-17T12:00:00Z"),
    }),
    /Approval metadata may be recorded only with --confirm/,
  );

  const incomplete = completeArtifact(gateName, "test_record");
  incomplete.status = "pending";
  const incompleteReference = "docs/launch/evidence/turnstile-incomplete.json";
  await writeFile(join(root, incompleteReference), `${JSON.stringify(incomplete, null, 2)}\n`);
  await assert.rejects(
    () => recordLaunchEvidence({
      manifest: cleanManifest(),
      artifactPath: incompleteReference,
      rootDir: root,
      now: new Date("2026-07-17T12:00:00Z"),
    }),
    /Evidence artifact is not complete/,
  );
  await rm(root, { recursive: true, force: true });
});
