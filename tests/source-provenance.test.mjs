import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rosterManifest = JSON.parse(await readFile(
  new URL("../data/imports/rwanda-fda-pharmacy-contacts-manifest.json", import.meta.url),
  "utf8",
));
const matchedContacts = await readFile(
  new URL("../data/imports/rwanda-fda-pharmacy-contacts-jul-sep-2026.csv", import.meta.url),
);
const retailRegistry = await readFile(
  new URL("../data/imports/rwanda-fda-retail-pharmacies-may-2026.csv", import.meta.url),
);
const retentionSpec = JSON.parse(await readFile(
  new URL("../data/source-retention-spec.json", import.meta.url),
  "utf8",
));
const retentionVerifierFile = await readFile(
  new URL("../scripts/source-retention-bundle.mjs", import.meta.url),
);
const retentionReceiptFile = await readFile(
  new URL("../docs/launch/evidence/source-retention-bundle-2026-07-16.json", import.meta.url),
);
const retentionReceipt = JSON.parse(retentionReceiptFile.toString("utf8"));
const dataReuseLedgerFile = await readFile(
  new URL("../docs/launch/evidence/data-reuse-review-ledger-pending-2026-07-16.json", import.meta.url),
);
const dataReuseLedger = JSON.parse(dataReuseLedgerFile.toString("utf8"));
const dataReuseApproval = JSON.parse(await readFile(
  new URL("../docs/launch/evidence/data-reuse-approval-pending-2026-07-16.json", import.meta.url),
  "utf8",
));

const expectedRosters = new Set([
  "bugesera",
  "huye",
  "kamonyi",
  "kayonza",
  "kigali",
  "muhanga",
  "musanze",
  "nyagatare",
  "rubavu",
  "ruhango",
  "rwamagana",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("Rwanda FDA duty-roster provenance binds every official source PDF", () => {
  assert.equal(rosterManifest.roster_pdfs_processed, 11);
  assert.deepEqual(new Set(Object.keys(rosterManifest.roster_sources)), expectedRosters);
  for (const [name, source] of Object.entries(rosterManifest.roster_sources)) {
    assert.match(source.url, /^https:\/\/monitoring\.rwandafda\.gov\.rw\/.+\.pdf$/);
    assert.match(source.sha256, /^[a-f0-9]{64}$/, `${name} must have an exact SHA-256 digest`);
  }
  assert.doesNotMatch(JSON.stringify(rosterManifest), /placeholder|regenerate-with/i);
});

test("duty-roster provenance remains bound to the governed derived datasets", () => {
  assert.equal(sha256(matchedContacts), rosterManifest.matched_contacts_sha256);
  assert.equal(sha256(retailRegistry), rosterManifest.retail_registry_sha256);
  assert.equal(rosterManifest.matched_contact_rows, 288);
  assert.equal(rosterManifest.matched_pharmacies, 267);
});

test("controlled retention spec binds every private source artifact to exact bytes", () => {
  assert.equal(retentionSpec.classification, "controlled_private_source_evidence");
  assert.equal(retentionSpec.artifacts.length, 25);
  assert.equal(new Set(retentionSpec.artifacts.map((artifact) => artifact.id)).size, 25);
  assert.equal(new Set(retentionSpec.artifacts.map((artifact) => artifact.bundle_path)).size, 25);
  for (const artifact of retentionSpec.artifacts) {
    assert.ok(Number.isInteger(artifact.expected_bytes) && artifact.expected_bytes > 0);
    assert.match(artifact.expected_sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(artifact.bundle_path, /(^\/|(^|\/)\.\.(\/|$))/);
  }
});

test("redacted retention receipt records verified lineage without claiming owner approval", () => {
  assert.equal(retentionReceipt.status, "complete");
  assert.equal(retentionReceipt.artifact_count, retentionSpec.artifacts.length);
  assert.equal(retentionReceipt.pdf_artifact_count, 13);
  assert.equal(retentionReceipt.approved_durable_storage, false);
  assert.match(retentionReceipt.bundle_digest, /^[a-f0-9]{64}$/);
  assert.match(retentionReceipt.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    retentionReceipt.source_spec_sha256,
    sha256(Buffer.from(`${JSON.stringify(retentionSpec, null, 2)}\n`, "utf8")),
  );
  assert.equal(retentionReceipt.verifier_sha256, sha256(retentionVerifierFile));
  assert.ok(retentionReceipt.checks.some((check) => check.name === "Approved durable evidence store" && check.status === "pending"));
});

test("data-reuse ledger has no unresolved technical retention blocker", () => {
  assert.equal(dataReuseLedger.total_records, dataReuseLedger.source_records.length);
  assert.equal(dataReuseLedger.pending_records, dataReuseLedger.source_records.length);
  assert.equal(dataReuseLedger.blocked_records, 0);
  assert.ok(dataReuseLedger.source_records.every((record) => record.decision_status.startsWith("pending_owner_")));
  assert.equal(dataReuseLedger.source_digests.controlled_source_bundle_digest, retentionReceipt.bundle_digest);
  assert.equal(dataReuseLedger.source_digests.controlled_source_bundle_manifest, retentionReceipt.manifest_sha256);
  assert.equal(dataReuseLedger.source_digests.controlled_source_bundle_spec, retentionReceipt.source_spec_sha256);
  assert.equal(dataReuseLedger.source_digests.controlled_source_bundle_verifier, retentionReceipt.verifier_sha256);
});

test("pending data-owner approval is bound to the current ledger and retention receipt", () => {
  assert.equal(dataReuseApproval.status, "pending");
  assert.equal(dataReuseApproval.review_ledger_sha256, sha256(dataReuseLedgerFile));
  assert.equal(dataReuseApproval.source_retention_receipt_sha256, sha256(retentionReceiptFile));
  assert.equal(dataReuseApproval.decision, null);
  assert.ok(dataReuseApproval.checks.every((check) => ["passed", "pending"].includes(check.status)));
});
