import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOperationalHealth } from "../scripts/monitor-operational-health.mjs";

const healthySnapshot = {
  generated_at: "2026-07-14T10:00:00Z",
  privacy: { aggregate_only: true },
  pharmacies: {
    gps_ready: 1,
    dispatch_ready: 1,
    login_enabled_whatsapp_contacts: 1,
  },
  prescription_cleanup: { stale: false, expired_claims: 0 },
  orders: { waiting_without_confirmation_over_30m: 0 },
  pharmacy_auth: { otp_failed_24h: 0 },
  catalogue: { products_with_current_prices: 1 },
};

test("classifies a complete aggregate production snapshot as healthy", () => {
  const result = evaluateOperationalHealth(healthySnapshot);
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.critical, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.generatedAt, healthySnapshot.generated_at);
});

test("raises every fail-closed pharmacy and cleanup launch condition", () => {
  const result = evaluateOperationalHealth({
    ...healthySnapshot,
    privacy: { aggregate_only: false },
    pharmacies: { gps_ready: 0, dispatch_ready: 0, login_enabled_whatsapp_contacts: 0 },
    prescription_cleanup: { stale: true, expired_claims: 0 },
  });
  assert.equal(result.status, "critical");
  assert.equal(result.critical.length, 5);
  assert.ok(result.critical.some((message) => /approved GPS/.test(message)));
  assert.ok(result.critical.some((message) => /dispatch eligibility/.test(message)));
  assert.ok(result.critical.some((message) => /WhatsApp login/.test(message)));
  assert.ok(result.critical.some((message) => /cleanup/.test(message)));
});

test("reports recoverable operations, order, OTP and price issues as degraded", () => {
  const result = evaluateOperationalHealth({
    ...healthySnapshot,
    prescription_cleanup: { stale: false, expired_claims: 2 },
    orders: { waiting_without_confirmation_over_30m: 3 },
    pharmacy_auth: { otp_failed_24h: 4 },
    catalogue: { products_with_current_prices: 0 },
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.critical.length, 0);
  assert.equal(result.warnings.length, 4);
});
