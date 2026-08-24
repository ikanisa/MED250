import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

const GATE = "MED250_GATE_TURNSTILE_SERVER_VERIFIED";
const DEFAULT_OUTPUT_DIR = "docs/launch/evidence";

const secretLike = /(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;
const prohibitedIdentifier = /(?:\b(?:\+?250)?7\d{8}\b|\bOTP\s*[:=]?\s*\d{6}\b|@[a-z0-9.-]+\.[a-z]{2,}|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b)/i;

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function named(value, label) {
  const text = String(value ?? "").trim();
  if (text.length < 3) throw new Error(`${label} is required.`);
  return text;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function requiredTimestamp(value, label) {
  const text = String(value ?? "").trim();
  if (!validTimestamp(text)) throw new Error(`${label} must be a timezone-qualified ISO 8601 timestamp.`);
  return text;
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

function assertSafeResult(result) {
  const serialized = JSON.stringify(result);
  if (secretLike.test(serialized)) throw new Error("Turnstile verifier result contains secret-like material.");
  if (prohibitedIdentifier.test(serialized)) throw new Error("Turnstile verifier result contains a prohibited identifier.");
}

function assertPassedVerifierResult(result) {
  if (result?.status !== "passed") throw new Error("Turnstile verifier status must be passed.");
  if (result?.identifiersEmitted !== false) throw new Error("Turnstile verifier must declare identifiersEmitted=false.");
  if (result?.tokensEmitted !== false) throw new Error("Turnstile verifier must declare tokensEmitted=false.");
  if (result?.checks?.missingToken?.status !== "passed" || result.checks.missingToken.sessionCookieNotIssued !== true) {
    throw new Error("Missing-token rejection check must pass without issuing a browser session.");
  }
  if (result?.checks?.invalidToken?.status !== "passed" || result.checks.invalidToken.sessionCookieNotIssued !== true) {
    throw new Error("Invalid-token rejection check must pass without issuing a browser session.");
  }
  const valid = result?.checks?.validToken;
  if (valid?.status !== "passed"
    || valid.disposableAnonymousSessionCreated !== true
    || valid.disposableSessionRestored !== true
    || valid.disposableSessionRevoked !== true
    || valid.postRevokeUnauthenticated !== true) {
    throw new Error("Valid-token positive path must create, restore and revoke one disposable anonymous session.");
  }
}

export function buildTurnstileLaunchEvidence({
  verifierResult,
  verifierResultSha256 = "",
  verifierResultReference = "",
  executedBy,
  executorRole,
  startedAt,
  completedAt,
  noMarketplaceSideEffectConfirmed = false,
  now = new Date(),
}) {
  assertSafeResult(verifierResult);
  assertPassedVerifierResult(verifierResult);
  if (!/^[a-f0-9]{64}$/.test(String(verifierResultSha256))) {
    throw new Error("verifierResultSha256 must be a lowercase SHA-256 digest.");
  }
  const started = requiredTimestamp(startedAt, "started_at");
  const completed = requiredTimestamp(completedAt, "completed_at");
  if (Date.parse(completed) < Date.parse(started)) throw new Error("completed_at cannot precede started_at.");
  if (Date.parse(completed) > now.getTime() + 300_000) throw new Error("completed_at is in the future.");
  if (noMarketplaceSideEffectConfirmed !== true) {
    throw new Error("noMarketplaceSideEffectConfirmed must be true.");
  }

  const artifact = {
    schema_version: "1",
    release: "med250-production",
    gate: GATE,
    evidence_type: "test_record",
    status: "complete",
    title: "MED+250 production Turnstile positive-path completed test record",
    summary: "The controlled production Turnstile verifier rejected missing and invalid responses, accepted one real widget response, created and revoked one disposable Cloudflare Worker session, and retained no tokens or identifiers.",
    recorded_at: completed,
    recorded_by: named(executedBy, "executed_by"),
    recorded_role: named(executorRole, "executor_role"),
    redactions_confirmed: true,
    checks: [
      {
        name: "Missing Turnstile evidence rejected",
        status: "passed",
        detail: "The protected Worker rejected a missing Turnstile response without issuing a browser session cookie.",
      },
      {
        name: "Invalid Turnstile evidence rejected",
        status: "passed",
        detail: "The protected Worker rejected an invalid Turnstile response without issuing a browser session cookie.",
      },
      {
        name: "Real production widget completed",
        status: "passed",
        detail: "The verifier received a short-lived real widget response only through the protected operator process environment.",
      },
      {
        name: "Disposable anonymous session created",
        status: "passed",
        detail: "The valid response created and restored one disposable anonymous customer session through the Cloudflare Worker.",
      },
      {
        name: "Disposable session revoked",
        status: "passed",
        detail: "The disposable session was revoked and the same cookie no longer authenticated after sign-out.",
      },
      {
        name: "No marketplace side effect",
        status: "passed",
        detail: "The operator confirmed the controlled Auth test created no cart, availability request, pharmacy message, prescription or marketplace data row.",
      },
      {
        name: "Redacted verifier output retained",
        status: "passed",
        detail: "The retained verifier result declares that no token, identity, session material or complete provider response was emitted.",
      },
    ],
    executed_by: named(executedBy, "executed_by"),
    executor_role: named(executorRole, "executor_role"),
    started_at: started,
    completed_at: completed,
    verifier_result_reference: verifierResultReference || null,
    verifier_result_sha256: verifierResultSha256,
    worker_host: verifierResult.workerHost,
    no_marketplace_side_effect_confirmed: true,
  };
  const validation = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: GATE,
    expectedType: "test_record",
    now,
  });
  if (!validation.valid) {
    throw new Error(`Turnstile test artifact is invalid: ${validation.errors.join("; ")}`);
  }
  return artifact;
}

function parseArgs(values) {
  const args = {
    input: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    date: new Date().toISOString().slice(0, 10),
    executedBy: "",
    executorRole: "",
    startedAt: "",
    completedAt: "",
    noMarketplaceSideEffectConfirmed: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--input") args.input = values[++index] ?? "";
    else if (flag === "--output-dir") args.outputDir = values[++index] ?? "";
    else if (flag === "--date") args.date = values[++index] ?? "";
    else if (flag === "--executed-by") args.executedBy = values[++index] ?? "";
    else if (flag === "--executor-role") args.executorRole = values[++index] ?? "";
    else if (flag === "--started-at") args.startedAt = values[++index] ?? "";
    else if (flag === "--completed-at") args.completedAt = values[++index] ?? "";
    else if (flag === "--no-marketplace-side-effect-confirmed") args.noMarketplaceSideEffectConfirmed = true;
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.input) throw new Error("--input requires a redacted Turnstile verifier result JSON path.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = evidenceOutputDir(args.outputDir);
  const stamp = dateStamp(args.date);
  const verifierSource = await readFile(args.input, "utf8");
  const artifact = buildTurnstileLaunchEvidence({
    verifierResult: JSON.parse(verifierSource),
    verifierResultSha256: sha256(verifierSource),
    verifierResultReference: args.input,
    executedBy: args.executedBy,
    executorRole: args.executorRole,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    noMarketplaceSideEffectConfirmed: args.noMarketplaceSideEffectConfirmed,
  });
  const outputReference = join(outputDir, `turnstile-positive-path-test-${stamp}.json`).replaceAll("\\", "/");
  const outputPath = resolve(outputReference);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "written",
    output: outputReference,
    gate: artifact.gate,
    next_commands: [
      `npm run launch:evidence:record -- --artifact ${outputReference} --replace --confirm --approved-by "Named security owner" --approved-role "Security owner" --approved-at "${artifact.completed_at}"`,
    ],
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message, identifiersEmitted: false, tokensEmitted: false }, null, 2));
  process.exitCode = 1;
});
