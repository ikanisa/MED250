import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const legacyOrigin = "https://med250.gikundiro.com";
export const canonicalOrigin = "https://med-250.com";
export const legacyRedirectProbes = [
  "/",
  "/categories?search=paracetamol&view=list",
  "/product/rwanda-fda-hm-0734",
  "/privacy",
  "/terms?source=legacy-domain",
];

const allowedRedirectStatuses = new Set([301, 308]);

function exactDestination(path) {
  return new URL(path, `${canonicalOrigin}/`).toString();
}

export function assessLegacyDomainRedirect(records) {
  const errors = [];
  const expectedPaths = [...legacyRedirectProbes];
  const observedPaths = records.map((record) => record.path);

  if (JSON.stringify(observedPaths) !== JSON.stringify(expectedPaths)) {
    errors.push("legacy redirect probes must be complete, unique, and in canonical order");
  }

  for (const path of expectedPaths) {
    const record = records.find((candidate) => candidate.path === path);
    if (!record) {
      errors.push(`${path}: redirect probe is missing`);
      continue;
    }
    if (record.error_code) {
      errors.push(`${path}: ${record.error_code}`);
      continue;
    }
    if (!allowedRedirectStatuses.has(record.status)) {
      errors.push(`${path}: expected HTTP 301 or 308, received ${record.status ?? "no response"}`);
    }
    if (record.location !== exactDestination(path)) {
      errors.push(`${path}: redirect must preserve the exact path and query on ${canonicalOrigin}`);
    }
    if (record.set_cookie_present) {
      errors.push(`${path}: redirect-only hostname must not set cookies`);
    }
  }

  return {
    status: errors.length ? "failed" : "passed",
    productionReady: false,
    classification: "redirect_only_external_probe_not_launch_approval",
    legacyOrigin,
    canonicalOrigin,
    probeCount: expectedPaths.length,
    passedProbeCount: expectedPaths.filter((path, index) => {
      const record = records[index];
      return record?.path === path
        && !record.error_code
        && allowedRedirectStatuses.has(record.status)
        && record.location === exactDestination(path)
        && !record.set_cookie_present;
    }).length,
    errors,
    records,
    note: "A passing redirect probe is necessary infrastructure evidence only; it does not approve launch or prove the candidate revision is live.",
  };
}

export function validateLegacyDomainRedirectEvidence(evidence, {
  expectedVerifierSha256,
  now = new Date(),
  maxAgeMs = 24 * 60 * 60 * 1000,
} = {}) {
  const errors = [];
  const assessment = assessLegacyDomainRedirect(Array.isArray(evidence?.records) ? evidence.records : []);
  if (evidence?.schema_version !== "1") errors.push("legacy redirect evidence schema_version must be 1");
  if (evidence?.classification !== "redirect_only_external_probe_not_launch_approval") {
    errors.push("legacy redirect evidence classification is invalid");
  }
  if (evidence?.legacyOrigin !== legacyOrigin || evidence?.canonicalOrigin !== canonicalOrigin) {
    errors.push("legacy redirect evidence origins do not match the governed redirect-only contract");
  }
  if (!/^[a-f0-9]{64}$/.test(String(expectedVerifierSha256 ?? ""))) {
    errors.push("current legacy redirect verifier digest is unavailable");
  } else if (evidence?.verifier_sha256 !== expectedVerifierSha256) {
    errors.push("legacy redirect evidence was captured by a different verifier revision");
  }
  const capturedAt = Date.parse(evidence?.captured_at ?? "");
  const currentTime = now.getTime();
  if (!Number.isFinite(capturedAt)) {
    errors.push("legacy redirect evidence requires a valid captured_at timestamp");
  } else if (capturedAt > currentTime + 5 * 60 * 1000) {
    errors.push("legacy redirect evidence captured_at cannot be in the future");
  } else if (currentTime - capturedAt > maxAgeMs) {
    errors.push("legacy redirect evidence is stale");
  }
  if (evidence?.status !== assessment.status) {
    errors.push("legacy redirect evidence status does not match its probe records");
  }
  if (evidence?.productionReady !== false) {
    errors.push("legacy redirect evidence must never self-approve production");
  }
  errors.push(...assessment.errors);
  return {
    valid: errors.length === 0 && assessment.status === "passed",
    errors,
    assessment,
  };
}

