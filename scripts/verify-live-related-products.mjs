import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { selectRelatedCatalogueRecords } from "../lib/product-related.ts";
import { validateWorkerOrigin } from "./verify-live-catalogue.mjs";

const PAGE_SIZE = 120;
const DEFAULT_RELATED_INDEX = "data/product-related-index.json";
const DEFAULT_DEPLOYMENT_RECEIPT = "docs/audit/live-baseline-2026-07-18/14-deployment-verification-5ef50a.json";
const DEFAULT_CATALOGUE_RECEIPT = "docs/audit/live-baseline-2026-07-18/15-live-catalogue-verification-5ef50a.json";
const DEFAULT_RELEASE_REVISION = "5ef50a296941056bd17e614dff7b35290742f50a";
const DEFAULT_SUPPRESSED_IDS = Object.freeze(["AMZ-032380909X", "AMZ-B01K1S6AHM"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArguments(values) {
  const parsed = {
    url: process.env.MED250_DEPLOYMENT_ORIGIN?.trim()
      || process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN?.trim()
      || process.env.NEXT_PUBLIC_SITE_URL?.trim()
      || "",
    relatedIndex: DEFAULT_RELATED_INDEX,
    deploymentReceipt: DEFAULT_DEPLOYMENT_RECEIPT,
    catalogueReceipt: DEFAULT_CATALOGUE_RECEIPT,
    releaseRevision: DEFAULT_RELEASE_REVISION,
    evidenceOutput: "",
    concurrency: 4,
  };
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--url") parsed.url = value;
    else if (flag === "--related-index") parsed.relatedIndex = value;
    else if (flag === "--deployment-receipt") parsed.deploymentReceipt = value;
    else if (flag === "--catalogue-receipt") parsed.catalogueReceipt = value;
    else if (flag === "--release-revision") parsed.releaseRevision = value;
    else if (flag === "--evidence-output") parsed.evidenceOutput = value;
    else if (flag === "--concurrency") parsed.concurrency = Number(value);
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!parsed.url) throw new Error("A MED250 Cloudflare Worker origin or --url is required.");
  if (!/^[a-f0-9]{40}$/.test(parsed.releaseRevision)) throw new Error("--release-revision must be a lowercase 40-character Git revision.");
  if (!Number.isInteger(parsed.concurrency) || parsed.concurrency < 1 || parsed.concurrency > 6) {
    throw new Error("--concurrency must be an integer from 1 to 6.");
  }
  return parsed;
}

async function boundedJson(response, limit = 5 * 1024 * 1024) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error("Related-product verification response exceeded the body limit.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > limit) throw new Error("Related-product verification response exceeded the body limit.");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Related-product verification received invalid JSON.");
  }
}

