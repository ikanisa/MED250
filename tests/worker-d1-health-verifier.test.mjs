import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import { evaluateWorkerD1Health } from "../scripts/verify-worker-d1-health.mjs";

const execFileAsync = promisify(execFile);
const verifierUrl = new URL("../scripts/verify-worker-d1-health.mjs", import.meta.url);

function healthySnapshot(overrides = {}) {
  return {
    contract_version: "med250-worker-d1-health-v1",
    generated_at: new Date().toISOString(),
    status: "healthy",
    privacy: {
      aggregate_only: true,
      contains_identifiers: false,
      contains_phone_numbers: false,
      contains_coordinates: false,
      contains_health_or_prescription_data: false,
    },
    database: { migrations_current: true },
    pharmacies: { dispatch_ready: 53, verified_login_contacts: 53 },
    dispatch: {
      provider_send_unknown: 0,
      dead_letter: 0,
      stale_work: 0,
      failed_24h: 0,
      retry: 0,
      provider_callback_failures_24h: 0,
    },
    inbound: { stale_unprocessed: 0 },
    orders: { waiting_without_confirmation_over_30m: 0 },
    private_media: { expired_not_deleted: 0, stale_processing: 0, expired_active_grants: 0 },
    ...overrides,
  };
}

test("accepts a matching aggregate Worker-D1 snapshot", () => {
  const result = evaluateWorkerD1Health(healthySnapshot());
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.critical, []);
  assert.deepEqual(result.warnings, []);
});

test("fails closed on provider-finality or privacy drift", () => {
  const result = evaluateWorkerD1Health(healthySnapshot({
    status: "critical",
    privacy: { ...healthySnapshot().privacy, contains_identifiers: true },
    dispatch: { ...healthySnapshot().dispatch, provider_send_unknown: 1 },
  }));
  assert.equal(result.status, "critical");
  assert.ok(result.critical.some((message) => message.includes("privacy")));
  assert.ok(result.critical.some((message) => message.includes("unknown finality")));
});

test("accepts the probe token only through the process environment and never logs it", async () => {
  const secret = "do-not-print-this-operational-health-secret";
  await assert.rejects(
    execFileAsync(process.execPath, [verifierUrl.pathname, `--token=${secret}`], {
      env: { ...process.env, MED250_HEALTH_PROBE_TOKEN: secret },
    }),
    (error) => {
      assert.doesNotMatch(`${error.stdout}\n${error.stderr}`, new RegExp(secret));
      assert.match(`${error.stdout}\n${error.stderr}`, /accepted only through MED250_HEALTH_PROBE_TOKEN/);
      return true;
    },
  );
  const source = await readFile(verifierUrl, "utf8");
  assert.doesNotMatch(source, /console[.](?:log|error)\([^\n]*(?:token|authorization)/i);
});

test("requires the canonical HTTPS health path before any network request", async () => {
  const secret = "test-only-operational-health-token-at-least-32-bytes";
  await assert.rejects(
    execFileAsync(process.execPath, [verifierUrl.pathname, "--url", "http://med-250.com/api/internal/health"], {
      env: { ...process.env, MED250_HEALTH_PROBE_TOKEN: secret },
    }),
    (error) => {
      assert.match(`${error.stdout}\n${error.stderr}`, /exact same-origin HTTPS/);
      return true;
    },
  );
});
