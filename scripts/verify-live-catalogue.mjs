import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PAGE_SIZE = 120;
const DEFAULT_SOURCE_INDEX = "data/product-sitemap-index.json";
const DEPARTMENTS = Object.freeze([
  "Medicines",
  "Beauty & Personal Care",
  "Baby",
  "Health & Household",
]);
const SEARCH_CASES = Object.freeze([
  { id: "paracetamol", query: "paracetamol", expectedTokens: ["paracetamol"] },
  { id: "zinc", query: "zinc", expectedTokens: ["zinc"] },
  { id: "omeprazole", query: "omeprazole", expectedTokens: ["omeprazole"] },
  { id: "typo", query: "brinzolamde", expectedTokens: ["brinzolamide"] },
  { id: "french", query: "douleur", expectedTokens: ["paracetamol", "ibuprofen", "diclofenac"] },
  { id: "kinyarwanda", query: "ububabare", expectedTokens: ["paracetamol", "ibuprofen", "diclofenac"] },
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateWorkerOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Live catalogue verification requires HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("The Worker URL cannot contain credentials, query parameters, or a fragment.");
  if (url.pathname !== "/") throw new Error("The Worker URL must be an origin without a path.");
  if (url.hostname !== "med-250.com" && !url.hostname.endsWith(".workers.dev")) {
    throw new Error("The live catalogue URL must use the MED250 Cloudflare Worker origin.");
  }
  return url.origin;
}

function parseArguments(values) {
  const parsed = {
    url: process.env.MED250_DEPLOYMENT_ORIGIN?.trim()
      || process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN?.trim()
      || process.env.NEXT_PUBLIC_SITE_URL?.trim()
      || "",
    sourceIndex: DEFAULT_SOURCE_INDEX,
    evidenceOutput: "",
    concurrency: 4,
  };
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--url") parsed.url = value;
    else if (flag === "--source-index") parsed.sourceIndex = value;
    else if (flag === "--evidence-output") parsed.evidenceOutput = value;
    else if (flag === "--concurrency") parsed.concurrency = Number(value);
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!parsed.url) throw new Error("MED250_DEPLOYMENT_ORIGIN, NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN, NEXT_PUBLIC_SITE_URL, or --url is required.");
  if (!Number.isInteger(parsed.concurrency) || parsed.concurrency < 1 || parsed.concurrency > 6) {
    throw new Error("--concurrency must be an integer from 1 to 6.");
  }
  return parsed;
}

async function boundedResponseText(response, limit = 5 * 1024 * 1024) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error("Catalogue response exceeded the verification body limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return body + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel("verification body limit exceeded");
      throw new Error("Catalogue response exceeded the verification body limit.");
    }
    body += decoder.decode(value, { stream: true });
  }
}

async function requestCatalogue({ origin, query = "", category = "All products", availability = "orderable", sort = "relevance", limit = PAGE_SIZE, offset = 0 }) {
  const endpoint = new URL("/api/catalogue", origin);
  endpoint.search = new URLSearchParams({
    query,
    category,
    prescriptionStatus: "all",
    formGroup: "all",
    availability,
    sort,
    limit: String(limit),
    offset: String(offset),
  }).toString();
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await boundedResponseText(response);
  if (!response.ok) throw new Error(`Worker catalogue returned HTTP ${response.status}.`);
  let receipt;
  try {
    receipt = JSON.parse(body);
  } catch {
    throw new Error("Worker catalogue returned invalid JSON.");
  }
  if (
    typeof receipt !== "object"
    || receipt === null
    || !Array.isArray(receipt.products)
    || !Number.isSafeInteger(receipt.total)
    || receipt.total < 0
  ) throw new Error("Worker catalogue did not return the governed receipt shape.");
  const rows = receipt.products.map((row) => ({ ...row, total_count: receipt.total }));
  return {
    offset,
    status: response.status,
    rows,
    bodySha256: sha256(body),
  };
}

async function mapWithConcurrency(values, concurrency, operation) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function numericTotal(rows) {
  return rows.length ? Number(rows[0]?.total_count ?? 0) : 0;
}