export async function currentLegacyRedirectVerifierSha256() {
  const scriptBytes = await readFile(new URL(import.meta.url));
  return createHash("sha256").update(scriptBytes).digest("hex");
}

function errorCode(error) {
  const code = error?.cause?.code ?? error?.code;
  if (["ENOTFOUND", "ENODATA", "EAI_AGAIN"].includes(code)) return "dns_unresolved";
  if (code === "CERT_HAS_EXPIRED") return "tls_certificate_expired";
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return "tls_hostname_mismatch";
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "request_timeout";
  return "network_or_tls_failure";
}

async function resolveWithPublicDns(hostname) {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const addresses = await resolver.resolve4(hostname);
  if (!addresses.length) {
    const error = new Error(`No public A record found for ${hostname}`);
    error.code = "ENODATA";
    throw error;
  }
  return addresses[0];
}

function captureProbeWithPinnedAddress(path, address) {
  const target = new URL(path, `${legacyOrigin}/`);
  return new Promise((resolveProbe, rejectProbe) => {
    const request = httpsRequest(target, {
      method: "HEAD",
      headers: { "User-Agent": "MED250LegacyRedirectVerifier/1.0" },
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) {
          callback(null, [{ address, family: 4 }]);
          return;
        }
        callback(null, address, 4);
      },
    }, (response) => {
      response.resume();
      resolveProbe({
        path,
        status: response.statusCode ?? null,
        location: response.headers.location ?? null,
        set_cookie_present: Array.isArray(response.headers["set-cookie"]),
        error_code: null,
        dns_resolution: "public_resolver_fallback",
      });
    });
    request.setTimeout(15_000, () => {
      const error = new Error("Legacy redirect probe timed out");
      error.name = "TimeoutError";
      request.destroy(error);
    });
    request.on("error", rejectProbe);
    request.end();
  });
}

async function captureProbe(path) {
  try {
    const response = await fetch(new URL(path, `${legacyOrigin}/`), {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "MED250LegacyRedirectVerifier/1.0" },
    });
    return {
      path,
      status: response.status,
      location: response.headers.get("location"),
      set_cookie_present: response.headers.has("set-cookie"),
      error_code: null,
    };
  } catch (error) {
    if (errorCode(error) === "dns_unresolved") {
      try {
        const address = await resolveWithPublicDns(new URL(legacyOrigin).hostname);
        return await captureProbeWithPinnedAddress(path, address);
      } catch (fallbackError) {
        return {
          path,
          status: null,
          location: null,
          set_cookie_present: false,
          error_code: errorCode(fallbackError),
          dns_resolution: "public_resolver_fallback_failed",
        };
      }
    }
    return {
      path,
      status: null,
      location: null,
      set_cookie_present: false,
      error_code: errorCode(error),
    };
  }
}

export function parseArguments(argv) {
  let evidenceOutput = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--evidence-output") {
      evidenceOutput = argv[index + 1] ?? "";
      index += 1;
      if (!evidenceOutput) throw new Error("--evidence-output requires a path");
      continue;
    }
    throw new Error(`Unknown argument ${argument}`);
  }
  return { evidenceOutput };
}

async function main() {
  const { evidenceOutput } = parseArguments(process.argv.slice(2));
  const records = [];
  for (const path of legacyRedirectProbes) records.push(await captureProbe(path));
  const result = assessLegacyDomainRedirect(records);
  const evidence = {
    schema_version: "1",
    captured_at: new Date().toISOString(),
    verifier_sha256: await currentLegacyRedirectVerifierSha256(),
    ...result,
  };
  if (evidenceOutput) {
    const outputPath = resolve(evidenceOutput);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  }
  console.log(JSON.stringify(evidence, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
