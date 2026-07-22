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

function fakeClients({
  startingUsers = 9,
  missingError = { code: "captcha_failed", status: 400, message: "captcha verification process failed" },
  invalidError = { code: "captcha_failed", status: 400, message: "captcha verification process failed" },
  validUser = null,
} = {}) {
  let count = startingUsers;
  let publicClientNumber = 0;
  const adminClient = {
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: [], total: count }, error: null };
        },
        async deleteUser() {
          count -= 1;
          return { data: {}, error: null };
        },
      },
    },
  };
  const attempts = [missingError, invalidError, validUser];
  const factory = (_url, key) => {
    if (key === "secret") return adminClient;
    const index = publicClientNumber++;
    return {
      auth: {
        async signInAnonymously() {
          const outcome = attempts[index];
          if (outcome?.id) {
            count += 1;
            return {
              data: {
                user: { id: outcome.id, is_anonymous: true },
                session: { access_token: "not-emitted" },
              },
              error: null,
            };
          }
          return { data: { user: null, session: null }, error: outcome };
        },
        async signOut() {
          return { error: null };
        },
      },
    };
  };
  return { factory, getCount: () => count };
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
  const fake = fakeClients();
  const result = await verifyTurnstileAuth({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "publishable",
    secretKey: "secret",
    clientFactory: fake.factory,
  });
  assert.equal(result.status, "passed");
  assert.equal(result.checks.missingToken.userCountUnchanged, true);
  assert.equal(result.checks.invalidToken.userCountUnchanged, true);
  assert.equal(result.checks.validToken.status, "not_run");
  assert.equal(fake.getCount(), 9);
});

test("creates, revokes and deletes only the disposable valid-token identity", async () => {
  const fake = fakeClients({ validUser: { id: "opaque-disposable-id" } });
  const result = await verifyTurnstileAuth({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "publishable",
    secretKey: "secret",
    validToken: "short-lived-browser-token",
    requireValid: true,
    clientFactory: fake.factory,
  });
  assert.equal(result.checks.validToken.status, "passed");
  assert.equal(result.checks.validToken.disposableSessionRevoked, true);
  assert.equal(result.checks.validToken.disposableUserDeleted, true);
  assert.equal(fake.getCount(), 9);
  assert.doesNotMatch(JSON.stringify(result), /opaque-disposable-id|short-lived-browser-token/);
});

test("fails closed when the positive-path token is required but absent", async () => {
  const fake = fakeClients();
  await assert.rejects(
    verifyTurnstileAuth({
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "publishable",
      secretKey: "secret",
      requireValid: true,
      clientFactory: fake.factory,
    }),
    /TURNSTILE_TEST_TOKEN/,
  );
});

test("the verifier source never logs raw tokens, user IDs, or complete Auth responses", async () => {
  const source = await readFile(new URL("../scripts/verify-turnstile-auth.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:validToken|userId|data\.user|data\.session)/);
  assert.doesNotMatch(source, /JSON\.stringify\([^)]*(?:validToken|userId|data\.user|data\.session)/);
});

test("builds launch evidence only from full positive-path Turnstile verifier output", async () => {
  const negativeOnly = await verifyTurnstileAuth({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "publishable",
    secretKey: "secret",
    clientFactory: fakeClients().factory,
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
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "publishable",
    secretKey: "secret",
    validToken: "short-lived-browser-token",
    requireValid: true,
    clientFactory: fakeClients({ validUser: { id: "opaque-disposable-id" } }).factory,
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
    supabaseHost: "example.supabase.co",
    identifiersEmitted: false,
    tokensEmitted: false,
    leaked: "access_token=unsafe",
    checks: {
      missingToken: { status: "passed", userCountUnchanged: true },
      invalidToken: { status: "passed", userCountUnchanged: true },
      validToken: {
        status: "passed",
        disposableAnonymousUserCreated: true,
        disposableSessionRevoked: true,
        disposableUserDeleted: true,
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
