import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_DATASET_PATH,
  DEFAULT_REVIEW_PATH,
  assessProductContentReview,
  buildProductContentReviewPacket,
} from "./import-data/product-content-review.mjs";
import { validateAuditBrowserEvidence } from "./validate-audit-browser-evidence.mjs";
import { validateAuditImplementationRegister } from "./validate-audit-implementation-register.mjs";
import { validateLaunchEvidence } from "./validate-launch-evidence.mjs";
import { validateLocalizationFiles } from "./validate-localization.mjs";
import { validatePhysicalUat } from "./validate-physical-uat.mjs";

const browser = (id, label) => ({ type: "browser", id, label });
const launch = (id, label) => ({ type: "launch", id, label });
const manual = (id, label) => ({ type: "manual", id, label });
const technical = (id, label) => ({ type: "technical", id, label });
const contentReview = (label) => ({ type: "content_review", id: "product-content-review", label });
const localization = (label) => ({ type: "localization", id: "rw-RW", label });
const physicalUat = (label) => ({ type: "physical_uat", id: "med250-production", label });

export const auditClosureBindings = Object.freeze({
  "P0-1": [
    browser("DESKTOP_DEPARTMENTS", "Desktop evidence for every advertised department"),
    browser("MOBILE_DEPARTMENTS", "Mobile evidence for every advertised department"),
  ],
  "P0-2": [
    browser("DESKTOP_CATALOGUE_BOUNDARIES", "Desktop catalogue-boundary evidence"),
    browser("MOBILE_CATALOGUE_BOUNDARIES", "Mobile catalogue-boundary evidence"),
    browser("DESKTOP_FAILURE_RECOVERY", "Desktop failure-and-retry evidence"),
    browser("MOBILE_FAILURE_RECOVERY", "Mobile failure-and-retry evidence"),
  ],
  "P0-3": [
    launch("MED250_GATE_DOMAIN_DNS_VERIFIED", "Confirmed DNS, TLS, routing, headers, robots, and sitemap evidence for the canonical production domain"),
    manual("search-console", "Search Console ownership, sitemap submission, URL inspection, and dated indexing evidence"),
    technical("sites-catalog-boundary", "The public Sites origin is verified as a current catalog-only release with ordering disabled"),
  ],
  "P0-4": [
    manual("price-review", "Named medicine-representative price review, freshness policy, and withdrawal policy"),
  ],
  "P0-5": [
    browser("DESKTOP_REQUEST_JOURNEY", "Desktop availability-request journey evidence"),
    browser("MOBILE_REQUEST_JOURNEY", "Mobile availability-request journey evidence"),
  ],
  "P1-1": [
    manual("trust-observations", "Fresh, sufficient, privacy-safe production observations and approved suppressed/published states"),
  ],
  "P1-2": [
    browser("DESKTOP_RELATED_PRODUCTS", "Desktop related-product safety evidence"),
    browser("MOBILE_RELATED_PRODUCTS", "Mobile related-product safety evidence"),
    technical("live-related-products", "Exact-release reconciliation of every live recommendable product and generated recommendation edge"),
  ],
  "P1-3": [
    launch("MED250_GATE_PRESCRIPTION_RETENTION_APPROVED", "Privacy-owner approval for prescription retention"),
    manual("controller-identity", "Approved controller identity, registered address, privacy contact, processor, transfer, and rights details"),
  ],
  "P1-4": [
    localization("Qualified Kinyarwanda translation, glossary, clinical review, legal review, and public release"),
    manual("localized-journey-qa", "Complete Kinyarwanda browse, product, request, status, and WhatsApp journey QA"),
  ],
  "P1-5": [
    browser("DESKTOP_SEARCH_MATRIX", "Desktop evidence for all six governed search cases"),
    browser("MOBILE_SEARCH_MATRIX", "Mobile evidence for all six governed search cases"),
  ],
  "P2-1": [
    contentReview("All source-bound duplicate-title, missing-generic, and short-title decisions"),
    browser("DESKTOP_PRODUCT_CONTENT", "Desktop representative product-content evidence"),
    browser("MOBILE_PRODUCT_CONTENT", "Mobile representative product-content evidence"),
  ],
  "P2-2": [],
  "P2-3": [
    browser("DESKTOP_NAVIGATION_RESTORE", "Desktop result-state restoration evidence"),
    browser("MOBILE_NAVIGATION_RESTORE", "Mobile result-state restoration evidence"),
  ],
  "P2-4": [
    manual("response-observations", "Fresh, sufficient, privacy-safe production response observations"),
  ],
  "P2-5": [
    contentReview("All governed product-content owner decisions"),
    launch("MED250_GATE_SECURITY_HARDENING_DEPLOYED", "Deployed product-description and image-governance contract"),
    launch("MED250_GATE_EDGE_FUNCTIONS_DEPLOYED", "Deployed protected product-description reviewer"),
    browser("DESKTOP_PRODUCT_CONTENT", "Desktop representative product-detail evidence"),
    browser("MOBILE_PRODUCT_CONTENT", "Mobile representative product-detail evidence"),
    manual("image-provenance", "Completed image provenance, reuse-rights, and creative QA review"),
  ],
  "P3-1": [
    manual("creative-rights", "Approved creative brief, authentic Rwanda production, model/property releases, and usage rights"),
  ],
  "P3-2": [
    physicalUat("All 12 supported Android and iOS physical-device scenarios"),
    launch("MED250_GATE_PHYSICAL_UAT_PASSED", "Named QA approval and test evidence for physical-device UAT"),
  ],
  "S4-1": [
    manual("payments-decision", "Accountable product, legal, finance, operations, and engineering decision on integrated payments"),
  ],
  "S4-2": [
    manual("marketplace-expansion-decision", "Accountable product, operations, legal, and data decision on marketplace expansion"),
  ],
  "S4-3": [
    manual("personalization-decision", "Accountable product, clinical, privacy, and data decision on personalization"),
  ],
});

