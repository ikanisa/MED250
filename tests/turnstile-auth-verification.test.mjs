import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isCaptchaRejection,
  safeAuthError,
  verifyTurnstileAuth,
} from "../scripts/verify-turnstile-auth.mjs";
import { buildTurnstileLaunchEvidence } from "../scripts/create-turnstile-launch-evidence.mjs";
import { validateLaunchEvidenceArtifact } from "../scripts/validate-launch-evidence-artifact.mjs";

function fakeWorker({ acceptValidToken = false } = {}) {
  const sessionToken = "session-token-value-with-forty-eight-characters-0001";
  const csrfToken = "csrf-token-value-with-forty-eight-characters-0000001";
  let sessionActive = false;
  const json = (payload, status, headers = new Headers()) => {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(payload), { status, headers });
  };
  const fetchImpl = async (url, options = {}) => {
    assert.equal(url, "https://med250.example/api/auth/client/session");
    const method = options.method ?? "GET";
    const headers = new Headers(options.headers);
    if (method === "POST") {
      const body = JSON.parse(options.body);
      if (!body.captchaToken) return json({ error: "turnstile_required", message: "Complete the security check." }, 400);
      if (body.captchaToken !== "short-lived-browser-token" || !acceptValidToken) {
        return json({ error: "turnstile_rejected", message: "The security check was rejected." }, 403);
      }
      sessionActive = true;
      const responseHeaders = new Headers();
      responseHeaders.append("Set-Cookie", `__Host-med250-client=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Strict`);
      responseHeaders.append("Set-Cookie", `__Host-med250-client-csrf=${csrfToken}; Path=/; Secure; SameSite=Strict`);
      return json({ authenticated: true, userId: "opaque-disposable-id" }, 201, responseHeaders);
    }
    const cookie = headers.get("Cookie") ?? "";
    const authenticated = sessionActive && cookie.includes(`__Host-med250-client=${sessionToken}`);
    if (method === "DELETE") {
      if (!authenticated || headers.get("X-MED250-CSRF") !== csrfToken) return json({ error: "session_required" }, 401);
      sessionActive = false;
      return json({ signedOut: true }, 200);
    }
    return json({ authenticated }, 200);
  };
  return { fetchImpl, getSessionCount: () => Number(sessionActive) };
}

test("recognizes and redacts CAPTCHA rejection details", () => {
  const error = {
    code: "captcha_failed",
    status: 400,
    message: "captcha verification failed for sensitive-token-value",
  };
  assert.equal(isCaptchaRejection(error), true);
  assert.deepEqual(safeAuthError(error), {
    status: 400,
    code: "captcha_failed",
    captchaRelated: true,
  });
  assert.doesNotMatch(JSON.stringify(safeAuthError(error)), /sensitive-token-value/);
});

test("proves missing and invalid token rejection without creating users", async () => {
  const fake = fakeWorker();
  const result = await verifyTurnstileAuth({
    workerOrigin: "https://med250.example",
    fetchImpl: fake.fetchImpl,
  });
  assert.equal(result.status, "passed");
  assert.equal(result.checks.missingToken.sessionCookieNotIssued, true);
  assert.equal(result.checks.invalidToken.sessionCookieNotIssued, true);
  assert.equal(result.checks.validToken.status, "not_run");
  assert.equal(fake.getSessionCount(), 0);
});

test("creates, restores and revokes only the disposable valid-token Worker session", async () => {
  const fake = fakeWorker({ acceptValidToken: true });
  const result = await verifyTurnstileAuth({
    workerOrigin: "https://med250.example",
    validToken: "short-lived-browser-token",
    requireValid: true,
    fetchImpl: fake.fetchImpl,
  });
  assert.equal(result.checks.validToken.status, "passed");
  assert.equal(result.checks.validToken.disposableAnonymousSessionCreated, true);
  assert.equal(result.checks.validToken.disposableSessionRestored, true);
  assert.equal(result.checks.validToken.disposableSessionRevoked, true);
  assert.equal(result.checks.validToken.postRevokeUnauthenticated, true);
  assert.equal(fake.getSessionCount(), 0);
  assert.doesNotMatch(JSON.stringify(result), /opaque-disposable-id|short-lived-browser-token/);
});

