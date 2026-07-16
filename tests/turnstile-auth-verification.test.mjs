import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isCaptchaRejection,
  safeAuthError,
  verifyTurnstileAuth,
} from "../scripts/verify-turnstile-auth.mjs";

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