async function requestPage({ origin, offset }) {
  const endpoint = new URL("/api/catalogue", origin);
  endpoint.search = new URLSearchParams({
    query: "",
    category: "All products",
    prescriptionStatus: "all",
    formGroup: "all",
    availability: "all",
    sort: "az",
    limit: String(PAGE_SIZE),
    offset: String(offset),
  }).toString();
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Related-product catalogue request returned HTTP ${response.status}.`);
  const receipt = await boundedJson(response);
  if (
    typeof receipt !== "object"
    || receipt === null
    || !Array.isArray(receipt.products)
    || !Number.isSafeInteger(receipt.total)
    || receipt.total < 0
  ) throw new Error("Related-product catalogue request did not return the governed Worker receipt.");
  const rows = receipt.products.map((row) => ({ ...row, total_count: receipt.total }));
  return { offset, rows };
}

async function mapWithConcurrency(values, concurrency, operation) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

export function assessLiveRelatedProductEvidence({
  relatedIndex,
  liveRows,
  deploymentReceipt,
  catalogueReceipt,
  releaseRevision,
  expectedLiveTotal = 4_657,
  expectedIndexTotal = 4_659,
  suppressedIds = DEFAULT_SUPPRESSED_IDS,
}) {
  const errors = [];
  const localIds = relatedIndex.map(({ id }) => String(id ?? ""));
  const recommendable = relatedIndex.filter(({ recommendable }) => recommendable === true);
  const actualSuppressedIds = relatedIndex.filter(({ recommendable }) => recommendable === false).map(({ id }) => id).sort();
  const expectedSuppressedIds = [...suppressedIds].sort();
  const liveIds = liveRows.map(({ id }) => String(id ?? ""));
  const liveIdSet = new Set(liveIds);
  const recommendableIdSet = new Set(recommendable.map(({ id }) => id));

  if (deploymentReceipt?.status !== "passed") errors.push("The deployment receipt is not passed.");
  if (deploymentReceipt?.observedReleaseRevision !== releaseRevision || deploymentReceipt?.expectedReleaseRevision !== releaseRevision) {
    errors.push("The deployment receipt is not bound to the expected release revision.");
  }
  if (catalogueReceipt?.status !== "passed") errors.push("The catalogue receipt is not passed.");
  if (catalogueReceipt?.observedTotal !== expectedLiveTotal || catalogueReceipt?.expectedTotal !== expectedLiveTotal) {
    errors.push("The catalogue receipt total does not match the expected live population.");
  }
  if (relatedIndex.length !== expectedIndexTotal) errors.push(`Expected ${expectedIndexTotal} related-index rows; found ${relatedIndex.length}.`);
  if (new Set(localIds).size !== localIds.length || localIds.some((id) => !id)) errors.push("The related index contains missing or duplicate identifiers.");
  if (recommendable.length !== expectedLiveTotal) errors.push(`Expected ${expectedLiveTotal} recommendable rows; found ${recommendable.length}.`);
  if (JSON.stringify(actualSuppressedIds) !== JSON.stringify(expectedSuppressedIds)) errors.push("The suppressed non-product set drifted.");
  if (liveRows.length !== expectedLiveTotal || liveIdSet.size !== expectedLiveTotal || liveIds.some((id) => !id)) {
    errors.push("The live catalogue population is incomplete or duplicated.");
  }
  const missingLive = [...recommendableIdSet].filter((id) => !liveIdSet.has(id));
  const unexpectedLive = [...liveIdSet].filter((id) => !recommendableIdSet.has(id));
  if (missingLive.length) errors.push(`The live catalogue is missing ${missingLive.length} recommendable products.`);
  if (unexpectedLive.length) errors.push(`The live catalogue contains ${unexpectedLive.length} products outside the recommendable index.`);
  const liveIdSha256 = sha256([...liveIdSet].sort().join("\n"));
  if (catalogueReceipt?.observedIdSha256 !== liveIdSha256) errors.push("The live identifier digest does not match the catalogue receipt.");

  let seedsWithMatches = 0;
  let totalEdges = 0;
  let medicineEdges = 0;
  let consumerEdges = 0;
  let unsafeEdgeCount = 0;
  let duplicateCandidateCount = 0;
  const edgeBindings = [];
  for (const seed of recommendable) {
    const candidates = selectRelatedCatalogueRecords(seed, relatedIndex, 8);
    if (candidates.length) seedsWithMatches += 1;
    const candidateIds = candidates.map(({ id }) => id);
    duplicateCandidateCount += candidateIds.length - new Set(candidateIds).size;
    for (const candidate of candidates) {
      totalEdges += 1;
      if (seed.kind === "medicine") medicineEdges += 1;
      else consumerEdges += 1;
      if (!liveIdSet.has(candidate.id)
        || candidate.recommendable !== true
        || candidate.isRequestable !== true
        || candidate.kind !== seed.kind
        || candidate.id === seed.id) unsafeEdgeCount += 1;
      edgeBindings.push(`${seed.id}\t${candidate.id}`);
    }
  }
  if (unsafeEdgeCount) errors.push(`The selector produced ${unsafeEdgeCount} unsafe live recommendation edges.`);
  if (duplicateCandidateCount) errors.push(`The selector produced ${duplicateCandidateCount} duplicate candidate edges.`);
  if (selectRelatedCatalogueRecords(relatedIndex.find(({ id }) => id === expectedSuppressedIds[0]), relatedIndex, 8).length
    || selectRelatedCatalogueRecords(relatedIndex.find(({ id }) => id === expectedSuppressedIds[1]), relatedIndex, 8).length) {
    errors.push("A suppressed non-product record can seed recommendations.");
  }

  return {
    status: errors.length ? "failed" : "passed",
    releaseRevision,
    liveProductCount: liveRows.length,
    relatedIndexCount: relatedIndex.length,
    recommendableCount: recommendable.length,
    suppressedCount: actualSuppressedIds.length,
    medicineCount: relatedIndex.filter(({ kind }) => kind === "medicine").length,
    consumerCount: relatedIndex.filter(({ kind }) => kind === "consumer").length,
    seedsEvaluated: recommendable.length,
    seedsWithMatches,
    totalEdges,
    medicineEdges,
    consumerEdges,
    maximumCandidatesPerSeed: 8,
    unsafeEdgeCount,
    duplicateCandidateCount,
    missingLiveCount: missingLive.length,
    unexpectedLiveCount: unexpectedLive.length,
    liveIdSha256,
    edgeBindingSha256: sha256(edgeBindings.sort().join("\n")),
    errors,
  };
}

async function writeEvidence(path, value) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, absolute);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const origin = validateWorkerOrigin(args.url);
  const [relatedBytes, deploymentBytes, catalogueBytes, verifierBytes] = await Promise.all([
    readFile(resolve(args.relatedIndex)),
    readFile(resolve(args.deploymentReceipt)),
    readFile(resolve(args.catalogueReceipt)),
    readFile(new URL(import.meta.url)),
  ]);
  const relatedIndex = JSON.parse(relatedBytes);
  const deploymentReceipt = JSON.parse(deploymentBytes);
  const catalogueReceipt = JSON.parse(catalogueBytes);
  if (!Array.isArray(relatedIndex)) throw new Error("The related-product index must be an array.");
  const first = await requestPage({ origin, offset: 0 });
  const total = Number(first.rows[0]?.total_count ?? 0);
  if (!Number.isInteger(total) || total < 1 || total > 10_120) throw new Error("The live catalogue total is outside the verifier boundary.");
  const offsets = Array.from({ length: Math.ceil(total / PAGE_SIZE) - 1 }, (_, index) => (index + 1) * PAGE_SIZE);
  const pages = [first, ...await mapWithConcurrency(offsets, args.concurrency, (offset) => requestPage({ origin, offset }))]
    .sort((left, right) => left.offset - right.offset);
  const liveRows = pages.flatMap(({ rows }) => rows);
  const assessment = assessLiveRelatedProductEvidence({
    relatedIndex,
    liveRows,
    deploymentReceipt,
    catalogueReceipt,
    releaseRevision: args.releaseRevision,
  });
  const evidence = {
    schemaVersion: "1.0",
    capturedAt: new Date().toISOString(),
    origin,
    endpoint: "/api/catalogue",
    ...assessment,
    sources: {
      relatedIndex: { path: args.relatedIndex, sha256: sha256(relatedBytes), rowCount: relatedIndex.length },
      deploymentReceipt: { path: args.deploymentReceipt, sha256: sha256(deploymentBytes) },
      catalogueReceipt: { path: args.catalogueReceipt, sha256: sha256(catalogueBytes) },
      verifier: { path: "scripts/verify-live-related-products.mjs", sha256: sha256(verifierBytes) },
    },
  };
  if (args.evidenceOutput) await writeEvidence(args.evidenceOutput, evidence);
  console.log(JSON.stringify(evidence, null, 2));
  if (assessment.errors.length) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
