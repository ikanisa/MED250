import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SESSION_COOKIE = "__Host-med250-client";
const CSRF_COOKIE = "__Host-med250-client-csrf";
const MAX_RESPONSE_BYTES = 64 * 1024;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(`${name} is required in the process environment`);
}

function verifiedWorkerOrigin(value) {
  const origin = new URL(String(value ?? ""));
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") {
    throw new Error("The MED250 Worker origin must be an HTTPS origin without credentials or a path");
  }
  return origin.origin;
}

export function isCaptchaRejection(error) {
  const code = String(error?.code ?? error?.error ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code.includes("turnstile") || code.includes("captcha") || message.includes("turnstile") || message.includes("captcha");
}

export function safeAuthError(error) {
  return {
    status: Number.isInteger(error?.status) ? error.status : null,
    code: typeof error?.code === "string"
      ? error.code
      : typeof error?.error === "string"
        ? error.error
        : null,
    captchaRelated: isCaptchaRejection(error),
  };
}

async function safeJson(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("The Worker returned an oversized authentication response");
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function setCookieValues(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

function cookieValue(response, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|,\\s*|;\\s*)${escaped}=([^;,\\s]+)`);
  for (const header of setCookieValues(response)) {
    const match = header.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function requestHeaders(origin, additions = {}) {
  return {
    Accept: "application/json",
    Origin: origin,
    "Sec-Fetch-Site": "same-origin",
    ...additions,
  };
}

async function rejectedAttempt({ label, origin, captchaToken, expectedCode, expectedStatus, fetchImpl }) {
  const response = await fetchImpl(`${origin}/api/auth/client/session`, {
    method: "POST",
    headers: requestHeaders(origin, { "Content-Type": "application/json" }),
    body: JSON.stringify(captchaToken ? { captchaToken } : {}),
    redirect: "error",
  });
  const payload = await safeJson(response);
  const safe = safeAuthError({ ...payload, status: response.status });
  if (response.status !== expectedStatus || safe.code !== expectedCode || !safe.captchaRelated) {
    throw new Error(`${label} was not rejected by the MED250 Worker Turnstile boundary`);
  }
  if (cookieValue(response, SESSION_COOKIE) || cookieValue(response, CSRF_COOKIE)) {
    throw new Error(`${label} unexpectedly issued a browser session`);
  }
  return { status: "passed", rejection: safe, sessionCookieNotIssued: true };
}

async function verifyPositivePath({ origin, validToken, fetchImpl }) {
  const createdResponse = await fetchImpl(`${origin}/api/auth/client/session`, {
    method: "POST",
    headers: requestHeaders(origin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ captchaToken: validToken }),
    redirect: "error",
  });
  const created = await safeJson(createdResponse);
  const session = cookieValue(createdResponse, SESSION_COOKIE);
  const csrf = cookieValue(createdResponse, CSRF_COOKIE);
  if (createdResponse.status !== 201 || created.authenticated !== true || !session || !csrf) {
    throw new Error("Valid Turnstile evidence did not create the disposable MED250 browser session");
  }
  const cookieHeader = `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`;
  const restoredResponse = await fetchImpl(`${origin}/api/auth/client/session`, {
    headers: requestHeaders(origin, { Cookie: cookieHeader }),
    redirect: "error",
  });
  const restored = await safeJson(restoredResponse);
  if (!restoredResponse.ok || restored.authenticated !== true) {
    throw new Error("The disposable MED250 browser session could not be restored");
  }
  const revokedResponse = await fetchImpl(`${origin}/api/auth/client/session`, {
    method: "DELETE",
    headers: requestHeaders(origin, { Cookie: cookieHeader, "X-MED250-CSRF": csrf }),
    redirect: "error",
  });
  const revoked = await safeJson(revokedResponse);
  if (!revokedResponse.ok || revoked.signedOut !== true) {
    throw new Error("The disposable MED250 browser session could not be revoked");
  }
  const finalResponse = await fetchImpl(`${origin}/api/auth/client/session`, {
    headers: requestHeaders(origin, { Cookie: cookieHeader }),
    redirect: "error",
  });
  const final = await safeJson(finalResponse);
  if (!finalResponse.ok || final.authenticated !== false) {
    throw new Error("The revoked MED250 browser session remained authenticated");
  }
  return {
    status: "passed",
    disposableAnonymousSessionCreated: true,
    disposableSessionRestored: true,
    disposableSessionRevoked: true,
    postRevokeUnauthenticated: true,
  };
}

export async function verifyTurnstileAuth({
  workerOrigin,
  validToken = "",
  requireValid = false,
  fetchImpl = fetch,
} = {}) {
  const origin = verifiedWorkerOrigin(workerOrigin);
  const missingToken = await rejectedAttempt({
    label: "Missing Turnstile token",
    origin,
    captchaToken: "",
    expectedCode: "turnstile_required",
    expectedStatus: 400,
    fetchImpl,
  });
  const invalidToken = await rejectedAttempt({
    label: "Invalid Turnstile token",
    origin,
    captchaToken: "med250-invalid-turnstile-token",
    expectedCode: "turnstile_rejected",
    expectedStatus: 403,
    fetchImpl,
  });
  const cleanedValidToken = validToken.trim();
  if (requireValid && !cleanedValidToken) {
    throw new Error("TURNSTILE_TEST_TOKEN is required for the controlled positive-path test");
  }
  const validTokenResult = cleanedValidToken
    ? await verifyPositivePath({ origin, validToken: cleanedValidToken, fetchImpl })
    : {
        status: "not_run",
        disposableAnonymousSessionCreated: false,
        disposableSessionRestored: false,
        disposableSessionRevoked: false,
        postRevokeUnauthenticated: false,
      };
  return {
    status: requireValid && validTokenResult.status !== "passed" ? "failed" : "passed",
    workerHost: new URL(origin).hostname,
    checks: { missingToken, invalidToken, validToken: validTokenResult },
    identifiersEmitted: false,
    tokensEmitted: false,
  };
}

async function main() {
  const result = await verifyTurnstileAuth({
    workerOrigin: requiredEnvironment("MED250_OPERATOR_ORIGIN"),
    validToken: process.env.TURNSTILE_TEST_TOKEN ?? "",
    requireValid: process.argv.includes("--require-valid"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      identifiersEmitted: false,
      tokensEmitted: false,
    }, null, 2));
    process.exitCode = 1;
  }
}
