import { readBodyText, readResponseText } from "./bounded-body.ts";
import { AuthRepository, type WebSessionReceipt, type WebSessionScope } from "./auth-repository.ts";
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
const CLIENT_SESSION_COOKIE = "__Host-med250-client";
const CLIENT_CSRF_COOKIE = "__Host-med250-client-csrf";
const PHARMACY_SESSION_COOKIE = "__Host-med250-pharmacy";
const PHARMACY_CSRF_COOKIE = "__Host-med250-pharmacy-csrf";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const BODY_LIMIT = 16 * 1024;

type JsonObject = Record<string, unknown>;

export class AuthHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthHttpError";
  }
}

function json(payload: unknown, status = 200, headers?: Headers): Response {
  const responseHeaders = headers ?? new Headers();
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Pragma", "no-cache");
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function errorResponse(error: unknown): Response {
  const resolved = error instanceof AuthHttpError
    ? error
    : databaseError(error);
  const headers = new Headers();
  if (resolved.retryAfterSeconds) headers.set("Retry-After", String(resolved.retryAfterSeconds));
  return json({ error: resolved.code, message: resolved.message }, resolved.status, headers);
}

function databaseError(error: unknown): AuthHttpError {
  const message = error instanceof Error ? error.message : "Authentication request failed.";
  if (message.includes("otp_phone_minute_rate_limit")) {
    return new AuthHttpError(429, "otp_rate_limited", "Please wait 60 seconds before requesting another code.", 60);
  }
  if (message.includes("otp_phone_hour_rate_limit") || message.includes("otp_source_rate_limit")) {
    return new AuthHttpError(429, "otp_rate_limited", "Too many verification requests. Try again later.", 300);
  }
  if (message.includes("registered pharmacy numbers must use pharmacy login")) {
    return new AuthHttpError(403, "pharmacy_number_requires_pharmacy_login", "This number belongs to a pharmacy. Use pharmacy sign-in.");
  }
  if (message.includes("pharmacy whatsapp number is not registered") || message.includes("pharmacy whatsapp login is not enabled")) {
    return new AuthHttpError(403, "pharmacy_not_registered", "This WhatsApp number is not registered for pharmacy sign-in.");
  }
  return new AuthHttpError(503, "auth_unavailable", "Secure sign-in is temporarily unavailable.");
}

async function readJson(request: Request): Promise<JsonObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBodyText(request, BODY_LIMIT));
  } catch {
    throw new AuthHttpError(400, "invalid_json", "The request body is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AuthHttpError(400, "invalid_json", "The request body is invalid.");
  }
  return parsed as JsonObject;
}

function stringInput(body: JsonObject, key: string, maximum = 2_048): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AuthHttpError(400, "invalid_request", `${key} is invalid.`);
  }
  return value.trim();
}

function optionalStringInput(body: JsonObject, key: string, maximum = 2_048): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new AuthHttpError(400, "invalid_request", `${key} is invalid.`);
  }
  return value.trim() || null;
}

function normalizedE164(value: string): string {
  const digits = value.replace(/^whatsapp:/i, "").replace(/\D/g, "");
  if (!E164.test(digits)) throw new AuthHttpError(400, "invalid_phone", "Enter a valid international WhatsApp number.");
  return digits;
}

function parsedCookies(request: Request): ReadonlyMap<string, string> {
  const header = request.headers.get("Cookie") ?? "";
  if (header.length > 8_192) throw new AuthHttpError(400, "invalid_cookie", "Browser session cookies are invalid.");
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value) cookies.set(name, value);
  }
  return cookies;
}

function cookieNames(scope: WebSessionScope): { session: string; csrf: string } {
  return scope === "client"
    ? { session: CLIENT_SESSION_COOKIE, csrf: CLIENT_CSRF_COOKIE }
    : { session: PHARMACY_SESSION_COOKIE, csrf: PHARMACY_CSRF_COOKIE };
}

function sessionCookieHeaders(scope: WebSessionScope, token: string, csrf: string): Headers {
  const names = cookieNames(scope);
  const headers = new Headers();
  headers.append("Set-Cookie", `${names.session}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Strict`);
  headers.append("Set-Cookie", `${names.csrf}=${csrf}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; Secure; SameSite=Strict`);
  return headers;
}

