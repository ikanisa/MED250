import { readBodyText, readResponseText } from "./bounded-body.ts";
import {
  AdminRepository,
  type AdminRole,
  type AdminSessionReceipt,
} from "./admin-repository.ts";
import { d1Database, webAuthRuntime, type WebAuthRuntime } from "./runtime-env.ts";
import {
  constantTimeEqualHex,
  createOpaqueToken,
  encryptOtpCode,
  hashOtpCode,
  hmacSha256Hex,
  sha256Hex,
} from "./secure-token.ts";

const E164 = /^[1-9][0-9]{7,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OTP = /^\d{6}$/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const ADMIN_SESSION_COOKIE = "__Host-med250-admin";
const ADMIN_CSRF_COOKIE = "__Host-med250-admin-csrf";
const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
const BODY_LIMIT = 16 * 1024;

type JsonObject = Record<string, unknown>;

class AdminHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AdminHttpError";
  }
}

function json(payload: unknown, status = 200, headers = new Headers()): Response {
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Pragma", "no-cache");
  headers.set("X-MED250-Admin-Contract", "worker-d1-admin-v1");
  return new Response(JSON.stringify(payload), { status, headers });
}

function resolvedError(error: unknown): AdminHttpError {
  if (error instanceof AdminHttpError) return error;
  const message = error instanceof Error ? error.message : "Admin request failed.";
  if (message.includes("otp_phone_minute_rate_limit")) {
    return new AdminHttpError(429, "otp_rate_limited", "Please wait 60 seconds before requesting another code.", 60);
  }
  if (message.includes("otp_phone_hour_rate_limit") || message.includes("otp_source_rate_limit")) {
    return new AdminHttpError(429, "otp_rate_limited", "Too many verification requests. Try again later.", 300);
  }
  return new AdminHttpError(503, "admin_unavailable", "The secure admin service is temporarily unavailable.");
}

function errorResponse(error: unknown): Response {
  const resolved = resolvedError(error);
  const headers = new Headers();
  if (resolved.retryAfterSeconds) headers.set("Retry-After", String(resolved.retryAfterSeconds));
  return json({ error: resolved.code, message: resolved.message }, resolved.status, headers);
}

async function readJson(request: Request): Promise<JsonObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBodyText(request, BODY_LIMIT));
  } catch {
    throw new AdminHttpError(400, "invalid_json", "The request body is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AdminHttpError(400, "invalid_json", "The request body is invalid.");
  }
  return parsed as JsonObject;
}

function stringInput(body: JsonObject, key: string, maximum = 2_048): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AdminHttpError(400, "invalid_request", `${key} is invalid.`);
  }
  return value.trim();
}

function optionalStringInput(body: JsonObject, key: string, maximum = 2_048): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new AdminHttpError(400, "invalid_request", `${key} is invalid.`);
  }
  return value.trim() || null;
}

function normalizedE164(value: string): string {
  const digits = value.replace(/^whatsapp:/i, "").replace(/\D/g, "");
  if (!E164.test(digits)) throw new AdminHttpError(400, "invalid_phone", "Enter a valid international WhatsApp number.");
  return digits;
}

function cookies(request: Request): ReadonlyMap<string, string> {
  const header = request.headers.get("Cookie") ?? "";
  if (header.length > 8_192) throw new AdminHttpError(400, "invalid_cookie", "Browser session cookies are invalid.");
  const result = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value) result.set(name, value);
  }
  return result;
}

function sessionHeaders(token: string, csrf: string): Headers {
  const headers = new Headers();
  headers.append("Set-Cookie", `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${ADMIN_SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict`);
  headers.append("Set-Cookie", `${ADMIN_CSRF_COOKIE}=${csrf}; Path=/; Max-Age=${ADMIN_SESSION_SECONDS}; Secure; SameSite=Strict`);
  return headers;
}

function clearSessionHeaders(): Headers {
  const headers = new Headers();
  headers.append("Set-Cookie", `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`);
  headers.append("Set-Cookie", `${ADMIN_CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Strict`);
  return headers;
}

function assertMutationOrigin(request: Request, runtime: WebAuthRuntime): void {
  const origin = request.headers.get("Origin")?.trim() ?? "";
  const expected = new URL(request.url).origin;
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (!origin || origin !== expected || (fetchSite && fetchSite !== "same-origin")) {
    throw new AdminHttpError(403, "origin_rejected", "This admin request did not come from MED250.");
  }
  if (runtime.allowedOrigins.size && !runtime.allowedOrigins.has(origin)) {
    throw new AdminHttpError(403, "origin_rejected", "This admin origin is not approved.");
  }
}

function requestIp(request: Request): string {
  return (request.headers.get("CF-Connecting-IP")?.trim() ?? "unknown").slice(0, 80);
}

