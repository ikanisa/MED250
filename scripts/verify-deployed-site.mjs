import { pathToFileURL } from "node:url";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const REQUIRED_ROUTES = Object.freeze([
  "/",
  "/categories",
  "/category/medicines",
  "/product/rwanda-fda-hm-0734",
  "/product/AMZ-B004L5JCZ4",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
]);
const WORKER_ROUTES = Object.freeze(REQUIRED_ROUTES.slice(0, 7));

function normalizedHeaders(headers) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

export function assessDeploymentEvidence({ origin, mode, records, expectedRevision = "" }) {
  const errors = [];
  const hostname = new URL(origin).hostname;
  if (mode === "live" && !/^[a-f0-9]{40}$/.test(expectedRevision)) {
    errors.push(`/: ${mode} verification requires the exact lowercase 40-character Git release revision`);
  }
  if (mode === "live" && hostname === "med250-rwanda.ikanisa.chatgpt.site") {
    errors.push("/: the public Sites origin is catalog-only and cannot be verified as a live ordering origin");
  }
  if (mode === "catalog" && hostname !== "med250-rwanda.ikanisa.chatgpt.site") {
    errors.push("/: catalog verification is restricted to the governed Sites origin");
  }
  const byRoute = new Map(records.map((record) => [record.route, {
    ...record,
    headers: normalizedHeaders(record.headers),
  }]));

  if (expectedRevision) {
    for (const route of WORKER_ROUTES) {
      const observed = byRoute.get(route)?.headers["x-med250-release-revision"] ?? null;
      if (observed !== expectedRevision) {
        errors.push(`${route}: X-MED250-Release-Revision does not match the expected release (${expectedRevision})`);
      }
    }
  }

  for (const route of REQUIRED_ROUTES) {
    const record = byRoute.get(route);
    if (!record) {
      errors.push(`${route}: no response was captured`);
      continue;
    }
    if (record.status !== 200) errors.push(`${route}: expected HTTP 200, received ${record.status}`);
    if (record.finalOrigin && record.finalOrigin !== origin) errors.push(`${route}: redirected outside the deployment origin`);
  }

  const home = byRoute.get("/");
  let releaseRevision = null;
  if (home) {
    const requiredHeaders = {
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-site",
      "permissions-policy":
        "accelerometer=(), browsing-topics=(), camera=(), geolocation=(self), gyroscope=(), microphone=(), payment=(), usb=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    };
    for (const [header, expected] of Object.entries(requiredHeaders)) {
      if (home.headers[header] !== expected) errors.push(`/: ${header} is missing or incorrect`);
    }
    if (!home.headers["content-security-policy"]?.includes("frame-ancestors 'none'")) {
      errors.push("/: Content-Security-Policy does not deny framing");
    }
    if (!home.headers["strict-transport-security"]?.includes("max-age=31536000")) {
      errors.push("/: Strict-Transport-Security is missing or too weak");
    }
    if (!/^[0-9a-f-]{36}$/i.test(home.headers["x-request-id"] ?? "")) errors.push("/: X-Request-Id is missing or invalid");
    if (!home.headers["server-timing"]?.includes("app;dur=")) errors.push("/: Server-Timing is missing");
    releaseRevision = home.headers["x-med250-release-revision"] ?? null;
    const requiresWorkerRevision = hostname !== "med250-rwanda.ikanisa.chatgpt.site" || mode !== "catalog";
    if (requiresWorkerRevision && !/^[A-Za-z0-9._-]{7,64}$/.test(releaseRevision ?? "")) {
      errors.push("/: X-MED250-Release-Revision is missing or invalid");
    }
    if (!home.body.includes("MED+250") || !home.body.includes("Health and everyday care") || !home.body.includes("Found at the nearest Pharmacy")) {
      errors.push("/: marketplace identity or primary proposition is missing");
    }
    const protectedMode = mode === "preview";
    if (protectedMode && home.headers["x-robots-tag"] !== "noindex, nofollow") {
      errors.push(`/: ${mode} deployment is not protected by X-Robots-Tag`);
    }
    if (!protectedMode && home.headers["x-robots-tag"]) errors.push(`/: ${mode} deployment is unexpectedly blocked from indexing`);
  }

  const robots = byRoute.get("/robots.txt")?.body ?? "";
  const sitemap = byRoute.get("/sitemap.xml")?.body ?? "";
  const manifest = byRoute.get("/manifest.webmanifest")?.body ?? "";
  const serviceWorker = byRoute.get("/sw.js")?.body ?? "";
  const offlinePage = byRoute.get("/offline.html")?.body ?? "";
  try {
    const parsedManifest = JSON.parse(manifest);
    if (parsedManifest.id !== "/" || parsedManifest.scope !== "/" || parsedManifest.display !== "standalone") {
      errors.push("/manifest.webmanifest: install identity, scope, or display mode is incorrect");
    }
    if (!/availability requests/i.test(parsedManifest.description ?? "") || /place one order/i.test(parsedManifest.description ?? "")) {
      errors.push("/manifest.webmanifest: description does not match the availability-request model");
    }
  } catch {
    errors.push("/manifest.webmanifest: response is not valid JSON");
  }
  const sensitiveWorkerExclusions = [
    '/api/auth/',
    '/api/orders',
    '/api/pharmacy/',
    '/api/internal/',
    '/api/twilio/',
  ];
  if (
    !serviceWorker.includes('const OFFLINE_URL = "/offline.html"')
    || !serviceWorker.includes('isPrivatePath(url)')
    || sensitiveWorkerExclusions.some((path) => !serviceWorker.includes(`url.pathname.startsWith("${path}")`))
  ) {
    errors.push("/sw.js: safe offline navigation or API exclusion is missing");
  }
  if (!offlinePage.includes("You are offline") || !offlinePage.includes("never show a request as sent while you are offline")) {
    errors.push("/offline.html: explicit non-transactional offline state is missing");
  }
  if (mode === "preview") {
    if (!/User-Agent:\s*\*[\s\S]*Disallow:\s*\//i.test(robots)) errors.push(`/robots.txt: ${mode} does not disallow crawling`);
    if (/<url>/i.test(sitemap)) errors.push(`/sitemap.xml: ${mode} unexpectedly publishes URLs`);
  } else {
    if (!/User-Agent:\s*\*[\s\S]*Allow:\s*\//i.test(robots)) errors.push("/robots.txt: live deployment does not allow public routes");
    if (!robots.includes(`${origin}/sitemap.xml`)) errors.push("/robots.txt: sitemap origin does not match the deployment");
    const urlCount = (sitemap.match(/<url>/gi) ?? []).length;
    if (urlCount < 4_600) errors.push(`/sitemap.xml: expected at least 4,600 URLs, received ${urlCount}`);
    if (!sitemap.includes(`${origin}/product/rwanda-fda-hm-`)) errors.push("/sitemap.xml: medicine URLs do not use the deployment origin");
    if (!sitemap.includes(`${origin}/product/AMZ-`)) errors.push("/sitemap.xml: approved consumer-product URLs are missing");
  }

  return {
    status: errors.length ? "failed" : "passed",
    origin,
    mode,
    releaseRevision,
    routeCount: records.length,
    errors,
  };
}

export function parseArguments(values) {
  const parsed = { url: "", mode: "", expectedRevision: "", evidenceOutput: "" };
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--url") parsed.url = value;
    else if (flag === "--mode") parsed.mode = value;
    else if (flag === "--expected-revision") parsed.expectedRevision = value;
    else if (flag === "--evidence-output") parsed.evidenceOutput = value;
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!parsed.url) throw new Error("--url is required.");
  if (!new Set(["preview", "catalog", "live"]).has(parsed.mode)) throw new Error("--mode must be preview, catalog, or live.");
  if (parsed.mode === "live" && !/^[a-f0-9]{40}$/.test(parsed.expectedRevision)) {
    throw new Error(`${parsed.mode === "live" ? "Live" : "Staging"} verification requires --expected-revision with the exact lowercase 40-character Git release revision.`);
  }
  if (parsed.mode !== "live" && parsed.expectedRevision && !/^[A-Za-z0-9._-]{7,64}$/.test(parsed.expectedRevision)) {
    throw new Error("--expected-revision must be 7-64 letters, numbers, dots, underscores, or hyphens.");
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const EVIDENCE_HEADERS = Object.freeze([
  "content-security-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "referrer-policy",
  "server-timing",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "x-med250-release-revision",
  "x-request-id",
  "x-robots-tag",
]);

export function buildDeploymentEvidence({ result, records, expectedRevision = "", capturedAt, verifierSha256 }) {
  return {
    schemaVersion: "1.0",
    capturedAt,
    status: result.status,
    origin: result.origin,
    mode: result.mode,
    observedReleaseRevision: result.releaseRevision,
    expectedReleaseRevision: expectedRevision || null,
    releaseRevisionExpectation: expectedRevision
      ? result.releaseRevision === expectedRevision ? "matched" : "mismatched"
      : "not_supplied",
    routeCount: result.routeCount,
    routes: records.map((record) => {
      const headers = normalizedHeaders(record.headers);
      return {
        route: record.route,
        status: record.status,
        finalOrigin: record.finalOrigin,
        headers: Object.fromEntries(EVIDENCE_HEADERS.flatMap((name) => headers[name] ? [[name, headers[name]]] : [])),
        bodyBytes: Buffer.byteLength(record.body),
        bodySha256: sha256(record.body),
      };
    }),
    errors: result.errors,
    verifier: {
      path: "scripts/verify-deployed-site.mjs",
      sha256: verifierSha256,
    },
  };
}

async function writeEvidence(outputPath, evidence) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, absolutePath);
}

export function validateDeploymentOrigin(value, mode) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Deployment verification requires HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Deployment URL cannot contain credentials, query parameters, or a fragment.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("Deployment verification cannot target a local host.");
  if (mode === "live" && /\.(?:workers|pages)\.dev$/i.test(url.hostname)) {
    throw new Error("Live verification requires the production custom domain, not a workers.dev or pages.dev URL.");
  }
  if (mode === "live" && url.hostname !== "med-250.com") {
    throw new Error("Live verification is restricted to the canonical MED+250 production domain.");
  }
  if (mode === "catalog" && url.hostname !== "med250-rwanda.ikanisa.chatgpt.site") {
    throw new Error("Catalog verification is restricted to the governed MED+250 Sites origin.");
  }
  return url.origin;
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : null);
  if (!ipv4) return false;
  const [a, b] = ipv4.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublicHostname(hostname) {
  if (isIP(hostname) && isPrivateAddress(hostname)) throw new Error("Deployment verification cannot target a private address.");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Deployment hostname resolved to a private or unavailable address.");
  }
}

