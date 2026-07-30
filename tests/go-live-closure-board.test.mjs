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
const readinessReport = await buildGoLiveReadinessReport({
  runtimeReceiptPath: ".wrangler/test-missing-live-domain-receipt.json",
});
const board = buildGoLiveClosureBoard({ manifest, handoff, readinessReport });

test("builds an owner closure board without promoting pending gates", () => {
  assert.equal(board.release, "med250-production");
  assert.equal(board.classification, "go-live closure board; execution aid only, not evidence or approval");
  assert.equal(board.production_ready, false);
  assert.equal(board.summary.site_production_ready, true);
  assert.equal(board.summary.marketplace_transaction_ready, false);
  assert.equal(board.summary.transaction_blocker_count, 2);
  assert.equal(board.summary.non_blocking_follow_up_count, 8);
  assert.equal(board.summary.gate_count, 11);
  assert.equal(board.summary.source_authority_production_authorized, false);
  assert.equal(board.summary.product_content_pending_entries, 72);
  assert.equal(board.summary.product_content_blocking_corrections, 0);
  assert.equal(board.prerequisites.source_authority.artifact, "data/source-authority-decision.json");
  assert.equal(board.prerequisites.source_authority.production_authorized, false);
  assert.equal(board.prerequisites.source_authority.blocker, null);
  assert.match(board.prerequisites.source_authority.follow_up, /exact original controlled bundle|bounded replacement decision/);
  assert.ok(board.prerequisites.source_authority.commands.includes("npm run data:source-authority:verify:strict"));
  assert.equal(board.prerequisites.product_content_review.pending_entries, 72);
  assert.equal(board.prerequisites.product_content_review.valid, false);
  assert.equal(board.prerequisites.product_content_review.blocker, null);
  assert.match(board.prerequisites.product_content_review.follow_up, /72 product-content decision/);
  assert.ok(board.prerequisites.product_content_review.commands.includes("npm run data:content-review:verify -- --strict"));
  assert.equal(board.summary.confirmed_gates, 0);
  assert.equal(board.summary.approval_pending_gates, 0);
  assert.equal(board.summary.prepared_evidence_pending_gates, 7);
  assert.equal(board.summary.missing_evidence_gates, 0);
  assert.equal(board.summary.stale_release_evidence_gates, 1);
  assert.equal(board.summary.machine_verified_gates, 2);
  assert.equal(board.summary.runtime_verification_required_gates, 1);
  assert.equal(board.summary.superseded_gates, 1);
  assert.equal(board.summary.duplicate_register_pending_groups, 51);
  assert.equal(board.summary.physical_uat_pending_scenarios, 12);
  assert.equal(board.summary.rendered_audit_passed_scenarios, 16);
  assert.equal(board.summary.rendered_audit_current_revision, false);
  assert.equal(board.summary.rendered_audit_strict_valid, false);
  assert.equal(board.summary.legacy_redirect_passed_probes, 5);
  assert.equal(board.summary.legacy_redirect_required_probes, 5);
  assert.equal(board.summary.legacy_redirect_valid, true);
  assert.equal(board.prerequisites.rendered_production_audit.valid, false);
  assert.equal(board.prerequisites.rendered_production_audit.required_origin, "https://med-250.com");
  assert.match(board.prerequisites.rendered_production_audit.current_release_revision_source, /git rev-parse HEAD/);
  assert.equal("current_release_revision" in board.prerequisites.rendered_production_audit, false);
  assert.equal(board.prerequisites.rendered_production_audit.release_revision_current, false);
  assert.equal(board.prerequisites.rendered_production_audit.blocker, null);
  assert.match(board.prerequisites.rendered_production_audit.follow_up, /prior 16-scenario rendered audit is historical/i);
  assert.ok(board.prerequisites.rendered_production_audit.commands.includes("npm run audit:browser-evidence:verify:live"));
  assert.equal(board.prerequisites.legacy_domain_redirect.valid, true);
  assert.equal(board.prerequisites.legacy_domain_redirect.artifact, "docs/launch/evidence/legacy-domain-redirect-2026-07-29.json");
  assert.equal(board.prerequisites.legacy_domain_redirect.legacy_origin, "https://med250.gikundiro.com");
  assert.equal(board.prerequisites.legacy_domain_redirect.canonical_origin, "https://med-250.com");
  assert.equal(board.prerequisites.legacy_domain_redirect.blocker, null);
  assert.ok(board.prerequisites.legacy_domain_redirect.commands.includes("npm run domain:legacy-redirect:verify"));
  assert.ok(board.prerequisites.legacy_domain_redirect.safety_rules.some((rule) => /second ordering origin/.test(rule)));
  assert.equal(board.summary.prepared_handoff_artifacts, 11);
  assert.equal(board.summary.required_handoff_artifacts, 11);
  assert.equal(board.gates.length, 11);
  assert.ok(board.gates.every((gate) => gate.current_status === "pending"));
  assert.equal(board.gates.filter((gate) => gate.approval.required).length, 7);
  assert.ok(board.gates.every((gate) => gate.approval.complete === false));
  assert.deepEqual(
    board.gates.filter((gate) => gate.blocking).map((gate) => gate.gate),
    ["MED250_GATE_TURNSTILE_SERVER_VERIFIED", "MED250_GATE_PHYSICAL_UAT_PASSED"],
  );
  assert.ok(board.gates.filter((gate) => !gate.blocking).every((gate) => gate.blockers.length === 0));
});

test("orders genuine transaction proof before non-blocking fail-closed follow-up", () => {
  assert.deepEqual(board.closure_order, [
    "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
    "MED250_GATE_PHYSICAL_UAT_PASSED",
    "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
    "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
    "MED250_GATE_DOMAIN_DNS_VERIFIED",
    "MED250_GATE_GPS_READY",
    "MED250_GATE_DUPLICATE_REGISTER_REVIEWED",
    "MED250_GATE_AUTH_RATE_LIMITS_APPROVED",
    "MED250_GATE_PRESCRIPTION_RETENTION_APPROVED",
    "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED",
    "MED250_GATE_WHATSAPP_READY",
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
  assert.deepEqual(duplicate.blockers, []);
  assert.match(duplicate.follow_up_items.join("\n"), /51 duplicate-register group/);
  assert.ok(duplicate.commands.includes("npm run data:duplicates:verify -- --strict"));

  assert.equal(security.readiness, "machine_verified");
  assert.deepEqual(security.evidence.missing_types, []);
  assert.deepEqual(security.blockers, []);
  assert.deepEqual(security.follow_up_items, []);
  assert.equal(security.approval.required, false);

  assert.equal(domain.readiness, "runtime_verification_required");
  assert.deepEqual(domain.blockers, []);
  assert.match(domain.follow_up_items.join("\n"), /Release-bound evidence is stale/);
  assert.ok(domain.commands.some((command) => /domain:evidence:refresh/.test(command)));
  assert.ok(!domain.commands.some((command) => /launch:gate:approve/.test(command)));

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
  const serialized = JSON.stringify(board).replaceAll(
    /"[^"]*sha256":"[a-f0-9]{64}"/g,
    '"sha256":"redacted-digest"',
  );
  assert.doesNotMatch(serialized, /(?:\+?250)?7\d{8}/);
  assert.doesNotMatch(serialized, /access[_-]?token|authorization:\s*bearer|password|service[_-]?role/i);
  assert.doesNotMatch(serialized, /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i);
  assert.ok(board.gates.every((gate) => gate.safety_rules.some((rule) => /Do not store credentials/.test(rule))));
});
