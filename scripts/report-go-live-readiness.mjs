import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  assessDuplicateReview,
  deriveDuplicateGroups,
  parseCsv,
} from "./import-data/verify-duplicate-register-review.mjs";
import { assessCurrentProductContentReview } from "./import-data/product-content-review.mjs";
import {
  createLaunchEvidenceHandoff,
  discoverPreparedLaunchEvidence,
} from "./create-launch-evidence-template.mjs";
import { validateLaunchEvidence } from "./validate-launch-evidence.mjs";
import { validatePhysicalUat } from "./validate-physical-uat.mjs";
import { assessSourceAuthorityDecision } from "./source-authority-decision.mjs";
import {
  canonicalProductionOrigin,
  validateAuditBrowserEvidence,
} from "./validate-audit-browser-evidence.mjs";
import {
  currentGitRevision,
  releaseBindingsForManifest,
} from "./launch-release-bindings.mjs";
import {
  currentLegacyRedirectVerifierSha256,
  validateLegacyDomainRedirectEvidence,
} from "./verify-legacy-domain-redirect.mjs";

const machineVerifiedGateNames = new Set([
  "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
  "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
  "MED250_GATE_DOMAIN_DNS_VERIFIED",
]);

const transactionGateNames = new Set([
  "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
  "MED250_GATE_PHYSICAL_UAT_PASSED",
]);

const supersededGateNames = new Set([
  "MED250_GATE_WHATSAPP_READY",
]);

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function assessDuplicateRegister() {
  const [products, retail, online, reviewSource] = await Promise.all([
    readFile("data/imports/rwanda-fda-products-july-2026.csv", "utf8"),
    readFile("data/imports/rwanda-fda-retail-pharmacies-may-2026.csv", "utf8"),
    readFile("data/imports/rwanda-fda-online-pharmacies-may-2026.csv", "utf8"),
    readFile("data/imports/duplicate-register-review.csv", "utf8"),
  ]);
  const groups = deriveDuplicateGroups(
    parseCsv(products, "products").rows,
    parseCsv(retail, "retail pharmacies").rows,
    parseCsv(online, "online pharmacies").rows,
  );
  return assessDuplicateReview(
    groups,
    parseCsv(reviewSource, "data/imports/duplicate-register-review.csv").rows,
    { strict: true },
  );
}

function approvalComplete(gate) {
  return Boolean(
    typeof gate?.approved_by === "string" && gate.approved_by.trim()
    && typeof gate?.approved_role === "string" && gate.approved_role.trim()
    && typeof gate?.approved_at === "string" && gate.approved_at.trim(),
  );
}

function gateRows(manifest, handoff, releaseBindings) {
  const handoffByGate = new Map((handoff.gates ?? []).map((gate) => [gate.gate, gate]));
  return Object.entries(manifest.gates ?? {}).map(([name, gate]) => {
    const suppliedTypes = new Set((gate.evidence ?? []).map((entry) => entry.type));
    const missingEvidenceTypes = (gate.required_evidence_types ?? []).filter((type) => !suppliedTypes.has(type));
    const preparedPendingEvidence = Object.keys(handoffByGate.get(name)?.prepared_pending_evidence ?? {});
    const approved = approvalComplete(gate);
    const releaseRevisionBindings = releaseBindings.get(name) ?? [];
    const staleReleaseEvidence = releaseRevisionBindings.some((binding) => !binding.matchesCurrentRevision);
    const evidenceComplete = missingEvidenceTypes.length === 0;
    let readiness = "missing_evidence";
    if (supersededGateNames.has(name)) {
      readiness = "superseded";
    } else if (machineVerifiedGateNames.has(name) && evidenceComplete) {
      readiness = staleReleaseEvidence ? "runtime_verification_required" : "machine_verified";
    } else if (gate.status === "confirmed" && approved && missingEvidenceTypes.length === 0) readiness = "confirmed";
    else if (missingEvidenceTypes.length === 0 && !approved) readiness = "approval_pending";
    else if (preparedPendingEvidence.length === missingEvidenceTypes.length) readiness = "prepared_evidence_pending";
    let disposition = "non_blocking_follow_up";
    if (supersededGateNames.has(name)) {
      disposition = "superseded_by_dispatch_portal_separation";
    } else if (machineVerifiedGateNames.has(name) && evidenceComplete) {
      disposition = staleReleaseEvidence ? "runtime_verification_required" : "closed_by_machine_evidence";
    } else if (transactionGateNames.has(name) && readiness !== "confirmed") {
      disposition = "transaction_blocker";
    }
    return {
      name,
      title: gate.title,
      owner: gate.owner,
      status: gate.status,
      readiness,
      requiredEvidenceTypes: gate.required_evidence_types ?? [],
      suppliedEvidenceTypes: [...suppliedTypes].sort(),
      missingEvidenceTypes,
      preparedPendingEvidence,
      approvalComplete: approved,
      releaseRevisionBindings,
      staleReleaseEvidence,
      evidenceComplete,
      disposition,
    };
  });
}

