import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  assessDuplicateReview,
  deriveDuplicateGroups,
  parseCsv,
} from "./import-data/verify-duplicate-register-review.mjs";
import {
  createLaunchEvidenceHandoff,
  discoverPreparedLaunchEvidence,
} from "./create-launch-evidence-template.mjs";
import { validateLaunchEvidence } from "./validate-launch-evidence.mjs";
import { validatePhysicalUat } from "./validate-physical-uat.mjs";
import {
  currentGitRevision,
  releaseBindingsForManifest,
  releaseRevisionForManifest,
} from "./launch-release-bindings.mjs";

const TECHNICAL_PRODUCTION_GATES = new Set([
  "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
  "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
  "MED250_GATE_DOMAIN_DNS_VERIFIED",
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
    let readiness = "missing_evidence";
    if (gate.status === "confirmed" && approved && missingEvidenceTypes.length === 0) readiness = "confirmed";
    else if (missingEvidenceTypes.length === 0 && staleReleaseEvidence) readiness = "stale_release_evidence";
    else if (missingEvidenceTypes.length === 0 && !approved) readiness = "approval_pending";
    else if (preparedPendingEvidence.length === missingEvidenceTypes.length) readiness = "prepared_evidence_pending";
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
    };
  });
}

export async function buildGoLiveReadinessReport() {
  const [manifest, prepared, physicalUat, duplicateRegister] = await Promise.all([
    loadJson("data/launch-evidence.json"),
    discoverPreparedLaunchEvidence(),
    loadJson("data/physical-device-uat.json"),
    assessDuplicateRegister(),
  ]);
  const handoff = createLaunchEvidenceHandoff(manifest, prepared);
  const launchNonStrict = validateLaunchEvidence(manifest);
  const physicalStrict = validatePhysicalUat(physicalUat, { strict: true });
  const currentCheckoutRevision = currentGitRevision();
  const currentReleaseRevision = releaseRevisionForManifest(manifest);
  const releaseBindings = await releaseBindingsForManifest(manifest, { currentRevision: currentReleaseRevision });
  const gates = gateRows(manifest, handoff, releaseBindings);
  const readinessCounts = gates.reduce((counts, gate) => {
    counts[gate.readiness] = (counts[gate.readiness] ?? 0) + 1;
    return counts;
  }, {});
  const technicalGates = gates.filter((gate) => TECHNICAL_PRODUCTION_GATES.has(gate.name));
  const technicalEvidenceReady = technicalGates.length === TECHNICAL_PRODUCTION_GATES.size
    && technicalGates.every((gate) => gate.missingEvidenceTypes.length === 0 && !gate.staleReleaseEvidence);

  return {
    schemaVersion: "1",
    release: manifest.release ?? "med250-production",
    productionReady: launchNonStrict.valid && technicalEvidenceReady,
    sourceControl: {
      currentReleaseRevision,
      currentCheckoutRevision,
      staleReleaseEvidenceGateCount: readinessCounts.stale_release_evidence ?? 0,
    },
    launchEvidence: {
      valid: launchNonStrict.valid,
      gateCount: launchNonStrict.gateCount,
      statusCounts: launchNonStrict.statusCounts,
    },
    technicalReadiness: {
      ready: technicalEvidenceReady,
      requiredGateCount: TECHNICAL_PRODUCTION_GATES.size,
      readyGateCount: technicalGates.filter((gate) => gate.missingEvidenceTypes.length === 0 && !gate.staleReleaseEvidence).length,
    },
    gateReadiness: {
      confirmed: readinessCounts.confirmed ?? 0,
      approvalPending: readinessCounts.approval_pending ?? 0,
      preparedEvidencePending: readinessCounts.prepared_evidence_pending ?? 0,
      missingEvidence: readinessCounts.missing_evidence ?? 0,
      staleReleaseEvidence: readinessCounts.stale_release_evidence ?? 0,
    },
    duplicateRegister: {
      valid: duplicateRegister.valid,
      expectedGroupCount: duplicateRegister.expectedGroupCount,
      reviewedRowCount: duplicateRegister.reviewedRowCount,
      decisionCounts: duplicateRegister.decisionCounts,
      errorCount: duplicateRegister.errors.length,
    },
    physicalUat: {
      valid: physicalStrict.valid,
      scenarioCount: physicalStrict.scenarioCount,
      statusCounts: physicalStrict.statusCounts,
      errorCount: physicalStrict.errors.length,
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
  console.log(`Production ready: ${report.productionReady ? "yes" : "no"}`);
  console.log(`Technical release evidence: ${report.technicalReadiness.readyGateCount}/${report.technicalReadiness.requiredGateCount} current`);
  console.log(`Recorded production revision: ${report.sourceControl.currentReleaseRevision ?? "unknown"}`);
}

async function main() {
  const json = process.argv.includes("--json");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--json");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  const report = await buildGoLiveReadinessReport();
  if (json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
  if (!report.productionReady) process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
