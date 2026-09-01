import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../db/d1/migrations/0011_admin_whatsapp_auth.sql", import.meta.url), "utf8");
const api = await readFile(new URL("../worker/backend/admin-api.ts", import.meta.url), "utf8");
const repository = await readFile(new URL("../worker/backend/admin-repository.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const client = await readFile(new URL("../app/admin/admin-panel.tsx", import.meta.url), "utf8");
const transport = await readFile(new URL("../worker/backend/twilio-send.ts", import.meta.url), "utf8");

test("keeps privileged identities outside client and pharmacy actor constraints", () => {
  assert.match(migration, /CREATE TABLE med250_admin_principals/);
  assert.match(migration, /role IN \('super_admin', 'operations_admin', 'catalogue_reviewer'\)/);
  assert.match(migration, /status IN \('active', 'suspended'\)/);
  assert.match(migration, /CREATE TABLE med250_admin_sessions/);
  assert.match(migration, /CREATE TABLE med250_admin_otp_challenges/);
  assert.match(migration, /CREATE TABLE med250_admin_otp_redemptions/);
  assert.match(migration, /admin_otp_challenge_id/);
  assert.doesNotMatch(migration, /ALTER TABLE med250_actors/);
  assert.doesNotMatch(migration, /ALTER TABLE med250_web_principals/);
});

test("protects admin login with origin, Turnstile, random OTP and isolated cookies", () => {
  assert.match(api, /action !== "admin_login"/);
  assert.match(api, /assertMutationOrigin\(request, runtime\)/);
  assert.match(api, /generatedOtp\(\)/);
  assert.match(api, /encryptOtpCode\(code, context/);
  assert.match(api, /__Host-med250-admin/);
  assert.match(api, /Secure; HttpOnly; SameSite=Strict/);
  assert.match(api, /ADMIN_SESSION_SECONDS = 12 \* 60 \* 60/);
  assert.match(api, /constantTimeEqualHex/);
  assert.doesNotMatch(api, /123455/);
});

test("makes OTP redemption atomic, rate limited, revocable and audited", () => {
  assert.match(repository, /med250_admin_auth_rate_events/);
  assert.match(repository, /otp_phone_minute_rate_limit/);
  assert.match(repository, /med250_admin_otp_redemptions/);
  assert.match(repository, /admin_otp_superseded/);
  assert.match(repository, /UPDATE med250_admin_sessions[\s\S]*revoked_at/);
  assert.match(repository, /admin_otp_queued/);
  assert.match(repository, /admin_otp_verified/);
});

test("routes authenticated admin APIs before public auth and keeps dashboard data server-side", () => {
  assert.match(worker, /adminResponse/);
  assert.ok(worker.indexOf('url.pathname.startsWith("/api/auth/admin/")') < worker.indexOf('url.pathname.startsWith("/api/auth/")'));
  assert.match(api, /\/api\/admin\/dashboard/);
  assert.match(api, /requireSession\(request, repository, false\)/);
  assert.match(client, /med250ApiJson\("\/api\/admin\/dashboard"\)/);
  assert.doesNotMatch(client, /MED250_ADMIN_TOKEN/);
});

test("delivers encrypted admin challenges through the existing staff OTP template", () => {
  assert.match(transport, /actorType !== "admin"/);
  assert.match(transport, /actorType === "client" \? runtime\.customerOtpContentSid : runtime\.pharmacyOtpContentSid/);
  assert.doesNotMatch(repository, /code[^_a-zA-Z]*:/);
});
