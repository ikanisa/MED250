import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  auditClosureBindings,
  assessUnavailableContentReviewSource,
  assessTechnicalClosureEvidence,
  buildAuditClosureReport,
} from "../scripts/report-audit-closure.mjs";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL("../" + relativePath, import.meta.url), "utf8"));
}

const [register, browserLedger, launchManifest, physicalUat, localizationRegistry, sitesCatalogReceipt, liveRelatedReceipt] = await Promise.all([
  readJson("data/audit-implementation-register.json"),
  readJson("data/audit-browser-evidence.json"),
  readJson("data/launch-evidence.json"),
  readJson("data/physical-device-uat.json"),
  readJson("data/localization/locale-releases.json"),
  readJson("docs/audit/live-baseline-2026-07-18/16-sites-catalog-verification-5ef50a.json"),
  readJson("docs/audit/live-baseline-2026-07-18/18-live-related-products-5ef50a.json"),
]);
const technicalAssessment = assessTechnicalClosureEvidence({ sitesCatalogReceipt, liveRelatedReceipt });
const pendingProductContentReview = await readJson("data/imports/product-content-review-pending-2026-07-18.json");

const contentReviewAssessment = {
  valid: false,
  strict: true,
  expectedEntryCount: 72,
  pendingCount: 72,
  blockingCorrectionCount: 0,
};

function build(overrides = {}) {
  return buildAuditClosureReport({
    register: overrides.register ?? register,
    browserLedger: overrides.browserLedger ?? browserLedger,
    launchManifest: overrides.launchManifest ?? launchManifest,
    physicalUat: overrides.physicalUat ?? physicalUat,
    localizationRegistry: overrides.localizationRegistry ?? localizationRegistry,
    contentReviewAssessment: overrides.contentReviewAssessment ?? contentReviewAssessment,
    technicalEvidence: overrides.technicalEvidence ?? technicalAssessment.signals,
    technicalEvidenceErrors: overrides.technicalEvidenceErrors ?? [],
  });
}

test("keeps a missing historical review source non-blocking and fail-closed", () => {
  const assessment = assessUnavailableContentReviewSource(pendingProductContentReview);
  assert.equal(assessment.valid, false);
  assert.equal(assessment.sourceAvailable, false);
  assert.equal(assessment.sourceStatus, "unavailable_non_blocking_fail_closed");
  assert.equal(assessment.expectedEntryCount, 72);
  assert.equal(assessment.reviewedEntryCount, 72);
  assert.equal(assessment.pendingCount, 72);
  assert.equal(assessment.blockingCorrectionCount, 0);
  assert.deepEqual(assessment.errors, []);
});

test("reports stale historical technical evidence without crashing or promoting it", () => {
  const report = build({
    technicalEvidenceErrors: ["Technical receipt source digest drifted for scripts/verify-deployed-site.mjs."],
  });
  assert.equal(report.systems.technicalEvidence.status, "stale_or_unavailable");
  assert.equal(report.systems.technicalEvidence.errorCount, 1);
  assert.equal(report.strictReady, false);
  assert.equal(
    report.items.find(({ id }) => id === "P0-3").signals.find(({ id }) => id === "sites-catalog-boundary").satisfied,
    false,
  );
  assert.equal(
    report.items.find(({ id }) => id === "P1-2").signals.find(({ id }) => id === "live-related-products").satisfied,
    false,
  );
});

test("binds every audit finding and strategic decision to an owner-ready closure queue", () => {
  const expectedIds = [...register.findings, ...register.strategic_items].map(({ id }) => id);
  assert.deepEqual(Object.keys(auditClosureBindings), expectedIds);

  const report = build();
  assert.equal(report.itemCount, 20);
  assert.equal(report.terminalItemCount, 1);
  assert.equal(report.readyItemCount, 1);
  assert.equal(report.openItemCount, 19);
  assert.equal(report.strictReady, false);
  assert.deepEqual(report.systems.sourceCoverage, {
    status: "mapped",
    sourceUnitCount: 73,
    findingCount: 17,
    scorecardCategoryCount: 9,
    preservationInvariantCount: 5,
    benchmarkCapabilityCount: 11,
    roadmapActionCount: 15,
    verificationLimitCount: 4,
    auditedSurfaceCount: 12,
  });
  assert.equal(report.releaseGateQueue.length, 11);
  assert.equal(report.releaseGateQueue.find(({ name }) => name === "MED250_GATE_DOMAIN_DNS_VERIFIED").approvalRequired, false);
  assert.equal(report.releaseGateQueue.find(({ name }) => name === "MED250_GATE_SECURITY_HARDENING_DEPLOYED").approvalRequired, false);
  assert.equal(report.releaseGateQueue.find(({ name }) => name === "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED").approvalRequired, false);
  assert.equal(report.ownerQueues.reduce((total, queue) => total + queue.itemCount, 0), 19);

  const declined = report.items.find(({ id }) => id === "P2-2");
  assert.equal(declined.terminal, true);
  assert.equal(declined.ready, true);
  assert.equal(declined.blockerCount, 0);
  assert.equal(report.items.find(({ id }) => id === "P0-3").signals.find(({ id }) => id === "sites-catalog-boundary").satisfied, true);
  assert.equal(report.items.find(({ id }) => id === "P1-2").signals.find(({ id }) => id === "live-related-products").satisfied, true);
});

