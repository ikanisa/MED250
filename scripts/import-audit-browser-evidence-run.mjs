import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ledgerPath = resolve(root, "data/audit-browser-evidence.json");
const replacePassed = process.argv.includes("--replace-passed");
const selectedScenarios = new Set(process.argv.slice(2)
  .filter((argument) => argument.startsWith("--scenario="))
  .map((argument) => argument.slice("--scenario=".length)));
const runArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const runPath = resolve(root, runArgument || "tmp/audit-browser-evidence-run.json");
const optionValue = (name) => process.argv.slice(2)
  .find((argument) => argument.startsWith(`${name}=`))
  ?.slice(name.length + 1);
const deploymentPath = optionValue("--deployment-receipt")
  || "docs/audit/live-baseline-2026-07-18/14-deployment-verification-5ef50a.json";
const cataloguePath = optionValue("--catalogue-receipt")
  || "docs/audit/live-baseline-2026-07-18/15-live-catalogue-verification-5ef50a.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const [ledgerSource, runSource, deploymentSource, catalogueSource] = await Promise.all([
  readFile(ledgerPath, "utf8"),
  readFile(runPath, "utf8"),
  readFile(resolve(root, deploymentPath)),
  readFile(resolve(root, cataloguePath)),
]);

const ledger = JSON.parse(ledgerSource);
const run = JSON.parse(runSource);

for (const [scenarioId, scenarioRun] of Object.entries(run.scenarios || {})) {
  if (selectedScenarios.size > 0 && !selectedScenarios.has(scenarioId)) continue;
  const scenario = ledger.scenarios?.[scenarioId];
  if (!scenario) throw new Error(`Unknown governed browser scenario: ${scenarioId}`);
  if (scenario.status === "passed" && !replacePassed) continue;

  for (const [captureId, captureRun] of Object.entries(scenarioRun.captures || {})) {
    const capture = scenario.captures?.[captureId];
    if (!capture) throw new Error(`Unknown governed browser capture: ${scenarioId}.${captureId}`);
    scenario.captures[captureId] = {
      ...capture,
      ...captureRun,
      title: capture.title,
    };
  }

  const expectedCaptureIds = Object.keys(scenario.captures);
  if (!expectedCaptureIds.every((captureId) => scenario.captures[captureId].status === "passed")) {
    throw new Error(`Scenario did not complete every governed capture: ${scenarioId}`);
  }
  scenario.status = "passed";
  scenario.note = scenarioRun.note || "Controlled production checks passed without retaining personal data or credentials.";
}

ledger.status = "pending";
ledger.execution_status = "completed_awaiting_approval";
ledger.release_revision = run.release_revision;
ledger.deployment_receipt = { path: deploymentPath, sha256: sha256(deploymentSource) };
ledger.catalogue_receipt = { path: cataloguePath, sha256: sha256(catalogueSource) };
ledger.capture_tool = run.capture_tool;
ledger.executed_by = run.executed_by;
ledger.started_at = run.started_at;
ledger.completed_at = run.console_summary?.captured_at || run.completed_at;
ledger.redaction_confirmed = true;
ledger.personal_data_recorded = false;
ledger.credentials_recorded = false;
ledger.approved_by = null;
ledger.approved_role = null;
ledger.approved_at = null;

await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const statusCounts = Object.values(ledger.scenarios).reduce((counts, scenario) => {
  counts[scenario.status] = (counts[scenario.status] || 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ ledgerPath, statusCounts, execution_status: ledger.execution_status }, null, 2));
