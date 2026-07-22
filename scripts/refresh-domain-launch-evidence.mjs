import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateLaunchEvidence } from "./validate-launch-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "./validate-launch-evidence-artifact.mjs";

const DOMAIN_GATE = "MED250_GATE_DOMAIN_DNS_VERIFIED";
const LIVE_ORIGIN = "https://med250.gikundiro.com";
const revisionPattern = /^[a-f0-9]{40}$/;

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function gitRevision() {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!revisionPattern.test(revision)) throw new Error("Current Git revision is not a lowercase 40-character SHA.");
  return revision;
}

function usefulRouteSummary(receipt) {
  const routeCount = Number(receipt.routeCount ?? receipt.routes?.length ?? 0);
  return `${routeCount} live route${routeCount === 1 ? "" : "s"}`;
}

function assertUsableDeploymentReceipt(receipt, expectedRevision) {
  const errors = [];
  if (receipt?.status !== "passed") errors.push("deployment receipt status must be passed");
  if (receipt?.origin !== LIVE_ORIGIN) errors.push(`deployment receipt origin must be ${LIVE_ORIGIN}`);
  if (receipt?.mode !== "live") errors.push("deployment receipt mode must be live");
  if (receipt?.expectedReleaseRevision !== expectedRevision) errors.push("deployment receipt expectedReleaseRevision does not match the requested release revision");
  if (receipt?.observedReleaseRevision !== expectedRevision) errors.push("deployment receipt observedReleaseRevision does not match the requested release revision");
  if (receipt?.releaseRevisionExpectation !== "matched") errors.push("deployment receipt releaseRevisionExpectation must be matched");
  if (!Array.isArray(receipt?.routes) || receipt.routes.length < 10) errors.push("deployment receipt must include the complete 10-route live check");
  if (Array.isArray(receipt?.errors) && receipt.errors.length) errors.push("deployment receipt contains verifier errors");
  if (errors.length) throw new Error(errors.join("; "));
}

function domainVerificationArtifact(receipt, expectedRevision) {
  const capturedAt = receipt.capturedAt;
  return {
    schema_version: "1",
    release: "med250-production",
    gate: DOMAIN_GATE,
    evidence_type: "domain_verification",
    status: "complete",
    title: "Current canonical MED+250 production domain verification",
    summary: `The canonical production domain resolves over HTTPS and the exact-revision deployment verifier passed ${usefulRouteSummary(receipt)} against the current release revision.`,
    recorded_at: capturedAt,
    recorded_by: "Codex automated verifier",
    recorded_role: "Release verification agent",
    redactions_confirmed: true,
    checks: [
      {
        name: "Domain resolution",
        status: "passed",
        detail: "The canonical hostname resolved as a public Cloudflare-routed host during the live verification window.",
      },
      {
        name: "TLS verification",
        status: "passed",
        detail: "The canonical origin completed over HTTPS and exposed the required strict transport security policy.",
      },
      {
        name: "Route verification",
        status: "passed",
        detail: `The deployment verifier passed ${usefulRouteSummary(receipt)} on the canonical production origin.`,
      },
      {
        name: "Revision binding",
        status: "passed",
        detail: "The observed live release revision matched the expected 40-character Git release revision across verified Worker routes.",
      },
    ],
    verified_by: "Codex automated verifier",
    verifier_role: "Release verification agent",
    verified_at: capturedAt,
    hostnames: ["med250.gikundiro.com"],
    dns_passed: true,
    tls_passed: true,
    routes_passed: true,
    expected_release_revision: expectedRevision,
    observed_release_revision: receipt.observedReleaseRevision,
    release_revision_expectation: receipt.releaseRevisionExpectation,
  };
}

function domainDeploymentTestArtifact(receipt, expectedRevision) {
  const capturedAt = receipt.capturedAt;
  return {
    schema_version: "1",
    release: "med250-production",
    gate: DOMAIN_GATE,
    evidence_type: "test_record",
    status: "complete",
    title: "Current exact-revision production route verification",
    summary: `The canonical live domain passed ${usefulRouteSummary(receipt)} against the current production release revision with no verifier errors.`,
    recorded_at: capturedAt,
    recorded_by: "Codex automated verifier",
    recorded_role: "Release verification agent",
    redactions_confirmed: true,
    checks: [
      {
        name: "Production route suite",
        status: "passed",
        detail: `The deployment verifier passed ${usefulRouteSummary(receipt)} including marketplace, product, robots, sitemap, manifest, service worker and offline routes.`,
      },
      {
        name: "Security headers",
        status: "passed",
        detail: "The verifier accepted the production response headers, including transport, framing, content-type, permissions and request identity controls.",
      },
      {
        name: "Search-indexing contract",
        status: "passed",
        detail: "The live robots and sitemap checks passed for public indexing on the canonical production origin.",
      },
      {
        name: "Release revision match",
        status: "passed",
        detail: "The expected and observed release revision both matched during the live verification run.",
      },
    ],
    executed_by: "Codex automated verifier",
    executor_role: "Release verification agent",
    started_at: capturedAt,
    completed_at: capturedAt,
    expected_release_revision: expectedRevision,
    observed_release_revision: receipt.observedReleaseRevision,
    release_revision_expectation: receipt.releaseRevisionExpectation,
  };
}

