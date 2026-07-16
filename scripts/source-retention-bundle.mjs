import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSpecPath = resolve(repoRoot, "data/source-retention-spec.json");
const digestPattern = /^[a-f0-9]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function canonicalEntries(entries) {
  return entries
    .map(({ id, bundle_path: bundlePath, bytes, sha256: digest }) => ({ id, bundle_path: bundlePath, bytes, sha256: digest }))
    .toSorted((left, right) => left.bundle_path.localeCompare(right.bundle_path));
}

export function bundleDigest(entries) {
  return sha256(Buffer.from(canonicalEntries(entries)
    .map((entry) => `${entry.bundle_path}\0${entry.id}\0${entry.bytes}\0${entry.sha256}\n`)
    .join(""), "utf8"));
}

function validateArtifactDefinition(artifact, seenIds, seenPaths) {
  if (!artifact || typeof artifact !== "object") throw new Error("Every retention artifact must be an object.");
  if (!/^[a-z0-9_]+$/.test(artifact.id ?? "")) throw new Error(`Invalid artifact id: ${artifact.id ?? ""}`);
  if (seenIds.has(artifact.id)) throw new Error(`Duplicate artifact id: ${artifact.id}`);
  seenIds.add(artifact.id);
  if (!["local", "remote"].includes(artifact.source_kind)) throw new Error(`${artifact.id} has an invalid source_kind.`);
  if (typeof artifact.source !== "string" || !artifact.source.trim()) throw new Error(`${artifact.id} is missing its source.`);
  if (artifact.source_kind === "local") {
    const normalizedSource = artifact.source.replaceAll("\\", "/");
    if (normalizedSource.startsWith("/") || normalizedSource.split("/").includes("..")) {
      throw new Error(`${artifact.id} local source must stay inside the source root.`);
    }
  } else {
    const source = new URL(artifact.source);
    if (source.protocol !== "https:") throw new Error(`${artifact.id} remote source must use HTTPS.`);
  }
  if (typeof artifact.bundle_path !== "string" || !artifact.bundle_path.trim()) throw new Error(`${artifact.id} is missing bundle_path.`);
  const normalizedPath = artifact.bundle_path.replaceAll("\\", "/");
  if (normalizedPath.startsWith("/") || normalizedPath.split("/").includes("..")) throw new Error(`${artifact.id} bundle_path must stay inside the bundle.`);
  if (seenPaths.has(normalizedPath)) throw new Error(`Duplicate bundle path: ${normalizedPath}`);
  seenPaths.add(normalizedPath);
  if (!Number.isInteger(artifact.expected_bytes) || artifact.expected_bytes < 1) throw new Error(`${artifact.id} expected_bytes must be positive.`);
  if (!digestPattern.test(artifact.expected_sha256 ?? "")) throw new Error(`${artifact.id} expected_sha256 must be lowercase SHA-256.`);
}

export function validateRetentionSpec(spec) {
  if (spec?.schema_version !== "1") throw new Error("Retention spec schema_version must be 1.");
  if (!/^[a-z0-9][a-z0-9-]+$/.test(spec?.bundle_id ?? "")) throw new Error("Retention spec bundle_id is invalid.");
  if (spec?.classification !== "controlled_private_source_evidence") throw new Error("Retention spec must be controlled private source evidence.");
  if (!Array.isArray(spec?.artifacts) || spec.artifacts.length < 1) throw new Error("Retention spec requires artifacts.");
  const seenIds = new Set();
  const seenPaths = new Set();
  for (const artifact of spec.artifacts) validateArtifactDefinition(artifact, seenIds, seenPaths);
  return spec;
}