test("reports the exact current cross-system state without promoting partial work", () => {
  const report = build();
  assert.deepEqual(report.systems.browserEvidence, {
    status: "pending",
    scenarioCount: 16,
    passedScenarioCount: 16,
    captureCount: 56,
  });
  assert.deepEqual(report.systems.launchEvidence, {
    gateCount: 11,
    confirmedGateCount: 0,
    pendingGateCount: 11,
  });
  assert.deepEqual(report.systems.physicalUat, {
    status: "pending",
    scenarioCount: 12,
    passedScenarioCount: 0,
  });
  assert.equal(report.systems.localization.status, "awaiting_qualified_translation");
  assert.equal(report.systems.productContentReview.pendingCount, 72);

  const departments = report.items.find(({ id }) => id === "P0-1");
  assert.deepEqual(departments.signals.map(({ id }) => id), ["DESKTOP_DEPARTMENTS", "MOBILE_DEPARTMENTS"]);
  assert.equal(departments.blockerCount, 0);

  const localizationItem = report.items.find(({ id }) => id === "P1-4");
  assert.equal(localizationItem.signals[0].status, "awaiting_qualified_translation");

  const searchVisibilityItem = report.items.find(({ id }) => id === "P0-3");
  assert.deepEqual(searchVisibilityItem.signals.map(({ id }) => id), [
    "MED250_GATE_DOMAIN_DNS_VERIFIED",
    "search-console",
    "sites-catalog-boundary",
  ]);
  assert.equal(searchVisibilityItem.blockerCount, 2);

  const deviceItem = report.items.find(({ id }) => id === "P3-2");
  assert.deepEqual(deviceItem.signals.map(({ type }) => type), ["physical_uat", "launch"]);
});

test("every automated binding resolves to an authoritative committed source", () => {
  for (const requirements of Object.values(auditClosureBindings)) {
    for (const requirement of requirements) {
      if (requirement.type === "browser") assert.ok(browserLedger.scenarios[requirement.id], requirement.id);
      if (requirement.type === "launch") assert.ok(launchManifest.gates[requirement.id], requirement.id);
      if (requirement.type === "technical") assert.ok(technicalAssessment.signals[requirement.id], requirement.id);
      if (requirement.type === "localization") {
        assert.ok(localizationRegistry.releases.some(({ locale }) => locale === requirement.id), requirement.id);
      }
      if (requirement.type === "physical_uat") assert.equal(Object.keys(physicalUat.scenarios).length, 12);
      assert.ok(requirement.label.length >= 20);
    }
  }
});

test("a complete item remains unready until all linked machine evidence passes", () => {
  const nextRegister = structuredClone(register);
  nextRegister.findings.find(({ id }) => id === "P0-5").status = "complete";
  const nextBrowser = structuredClone(browserLedger);
  nextBrowser.scenarios.DESKTOP_REQUEST_JOURNEY.status = "pending";
  nextBrowser.scenarios.MOBILE_REQUEST_JOURNEY.status = "pending";

  const incomplete = build({ register: nextRegister, browserLedger: nextBrowser });
  assert.equal(incomplete.items.find(({ id }) => id === "P0-5").ready, false);
  assert.equal(incomplete.openItemCount, 19);
  assert.ok(incomplete.ownerQueues.some(({ owner }) => owner === "Product owner and frontend lead"));

  nextBrowser.scenarios.DESKTOP_REQUEST_JOURNEY.status = "passed";
  nextBrowser.scenarios.MOBILE_REQUEST_JOURNEY.status = "passed";
  const complete = build({ register: nextRegister, browserLedger: nextBrowser });
  assert.equal(complete.items.find(({ id }) => id === "P0-5").ready, true);
  assert.equal(complete.terminalItemCount, 2);
  assert.equal(complete.openItemCount, 18);
  assert.equal(complete.strictReady, false);
});

test("reports strict readiness only when every cross-ledger source is ready", () => {
  const nextRegister = structuredClone(register);
  for (const item of [...nextRegister.findings, ...nextRegister.strategic_items]) {
    if (item.status !== "owner_declined") item.status = "complete";
  }

  const nextBrowser = structuredClone(browserLedger);
  nextBrowser.status = "passed";
  for (const scenario of Object.values(nextBrowser.scenarios)) scenario.status = "passed";

  const nextLaunch = structuredClone(launchManifest);
  for (const gate of Object.values(nextLaunch.gates)) gate.status = "confirmed";

  const nextPhysicalUat = structuredClone(physicalUat);
  nextPhysicalUat.status = "passed";
  for (const scenario of Object.values(nextPhysicalUat.scenarios)) scenario.status = "passed";

  const nextLocalization = structuredClone(localizationRegistry);
  const rwRelease = nextLocalization.releases.find(({ locale }) => locale === "rw-RW");
  Object.assign(rwRelease, {
    status: "approved_translation",
    public: true,
    runtime_ready: true,
    route_mode: "localized_prefix",
  });

  const report = build({
    register: nextRegister,
    browserLedger: nextBrowser,
    launchManifest: nextLaunch,
    physicalUat: nextPhysicalUat,
    localizationRegistry: nextLocalization,
    contentReviewAssessment: {
      valid: true,
      strict: true,
      expectedEntryCount: 72,
      pendingCount: 0,
      blockingCorrectionCount: 0,
    },
  });

  assert.equal(report.strictReady, true);
  assert.equal(report.readyItemCount, 20);
  assert.equal(report.openItemCount, 0);
  assert.equal(report.ownerQueues.length, 0);
  assert.equal(report.releaseGateQueue.length, 0);
});