async function boundedResponseText(response, limit = 2 * 1024 * 1024) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error("Deployment response exceeded the verification body limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return body + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel("verification body limit exceeded");
      throw new Error("Deployment response exceeded the verification body limit.");
    }
    body += decoder.decode(value, { stream: true });
  }
}

async function fetchDeploymentRoute(origin, route, sitesBypassToken = "") {
  let target = new URL(route, origin);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (target.origin !== origin) throw new Error(`${route}: redirect left the deployment origin`);
    await assertPublicHostname(target.hostname);
    const response = await fetch(target, {
      headers: {
        Accept: route.endsWith(".txt") || route.endsWith(".xml") || route.endsWith(".js") ? "text/plain,*/*" : "text/html,*/*",
        ...(sitesBypassToken ? { "OAI-Sites-Authorization": `Bearer ${sitesBypassToken}` } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    target = new URL(location, target);
  }
  throw new Error(`${route}: too many redirects`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const origin = validateDeploymentOrigin(args.url, args.mode);
  const sitesBypassToken = (process.env.SITES_BYPASS_BEARER_TOKEN ?? "").trim();
  await assertPublicHostname(new URL(origin).hostname);
  const records = await Promise.all(REQUIRED_ROUTES.map(async (route) => {
    const response = await fetchDeploymentRoute(origin, route, sitesBypassToken);
    const body = await boundedResponseText(response);
    return {
      route,
      status: response.status,
      finalOrigin: new URL(response.url).origin,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }));
  const result = assessDeploymentEvidence({
    origin,
    mode: args.mode,
    records,
    expectedRevision: args.expectedRevision,
  });
  if (args.evidenceOutput) {
    const verifierSource = await readFile(new URL(import.meta.url), "utf8");
    const evidence = buildDeploymentEvidence({
      result,
      records,
      expectedRevision: args.expectedRevision,
      capturedAt: new Date().toISOString(),
      verifierSha256: sha256(verifierSource),
    });
    await writeEvidence(args.evidenceOutput, evidence);
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