export async function buildGoLiveReadinessReport() {
  const [
    manifest,
    prepared,
    physicalUat,
    duplicateRegister,
    productContentReview,
    auditBrowserEvidence,
    sourceAuthorityDecision,
    legacyDomainRedirectEvidence,
  ] = await Promise.all([
    loadJson("data/launch-evidence.json"),
    discoverPreparedLaunchEvidence(),
    loadJson("data/physical-device-uat.json"),
    assessDuplicateRegister(),
    assessCurrentProductContentReview({ strict: true }),
    loadJson("data/audit-browser-evidence.json"),
    loadJson("data/source-authority-decision.json"),
    loadJson("docs/launch/evidence/legacy-domain-redirect-2026-07-29.json"),
  ]);
  const sourceAuthority = await assessSourceAuthorityDecision(sourceAuthorityDecision, { strict: true });
  const handoff = createLaunchEvidenceHandoff(manifest, prepared);
  const launchNonStrict = validateLaunchEvidence(manifest);
  const launchStrict = validateLaunchEvidence(manifest, { strict: true });
  const physicalStrict = validatePhysicalUat(physicalUat, { strict: true });
  const currentReleaseRevision = currentGitRevision();
  const renderedProductionAudit = validateAuditBrowserEvidence(auditBrowserEvidence, {
    strict: true,
    currentReleaseRevision,
  });
  const expectedLegacyRedirectVerifierSha256 = await currentLegacyRedirectVerifierSha256();
  const legacyDomainRedirect = validateLegacyDomainRedirectEvidence(legacyDomainRedirectEvidence, {
    expectedVerifierSha256: expectedLegacyRedirectVerifierSha256,
  });
  const releaseBindings = await releaseBindingsForManifest(manifest, { currentRevision: currentReleaseRevision });
  const gates = gateRows(manifest, handoff, releaseBindings);
  const readinessCounts = gates.reduce((counts, gate) => {
    counts[gate.readiness] = (counts[gate.readiness] ?? 0) + 1;
    return counts;
  }, {});
  const staleReleaseEvidenceGateCount = gates.filter((gate) => gate.staleReleaseEvidence).length;
  const siteProductionReady = launchNonStrict.valid
    && legacyDomainRedirect.valid
    && gates
      .filter((gate) => machineVerifiedGateNames.has(gate.name))
      .every((gate) => gate.evidenceComplete);
  const transactionBlockers = gates
    .filter((gate) => gate.disposition === "transaction_blocker")
    .map((gate) => ({
      gate: gate.name,
      title: gate.title,
      missingEvidenceTypes: gate.missingEvidenceTypes,
    }));
  const nonBlockingFollowUp = [
    {
      area: "source_authority",
      pending: !sourceAuthority.productionAuthorized,
      safeDefault: "The replacement source remains available and unapproved recovered content remains unpublished.",
    },
    {
      area: "duplicate_register",
      pending: !duplicateRegister.valid,
      count: duplicateRegister.decisionCounts.pending,
      safeDefault: "Unresolved duplicate groups remain quarantined from authoritative publication.",
    },
    {
      area: "product_content",
      pending: !productContentReview.valid,
      count: productContentReview.pendingCount,
      safeDefault: "Pending descriptions remain hidden until reviewed.",
    },
    ...gates
      .filter((gate) => gate.disposition === "non_blocking_follow_up")
      .map((gate) => ({
        area: gate.name,
        pending: gate.readiness !== "confirmed",
        safeDefault: "The current fail-closed production behavior remains in force.",
      })),
  ].filter((item) => item.pending);
  const marketplaceTransactionReady = siteProductionReady
    && transactionBlockers.length === 0
    && physicalStrict.valid;

  return {
    schemaVersion: "2",
    release: manifest.release ?? "med250-production",
    productionReady: marketplaceTransactionReady,
    siteProductionReady,
    marketplaceTransactionReady,
    transactionBlockers,
    nonBlockingFollowUp,
    sourceControl: {
      currentReleaseRevision,
      staleReleaseEvidenceGateCount,
    },
    sourceAuthority: {
      valid: sourceAuthority.valid,
      productionAuthorized: sourceAuthority.productionAuthorized,
      status: sourceAuthority.status,
      decision: sourceAuthority.decision,
      originalAvailable: sourceAuthority.originalAvailable,
      replacementAvailable: sourceAuthority.replacementAvailable,
      durableStorageApproved: sourceAuthority.durableStorageApproved,
      errorCount: sourceAuthority.errors.length,
    },
    launchEvidence: {
      valid: launchNonStrict.valid,
      strictValid: launchStrict.valid,
      gateCount: launchNonStrict.gateCount,
      statusCounts: launchNonStrict.statusCounts,
      strictErrorCount: launchStrict.errors.length,
    },
    gateReadiness: {
      confirmed: readinessCounts.confirmed ?? 0,
      approvalPending: readinessCounts.approval_pending ?? 0,
      preparedEvidencePending: readinessCounts.prepared_evidence_pending ?? 0,
      missingEvidence: readinessCounts.missing_evidence ?? 0,
      staleReleaseEvidence: staleReleaseEvidenceGateCount,
      machineVerified: readinessCounts.machine_verified ?? 0,
      runtimeVerificationRequired: readinessCounts.runtime_verification_required ?? 0,
      superseded: readinessCounts.superseded ?? 0,
    },
    duplicateRegister: {
      valid: duplicateRegister.valid,
      expectedGroupCount: duplicateRegister.expectedGroupCount,
      reviewedRowCount: duplicateRegister.reviewedRowCount,
      decisionCounts: duplicateRegister.decisionCounts,
      errorCount: duplicateRegister.errors.length,
    },
    productContentReview: {
      valid: productContentReview.valid,
      expectedEntryCount: productContentReview.expectedEntryCount,
      reviewedEntryCount: productContentReview.reviewedEntryCount,
      pendingCount: productContentReview.pendingCount,
      blockingCorrectionCount: productContentReview.blockingCorrectionCount,
      decisionCounts: productContentReview.decisionCounts,
      recoveredValidation: productContentReview.recoveredValidation,
      originalSourceRetentionSatisfied: productContentReview.originalSourceRetentionSatisfied,
      reviewSourcePath: productContentReview.reviewSourcePath,
      reviewSourceSha256: productContentReview.reviewSourceSha256,
      errorCount: productContentReview.errors.length,
    },
    physicalUat: {
      valid: physicalStrict.valid,
      scenarioCount: physicalStrict.scenarioCount,
      statusCounts: physicalStrict.statusCounts,
      errorCount: physicalStrict.errors.length,
    },
    renderedProductionAudit: {
      valid: renderedProductionAudit.valid,
      status: auditBrowserEvidence.status ?? null,
      executionStatus: auditBrowserEvidence.execution_status ?? null,
      origin: auditBrowserEvidence.origin ?? null,
      canonicalOrigin: canonicalProductionOrigin,
      releaseRevision: auditBrowserEvidence.release_revision ?? null,
      currentReleaseRevision,
      releaseRevisionCurrent: Boolean(
        currentReleaseRevision
        && auditBrowserEvidence.release_revision === currentReleaseRevision
      ),
      scenarioCount: renderedProductionAudit.scenarioCount,
      captureCount: renderedProductionAudit.captureCount,
      statusCounts: renderedProductionAudit.statusCounts,
      errorCount: renderedProductionAudit.errors.length,
    },
    legacyDomainRedirect: {
      valid: legacyDomainRedirect.valid,
      status: legacyDomainRedirectEvidence.status ?? null,
      legacyOrigin: legacyDomainRedirect.assessment.legacyOrigin,
      canonicalOrigin: legacyDomainRedirect.assessment.canonicalOrigin,
      capturedAt: legacyDomainRedirectEvidence.captured_at ?? null,
      verifierCurrent: legacyDomainRedirectEvidence.verifier_sha256 === expectedLegacyRedirectVerifierSha256,
      probeCount: legacyDomainRedirect.assessment.probeCount,
      passedProbeCount: legacyDomainRedirect.assessment.passedProbeCount,
      errorCount: legacyDomainRedirect.errors.length,
    },
    handoff: {
      gateCount: handoff.gate_count,
      missingEvidenceArtifactCount: handoff.missing_evidence_artifact_count,
      preparedPendingArtifactCount: handoff.prepared_pending_artifact_count,
      unpreparedEvidenceArtifactCount: handoff.unprepared_evidence_artifact_count,
    },
    gates,
  };
}