function terminalStatus(status) {
  return status === "complete" || status === "owner_declined";
}

export function assessTechnicalClosureEvidence({ sitesCatalogReceipt, liveRelatedReceipt }) {
  const sitesErrors = [];
  const sitesOrigin = "https://med250-rwanda.ikanisa.chatgpt.site";
  const requiredSitesRoutes = new Set([
    "/", "/categories", "/category/medicines",
    "/product/rwanda-fda-hm-0734", "/product/AMZ-B004L5JCZ4",
    "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/sw.js", "/offline.html",
  ]);
  if (sitesCatalogReceipt?.status !== "passed") sitesErrors.push("Sites catalogue receipt is not passed.");
  if (sitesCatalogReceipt?.origin !== sitesOrigin || sitesCatalogReceipt?.mode !== "catalog") sitesErrors.push("Sites receipt is not bound to the governed catalog-only origin.");
  const sitesRoutes = sitesCatalogReceipt?.routes ?? [];
  if (sitesCatalogReceipt?.routeCount !== 10 || sitesRoutes.length !== 10) sitesErrors.push("Sites receipt does not contain all ten governed routes.");
  if (sitesRoutes.some((route) => route?.status !== 200 || route?.finalOrigin !== sitesOrigin)) sitesErrors.push("A Sites route failed or escaped the catalog origin.");
  if ([...requiredSitesRoutes].some((route) => !sitesRoutes.some((entry) => entry?.route === route))) sitesErrors.push("A required Sites route is missing.");
  if ((sitesCatalogReceipt?.errors ?? []).length) sitesErrors.push("Sites receipt contains verification errors.");

  const relatedErrors = [];
  if (liveRelatedReceipt?.status !== "passed") relatedErrors.push("Live related-product receipt is not passed.");
  if (liveRelatedReceipt?.releaseRevision !== "5ef50a296941056bd17e614dff7b35290742f50a") relatedErrors.push("Related-product receipt is not bound to the production revision.");
  for (const [field, expected] of Object.entries({
    liveProductCount: 4_657,
    relatedIndexCount: 4_659,
    recommendableCount: 4_657,
    suppressedCount: 2,
    seedsEvaluated: 4_657,
    unsafeEdgeCount: 0,
    duplicateCandidateCount: 0,
    missingLiveCount: 0,
    unexpectedLiveCount: 0,
    maximumCandidatesPerSeed: 8,
  })) if (liveRelatedReceipt?.[field] !== expected) relatedErrors.push(`Related-product ${field} must equal ${expected}.`);
  if (!Number.isInteger(liveRelatedReceipt?.totalEdges) || liveRelatedReceipt.totalEdges < 1) relatedErrors.push("Related-product receipt has no evaluated edges.");
  if (!/^[a-f0-9]{64}$/.test(liveRelatedReceipt?.liveIdSha256 ?? "")) relatedErrors.push("Related-product live identifier digest is invalid.");
  if (!/^[a-f0-9]{64}$/.test(liveRelatedReceipt?.edgeBindingSha256 ?? "")) relatedErrors.push("Related-product edge digest is invalid.");
  if ((liveRelatedReceipt?.errors ?? []).length) relatedErrors.push("Related-product receipt contains verification errors.");

  return {
    valid: sitesErrors.length === 0 && relatedErrors.length === 0,
    errors: [...sitesErrors, ...relatedErrors],
    signals: {
      "sites-catalog-boundary": {
        status: sitesErrors.length ? "failed" : "passed",
        satisfied: sitesErrors.length === 0,
      },
      "live-related-products": {
        status: relatedErrors.length ? "failed" : "passed",
        satisfied: relatedErrors.length === 0,
      },
    },
  };
}

