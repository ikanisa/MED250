import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assessSourceAuthorityDecision,
  buildPendingSourceAuthorityDecision,
  loadSourceAuthorityContext,
} from "../scripts/source-authority-decision.mjs";

const rootDir = new URL("..", import.meta.url).pathname;
const context = await loadSourceAuthorityContext({ rootDir });
const committed = JSON.parse(await readFile(
  new URL("../data/source-authority-decision.json", import.meta.url),
  "utf8",
));
const now = new Date("2026-07-25T00:00:00+02:00");

function addAuthority(decision) {
  decision.authority = {
    decided_by: "Named MED+250 data owner",
    role: "Catalogue provenance and retention owner",
    decided_at: "2026-07-24T10:00:00+02:00",
    next_review_at: "2027-01-24T10:00:00+02:00",
    rationale: "The exact evidence boundaries, missing fields, permitted uses, and durable custody were reviewed.",
    evidence_reference: "Controlled source authority review record MED250-SA-2026-07-24",
  };
}

function addDurableStorage(decision) {
  decision.durable_storage = {
    approved: true,
    label: "MED+250 controlled evidence store",
    verification_reference: "Custody receipt MED250-CUSTODY-2026-07-24",
  };
}

test("keeps the committed decision valid but production-blocking while owner authority is pending", async () => {
  const preview = await assessSourceAuthorityDecision(committed, { rootDir, now });
  assert.equal(preview.valid, true, preview.errors.join("\n"));
  assert.equal(preview.productionAuthorized, false);
  assert.equal(preview.replacementAvailable, true);

  const strict = await assessSourceAuthorityDecision(committed, { rootDir, now, strict: true });
  assert.equal(strict.valid, false);
  assert.match(strict.errors.join("\n"), /not approved for production/);
});

test("authorizes only an explicitly bounded replacement that preserves the original-missing fact", async () => {
  const decision = buildPendingSourceAuthorityDecision(context);
  decision.status = "approved";
  decision.decision = "approve_replacement";
  decision.replacement_candidate.limitations_acknowledged = true;
  decision.replacement_scope = {
    permitted_uses: "Catalogue identity, source comparison, and governed product-review preparation only.",
    prohibited_uses: "No claim that this is the original research source and no unreviewed clinical or reuse-rights inference.",
    retention_and_review: "Retain in the controlled evidence store and review at the recorded next-review date.",
    correction_process: "Apply only source-backed corrections through the governed import and review workflow.",
    future_provenance_rules: "Every future refresh must retain immutable source references, byte hashes, and accountable review.",
  };
  addAuthority(decision);
  addDurableStorage(decision);

  const result = await assessSourceAuthorityDecision(decision, { rootDir, now, strict: true });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.productionAuthorized, true);
  assert.equal(decision.original_evidence.availability, "missing");
  assert.equal(decision.replacement_candidate.is_original, false);

  decision.authority.next_review_at = "2026-07-24T12:00:00+02:00";
  const expired = await assessSourceAuthorityDecision(decision, { rootDir, now, strict: true });
  assert.equal(expired.valid, false);
  assert.match(expired.errors.join("\n"), /next_review_at must be in the future/);
});

test("accepts original restoration only when the exact private bundle verifies", async () => {
  const decision = buildPendingSourceAuthorityDecision(context);
  decision.status = "approved";
  decision.decision = "restore_original";
  decision.original_evidence.availability = "restored_and_verified";
  addAuthority(decision);
  addDurableStorage(decision);

  const verifyBundle = async () => ({
    artifact_count: context.originalEvidence.artifact_count,
    total_bytes: context.originalEvidence.total_bytes,
    bundle_digest: context.originalEvidence.bundle_digest,
    manifest_sha256: context.originalEvidence.manifest_sha256,
  });
  const result = await assessSourceAuthorityDecision(decision, {
    rootDir,
    bundlePath: "private-restored-bundle",
    now,
    strict: true,
    verifyBundle,
  });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.productionAuthorized, true);
});

test("keeps rejection terminal and non-authorizing", async () => {
  const decision = buildPendingSourceAuthorityDecision(context);
  decision.status = "rejected";
  decision.decision = "reject";
  addAuthority(decision);

  const preview = await assessSourceAuthorityDecision(decision, { rootDir, now });
  assert.equal(preview.valid, true, preview.errors.join("\n"));
  assert.equal(preview.productionAuthorized, false);
  const strict = await assessSourceAuthorityDecision(decision, { rootDir, now, strict: true });
  assert.equal(strict.valid, false);
});

test("rejects source-fact drift, silent substitution, and secret-bearing approval metadata", async () => {
  const decision = buildPendingSourceAuthorityDecision(context);
  decision.original_evidence.bundle_digest = "0".repeat(64);
  decision.replacement_candidate.is_original = true;
  decision.durable_storage.label = "password=not-allowed";
  const result = await assessSourceAuthorityDecision(decision, { rootDir, now });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /original_evidence\.bundle_digest/);
  assert.match(result.errors.join("\n"), /never be labelled as the original/);
  assert.match(result.errors.join("\n"), /secret-like material/);
});

test("records one explicit bounded replacement atomically from owner-supplied metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "med250-source-authority-"));
  const output = join(directory, "decision.json");
  const result = spawnSync(process.execPath, [
    "scripts/source-authority-decision.mjs",
    "record",
    "--output", output,
    "--decision", "approve_replacement",
    "--decided-by", "Named MED+250 data owner",
    "--role", "Catalogue provenance and retention owner",
    "--decided-at", "2026-07-24T09:00:00+02:00",
    "--next-review-at", "2027-01-24T09:00:00+02:00",
    "--rationale", "Reviewed the exact reconstruction limits and approved a bounded operational baseline.",
    "--evidence-reference", "Controlled source authority review record MED250-SA-2026-07-24",
    "--storage-label", "MED+250 controlled evidence store",
    "--storage-verification-reference", "Custody receipt MED250-CUSTODY-2026-07-24",
    "--permitted-uses", "Catalogue identity, source comparison, and governed review preparation only.",
    "--prohibited-uses", "No original-source claim and no unreviewed clinical or reuse-rights inference.",
    "--retention-and-review", "Retain in the controlled evidence store and review at the recorded next-review date.",
    "--correction-process", "Apply only source-backed corrections through the governed import and review workflow.",
    "--future-provenance-rules", "Every refresh must retain immutable source references, byte hashes, and accountable review.",
    "--confirm",
  ], { cwd: rootDir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const recorded = JSON.parse(await readFile(output, "utf8"));
  assert.equal(recorded.status, "approved");
  assert.equal(recorded.decision, "approve_replacement");
  assert.equal(recorded.original_evidence.availability, "missing");
  assert.equal(recorded.replacement_candidate.is_original, false);
  const strict = await assessSourceAuthorityDecision(recorded, { rootDir, now, strict: true });
  assert.equal(strict.valid, true, strict.errors.join("\n"));
  await rm(directory, { recursive: true, force: true });
});
