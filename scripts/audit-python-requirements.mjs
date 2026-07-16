import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REQUIREMENT_FILES = [
  "requirements-pharmacy-scraper.txt",
  "requirements-product-images.txt",
];
const DEFAULT_OSV_URL = "https://api.osv.dev/v1/querybatch";

function normalizePackageName(value) {
  return value.trim().toLowerCase().replace(/[_.]+/g, "-");
}

export function parsePinnedRequirement(line, source = "requirements") {
  const withoutComment = line.replace(/\s+#.*$/, "").trim();
  if (!withoutComment) return null;
  if (withoutComment.startsWith("-")) {
    throw new Error(`${source} contains an unsupported requirement directive: ${withoutComment}`);
  }
  const match = withoutComment.match(
    /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([A-Za-z0-9,._-]+)\])?==([A-Za-z0-9][A-Za-z0-9.!+_-]*)$/,
  );
  if (!match) {
    throw new Error(`${source} must pin every package with ==: ${withoutComment}`);
  }
  return {
    name: normalizePackageName(match[1]),
    displayName: match[1],
    extras: match[2] ? match[2].split(",").sort() : [],
    version: match[3],
    source,
  };
}

export function collectPinnedRequirements(sources) {
  const requirements = new Map();
  for (const { source, text } of sources) {
    for (const line of text.split(/\r?\n/)) {
      const requirement = parsePinnedRequirement(line, source);
      if (!requirement) continue;
      const previous = requirements.get(requirement.name);
      if (previous && previous.version !== requirement.version) {
        throw new Error(
          `${requirement.name} has conflicting pins: ${previous.version} and ${requirement.version}`,
        );
      }
      requirements.set(requirement.name, requirement);
    }
  }
  return [...requirements.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function assessOsvResults(requirements, results) {
  if (!Array.isArray(results) || results.length !== requirements.length) {
    throw new Error("OSV returned an incomplete Python dependency result set");
  }
  const findings = [];
  for (const [index, result] of results.entries()) {
    const ids = [...new Set((result?.vulns ?? []).map((entry) => entry?.id).filter(Boolean))].sort();
    if (ids.length) {
      findings.push({
        package: requirements[index].name,
        version: requirements[index].version,
        advisoryCount: ids.length,
        advisoryIds: ids,
      });
    }
  }
  return {
    status: findings.length ? "failed" : "passed",
    ecosystem: "PyPI",
    packageCount: requirements.length,
    vulnerablePackageCount: findings.length,
    findings,
  };
}

export async function auditPythonRequirements({
  rootDir = resolve("."),
  requirementFiles = DEFAULT_REQUIREMENT_FILES,
  fetchImpl = fetch,
  osvUrl = DEFAULT_OSV_URL,
} = {}) {
  const sources = await Promise.all(
    requirementFiles.map(async (file) => ({
      source: file,
      text: await readFile(resolve(rootDir, file), "utf8"),
    })),
  );
  const requirements = collectPinnedRequirements(sources);
  if (!requirements.length) throw new Error("No pinned Python dependencies were found");

  const response = await fetchImpl(osvUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      queries: requirements.map(({ name, version }) => ({
        package: { ecosystem: "PyPI", name },
        version,
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`OSV Python dependency audit failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  return assessOsvResults(requirements, payload?.results);
}

async function main() {
  const result = await auditPythonRequirements();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  }
}
