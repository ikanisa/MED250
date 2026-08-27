import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function currentGitRevision({ rootDir = process.cwd() } = {}) {
  try {
    const revision = execFileSync("git", ["-C", resolve(rootDir), "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[a-f0-9]{40}$/.test(revision) ? revision : null;
  } catch {
    return null;
  }
}

export function recordedReleaseRevision(manifest) {
  const revision = String(manifest?.release_revision ?? "").trim();
  return /^[a-f0-9]{40}$/.test(revision) ? revision : null;
}

export function releaseRevisionForManifest(manifest, { rootDir = process.cwd() } = {}) {
  return recordedReleaseRevision(manifest) ?? currentGitRevision({ rootDir });
}

export async function releaseBindingsForManifest(
  manifest,
  options = {},
) {
  const rootDir = options.rootDir ?? process.cwd();
  const currentRevision = Object.hasOwn(options, "currentRevision")
    ? options.currentRevision
    : releaseRevisionForManifest(manifest, { rootDir });
  const bindings = new Map();
  for (const [gateName, gate] of Object.entries(manifest.gates ?? {})) {
    const gateBindings = [];
    for (const evidence of gate.evidence ?? []) {
      if (typeof evidence?.reference !== "string" || !evidence.reference.startsWith("docs/launch/evidence/")) continue;
      try {
        const artifact = await loadJson(resolve(rootDir, evidence.reference));
        const expectedReleaseRevision = String(artifact.expected_release_revision ?? "").trim();
        const observedReleaseRevision = String(artifact.observed_release_revision ?? "").trim();
        if (!expectedReleaseRevision && !observedReleaseRevision) continue;
        const matchesCurrentRevision = Boolean(
          currentRevision
          && expectedReleaseRevision === currentRevision
          && observedReleaseRevision === currentRevision
          && artifact.release_revision_expectation === "matched",
        );
        gateBindings.push({
          type: evidence.type,
          reference: evidence.reference,
          expectedReleaseRevision,
          observedReleaseRevision,
          releaseRevisionExpectation: artifact.release_revision_expectation ?? null,
          matchesCurrentRevision,
        });
      } catch {
        gateBindings.push({
          type: evidence.type,
          reference: evidence.reference,
          expectedReleaseRevision: null,
          observedReleaseRevision: null,
          releaseRevisionExpectation: "unreadable",
          matchesCurrentRevision: false,
        });
      }
    }
    bindings.set(gateName, gateBindings);
  }
  return bindings;
}

export async function staleReleaseEvidenceGateNames(manifest, options = {}) {
  const bindings = await releaseBindingsForManifest(manifest, options);
  return new Set([...bindings.entries()]
    .filter(([, gateBindings]) => gateBindings.some((binding) => !binding.matchesCurrentRevision))
    .map(([gateName]) => gateName));
}