function validateMediaType(buffer, artifact) {
  const mediaType = artifact.media_type ?? "";
  if (mediaType === "application/pdf" && !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error(`${artifact.id} is not a PDF.`);
  }
  if (mediaType.includes("spreadsheetml") && !buffer.subarray(0, 2).equals(Buffer.from("PK"))) {
    throw new Error(`${artifact.id} is not an XLSX ZIP container.`);
  }
  if (mediaType === "application/json" || artifact.semantic_check?.type === "json") {
    JSON.parse(buffer.toString("utf8"));
  }
  if (artifact.semantic_check?.type === "csv_data_rows") {
    const rows = buffer.toString("utf8").trimEnd().split(/\r?\n/).length - 1;
    if (rows !== artifact.semantic_check.expected) {
      throw new Error(`${artifact.id} has ${rows} CSV data rows; expected ${artifact.semantic_check.expected}.`);
    }
  }
  if (artifact.semantic_check?.type === "html_pattern_count") {
    const count = buffer.toString("utf8").split(artifact.semantic_check.pattern).length - 1;
    if (count !== artifact.semantic_check.expected) {
      throw new Error(`${artifact.id} has ${count} HTML pattern matches; expected ${artifact.semantic_check.expected}.`);
    }
  }
}

async function loadArtifact(artifact, { fetchImpl = fetch, rootDir = repoRoot } = {}) {
  let buffer;
  if (artifact.source_kind === "local") {
    buffer = await readFile(resolve(rootDir, artifact.source));
  } else {
    const response = await fetchImpl(artifact.source, {
      headers: { "User-Agent": "MED250 controlled source-retention capture/1.0" },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`${artifact.id} returned HTTP ${response.status}.`);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  const digest = sha256(buffer);
  if (buffer.byteLength !== artifact.expected_bytes) {
    throw new Error(`${artifact.id} has ${buffer.byteLength} bytes; expected ${artifact.expected_bytes}.`);
  }
  if (digest !== artifact.expected_sha256) {
    throw new Error(`${artifact.id} SHA-256 changed: ${digest}.`);
  }
  validateMediaType(buffer, artifact);
  return buffer;
}

function resolveOutput(output, spec, rootDir) {
  const destination = resolve(rootDir, output || spec.default_output);
  if (inside(rootDir, destination) && !inside(resolve(rootDir, "outputs"), destination)) {
    throw new Error("A source-retention bundle inside the repository must stay under the gitignored outputs/ directory.");
  }
  return destination;
}

export async function buildRetentionBundle({
  spec,
  output,
  rootDir = repoRoot,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  validateRetentionSpec(spec);
  const destination = resolveOutput(output, spec, rootDir);
  const partial = `${destination}.partial-${process.pid}`;
  await rm(partial, { recursive: true, force: true });
  try {
    await mkdir(partial, { recursive: true });
    const entries = [];
    for (const artifact of spec.artifacts) {
      const buffer = await loadArtifact(artifact, { fetchImpl, rootDir });
      const target = resolve(partial, artifact.bundle_path);
      if (!inside(partial, target)) throw new Error(`${artifact.id} escaped the bundle directory.`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer, { flag: "wx" });
      entries.push({
        id: artifact.id,
        role: artifact.role ?? null,
        bundle_path: artifact.bundle_path,
        media_type: artifact.media_type ?? null,
        source_kind: artifact.source_kind,
        source_reference: artifact.source_kind === "remote" ? artifact.source : artifact.source_url ?? artifact.source,
        bytes: buffer.byteLength,
        sha256: artifact.expected_sha256,
      });
    }
    const manifest = {
      schema_version: "1",
      bundle_id: spec.bundle_id,
      classification: spec.classification,
      generated_at: now.toISOString(),
      approved_durable_storage: false,
      owner_action_required: "The data owner must approve this storage location or move the unchanged bundle to an approved durable evidence store, then record the resulting manifest digest.",
      artifact_count: entries.length,
      total_bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      bundle_digest: bundleDigest(entries),
      artifacts: canonicalEntries(entries).map((entry) => {
        const full = entries.find((candidate) => candidate.id === entry.id);
        return { ...full };
      }),
    };
    const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(resolve(partial, "manifest.json"), manifestSource, { flag: "wx" });
    try {
      await lstat(destination);
      throw new Error(`Bundle destination already exists: ${destination}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(dirname(destination), { recursive: true });
    await rename(partial, destination);
    return {
      status: "passed",
      output: destination,
      artifact_count: manifest.artifact_count,
      total_bytes: manifest.total_bytes,
      bundle_digest: manifest.bundle_digest,
      manifest_sha256: sha256(Buffer.from(manifestSource, "utf8")),
    };
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyRetentionBundle(bundlePath, { spec } = {}) {
  const bundle = resolve(bundlePath);
  const manifestPath = resolve(bundle, "manifest.json");
  const manifestBuffer = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBuffer.toString("utf8"));
  if (manifest?.schema_version !== "1") throw new Error("Bundle manifest schema_version must be 1.");
  if (manifest?.classification !== "controlled_private_source_evidence") throw new Error("Bundle classification is invalid.");
  if (!Array.isArray(manifest?.artifacts) || manifest.artifacts.length !== manifest.artifact_count) throw new Error("Bundle artifact count is inconsistent.");
  if (spec) {
    validateRetentionSpec(spec);
    if (manifest.bundle_id !== spec.bundle_id) throw new Error("Bundle id does not match the retention spec.");
    if (manifest.classification !== spec.classification) throw new Error("Bundle classification does not match the retention spec.");
    if (manifest.artifact_count !== spec.artifacts.length) throw new Error("Bundle artifact count does not match the retention spec.");
    const expectedById = new Map(spec.artifacts.map((artifact) => [artifact.id, artifact]));
    for (const artifact of manifest.artifacts) {
      const expected = expectedById.get(artifact.id);
      if (!expected) throw new Error(`${artifact.id} is not declared by the retention spec.`);
      if (
        artifact.bundle_path !== expected.bundle_path
        || artifact.bytes !== expected.expected_bytes
        || artifact.sha256 !== expected.expected_sha256
      ) {
        throw new Error(`${artifact.id} does not match the retention spec.`);
      }
    }
  }
  const entries = [];
  for (const artifact of manifest.artifacts) {
    if (!/^[a-z0-9_]+$/.test(artifact.id ?? "")) throw new Error("Bundle artifact id is invalid.");
    if (!Number.isInteger(artifact.bytes) || artifact.bytes < 1) throw new Error(`${artifact.id} byte size is invalid.`);
    if (!digestPattern.test(artifact.sha256 ?? "")) throw new Error(`${artifact.id} SHA-256 is invalid.`);
    const artifactPath = resolve(bundle, artifact.bundle_path);
    if (!inside(bundle, artifactPath)) throw new Error(`${artifact.id} escaped the bundle directory.`);
    const file = await readFile(artifactPath);
    const metadata = await stat(artifactPath);
    const digest = sha256(file);
    if (metadata.size !== artifact.bytes) throw new Error(`${artifact.id} byte size changed.`);
    if (digest !== artifact.sha256) throw new Error(`${artifact.id} SHA-256 changed.`);
    entries.push(artifact);
  }
  const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  if (totalBytes !== manifest.total_bytes) throw new Error("Bundle total_bytes is inconsistent.");
  if (bundleDigest(entries) !== manifest.bundle_digest) throw new Error("Bundle digest is inconsistent.");
  return {
    status: "passed",
    bundle,
    artifact_count: entries.length,
    total_bytes: totalBytes,
    bundle_digest: manifest.bundle_digest,
    manifest_sha256: sha256(manifestBuffer),
    approved_durable_storage: manifest.approved_durable_storage === true,
  };
}

function parseArgs(values) {
  const args = { command: values[0] ?? "" };
  for (let index = 1; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("Use build [--spec path] [--output path] or verify [--bundle path].");
    args[flag.slice(2)] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const specPath = resolve(repoRoot, args.spec ?? defaultSpecPath);
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  if (args.command === "build") {
    console.log(JSON.stringify(await buildRetentionBundle({ spec, output: args.output, rootDir: repoRoot }), null, 2));
    return;
  }
  if (args.command === "verify") {
    const bundle = args.bundle ?? resolveOutput("", spec, repoRoot);
    console.log(JSON.stringify(await verifyRetentionBundle(bundle, { spec }), null, 2));
    return;
  }
  throw new Error("Use build [--spec path] [--output path] or verify [--bundle path].");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
