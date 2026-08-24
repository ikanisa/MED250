import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";
import {
  expectedPhysicalUatScenarios,
  validatePhysicalUat,
} from "./validate-physical-uat.mjs";

const GATE = "MED250_GATE_PHYSICAL_UAT_PASSED";
const LEDGER_PATH = "data/physical-device-uat.json";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function dateStamp(value) {
  const stamp = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) throw new Error("--date must use YYYY-MM-DD.");
  return stamp;
}

function evidenceOutputDir(value) {
  const outputDir = String(value ?? "").trim().replaceAll("\\", "/");
  if (!outputDir) throw new Error("--output-dir requires a path.");
  if (isAbsolute(outputDir) || outputDir.split("/").includes("..")) {
    throw new Error("--output-dir must be a repository-relative path.");
  }
  if (!outputDir.startsWith("docs/launch/evidence")) {
    throw new Error("--output-dir must be under docs/launch/evidence.");
  }
  return outputDir.replace(/\/+$/, "");
}

function scenarioCheckName(scenarioId, scenario) {
  const title = String(scenario?.title ?? scenarioId).trim();
  return title.length <= 72 ? title : `${title.slice(0, 69)}...`;
}

function scenarioCheckDetail(scenarioId, scenario) {
  const note = String(scenario?.note ?? "").trim();
  return `${scenarioId}: ${note}`;
}

export function buildPhysicalUatLaunchEvidence(
  ledger,
  {
    ledgerPath = LEDGER_PATH,
    ledgerSha256 = "",
    recordedAt = ledger.completed_at,
    recordedBy = ledger.executed_by,
    recordedRole = "QA test executor",
    testReference = null,
    now = new Date(),
  } = {},
) {
  const strict = validatePhysicalUat(ledger, { strict: true, now });
  if (!strict.valid) {
    throw new Error(`Physical UAT ledger is not production-ready: ${strict.errors.join("; ")}`);
  }

  const checks = expectedPhysicalUatScenarios.map((scenarioId) => {
    const scenario = ledger.scenarios[scenarioId];
    return {
      name: scenarioCheckName(scenarioId, scenario),
      status: "passed",
      detail: scenarioCheckDetail(scenarioId, scenario),
    };
  });

  const common = {
    schema_version: "1",
    release: "med250-production",
    gate: GATE,
    status: "complete",
    recorded_at: recordedAt,
    recorded_by: recordedBy,
    recorded_role: recordedRole,
    redactions_confirmed: true,
    uat_ledger_reference: ledgerPath,
    uat_ledger_sha256: ledgerSha256,
    scenario_count: expectedPhysicalUatScenarios.length,
    passed_scenarios: strict.statusCounts.passed,
    pending_scenarios: strict.statusCounts.pending,
  };

  const testRecord = {
    ...common,
    evidence_type: "test_record",
    title: "MED+250 controlled physical-device UAT completed test record",
    summary: "Strict controlled physical-device UAT passed all 12 production launch scenarios with redacted evidence references and no prohibited identifiers stored.",
    checks,
    executed_by: ledger.executed_by,
    executor_role: "QA test executor",
    started_at: ledger.started_at,
    completed_at: ledger.completed_at,
    customer_identity_label: ledger.customer_identity_label,
    pharmacy_identity_label: ledger.pharmacy_identity_label,
    unrelated_pharmacy_identity_label: ledger.unrelated_pharmacy_identity_label,
  };

  const signedApproval = {
    ...common,
    evidence_type: "signed_approval",
    title: "MED+250 controlled physical-device UAT QA-owner approval",
    summary: "The QA owner approved the strict controlled physical-device UAT results, identity scope, privacy boundaries, unintended-contact controls and cleanup readiness.",
    recorded_by: ledger.approved_by,
    recorded_role: ledger.approved_role,
    recorded_at: ledger.approved_at,
    checks: [
      {
        name: "Strict UAT ledger passed",
        status: "passed",
        detail: "The governed physical-device UAT ledger passed strict validation with every launch scenario completed.",
      },
      {
        name: "All scenario evidence reviewed",
        status: "passed",
        detail: "The QA owner reviewed redacted evidence references and notes for all controlled-device scenarios.",
      },
      {
        name: "No unintended pharmacy contacted",
        status: "passed",
        detail: "The QA owner confirmed the run stayed inside approved customer, pharmacy and unrelated-pharmacy test identities.",
      },
      {
        name: "Privacy-safe cleanup accepted",
        status: "passed",
        detail: "The QA owner accepted the privacy boundaries, retention behavior and cleanup posture for controlled test data.",
      },
    ],
    decision: "approved",
    approved_by: ledger.approved_by,
    approved_role: ledger.approved_role,
    approved_at: ledger.approved_at,
    test_reference: testReference,
  };

  for (const artifact of [testRecord, signedApproval]) {
    const validation = validateLaunchEvidenceArtifact(artifact, {
      expectedGate: GATE,
      expectedType: artifact.evidence_type,
      now,
    });
    if (!validation.valid) {
      throw new Error(`${artifact.evidence_type} artifact is invalid: ${validation.errors.join("; ")}`);
    }
  }

  return { testRecord, signedApproval };
}

async function main() {
  const values = process.argv.slice(2);
  const args = {
    ledgerPath: LEDGER_PATH,
    outputDir: "docs/launch/evidence",
    date: new Date().toISOString().slice(0, 10),
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--ledger") args.ledgerPath = values[++index] ?? "";
    else if (flag === "--output-dir") args.outputDir = values[++index] ?? "";
    else if (flag === "--date") args.date = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.ledgerPath) throw new Error("--ledger requires a path.");
  const outputDir = evidenceOutputDir(args.outputDir);
  const stamp = dateStamp(args.date);
  const testReference = join(outputDir, `physical-device-uat-test-${stamp}.json`).replaceAll("\\", "/");
  const approvalReference = join(outputDir, `physical-device-uat-approval-${stamp}.json`).replaceAll("\\", "/");
  const ledgerSource = await readFile(args.ledgerPath, "utf8");
  const artifacts = buildPhysicalUatLaunchEvidence(JSON.parse(ledgerSource), {
    ledgerPath: args.ledgerPath,
    ledgerSha256: sha256(ledgerSource),
    testReference,
  });

  const testPath = resolve(testReference);
  const approvalPath = resolve(approvalReference);
  for (const [path, artifact] of [
    [testPath, artifacts.testRecord],
    [approvalPath, artifacts.signedApproval],
  ]) {
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialized, "utf8");
  }

  console.log(JSON.stringify({
    status: "written",
    outputs: {
      test_record: testReference,
      signed_approval: approvalReference,
    },
    next_commands: [
      `npm run launch:evidence:record -- --artifact ${testReference} --replace`,
      `npm run launch:evidence:record -- --artifact ${approvalReference} --replace --confirm --approved-by "${artifacts.signedApproval.approved_by}" --approved-role "${artifacts.signedApproval.approved_role}" --approved-at "${artifacts.signedApproval.approved_at}"`,
    ],
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