function buildSignal(requirement, item, sources) {
  if (requirement.type === "browser") {
    const scenario = sources.browserLedger?.scenarios?.[requirement.id];
    return {
      ...requirement,
      status: scenario?.status ?? "missing",
      satisfied: scenario?.status === "passed",
    };
  }
  if (requirement.type === "launch") {
    const gate = sources.launchManifest?.gates?.[requirement.id];
    return {
      ...requirement,
      status: gate?.status ?? "missing",
      satisfied: gate?.status === "confirmed",
    };
  }
  if (requirement.type === "physical_uat") {
    const scenarios = Object.values(sources.physicalUat?.scenarios ?? {});
    const passed = sources.physicalUat?.status === "passed"
      && scenarios.length === 12
      && scenarios.every((scenario) => scenario?.status === "passed");
    return {
      ...requirement,
      status: passed ? "passed" : sources.physicalUat?.status ?? "missing",
      satisfied: passed,
    };
  }
  if (requirement.type === "localization") {
    const release = (sources.localizationRegistry?.releases ?? []).find(({ locale }) => locale === requirement.id);
    const passed = release?.status === "approved_translation"
      && release?.public === true
      && release?.runtime_ready === true
      && release?.route_mode === "localized_prefix";
    return {
      ...requirement,
      status: passed ? "passed" : release?.status ?? "missing",
      satisfied: passed,
    };
  }
  if (requirement.type === "content_review") {
    const assessment = sources.contentReviewAssessment ?? {};
    const passed = assessment.pendingCount === 0
      && assessment.blockingCorrectionCount === 0
      && assessment.valid === true;
    return {
      ...requirement,
      status: passed ? "passed" : String(assessment.pendingCount ?? "unknown") + " pending",
      satisfied: passed,
    };
  }
  if (requirement.type === "technical") {
    const signal = sources.technicalEvidence?.[requirement.id];
    return {
      ...requirement,
      status: signal?.status ?? "missing",
      satisfied: signal?.satisfied === true,
    };
  }
  const covered = item.status === "complete";
  return {
    ...requirement,
    status: covered ? "covered_by_closure" : "pending",
    satisfied: covered,
  };
}

