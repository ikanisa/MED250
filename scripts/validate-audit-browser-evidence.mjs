import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { currentGitRevision } from "./launch-release-bindings.mjs";

export const expectedAuditSourceRevision = "ALtnJHwQWBgt5JycfaOGftvKWVHBOLMKzbI9tuf-JrxPmecFrmDaMt1VqSxxxAxyOZIqpkTkcapZA8VcxqQNLq9OMDzTgjApfiO0tloLkak";
export const canonicalProductionOrigin = "https://med-250.com";
const historicalProductionOrigins = new Set(["https://med250.gikundiro.com"]);

const productRoute = /^\/product\/(?:rwanda-fda-hm-[0-9]{4}|AMZ-[A-Z0-9]{10})(?:\?[^#]{1,400})?$/;
const catalogueRoute = /^(?:\/|\/categories|\/category\/(?:medicines|personal-care|baby-family|wellness))(?:\?[^#]{1,400})?$/;
const catalogueBoundaryRoute = /^(?:(?:\/|\/categories|\/category\/(?:medicines|personal-care|baby-family|wellness))(?:\?[^#]{1,400})?|\/product\/(?:rwanda-fda-hm-[0-9]{4}|AMZ-[A-Z0-9]{10})(?:\?[^#]{1,400})?)$/;

function pairedScenario(id, title, findingIds, captures) {
  return Object.fromEntries(["DESKTOP", "MOBILE"].map((device) => {
    const scenarioId = `${device}_${id}`;
    return [scenarioId, {
      title: `${title} — ${device.toLowerCase()}`,
      findingIds,
      device: device.toLowerCase(),
      captures,
    }];
  }));
}

export const expectedAuditBrowserScenarios = Object.freeze({
  ...pairedScenario("DEPARTMENTS", "Every advertised department settles with source-backed products", ["P0-1"], {
    medicines: { title: "Medicines department settled", routePattern: /^\/category\/medicines$/ },
    personal_care: { title: "Beauty and personal care department settled", routePattern: /^\/category\/personal-care$/ },
    baby_family: { title: "Baby and family department settled", routePattern: /^\/category\/baby-family$/ },
    wellness: { title: "Health and household department settled", routePattern: /^\/category\/wellness$/ },
  }),
  ...pairedScenario("CATALOGUE_BOUNDARIES", "Catalogue products 25, 120, and the final result are reachable", ["P0-2"], {
    product_25: { title: "Product 25 is reachable", routePattern: catalogueBoundaryRoute },
    product_120: { title: "Product 120 is reachable", routePattern: catalogueBoundaryRoute },
    final_product: { title: "Final catalogue product is reachable", routePattern: catalogueBoundaryRoute },
  }),
  ...pairedScenario("FAILURE_RECOVERY", "Catalogue failure and retry recover without a terminal placeholder", ["P0-2"], {
    failed_state: { title: "Bounded catalogue failure is visible", routePattern: catalogueRoute },
    retry_state: { title: "Retry action is available and active", routePattern: catalogueRoute },
    recovered_state: { title: "Catalogue returns to a settled result state", routePattern: catalogueRoute },
  }),
  ...pairedScenario("REQUEST_JOURNEY", "Availability-request journey preserves the non-transactional boundary", ["P0-5"], {
    product_action: { title: "Product action uses the approved request vocabulary", routePattern: productRoute },
    request_basket: { title: "Request basket shows the selected product without a purchase claim", routePattern: catalogueRoute },
    no_payment_boundary: { title: "No-payment-before-confirmation disclosure is visible", routePattern: productRoute },
    preselection_status: { title: "Pre-selection state does not claim an order or payment succeeded", routePattern: catalogueRoute },
  }),
  ...pairedScenario("RELATED_PRODUCTS", "Related-product rails stay inside the governed safety boundary", ["P1-2"], {
    medicine_rail: { title: "Representative medicine rail uses compatible source evidence", routePattern: productRoute },
    consumer_rail: { title: "Representative consumer rail stays in approved taxonomy", routePattern: productRoute },
    fail_closed_empty: { title: "Insufficient evidence produces no recommendation rail", routePattern: productRoute },
  }),
  ...pairedScenario("SEARCH_MATRIX", "All six governed live-search cases return relevant results", ["P1-5"], {
    paracetamol: { title: "Paracetamol search result", routePattern: catalogueRoute },
    zinc: { title: "Late-alphabet zinc search result", routePattern: catalogueRoute },
    omeprazole: { title: "Omeprazole search result", routePattern: catalogueRoute },
    typo: { title: "Clinically meaningful typo recovery", routePattern: catalogueRoute },
    french: { title: "French common-use query result", routePattern: catalogueRoute },
    kinyarwanda: { title: "Kinyarwanda common-use query result", routePattern: catalogueRoute },
  }),
  ...pairedScenario("NAVIGATION_RESTORE", "Browser Back restores catalogue controls, depth, position, and focus", ["P2-3"], {
    configured_results: { title: "Configured query, filters, sort, and view", routePattern: catalogueRoute },
    later_product: { title: "Product opened from a later result batch", routePattern: productRoute },
    restored_results: { title: "Back navigation restores URL, controls, depth, position, and focus", routePattern: catalogueRoute },
  }),
  ...pairedScenario("PRODUCT_CONTENT", "Representative product details preserve governed title and content boundaries", ["P2-1", "P2-5"], {
    medicine_detail: { title: "Medicine detail preserves concise and exact official titles", routePattern: productRoute },
    consumer_detail: { title: "Consumer detail exposes only approved description and imagery", routePattern: productRoute },
  }),
});

const allowedStatuses = new Set(["pending", "passed", "failed", "blocked"]);
const allowedCaptureTools = new Set(["in-app-browser", "controlled-device-browser"]);
const secretLike = /(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;
const prohibitedContent = /(?:\b(?:\+?250)?7\d{8}\b|\b\d{6}\b|@[a-z0-9.-]+\.[a-z]{2,}|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}|\b(?:latitude|longitude|otp|prescription contents?|order id|phone number)\b\s*[:=])/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function exactArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateSafeText(value, label, errors, minimum = 0) {
  const text = String(value ?? "");
  if (minimum && text.trim().length < minimum) errors.push(`${label} needs at least ${minimum} useful characters`);
  if (secretLike.test(text) || prohibitedContent.test(text)) errors.push(`${label} contains prohibited identity or secret material`);
}

function resolveRepositoryFile(reference, { rootDir, prefix, extension }, errors, label) {
  if (typeof reference !== "string" || !reference.trim()) {
    errors.push(`${label} path is missing`);
    return null;
  }
  if (isAbsolute(reference) || reference.split(/[\\/]/).includes("..") || !reference.startsWith(prefix) || !reference.endsWith(extension)) {
    errors.push(`${label} must be a repository-relative ${extension} file under ${prefix}`);
    return null;
  }
  const root = realpathSync(rootDir);
  const absolute = resolve(root, reference);
  if (!existsSync(absolute)) {
    errors.push(`${label} does not exist at ${reference}`);
    return null;
  }
  if (lstatSync(absolute).isSymbolicLink()) {
    errors.push(`${label} cannot be a symbolic link`);
    return null;
  }
  const real = realpathSync(absolute);
  if (relative(root, real).startsWith("..")) {
    errors.push(`${label} resolves outside the repository`);
    return null;
  }
  return { absolute: real, bytes: readFileSync(real) };
}

function validateScreenshot(capture, options, errors, label) {
  const file = resolveRepositoryFile(capture.screenshot_path, {
    rootDir: options.rootDir,
    prefix: "docs/audit/browser-evidence/",
    extension: ".png",
  }, errors, label);
  if (!file) return;
  if (file.bytes.length < 68 || file.bytes.length > 15 * 1024 * 1024) errors.push(`${label} screenshot size is outside 68 bytes–15 MB`);
  if (file.bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") errors.push(`${label} is not a PNG file`);
  if (!/^[a-f0-9]{64}$/.test(String(capture.screenshot_sha256 ?? ""))) errors.push(`${label} screenshot_sha256 is invalid`);
  else if (sha256(file.bytes) !== capture.screenshot_sha256) errors.push(`${label} screenshot SHA-256 does not match`);
}

function validateReceipt(binding, type, ledger, options, errors) {
  const label = `${type} receipt`;
  const file = resolveRepositoryFile(binding?.path, {
    rootDir: options.rootDir,
    prefix: "docs/audit/",
    extension: ".json",
  }, errors, label);
  if (!file) return;
  if (!/^[a-f0-9]{64}$/.test(String(binding?.sha256 ?? "")) || sha256(file.bytes) !== binding.sha256) {
    errors.push(`${label} SHA-256 does not match`);
  }
  let receipt;
  try { receipt = JSON.parse(file.bytes.toString("utf8")); }
  catch { errors.push(`${label} is not valid JSON`); return; }
  if (receipt.schemaVersion !== "1.0" || receipt.status !== "passed" || (receipt.errors?.length ?? 0) !== 0) {
    errors.push(`${label} is not a passing schemaVersion 1.0 receipt`);
  }
  if (!validTimestamp(receipt.capturedAt)) errors.push(`${label} needs a timezone-qualified capturedAt`);
  if (type === "deployment") {
    if (receipt.mode !== "live" || receipt.origin !== ledger.origin) errors.push("deployment receipt does not describe the ledger live origin");
    if (receipt.observedReleaseRevision !== ledger.release_revision
      || receipt.expectedReleaseRevision !== ledger.release_revision
      || receipt.releaseRevisionExpectation !== "matched") {
      errors.push("deployment receipt is not exactly bound to the ledger Git release revision");
    }
  } else {
    if (receipt.expectedTotal !== 4_657 || receipt.observedTotal !== 4_657) errors.push("catalogue receipt does not reconcile the governed 4,657-product population");
    if (!receipt.boundaryProducts?.product25 || !receipt.boundaryProducts?.product120 || !receipt.boundaryProducts?.finalProduct) {
      errors.push("catalogue receipt does not prove all three catalogue boundaries");
    }
    const searchIds = new Set((receipt.searches ?? []).filter((entry) => Number(entry.total) > 0).map((entry) => entry.id));
    for (const id of ["paracetamol", "zinc", "omeprazole", "typo", "french", "kinyarwanda"]) {
      if (!searchIds.has(id)) errors.push(`catalogue receipt is missing passing ${id} search evidence`);
    }
  }
  if (validTimestamp(receipt.capturedAt) && validTimestamp(ledger.started_at)) {
    const distance = Math.abs(Date.parse(receipt.capturedAt) - Date.parse(ledger.started_at));
    if (distance > 24 * 60 * 60 * 1000) errors.push(`${label} was not captured within 24 hours of the browser session`);
  }
}

export function validateAuditBrowserEvidence(ledger, {
  strict = false,
  rootDir = process.cwd(),
  now = new Date(),
  currentReleaseRevision = currentGitRevision({ rootDir }),
} = {}) {
  const errors = [];
  const warnings = [];
  const options = { strict, rootDir, now, currentReleaseRevision };
  const scenarios = ledger?.scenarios && typeof ledger.scenarios === "object" ? ledger.scenarios : {};
  const expectedScenarioIds = Object.keys(expectedAuditBrowserScenarios).sort();
  const scenarioIds = Object.keys(scenarios).sort();

  if (ledger?.schema_version !== "1") errors.push("audit browser evidence schema_version must be 1");
  if (ledger?.environment !== "production") errors.push("audit browser evidence environment must be production");
  if (strict && ledger?.origin !== canonicalProductionOrigin) {
    errors.push(`audit browser evidence origin must be the current production origin ${canonicalProductionOrigin}`);
  } else if (!strict && historicalProductionOrigins.has(ledger?.origin)) {
    warnings.push(`audit browser evidence uses historical origin ${ledger.origin}; rerun it on ${canonicalProductionOrigin} before strict closure`);
  } else if (ledger?.origin !== canonicalProductionOrigin) {
    errors.push(`audit browser evidence origin must be ${canonicalProductionOrigin}`);
  }
  if (ledger?.audit_source_revision !== expectedAuditSourceRevision) errors.push("audit browser evidence is not bound to the current audit source revision");
  if (!allowedStatuses.has(ledger?.status)) errors.push("audit browser evidence has an invalid overall status");
  for (const id of expectedScenarioIds.filter((id) => !scenarioIds.includes(id))) errors.push(`missing audit browser scenario ${id}`);
  for (const id of scenarioIds.filter((id) => !expectedScenarioIds.includes(id))) errors.push(`unexpected audit browser scenario ${id}`);

  const statusCounts = { pending: 0, passed: 0, failed: 0, blocked: 0, invalid: 0 };
  let captureCount = 0;
  for (const scenarioId of expectedScenarioIds) {
    const expected = expectedAuditBrowserScenarios[scenarioId];
    const scenario = scenarios[scenarioId];
    if (!scenario) continue;
    if (scenario.title !== expected.title) errors.push(`${scenarioId} title changed from the governed evidence plan`);
    if (scenario.device !== expected.device) errors.push(`${scenarioId} device changed from ${expected.device}`);
    if (!exactArray(scenario.finding_ids, expected.findingIds)) errors.push(`${scenarioId} finding_ids changed from the governed evidence plan`);
    const status = String(scenario.status ?? "");
    if (!allowedStatuses.has(status)) {
      statusCounts.invalid += 1;
      errors.push(`${scenarioId} has invalid status ${status || "missing"}`);
    } else statusCounts[status] += 1;

    const captures = scenario.captures && typeof scenario.captures === "object" ? scenario.captures : {};
    const expectedCaptureIds = Object.keys(expected.captures).sort();
    const captureIds = Object.keys(captures).sort();
    for (const id of expectedCaptureIds.filter((id) => !captureIds.includes(id))) errors.push(`${scenarioId} is missing capture ${id}`);
    for (const id of captureIds.filter((id) => !expectedCaptureIds.includes(id))) errors.push(`${scenarioId} has unexpected capture ${id}`);
    captureCount += captureIds.length;

    for (const captureId of expectedCaptureIds) {
      const capture = captures[captureId];
      if (!capture) continue;
      const captureStatus = String(capture.status ?? "");
      if (!allowedStatuses.has(captureStatus)) errors.push(`${scenarioId}.${captureId} has an invalid status`);
      if (capture.title !== expected.captures[captureId].title) errors.push(`${scenarioId}.${captureId} title changed from the governed evidence plan`);
      validateSafeText(capture.note, `${scenarioId}.${captureId} note`, errors, strict ? 20 : 0);
      if (strict || captureStatus === "passed") {
        if (captureStatus !== "passed") errors.push(`${scenarioId}.${captureId} must be passed`);
        if (typeof capture.route !== "string" || !expected.captures[captureId].routePattern.test(capture.route)) {
          errors.push(`${scenarioId}.${captureId} route is missing or outside its governed surface`);
        }
        const width = Number(capture.viewport_width);
        const height = Number(capture.viewport_height);
        if (expected.device === "desktop" && (!Number.isInteger(width) || width < 1_280 || width > 3_840 || !Number.isInteger(height) || height < 720 || height > 2_160)) {
          errors.push(`${scenarioId}.${captureId} needs a desktop viewport from 1280×720 through 3840×2160`);
        }
        if (expected.device === "mobile" && (!Number.isInteger(width) || width < 320 || width > 480 || !Number.isInteger(height) || height < 640 || height > 1_200)) {
          errors.push(`${scenarioId}.${captureId} needs a mobile viewport from 320×640 through 480×1200`);
        }
        if (!validTimestamp(capture.captured_at)) errors.push(`${scenarioId}.${captureId} needs a timezone-qualified captured_at`);
        if (validTimestamp(capture.captured_at) && validTimestamp(ledger.started_at) && Date.parse(capture.captured_at) < Date.parse(ledger.started_at)) {
          errors.push(`${scenarioId}.${captureId} was captured before the browser session started`);
        }
        if (validTimestamp(capture.captured_at) && validTimestamp(ledger.completed_at) && Date.parse(capture.captured_at) > Date.parse(ledger.completed_at)) {
          errors.push(`${scenarioId}.${captureId} was captured after the browser session completed`);
        }
        validateScreenshot(capture, options, errors, `${scenarioId}.${captureId}`);
      }
    }

    validateSafeText(scenario.note, `${scenarioId} note`, errors, strict ? 30 : 0);
    if (strict && status !== "passed") errors.push(`${scenarioId} is ${status}; strict audit closure requires passed evidence`);
  }

  if (strict || ledger?.status === "passed") {
    if (!/^[a-f0-9]{40}$/.test(String(ledger?.release_revision ?? ""))) errors.push("audit browser evidence requires the exact lowercase Git release revision");
    if (!/^[a-f0-9]{40}$/.test(String(currentReleaseRevision ?? ""))) {
      errors.push("audit browser evidence cannot determine the current checkout revision");
    } else if (ledger?.release_revision !== currentReleaseRevision) {
      errors.push(`audit browser evidence release revision is stale; expected current checkout ${currentReleaseRevision}`);
    }
    if (!allowedCaptureTools.has(ledger?.capture_tool)) errors.push("audit browser evidence requires an approved capture_tool");
    if (typeof ledger?.executed_by !== "string" || ledger.executed_by.trim().length < 3) errors.push("audit browser evidence requires a named executor");
    if (!validTimestamp(ledger?.started_at)) errors.push("audit browser evidence requires a timezone-qualified started_at");
    if (!validTimestamp(ledger?.completed_at)) errors.push("audit browser evidence requires a timezone-qualified completed_at");
    if (validTimestamp(ledger?.started_at) && validTimestamp(ledger?.completed_at) && Date.parse(ledger.completed_at) < Date.parse(ledger.started_at)) errors.push("audit browser evidence completed_at precedes started_at");
    if (typeof ledger?.approved_by !== "string" || ledger.approved_by.trim().length < 3) errors.push("audit browser evidence requires a named approver");
    if (typeof ledger?.approved_role !== "string" || ledger.approved_role.trim().length < 3) errors.push("audit browser evidence requires an approver role");
    if (!validTimestamp(ledger?.approved_at)) errors.push("audit browser evidence requires a timezone-qualified approved_at");
    if (validTimestamp(ledger?.approved_at) && validTimestamp(ledger?.completed_at) && Date.parse(ledger.approved_at) < Date.parse(ledger.completed_at)) errors.push("audit browser evidence was approved before capture completed");
    if (validTimestamp(ledger?.approved_at) && Date.parse(ledger.approved_at) > now.getTime() + 300_000) errors.push("audit browser evidence approval timestamp is in the future");
    if (ledger?.redaction_confirmed !== true || ledger?.personal_data_recorded !== false || ledger?.credentials_recorded !== false) {
      errors.push("audit browser evidence requires explicit redaction and no personal-data or credential retention");
    }
    if (ledger?.status !== "passed") errors.push("audit browser evidence overall status must be passed");
    validateReceipt(ledger?.deployment_receipt, "deployment", ledger, options, errors);
    validateReceipt(ledger?.catalogue_receipt, "catalogue", ledger, options, errors);
  } else if (ledger?.execution_status === "completed_awaiting_approval") {
    if (!/^[a-f0-9]{40}$/.test(String(ledger?.release_revision ?? ""))) errors.push("completed audit browser execution requires the exact lowercase Git release revision");
    if (!allowedCaptureTools.has(ledger?.capture_tool)) errors.push("completed audit browser execution requires an approved capture_tool");
    if (typeof ledger?.executed_by !== "string" || ledger.executed_by.trim().length < 3) errors.push("completed audit browser execution requires a named executor");
    if (!validTimestamp(ledger?.started_at)) errors.push("completed audit browser execution requires a timezone-qualified started_at");
    if (!validTimestamp(ledger?.completed_at)) errors.push("completed audit browser execution requires a timezone-qualified completed_at");
    if (validTimestamp(ledger?.started_at) && validTimestamp(ledger?.completed_at) && Date.parse(ledger.completed_at) < Date.parse(ledger.started_at)) errors.push("audit browser execution completed_at precedes started_at");
    if (ledger?.approved_by !== null || ledger?.approved_role !== null || ledger?.approved_at !== null) errors.push("awaiting-approval audit browser evidence must not contain approval metadata");
    if (ledger?.redaction_confirmed !== true || ledger?.personal_data_recorded !== false || ledger?.credentials_recorded !== false) {
      errors.push("completed audit browser execution requires explicit redaction and no personal-data or credential retention");
    }
    if (statusCounts.passed !== expectedScenarioIds.length) errors.push("completed audit browser execution requires every governed scenario to pass");
    validateReceipt(ledger?.deployment_receipt, "deployment", ledger, options, errors);
    validateReceipt(ledger?.catalogue_receipt, "catalogue", ledger, options, errors);
  } else if ([ledger?.release_revision, ledger?.executed_by, ledger?.started_at, ledger?.completed_at, ledger?.approved_by, ledger?.approved_role, ledger?.approved_at].some(Boolean)) {
    warnings.push("pending audit browser evidence contains execution or approval metadata; clear it until the controlled run begins");
  }

  return {
    valid: errors.length === 0,
    strict,
    scenarioCount: scenarioIds.length,
    captureCount,
    statusCounts,
    errors,
    warnings,
  };
}

function main() {
  const strict = process.argv.includes("--strict");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--strict");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  const ledger = JSON.parse(readFileSync("data/audit-browser-evidence.json", "utf8"));
  const result = validateAuditBrowserEvidence(ledger, { strict });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try { main(); }
  catch (error) {
    console.error(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : "Audit browser evidence validation failed." }, null, 2));
    process.exitCode = 1;
  }
}