function printText(report) {
  console.log("MED+250 production readiness");
  console.log(`Site production ready: ${report.siteProductionReady ? "yes" : "no"}`);
  console.log(`Marketplace transactions ready: ${report.marketplaceTransactionReady ? "yes" : "no"}`);
  console.log(`Genuine transaction blockers: ${report.transactionBlockers.length}`);
  for (const blocker of report.transactionBlockers) console.log(`  - ${blocker.title}`);
  console.log(`Safe deferred follow-ups: ${report.nonBlockingFollowUp.length}`);
  console.log("");
  console.log(`Technical evidence structure: ${report.launchEvidence.valid ? "valid" : "invalid"}`);
  console.log(`Historical hostname redirect: ${report.legacyDomainRedirect.passedProbeCount}/${report.legacyDomainRedirect.probeCount} probes passed; redirect-only contract valid: ${report.legacyDomainRedirect.valid ? "yes" : "no"}`);
  if (report.gateReadiness.staleReleaseEvidence) console.log("Exact live revision must be checked after the final commit and deployment.");
}

async function main() {
  const json = process.argv.includes("--json");
  const strict = process.argv.includes("--strict");
  const unknown = process.argv.slice(2).filter((argument) => !["--json", "--strict"].includes(argument));
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  const report = await buildGoLiveReadinessReport();
  if (json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
  if (strict && !report.marketplaceTransactionReady) process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