function sampledSearch(searchCase, response) {
  return {
    id: searchCase.id,
    query: searchCase.query,
    expectedTokens: searchCase.expectedTokens,
    total: numericTotal(response.rows),
    bodySha256: response.bodySha256,
    sample: response.rows.slice(0, 5).map((row) => ({
      id: String(row.id ?? ""),
      brand: String(row.brand_name ?? ""),
      generic: String(row.generic_name ?? ""),
      explanation: String(row.match_explanation ?? ""),
    })),
  };
}

export function assessLiveCatalogueEvidence({ sourceIds, pages, pageSize = PAGE_SIZE, departments, searches }) {
  const errors = [];
  const sortedPages = [...pages].sort((left, right) => left.offset - right.offset);
  const expectedSourceIds = [...new Set(sourceIds)].sort();
  if (expectedSourceIds.length !== sourceIds.length) errors.push("Source index contains duplicate product IDs.");
  if (!sortedPages.length) errors.push("No catalogue pages were captured.");

  const observedTotal = sortedPages.length ? numericTotal(sortedPages[0].rows) : 0;
  const expectedPageCount = observedTotal ? Math.ceil(observedTotal / pageSize) : 0;
  if (sortedPages.length !== expectedPageCount) errors.push(`Expected ${expectedPageCount} catalogue pages, captured ${sortedPages.length}.`);

  const observedIds = [];
  for (let index = 0; index < sortedPages.length; index += 1) {
    const page = sortedPages[index];
    const expectedOffset = index * pageSize;
    if (page.offset !== expectedOffset) errors.push(`Catalogue page offset ${expectedOffset} was not captured in sequence.`);
    const expectedRows = index === sortedPages.length - 1 ? observedTotal - expectedOffset : pageSize;
    if (page.rows.length !== expectedRows) errors.push(`Catalogue page at offset ${page.offset} returned ${page.rows.length} rows; expected ${expectedRows}.`);
    if (page.rows.some((row) => numericTotal([row]) !== observedTotal)) errors.push(`Catalogue total changed within the page at offset ${page.offset}.`);
    observedIds.push(...page.rows.map((row) => String(row.id ?? "")));
  }

  const duplicateIds = [...new Set(observedIds.filter((id, index) => id && observedIds.indexOf(id) !== index))].sort();
  if (duplicateIds.length) errors.push(`Catalogue pagination returned ${duplicateIds.length} duplicate product IDs.`);
  if (observedIds.some((id) => !id)) errors.push("Catalogue pagination returned a row without a product ID.");

  const observedIdSet = new Set(observedIds);
  const sourceIdSet = new Set(expectedSourceIds);
  const missingSourceIds = expectedSourceIds.filter((id) => !observedIdSet.has(id));
  const unexpectedLiveIds = [...observedIdSet].filter((id) => !sourceIdSet.has(id)).sort();
  if (observedTotal !== expectedSourceIds.length) errors.push(`Live catalogue total ${observedTotal} does not match the governed source total ${expectedSourceIds.length}.`);
  if (missingSourceIds.length) errors.push(`Live catalogue is missing ${missingSourceIds.length} governed source products.`);
  if (unexpectedLiveIds.length) errors.push(`Live catalogue contains ${unexpectedLiveIds.length} products outside the governed source index.`);
  if (!observedIds[24]) errors.push("Product 25 was not reachable.");
  if (!observedIds[119]) errors.push("Product 120 was not reachable.");
  if (observedTotal && !observedIds[observedTotal - 1]) errors.push("The final catalogue product was not reachable.");

  for (const department of DEPARTMENTS) {
    const evidence = departments.find((entry) => entry.department === department);
    if (!evidence || evidence.total < 1) errors.push(`${department}: no live catalogue products were returned.`);
  }

  for (const searchCase of SEARCH_CASES) {
    const evidence = searches.find((entry) => entry.id === searchCase.id);
    if (!evidence || evidence.total < 1 || !evidence.sample.length) {
      errors.push(`${searchCase.id}: live search returned no results for ${searchCase.query}.`);
      continue;
    }
    const searchable = evidence.sample.map(({ brand, generic }) => `${brand} ${generic}`.toLowerCase()).join(" ");
    if (!searchCase.expectedTokens.some((token) => searchable.includes(token))) {
      errors.push(`${searchCase.id}: sampled live results were not relevant to ${searchCase.query}.`);
    }
  }

  return {
    status: errors.length ? "failed" : "passed",
    expectedTotal: expectedSourceIds.length,
    observedTotal,
    expectedPageCount,
    capturedPageCount: sortedPages.length,
    observedIdSha256: sha256([...observedIdSet].sort().join("\n")),
    duplicateIds,
    missingSourceIds,
    unexpectedLiveIds,
    boundaryProducts: {
      product25: observedIds[24] ?? null,
      product120: observedIds[119] ?? null,
      finalProduct: observedTotal ? observedIds[observedTotal - 1] ?? null : null,
    },
    errors,
  };
}