function userAgent(request: Request): string {
  return (request.headers.get("User-Agent")?.trim() ?? "unknown").slice(0, 512);
}

async function fingerprints(request: Request, runtime: WebAuthRuntime): Promise<{
  requestIpHashHex: string;
  userAgentHashHex: string;
}> {
  return {
    requestIpHashHex: await hmacSha256Hex(runtime.otpSecret, `admin-request-ip:${requestIp(request)}`),
    userAgentHashHex: await hmacSha256Hex(runtime.otpSecret, `admin-user-agent:${userAgent(request)}`),
  };
}

function generatedOtp(): string {
  const maximum = Math.floor(0x1_0000_0000 / 900_000) * 900_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= maximum);
  return String(100_000 + values[0] % 900_000);
}

function sessionTimes(): { expiresAt: string; absoluteExpiresAt: string } {
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1_000).toISOString();
  return { expiresAt, absoluteExpiresAt: expiresAt };
}

function maskedE164(e164: string): string {
  return e164.length > 4 ? `+${e164.slice(0, 3)}••••${e164.slice(-3)}` : "••••";
}

function permissions(role: AdminRole): string[] {
  if (role === "super_admin") return ["dashboard:read", "operations:review", "catalogue:review", "admins:manage"];
  if (role === "operations_admin") return ["dashboard:read", "operations:review"];
  return ["dashboard:read", "catalogue:review"];
}

function publicSession(receipt: AdminSessionReceipt): JsonObject {
  return {
    authenticated: true,
    userId: receipt.id,
    displayName: receipt.displayName,
    role: receipt.role,
    permissions: permissions(receipt.role),
    whatsappMasked: maskedE164(receipt.e164),
    lastLoginAt: receipt.lastLoginAt,
    expiresAt: receipt.expiresAt,
  };
}

async function verifyTurnstile(
  token: string | null,
  request: Request,
  runtime: WebAuthRuntime,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!runtime.turnstileSecretKey) return;
  if (!token || token.length > 2_048) {
    throw new AdminHttpError(400, "turnstile_required", "Complete the security check before continuing.");
  }
  const form = new URLSearchParams({
    secret: runtime.turnstileSecretKey,
    response: token,
  });
  const ip = requestIp(request);
  if (ip !== "unknown") form.set("remoteip", ip);
  let response: Response;
  try {
    response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AdminHttpError(503, "turnstile_unavailable", "The security check could not be verified. Try again.");
  }
  const text = await readResponseText(response, 32 * 1024).catch(() => "");
  let receipt: unknown = null;
  try {
    receipt = JSON.parse(text);
  } catch {
    receipt = null;
  }
  const success = typeof receipt === "object" && receipt !== null && Reflect.get(receipt, "success") === true;
  const hostname = typeof receipt === "object" && receipt !== null ? Reflect.get(receipt, "hostname") : null;
  const action = typeof receipt === "object" && receipt !== null ? Reflect.get(receipt, "action") : null;
  if (!response.ok || !success || hostname !== new URL(request.url).hostname || action !== "admin_login") {
    throw new AdminHttpError(403, "turnstile_rejected", "The security check was rejected. Complete it again.");
  }
}

async function existingSession(
  request: Request,
  repository: AdminRepository,
): Promise<{ token: string; receipt: AdminSessionReceipt } | null> {
  const token = cookies(request).get(ADMIN_SESSION_COOKIE) ?? "";
  if (!OPAQUE_TOKEN.test(token)) return null;
  const receipt = await repository.lookupSession(await sha256Hex(token));
  return receipt ? { token, receipt } : null;
}

async function requireSession(
  request: Request,
  repository: AdminRepository,
  requireCsrf: boolean,
): Promise<{ token: string; receipt: AdminSessionReceipt }> {
  const found = await existingSession(request, repository);
  if (!found) throw new AdminHttpError(401, "session_required", "Your secure admin session expired. Sign in again.");
  if (requireCsrf) {
    const parsed = cookies(request);
    const csrfCookie = parsed.get(ADMIN_CSRF_COOKIE) ?? "";
    const csrfHeader = request.headers.get("X-MED250-CSRF")?.trim() ?? "";
    if (!OPAQUE_TOKEN.test(csrfCookie) || !OPAQUE_TOKEN.test(csrfHeader)) {
      throw new AdminHttpError(403, "csrf_rejected", "The secure form token is missing.");
    }
    const [cookieHash, headerHash] = await Promise.all([sha256Hex(csrfCookie), sha256Hex(csrfHeader)]);
    if (!constantTimeEqualHex(cookieHash, headerHash)
      || !constantTimeEqualHex(headerHash, found.receipt.csrfHashHex)) {
      throw new AdminHttpError(403, "csrf_rejected", "The secure form token is invalid.");
    }
  }
  return found;
}