function clearSessionCookieHeaders(scope: WebSessionScope): Headers {
  const names = cookieNames(scope);
  const headers = new Headers();
  headers.append("Set-Cookie", `${names.session}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`);
  headers.append("Set-Cookie", `${names.csrf}=; Path=/; Max-Age=0; Secure; SameSite=Strict`);
  return headers;
}

export function assertMutationOrigin(request: Request, runtime: WebAuthRuntime): void {
  const origin = request.headers.get("Origin")?.trim() ?? "";
  const expected = new URL(request.url).origin;
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (!origin || origin !== expected || (fetchSite && fetchSite !== "same-origin")) {
    throw new AuthHttpError(403, "origin_rejected", "This sign-in request did not come from MED250.");
  }
  if (runtime.allowedOrigins.size && !runtime.allowedOrigins.has(origin)) {
    throw new AuthHttpError(403, "origin_rejected", "This sign-in origin is not approved.");
  }
}

function requestIp(request: Request): string {
  const value = request.headers.get("CF-Connecting-IP")?.trim() ?? "unknown";
  return value.slice(0, 80);
}

function userAgent(request: Request): string {
  return (request.headers.get("User-Agent")?.trim() ?? "unknown").slice(0, 512);
}

async function requestFingerprints(request: Request, runtime: WebAuthRuntime): Promise<{
  requestIpHashHex: string;
  userAgentHashHex: string;
}> {
  return {
    requestIpHashHex: await hmacSha256Hex(runtime.otpSecret, `request-ip:${requestIp(request)}`),
    userAgentHashHex: await hmacSha256Hex(runtime.otpSecret, `user-agent:${userAgent(request)}`),
  };
}

async function withRepository<T>(env: Env, work: (repository: AuthRepository) => Promise<T>): Promise<T> {
  return work(new AuthRepository(d1Database(env)));
}

async function existingSession(
  request: Request,
  repository: AuthRepository,
  scope: WebSessionScope,
): Promise<{ token: string; receipt: WebSessionReceipt } | null> {
  const token = parsedCookies(request).get(cookieNames(scope).session) ?? "";
  if (!OPAQUE_TOKEN.test(token)) return null;
  const receipt = await repository.lookupSession(await sha256Hex(token), scope);
  return receipt ? { token, receipt } : null;
}

export async function requireSession(
  request: Request,
  repository: AuthRepository,
  scope: WebSessionScope,
  requireCsrf: boolean,
): Promise<{ token: string; receipt: WebSessionReceipt }> {
  const found = await existingSession(request, repository, scope);
  if (!found) throw new AuthHttpError(401, "session_required", "Your secure session expired. Refresh and try again.");
  if (requireCsrf) {
    const cookies = parsedCookies(request);
    const csrfCookie = cookies.get(cookieNames(scope).csrf) ?? "";
    const csrfHeader = request.headers.get("X-MED250-CSRF")?.trim() ?? "";
    if (!OPAQUE_TOKEN.test(csrfCookie) || !OPAQUE_TOKEN.test(csrfHeader)) {
      throw new AuthHttpError(403, "csrf_rejected", "The secure form token is missing.");
    }
    const [cookieHash, headerHash] = await Promise.all([sha256Hex(csrfCookie), sha256Hex(csrfHeader)]);
    if (!constantTimeEqualHex(cookieHash, headerHash) || !constantTimeEqualHex(headerHash, found.receipt.csrfHashHex)) {
      throw new AuthHttpError(403, "csrf_rejected", "The secure form token is invalid.");
    }
  }
  return found;
}

async function verifyTurnstile(
  token: string | null,
  request: Request,
  runtime: WebAuthRuntime,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!runtime.turnstileSecretKey) return;
  if (!token || token.length > 2_048) {
    throw new AuthHttpError(400, "turnstile_required", "Complete the security check before continuing.");
  }
  const form = new URLSearchParams({ secret: runtime.turnstileSecretKey, response: token });
  const ip = requestIp(request);
  if (ip !== "unknown") form.set("remoteip", ip);
  let response: Response;
  try {
    response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AuthHttpError(503, "turnstile_unavailable", "The security check could not be verified. Try again.");
  }
  const text = await readResponseText(response, 32 * 1024).catch(() => "");
  let receipt: unknown;
  try {
    receipt = JSON.parse(text);
  } catch {
    receipt = null;
  }
  const success = typeof receipt === "object" && receipt !== null && Reflect.get(receipt, "success") === true;
  const hostname = typeof receipt === "object" && receipt !== null ? Reflect.get(receipt, "hostname") : null;
  const action = typeof receipt === "object" && receipt !== null ? Reflect.get(receipt, "action") : null;
  if (!response.ok || !success || hostname !== new URL(request.url).hostname || action !== "customer_order") {
    throw new AuthHttpError(403, "turnstile_rejected", "The security check was rejected. Complete it again.");
  }
}