export function buildAuditClosureReport({
  register,
  browserLedger,
  launchManifest,
  physicalUat: physicalUatLedger,
  localizationRegistry,
  contentReviewAssessment,
  technicalEvidence = {},
}) {
  const sources = {
    browserLedger,
    launchManifest,
    physicalUat: physicalUatLedger,
    localizationRegistry,
    contentReviewAssessment,
    technicalEvidence,
  };
  const registerItems = [...(register.findings ?? []), ...(register.strategic_items ?? [])];
  const items = registerItems.map((item) => {
    const requirements = auditClosureBindings[item.id] ?? [];
    const signals = requirements.map((requirement) => buildSignal(requirement, item, sources));
    const terminal = terminalStatus(item.status);
    const ready = item.status === "owner_declined" || (item.status === "complete" && signals.every(({ satisfied }) => satisfied));
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      owner: item.owner,
      goals: item.goals ?? [item.goal],
      terminal,
      ready,
      signals,
      blockerCount: signals.filter(({ satisfied }) => !satisfied).length,
      blockers: signals.filter(({ satisfied }) => !satisfied).map(({ label, status }) => label + " (" + status + ")"),
      nextAction: item.remaining?.[0]
        ?? (item.status === "owner_declined" ? "Preserve the accountable owner decision and keep the rejected surface absent." : item.decision_prompt)
        ?? requirements[0]?.label
        ?? "Complete every governed entry criterion and record accountable evidence.",
    };
  });

  // A terminal register status is not enough to leave the owner queue: linked
  // machine evidence must also be ready. This keeps a prematurely completed
  // item visible until every cross-ledger dependency actually passes.
  const openItems = items.filter(({ ready }) => !ready);
  const ownerQueues = Object.values(openItems.reduce((queues, item) => {
    queues[item.owner] ??= { owner: item.owner, itemCount: 0, blockerCount: 0, items: [] };
    queues[item.owner].itemCount += 1;
    queues[item.owner].blockerCount += item.blockerCount;
    queues[item.owner].items.push({ id: item.id, title: item.title, status: item.status, nextAction: item.nextAction });
    return queues;
  }, {})).sort((left, right) => left.owner.localeCompare(right.owner));

  const browserScenarios = Object.values(browserLedger?.scenarios ?? {});
  const launchGates = Object.values(launchManifest?.gates ?? {});
  const physicalScenarios = Object.values(physicalUatLedger?.scenarios ?? {});
  const kinyarwanda = (localizationRegistry?.releases ?? []).find(({ locale }) => locale === "rw-RW");
  const terminalItems = items.filter(({ terminal }) => terminal);
  const readyItems = items.filter(({ ready }) => ready);
  const releaseGateQueue = Object.entries(launchManifest?.gates ?? {}).flatMap(([name, gate]) => {
    if (gate?.status === "confirmed") return [];
    const suppliedTypes = new Set((gate?.evidence ?? []).map(({ type }) => type));
    const missingEvidenceTypes = (gate?.required_evidence_types ?? []).filter((type) => !suppliedTypes.has(type));
    return [{
      name,
      title: gate?.title ?? "",
      owner: gate?.owner ?? "",
      status: gate?.status ?? "missing",
      missingEvidenceTypes,
      approvalRequired: gate?.status === "pending" && missingEvidenceTypes.length === 0,
    }];
  });
  const allBrowserEvidencePassed = browserLedger?.status === "passed"
    && browserScenarios.length === 16
    && browserScenarios.every(({ status }) => status === "passed");
  const allLaunchEvidenceConfirmed = launchGates.length === 11
    && launchGates.every(({ status }) => status === "confirmed");
  const allPhysicalUatPassed = physicalUatLedger?.status === "passed"
    && physicalScenarios.length === 12
    && physicalScenarios.every(({ status }) => status === "passed");
  const contentReviewReady = contentReviewAssessment?.valid === true
    && contentReviewAssessment?.pendingCount === 0
    && contentReviewAssessment?.blockingCorrectionCount === 0;
  const sourceCoverage = register.source_coverage ?? {};
  const sourceCoverageCounts = {
    findingCount: (register.findings ?? []).length,
    scorecardCategoryCount: (sourceCoverage.scorecard_categories ?? []).length,
    preservationInvariantCount: (sourceCoverage.preservation_invariants ?? []).length,
    benchmarkCapabilityCount: (sourceCoverage.benchmark_capabilities ?? []).length,
    roadmapActionCount: (sourceCoverage.roadmap_actions ?? []).length,
    verificationLimitCount: (sourceCoverage.verification_limits ?? []).length,
    auditedSurfaceCount: (sourceCoverage.audited_surfaces ?? []).length,
  };
  const sourceUnitCount = Object.values(sourceCoverageCounts).reduce((total, count) => total + count, 0);
  const sourceCoverageReady = JSON.stringify(Object.values(sourceCoverageCounts)) === JSON.stringify([17, 9, 5, 11, 15, 4, 12]);

  return {
    schemaVersion: "1",
    auditSourceRevision: register.audit?.source_revision ?? null,
    itemCount: items.length,
    terminalItemCount: terminalItems.length,
    readyItemCount: readyItems.length,
    openItemCount: openItems.length,
    strictReady: items.length === 20
      && items.every(({ ready }) => ready)
      && allBrowserEvidencePassed
      && allLaunchEvidenceConfirmed
      && allPhysicalUatPassed
      && contentReviewReady
      && sourceCoverageReady,
    systems: {
      sourceCoverage: {
        status: sourceCoverageReady ? "mapped" : "incomplete",
        sourceUnitCount,
        ...sourceCoverageCounts,
      },
      browserEvidence: {
        status: browserLedger?.status ?? "missing",
        scenarioCount: browserScenarios.length,
        passedScenarioCount: browserScenarios.filter(({ status }) => status === "passed").length,
        captureCount: browserScenarios.reduce((total, scenario) => total + Object.keys(scenario?.captures ?? {}).length, 0),
      },
      launchEvidence: {
        gateCount: launchGates.length,
        confirmedGateCount: launchGates.filter(({ status }) => status === "confirmed").length,
        pendingGateCount: launchGates.filter(({ status }) => status === "pending").length,
      },
      physicalUat: {
        status: physicalUatLedger?.status ?? "missing",
        scenarioCount: physicalScenarios.length,
        passedScenarioCount: physicalScenarios.filter(({ status }) => status === "passed").length,
      },
      localization: {
        locale: "rw-RW",
        status: kinyarwanda?.status ?? "missing",
        public: kinyarwanda?.public ?? false,
        runtimeReady: kinyarwanda?.runtime_ready ?? false,
      },
      productContentReview: {
        expectedEntryCount: contentReviewAssessment?.expectedEntryCount ?? null,
        pendingCount: contentReviewAssessment?.pendingCount ?? null,
        blockingCorrectionCount: contentReviewAssessment?.blockingCorrectionCount ?? null,
      },
    },
    items,
    ownerQueues,
    releaseGateQueue,
  };
}