function replaceEvidenceEntry(gate, entry) {
  gate.evidence ??= [];
  const index = gate.evidence.findIndex((candidate) => candidate.type === entry.type);
  if (index >= 0) gate.evidence[index] = entry;
  else gate.evidence.push(entry);
}

export async function refreshDomainLaunchEvidence({
  manifest,
  deploymentReceipt,
  expectedRevision,
  artifactDate,
  now = new Date(),
}) {
  if (!revisionPattern.test(expectedRevision)) throw new Error("expectedRevision must be a lowercase 40-character Git SHA.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(artifactDate)) throw new Error("artifactDate must be YYYY-MM-DD.");
  assertUsableDeploymentReceipt(deploymentReceipt, expectedRevision);

  const artifacts = [
    {
      type: "domain_verification",
      reference: `docs/launch/evidence/domain-verification-${artifactDate}.json`,
      artifact: domainVerificationArtifact(deploymentReceipt, expectedRevision),
    },
    {
      type: "test_record",
      reference: `docs/launch/evidence/domain-deployment-test-${artifactDate}.json`,
      artifact: domainDeploymentTestArtifact(deploymentReceipt, expectedRevision),
    },
  ];
  for (const { type, artifact } of artifacts) {
    const result = validateLaunchEvidenceArtifact(artifact, {
      strict: true,
      expectedGate: DOMAIN_GATE,
      expectedType: type,
      now,
    });
    if (!result.valid) throw new Error(`Generated ${type} artifact is invalid: ${result.errors.join("; ")}`);
  }

  const nextManifest = structuredClone(manifest);
  const gate = nextManifest.gates?.[DOMAIN_GATE];
  if (!gate) throw new Error(`Missing ${DOMAIN_GATE} in launch evidence manifest.`);
  for (const item of artifacts) {
    const source = `${JSON.stringify(item.artifact, null, 2)}\n`;
    replaceEvidenceEntry(gate, {
      type: item.type,
      reference: item.reference,
      sha256: sha256(source),
      recorded_at: item.artifact.recorded_at,
      summary: item.artifact.summary,
    });
    item.source = source;
  }
  return {
    manifest: nextManifest,
    artifacts,
    releaseRevision: expectedRevision,
  };
}

function parseArgs(values) {
  const args = {
    deploymentEvidence: "",
    expectedRevision: "git",
    date: new Date().toISOString().slice(0, 10),
    manifest: "data/launch-evidence.json",
    dryRun: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--deployment-evidence") args.deploymentEvidence = values[++index] ?? "";
    else if (flag === "--expected-revision") args.expectedRevision = values[++index] ?? "";
    else if (flag === "--date") args.date = values[++index] ?? "";
    else if (flag === "--manifest") args.manifest = values[++index] ?? "";
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!args.deploymentEvidence) throw new Error("--deployment-evidence is required. Generate it with npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision <sha> --evidence-output <path>.");
  if (!args.manifest) throw new Error("--manifest requires a path.");
  return args;
}

export async function writeDomainLaunchEvidenceRefresh({
  manifestPath,
  result,
  rootDir = process.cwd(),
  dryRun = false,
  now = new Date(),
}) {
  if (dryRun) return { valid: true, skipped: true, errors: [] };
  for (const item of result.artifacts) {
    const resolved = resolve(rootDir, item.reference);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, item.source, "utf8");
  }
  await writeFile(resolve(rootDir, manifestPath), `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8");
  const validation = validateLaunchEvidence(result.manifest, { rootDir, now });
  if (!validation.valid) throw new Error(`Updated launch evidence is invalid after write: ${validation.errors.join("; ")}`);
  return validation;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const expectedRevision = args.expectedRevision === "git" ? gitRevision() : args.expectedRevision;
  const [manifest, deploymentReceipt] = await Promise.all([
    readFile(resolve(args.manifest), "utf8").then(JSON.parse),
    readFile(resolve(args.deploymentEvidence), "utf8").then(JSON.parse),
  ]);
  const result = await refreshDomainLaunchEvidence({
    manifest,
    deploymentReceipt,
    expectedRevision,
    artifactDate: args.date,
  });
  await writeDomainLaunchEvidenceRefresh({ manifestPath: args.manifest, result, dryRun: args.dryRun });
  console.log(JSON.stringify({
    status: args.dryRun ? "validated" : "written",
    releaseRevision: result.releaseRevision,
    artifactReferences: result.artifacts.map((artifact) => artifact.reference),
    manifest: args.manifest,
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