function generatedOtp(): string {
  const maximum = Math.floor(0x1_0000_0000 / 900_000) * 900_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= maximum);
  return String(100_000 + values[0] % 900_000);
}

function sessionTimes(): { expiresAt: string; absoluteExpiresAt: string } {
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_MAX_AGE_SECONDS * 1_000).toISOString();
  return { expiresAt, absoluteExpiresAt: expiresAt };
}

function publicSession(receipt: WebSessionReceipt): JsonObject {
  return {
    authenticated: true,
    userId: receipt.principalId,
    actorType: receipt.actorType,
    pharmacyId: receipt.pharmacyId,
    whatsapp: receipt.e164,
    whatsappVerifiedAt: receipt.verifiedAt,
    preferredLanguage: receipt.preferredLanguage,
    expiresAt: receipt.expiresAt,
  };
}

async function clientSessionRoute(request: Request, env: Env, runtime: WebAuthRuntime): Promise<Response> {
  if (request.method === "GET") {
    return withRepository(env, async (repository) => {
      const session = await existingSession(request, repository, "client");
      return session ? json(publicSession(session.receipt)) : json({ authenticated: false });
    });
  }
  assertMutationOrigin(request, runtime);
  if (request.method === "POST") {
    const body = await readJson(request);
    return withRepository(env, async (repository) => {
      const restored = await existingSession(request, repository, "client");
      if (restored) return json(publicSession(restored.receipt));
      await verifyTurnstile(optionalStringInput(body, "captchaToken"), request, runtime);
      const token = createOpaqueToken();
      const csrf = createOpaqueToken();
      const principalId = crypto.randomUUID();
      const fingerprints = await requestFingerprints(request, runtime);
      const times = sessionTimes();
      const created = await repository.createAnonymousSession({
        principalId,
        tokenHashHex: await sha256Hex(token),
        csrfHashHex: await sha256Hex(csrf),
        ...fingerprints,
        ...times,
      });
      return json({ authenticated: true, userId: created.principalId, actorType: null, whatsapp: null, expiresAt: created.expiresAt }, 201, sessionCookieHeaders("client", token, csrf));
    });
  }
  if (request.method === "DELETE") {
    return withRepository(env, async (repository) => {
      const session = await requireSession(request, repository, "client", true);
      await repository.revokeSession(await sha256Hex(session.token), "client");
      return json({ signedOut: true }, 200, clearSessionCookieHeaders("client"));
    });
  }
  return json({ error: "method_not_allowed" }, 405, new Headers({ Allow: "GET, POST, DELETE" }));
}

async function pharmacySessionRoute(request: Request, env: Env, runtime: WebAuthRuntime): Promise<Response> {
  if (request.method === "GET") {
    return withRepository(env, async (repository) => {
      const session = await existingSession(request, repository, "pharmacy");
      return session ? json(publicSession(session.receipt)) : json({ authenticated: false });
    });
  }
  assertMutationOrigin(request, runtime);
  if (request.method === "DELETE") {
    return withRepository(env, async (repository) => {
      const session = await requireSession(request, repository, "pharmacy", true);
      await repository.revokeSession(await sha256Hex(session.token), "pharmacy");
      return json({ signedOut: true }, 200, clearSessionCookieHeaders("pharmacy"));
    });
  }
  return json({ error: "method_not_allowed" }, 405, new Headers({ Allow: "GET, DELETE" }));
}

