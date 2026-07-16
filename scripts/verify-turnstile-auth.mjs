import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

function requiredEnvironment(name, alternatives = []) {
  for (const candidate of [name, ...alternatives]) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  throw new Error(`${[name, ...alternatives].join(" or ")} is required in the process environment`);
}

function verifiedSupabaseOrigin(value) {
  const origin = new URL(value);
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".supabase.co")) {
    throw new Error("The Supabase URL must be an HTTPS *.supabase.co origin");
  }
  return origin.origin;
}

function authClient(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export function isCaptchaRejection(error) {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code.includes("captcha") || message.includes("captcha");
}

export function safeAuthError(error) {
  return {
    status: Number.isInteger(error?.status) ? error.status : null,
    code: typeof error?.code === "string" ? error.code : null,
    captchaRelated: isCaptchaRejection(error),
  };
}

async function userCount(adminClient) {
  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error(`Could not count Auth users: ${error.code || error.status || "unknown error"}`);
  if (!Number.isInteger(data?.total)) throw new Error("Supabase Auth returned no aggregate user count");
  return data.total;
}

async function removeDisposableUser(publicClient, adminClient, userId) {
  const signOut = await publicClient.auth.signOut({ scope: "global" });
  if (signOut.error) {
    throw new Error(`Could not revoke the disposable session: ${signOut.error.code || signOut.error.status || "unknown error"}`);
  }
  const deletion = await adminClient.auth.admin.deleteUser(userId);
  if (deletion.error) {
    throw new Error(`Could not delete the disposable Auth user: ${deletion.error.code || deletion.error.status || "unknown error"}`);
  }
}

async function rejectedAttempt({
  label,
  publicClient,
  adminClient,
  captchaToken,
  expectedCount,
}) {
  const { data, error } = await publicClient.auth.signInAnonymously(
    captchaToken ? { options: { captchaToken } } : undefined,
  );
  if (!error && data?.user?.id) {
    await removeDisposableUser(publicClient, adminClient, data.user.id);
    throw new Error(`${label} unexpectedly created an anonymous user`);
  }
  if (!error || !isCaptchaRejection(error)) {
    throw new Error(`${label} was not rejected by CAPTCHA validation`);
  }
  const observedCount = await userCount(adminClient);
  if (observedCount !== expectedCount) {
    throw new Error(`${label} changed the aggregate Auth user count`);
  }
  return {
    status: "passed",
    rejection: safeAuthError(error),
    userCountUnchanged: true,
  };
}

export async function verifyTurnstileAuth({
  supabaseUrl,
  publishableKey,
  secretKey,
  validToken = "",
  requireValid = false,
  clientFactory = authClient,
} = {}) {
  const url = verifiedSupabaseOrigin(supabaseUrl);
  const adminClient = clientFactory(url, secretKey);
  const initialUserCount = await userCount(adminClient);
  const missingToken = await rejectedAttempt({
    label: "Missing Turnstile token",
    publicClient: clientFactory(url, publishableKey),
    adminClient,
    captchaToken: "",
    expectedCount: initialUserCount,
  });
  const invalidToken = await rejectedAttempt({
    label: "Invalid Turnstile token",
    publicClient: clientFactory(url, publishableKey),
    adminClient,
    captchaToken: "med250-invalid-turnstile-token",
    expectedCount: initialUserCount,
  });

  const cleanedValidToken = validToken.trim();
  if (requireValid && !cleanedValidToken) {
    throw new Error("TURNSTILE_TEST_TOKEN is required for the controlled positive-path test");
  }

  let validTokenResult = {
    status: "not_run",
    disposableAnonymousUserCreated: false,
    disposableSessionRevoked: false,
    disposableUserDeleted: false,
  };
  if (cleanedValidToken) {
    const publicClient = clientFactory(url, publishableKey);
    const { data, error } = await publicClient.auth.signInAnonymously({
      options: { captchaToken: cleanedValidToken },
    });
    if (error || !data?.user?.id || !data?.session || data.user.is_anonymous !== true) {
      throw new Error(`Valid Turnstile token did not create the disposable anonymous session: ${error?.code || error?.status || "invalid response"}`);
    }
    await removeDisposableUser(publicClient, adminClient, data.user.id);
    const finalUserCount = await userCount(adminClient);
    if (finalUserCount !== initialUserCount) {
      throw new Error("Disposable Turnstile test identity cleanup did not restore the aggregate Auth user count");
    }
    validTokenResult = {
      status: "passed",
      disposableAnonymousUserCreated: true,
      disposableSessionRevoked: true,
      disposableUserDeleted: true,
    };
  }

  return {
    status: requireValid && validTokenResult.status !== "passed" ? "failed" : "passed",
    supabaseHost: new URL(url).hostname,
    checks: {
      missingToken,
      invalidToken,
      validToken: validTokenResult,
    },
    identifiersEmitted: false,
    tokensEmitted: false,
  };
}

async function main() {
  const result = await verifyTurnstileAuth({
    supabaseUrl: requiredEnvironment("SUPABASE_URL", ["NEXT_PUBLIC_SUPABASE_URL"]),
    publishableKey: requiredEnvironment("SUPABASE_PUBLISHABLE_KEY", [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]),
    secretKey: requiredEnvironment("SUPABASE_SECRET_KEY", ["SUPABASE_SERVICE_ROLE_KEY"]),
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
