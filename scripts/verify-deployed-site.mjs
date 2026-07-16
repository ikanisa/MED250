import { pathToFileURL } from "node:url";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const REQUIRED_ROUTES = Object.freeze([
  "/",
  "/categories",
  "/category/medicines",
  "/product/rwanda-fda-hm-0734",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
]);

function normalizedHeaders(headers) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

export function assessDeploymentEvidence({ origin, mode, records }) {
  const errors = [];
  const byRoute = new Map(records.map((record) => [record.route, {
    ...record,
    headers: normalizedHeaders(record.headers),
  }]));

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
  if (home) {
    const requiredHeaders = {
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-site",
      "permissions-policy": "camera=(), geolocation=(self), microphone=()",
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
    if (!home.body.includes("MED+250") || !home.body.includes("Connect with a pharmacy that has it")) {
      errors.push("/: marketplace identity or primary proposition is missing");
    }
    if (mode === "preview" && home.headers["x-robots-tag"] !== "noindex, nofollow") {
      errors.push("/: preview deployment is not protected by X-Robots-Tag");
    }
    if (mode !== "preview" && home.headers["x-robots-tag"]) errors.push(`/: ${mode} deployment is unexpectedly blocked from indexing`);
  }

  const robots = byRoute.get("/robots.txt")?.body ?? "";
  const sitemap = byRoute.get("/sitemap.xml")?.body ?? "";
  if (mode === "preview") {
    if (!/User-Agent:\s*\*[\s\S]*Disallow:\s*\//i.test(robots)) errors.push("/robots.txt: preview does not disallow crawling");
    if (/<url>/i.test(sitemap)) errors.push("/sitemap.xml: preview unexpectedly publishes URLs");
  } else {
    if (!/User-Agent:\s*\*[\s\S]*Allow:\s*\//i.test(robots)) errors.push("/robots.txt: live deployment does not allow public routes");
    if (!robots.includes(`${origin}/sitemap.xml`)) errors.push("/robots.txt: sitemap origin does not match the deployment");
    const urlCount = (sitemap.match(/<url>/gi) ?? []).length;
    if (urlCount < 2_400) errors.push(`/sitemap.xml: expected at least 2,400 URLs, received ${urlCount}`);
    if (!sitemap.includes(`${origin}/product/`)) errors.push("/sitemap.xml: product URLs do not use the deployment origin");
  }

  return {
    status: errors.length ? "failed" : "passed",
    origin,
    mode,
    routeCount: records.length,
    errors,
  };
}

function parseArguments(values) {
  const parsed = { url: "", mode: "" };
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--url") parsed.url = value;
    else if (flag === "--mode") parsed.mode = value;
    else throw new Error(`Unknown argument ${flag}.`);
  }
  if (!parsed.url) throw new Error("--url is required.");
  if (!new Set(["preview", "catalog", "live"]).has(parsed.mode)) throw new Error("--mode must be preview, catalog, or live.");
  return parsed;
}

export function validateDeploymentOrigin(value, mode) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Deployment verification requires HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Deployment URL cannot contain credentials, query parameters, or a fragment.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("Deployment verification cannot target a local host.");
  if (mode === "live" && /\.(?:workers|pages)\.dev$/i.test(url.hostname)) {
    throw new Error("Live verification requires the production custom domain, not a workers.dev or pages.dev URL.");
  }
  const liveHostnames = new Set([
    "med250.gikundiro.com",
    "med250-rwanda.ikanisa.chatgpt.site",
  ]);
  if (mode === "live" && !liveHostnames.has(url.hostname)) {
    throw new Error("Live verification is restricted to the MED+250 production domains.");
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
        Accept: route.endsWith(".txt") || route.endsWith(".xml") ? "text/plain,*/*" : "text/html,*/*",
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
  const result = assessDeploymentEvidence({ origin, mode: args.mode, records });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