test("fails closed when the positive-path token is required but absent", async () => {
  const fake = fakeWorker();
  await assert.rejects(
    verifyTurnstileAuth({
      workerOrigin: "https://med250.example",
      requireValid: true,
      fetchImpl: fake.fetchImpl,
    }),
    /TURNSTILE_TEST_TOKEN/,
  );
});

test("the verifier source never logs raw tokens, user IDs, or complete Auth responses", async () => {
  const source = await readFile(new URL("../scripts/verify-turnstile-auth.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:validToken|userId|data\.user|data\.session)/);
});

test("builds launch evidence only from full positive-path Turnstile verifier output", async () => {
  const negativeOnly = await verifyTurnstileAuth({
    workerOrigin: "https://med250.example",
    fetchImpl: fakeWorker().fetchImpl,
  });
  assert.throws(
    () => buildTurnstileLaunchEvidence({
      verifierResult: negativeOnly,
      verifierResultSha256: "a".repeat(64),
      executedBy: "Named security tester",
      executorRole: "Security owner",
      startedAt: "2026-07-17T08:00:00Z",
      completedAt: "2026-07-17T08:15:00Z",
      noMarketplaceSideEffectConfirmed: true,
      now: new Date("2026-07-17T09:00:00Z"),
    }),
    /Valid-token positive path/,
  );

  const positive = await verifyTurnstileAuth({
    workerOrigin: "https://med250.example",
    validToken: "short-lived-browser-token",
    requireValid: true,
    fetchImpl: fakeWorker({ acceptValidToken: true }).fetchImpl,
  });
  const artifact = buildTurnstileLaunchEvidence({
    verifierResult: positive,
    verifierResultSha256: "a".repeat(64),
    verifierResultReference: "desktop-output/goal-progress-2026-07-17/turnstile-verifier-result.json",
    executedBy: "Named security tester",
    executorRole: "Security owner",
    startedAt: "2026-07-17T08:00:00Z",
    completedAt: "2026-07-17T08:15:00Z",
    noMarketplaceSideEffectConfirmed: true,
    now: new Date("2026-07-17T09:00:00Z"),
  });
  assert.equal(artifact.evidence_type, "test_record");
  assert.equal(artifact.checks.length, 7);
  assert.equal(artifact.no_marketplace_side_effect_confirmed, true);
  assert.doesNotMatch(JSON.stringify(artifact), /short-lived-browser-token|opaque-disposable-id/);
  const validation = validateLaunchEvidenceArtifact(artifact, {
    expectedGate: "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
    expectedType: "test_record",
    now: new Date("2026-07-17T09:00:00Z"),
  });
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("rejects Turnstile evidence input that leaks secrets or identifiers", () => {
  const unsafe = {
    status: "passed",
    workerHost: "med250.example",
    identifiersEmitted: false,
    tokensEmitted: false,
    leaked: "access_token=unsafe",
    checks: {
      missingToken: { status: "passed", sessionCookieNotIssued: true },
      invalidToken: { status: "passed", sessionCookieNotIssued: true },
      validToken: {
        status: "passed",
        disposableAnonymousSessionCreated: true,
        disposableSessionRestored: true,
        disposableSessionRevoked: true,
        postRevokeUnauthenticated: true,
      },
    },
  };
  assert.throws(
    () => buildTurnstileLaunchEvidence({
      verifierResult: unsafe,
      verifierResultSha256: "a".repeat(64),
      executedBy: "Named security tester",
      executorRole: "Security owner",
      startedAt: "2026-07-17T08:00:00Z",
      completedAt: "2026-07-17T08:15:00Z",
      noMarketplaceSideEffectConfirmed: true,
      now: new Date("2026-07-17T09:00:00Z"),
    }),
    /secret-like material/,
  );
});