async function writeEvidence(outputPath, evidence) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, absolutePath);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const origin = validateWorkerOrigin(args.url);
  const sourcePath = resolve(args.sourceIndex);
  const sourceBytes = await readFile(sourcePath);
  const sourceRows = JSON.parse(sourceBytes);
  if (!Array.isArray(sourceRows) || sourceRows.some((row) => !row?.id)) throw new Error("The governed source index is invalid.");
  const sourceIds = sourceRows.map(({ id }) => String(id));
  const firstPage = await requestCatalogue({ origin, sort: "az", offset: 0 });
  const visiblePage = await requestCatalogue({ origin, availability: "all", sort: "az", limit: 1, offset: 0 });
  const observedTotal = numericTotal(firstPage.rows);
  if (!Number.isInteger(observedTotal) || observedTotal < 1 || observedTotal > 10_120) throw new Error("The live catalogue total is outside the verifier boundary.");
  const offsets = Array.from({ length: Math.ceil(observedTotal / PAGE_SIZE) - 1 }, (_, index) => (index + 1) * PAGE_SIZE);
  const remainingPages = await mapWithConcurrency(offsets, args.concurrency, (offset) => requestCatalogue({ origin, sort: "az", offset }));
  const pages = [firstPage, ...remainingPages];

  const departmentResponses = await mapWithConcurrency(DEPARTMENTS, args.concurrency, (department) => requestCatalogue({
    origin,
    category: department,
    sort: "az",
    limit: 1,
  }));
  const departments = departmentResponses.map((response, index) => ({
    department: DEPARTMENTS[index],
    total: numericTotal(response.rows),
    sampleId: response.rows[0]?.id ?? null,
    bodySha256: response.bodySha256,
  }));

  const searchResponses = await mapWithConcurrency(SEARCH_CASES, args.concurrency, (searchCase) => requestCatalogue({
    origin,
    query: searchCase.query,
    limit: 5,
  }));
  const searches = searchResponses.map((response, index) => sampledSearch(SEARCH_CASES[index], response));
  const assessment = assessLiveCatalogueEvidence({ sourceIds, pages, departments, searches });
  const verifierSource = await readFile(new URL(import.meta.url));
  const evidence = {
    schemaVersion: "1.0",
    capturedAt: new Date().toISOString(),
    origin,
    endpoint: "/api/catalogue",
    visibleCatalogueTotal: numericTotal(visiblePage.rows),
    ...assessment,
    source: {
      path: args.sourceIndex,
      sha256: sha256(sourceBytes),
      productCount: sourceIds.length,
    },
    pages: pages.map((page) => ({
      offset: page.offset,
      rowCount: page.rows.length,
      total: numericTotal(page.rows),
      bodySha256: page.bodySha256,
    })),
    departments,
    searches,
    verifier: {
      path: "scripts/verify-live-catalogue.mjs",
      sha256: sha256(verifierSource),
    },
  };
  if (args.evidenceOutput) await writeEvidence(args.evidenceOutput, evidence);
  console.log(JSON.stringify({
    status: evidence.status,
    origin: evidence.origin,
    expectedTotal: evidence.expectedTotal,
    observedTotal: evidence.observedTotal,
    visibleCatalogueTotal: evidence.visibleCatalogueTotal,
    capturedPageCount: evidence.capturedPageCount,
    boundaryProducts: evidence.boundaryProducts,
    departmentTotals: Object.fromEntries(departments.map(({ department, total }) => [department, total])),
    searchTotals: Object.fromEntries(searches.map(({ id, total }) => [id, total])),
    errors: evidence.errors,
  }, null, 2));
  if (evidence.errors.length) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