async function issueOtpRoute(
  request: Request,
  env: Env,
  runtime: WebAuthRuntime,
  actorType: WebSessionScope,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, new Headers({ Allow: "POST" }));
  assertMutationOrigin(request, runtime);
  const body = await readJson(request);
  const e164 = normalizedE164(stringInput(body, "phone", 40));
  return withRepository(env, async (repository) => {
    const clientSession = actorType === "client"
      ? await requireSession(request, repository, "client", true)
      : null;
    const fingerprints = await requestFingerprints(request, runtime);
    if (actorType === "pharmacy") {
      const classification = await repository.classifyNumber(e164);
      if (classification.actorType !== "pharmacy" || !classification.pharmacyLoginEnabled) {
        await repository.recordUnknownPharmacyLoginAttempt(
          await hmacSha256Hex(runtime.otpSecret, `pharmacy-login-number:${e164}`),
          fingerprints.requestIpHashHex,
        );
        return json({ registered: false, adminWhatsapp: runtime.adminWhatsappE164 });
      }
    }
    const challengeId = crypto.randomUUID();
    const code = generatedOtp();
    const context = { challengeId, e164, actorType };
    const [codeHashHex, encrypted] = await Promise.all([
      hashOtpCode({ ...context, code }, runtime.otpSecret),
      encryptOtpCode(code, context, runtime.otpEncryptionSecret),
    ]);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const receipt = await repository.issueOtp({
      challengeId,
      principalId: clientSession?.receipt.principalId ?? null,
      e164,
      actorType,
      codeHashHex,
      requestIpHashHex: fingerprints.requestIpHashHex,
      ...encrypted,
      expiresAt,
    });
    return json({ registered: true, challengeId: receipt.challengeId, expiresAt: receipt.expiresAt }, 202);
  });
}

async function verifyOtpRoute(
  request: Request,
  env: Env,
  runtime: WebAuthRuntime,
  actorType: WebSessionScope,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, new Headers({ Allow: "POST" }));
  assertMutationOrigin(request, runtime);
  const body = await readJson(request);
  const e164 = normalizedE164(stringInput(body, "phone", 40));
  const challengeId = stringInput(body, "challengeId", 40).toLowerCase();
  const code = stringInput(body, "code", 12).replace(/\s/g, "");
  if (!UUID.test(challengeId) || !OTP.test(code)) {
    throw new AuthHttpError(400, "invalid_otp", "Send a new code and enter all 6 digits.");
  }
  return withRepository(env, async (repository) => {
    const clientSession = actorType === "client"
      ? await requireSession(request, repository, "client", true)
      : null;
    const fingerprints = await requestFingerprints(request, runtime);
    const codeHashHex = await hashOtpCode({ challengeId, e164, actorType, code }, runtime.otpSecret);
    let token: string | null = null;
    let csrf: string | null = null;
    let verifiedSession: Parameters<AuthRepository["verifyOtp"]>[0]["session"];
    if (actorType === "pharmacy") {
      token = createOpaqueToken();
      csrf = createOpaqueToken();
      verifiedSession = {
        tokenHashHex: await sha256Hex(token),
        csrfHashHex: await sha256Hex(csrf),
        ...fingerprints,
        ...sessionTimes(),
      };
    }
    const receipt = await repository.verifyOtp({
      challengeId,
      principalId: clientSession?.receipt.principalId ?? null,
      e164,
      actorType,
      codeHashHex,
      session: verifiedSession,
    });
    if (!receipt.accepted) {
      const message = receipt.reason === "expired"
        ? "This code expired. Request a new WhatsApp code."
        : "The WhatsApp code is incorrect or no longer active.";
      throw new AuthHttpError(400, `otp_${receipt.reason}`, message);
    }
    const payload = {
      verified: true,
      phone: e164,
      verifiedAt: receipt.verifiedAt,
      pharmacyId: receipt.pharmacyId,
      expiresAt: receipt.sessionExpiresAt,
    };
    return token && csrf
      ? json(payload, 200, sessionCookieHeaders("pharmacy", token, csrf))
      : json(payload);
  });
}

export async function authResponse(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/auth/")) return null;
  const runtime = webAuthRuntime(env);
  try {
    if (pathname === "/api/auth/client/session") return await clientSessionRoute(request, env, runtime);
    if (pathname === "/api/auth/client/otp/request") return await issueOtpRoute(request, env, runtime, "client");
    if (pathname === "/api/auth/client/otp/verify") return await verifyOtpRoute(request, env, runtime, "client");
    if (pathname === "/api/auth/pharmacy/session") return await pharmacySessionRoute(request, env, runtime);
    if (pathname === "/api/auth/pharmacy/otp/request") return await issueOtpRoute(request, env, runtime, "pharmacy");
    if (pathname === "/api/auth/pharmacy/otp/verify") return await verifyOtpRoute(request, env, runtime, "pharmacy");
    return json({ error: "not_found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