function printText(report) {
  console.log("MED+250 audit closure — " + report.terminalItemCount + "/" + report.itemCount + " terminal");
  console.log("Evidence-ready items: " + report.readyItemCount + "/" + report.itemCount);
  console.log("Strictly ready: " + (report.strictReady ? "yes" : "no"));
  console.log("Open items: " + report.openItemCount);
  console.log("Audit source revision: " + report.auditSourceRevision);
  console.log("");
  console.log("Audit source coverage: " + report.systems.sourceCoverage.sourceUnitCount + " units mapped");
  console.log("Browser evidence: " + report.systems.browserEvidence.passedScenarioCount + "/" + report.systems.browserEvidence.scenarioCount + " scenarios passed; " + report.systems.browserEvidence.captureCount + " planned captures");
  console.log("Launch evidence: " + report.systems.launchEvidence.confirmedGateCount + "/" + report.systems.launchEvidence.gateCount + " gates confirmed");
  console.log("Physical UAT: " + report.systems.physicalUat.passedScenarioCount + "/" + report.systems.physicalUat.scenarioCount + " scenarios passed");
  console.log("Kinyarwanda release: " + report.systems.localization.status);
  console.log("Product-content review: " + report.systems.productContentReview.pendingCount + " pending");
  if (report.releaseGateQueue.length) {
    console.log("\nProduction release gates needing evidence:");
    for (const gate of report.releaseGateQueue) {
      const missing = gate.missingEvidenceTypes.length ? gate.missingEvidenceTypes.join(", ") : "named owner approval";
      console.log("  " + gate.name + " — " + gate.owner + " — " + missing);
    }
  }
  for (const queue of report.ownerQueues) {
    console.log("\n" + queue.owner + " — " + queue.itemCount + " item(s), " + queue.blockerCount + " blocker(s)");
    for (const item of queue.items) console.log("  " + item.id + " " + item.status + ": " + item.nextAction);
  }
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function validateReceiptSourceBindings(receipt) {
  const errors = [];
  const bindings = receipt?.sources
    ? Object.values(receipt.sources)
    : receipt?.verifier ? [receipt.verifier] : [];
  for (const binding of bindings) {
    const path = String(binding?.path ?? "");
    const digest = String(binding?.sha256 ?? "");
    if (!path || path.startsWith("/") || path.split(/[\\/]/).includes("..") || !/^[a-f0-9]{64}$/.test(digest)) {
      errors.push("Technical receipt contains an unsafe or incomplete source binding.");
      continue;
    }
    try {
      const bytes = await readFile(path);
      if (createHash("sha256").update(bytes).digest("hex") !== digest) errors.push(`Technical receipt source digest drifted for ${path}.`);
    } catch {
      errors.push(`Technical receipt source is unavailable at ${path}.`);
    }
  }
  return errors;
}

async function main() {
  const json = process.argv.includes("--json");
  const strict = process.argv.includes("--strict");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--json" && argument !== "--strict");
  if (unknown.length) throw new Error("Unknown argument(s): " + unknown.join(", "));

  const [register, browserLedger, launchManifest, physicalUatLedger, localizationRegistry, actualReview, datasetSource, sitesCatalogReceipt, liveRelatedReceipt] = await Promise.all([
    loadJson("data/audit-implementation-register.json"),
    loadJson("data/audit-browser-evidence.json"),
    loadJson("data/launch-evidence.json"),
    loadJson("data/physical-device-uat.json"),
    loadJson("data/localization/locale-releases.json"),
    loadJson(DEFAULT_REVIEW_PATH),
    readFile(DEFAULT_DATASET_PATH, "utf8"),
    loadJson("docs/audit/live-baseline-2026-07-18/16-sites-catalog-verification-5ef50a.json"),
    loadJson("docs/audit/live-baseline-2026-07-18/18-live-related-products-5ef50a.json"),
  ]);
  const dataset = JSON.parse(datasetSource);
  const expectedReview = buildProductContentReviewPacket(dataset, {
    sourcePath: DEFAULT_DATASET_PATH,
    sourceSha256: createHash("sha256").update(datasetSource).digest("hex"),
  });
  const contentReviewPreview = assessProductContentReview(expectedReview, actualReview);
  const contentReviewAssessment = assessProductContentReview(expectedReview, actualReview, { strict: true });
  const technicalAssessment = assessTechnicalClosureEvidence({ sitesCatalogReceipt, liveRelatedReceipt });
  const technicalBindingErrors = (await Promise.all([
    validateReceiptSourceBindings(sitesCatalogReceipt),
    validateReceiptSourceBindings(liveRelatedReceipt),
  ])).flat();
  const validations = await Promise.all([
    validateAuditImplementationRegister(register),
    Promise.resolve(validateAuditBrowserEvidence(browserLedger)),
    Promise.resolve(validateLaunchEvidence(launchManifest)),
    Promise.resolve(validatePhysicalUat(physicalUatLedger)),
    validateLocalizationFiles(),
    Promise.resolve(contentReviewPreview),
  ]);
  const validationErrors = [
    ...validations.flatMap((result) => result.errors ?? []),
    ...technicalAssessment.errors,
    ...technicalBindingErrors,
  ];
  if (validationErrors.length) throw new Error("Authoritative closure input is invalid: " + validationErrors.join("; "));

  const report = buildAuditClosureReport({
    register,
    browserLedger,
    launchManifest,
    physicalUat: physicalUatLedger,
    localizationRegistry,
    contentReviewAssessment,
    technicalEvidence: technicalAssessment.signals,
  });
  if (json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
  if (strict && !report.strictReady) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