async function sessionRoute(
  request: Request,
  repository: AdminRepository,
  runtime: WebAuthRuntime,
): Promise<Response> {
  if (request.method === "GET") {
    const session = await existingSession(request, repository);
    return session ? json(publicSession(session.receipt)) : json({ authenticated: false });
  }
  assertMutationOrigin(request, runtime);
  if (request.method === "DELETE") {
    const session = await requireSession(request, repository, true);
    await repository.revokeSession(await sha256Hex(session.token));
    return json({ signedOut: true }, 200, clearSessionHeaders());
  }
  return json({ error: "method_not_allowed" }, 405, new Headers({ Allow: "GET, DELETE" }));
}

async function requestOtpRoute(
  request: Request,
  repository: AdminRepository,
  runtime: WebAuthRuntime,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, new Headers({ Allow: "POST" }));
  assertMutationOrigin(request, runtime);
  const body = await readJson(request);
  const e164 = normalizedE164(stringInput(body, "phone", 40));
  await verifyTurnstile(optionalStringInput(body, "captchaToken"), request, runtime);
  const requestFingerprint = await fingerprints(request, runtime);
  const principal = await repository.findActivePrincipalByE164(e164);
  if (!principal) {
    await repository.recordUnknownLogin(
      await hmacSha256Hex(runtime.otpSecret, `admin-login-number:${e164}`),
      requestFingerprint.requestIpHashHex,
    );
    return json({
      accepted: true,
      challengeId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }, 202);
  }
  const challengeId = crypto.randomUUID();
  const code = generatedOtp();
  const context = { challengeId, e164, actorType: "admin" as const };
  const [codeHashHex, encrypted] = await Promise.all([
    hashOtpCode({ ...context, code }, runtime.otpSecret),
    encryptOtpCode(code, context, runtime.otpEncryptionSecret),
  ]);
  const receipt = await repository.issueOtp({
    challengeId,
    principalId: principal.id,
    e164,
    codeHashHex,
    requestIpHashHex: requestFingerprint.requestIpHashHex,
    ...encrypted,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  return json({ accepted: true, challengeId: receipt.challengeId, expiresAt: receipt.expiresAt }, 202);
}

async function verifyOtpRoute(
  request: Request,
  repository: AdminRepository,
  runtime: WebAuthRuntime,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, new Headers({ Allow: "POST" }));
  assertMutationOrigin(request, runtime);
  const body = await readJson(request);
  const e164 = normalizedE164(stringInput(body, "phone", 40));
  const challengeId = stringInput(body, "challengeId", 40).toLowerCase();
  const code = stringInput(body, "code", 12).replace(/\s/g, "");
  if (!UUID.test(challengeId) || !OTP.test(code)) {
    throw new AdminHttpError(400, "invalid_otp", "Send a new code and enter all 6 digits.");
  }
  const token = createOpaqueToken();
  const csrf = createOpaqueToken();
  const requestFingerprint = await fingerprints(request, runtime);
  const receipt = await repository.verifyOtp({
    challengeId,
    e164,
    codeHashHex: await hashOtpCode({ challengeId, e164, actorType: "admin", code }, runtime.otpSecret),
    session: {
      tokenHashHex: await sha256Hex(token),
      csrfHashHex: await sha256Hex(csrf),
      ...requestFingerprint,
      ...sessionTimes(),
    },
  });
  if (!receipt.accepted || !receipt.principal || !receipt.expiresAt) {
    const message = receipt.reason === "expired"
      ? "This code expired. Request a new WhatsApp code."
      : "The WhatsApp code is incorrect or no longer active.";
    throw new AdminHttpError(400, `otp_${receipt.reason}`, message);
  }
  const session = await repository.lookupSession(await sha256Hex(token));
  if (!session) throw new Error("admin session was not created");
  return json(publicSession(session), 200, sessionHeaders(token, csrf));
}

async function dashboardRoute(request: Request, repository: AdminRepository): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, new Headers({ Allow: "GET" }));
  const session = await requireSession(request, repository, false);
  return json({
    admin: publicSession(session.receipt),
    permissions: permissions(session.receipt.role),
    dashboard: await repository.dashboard(),
  });
}

export async function adminResponse(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/auth/admin/") && !pathname.startsWith("/api/admin/")) return null;
  const runtime = webAuthRuntime(env);
  const repository = new AdminRepository(d1Database(env));
  try {
    if (pathname === "/api/auth/admin/session") return await sessionRoute(request, repository, runtime);
    if (pathname === "/api/auth/admin/otp/request") return await requestOtpRoute(request, repository, runtime);
    if (pathname === "/api/auth/admin/otp/verify") return await verifyOtpRoute(request, repository, runtime);
    if (pathname === "/api/admin/dashboard") return await dashboardRoute(request, repository);
    return json({ error: "not_found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
