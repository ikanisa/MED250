import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { clientMediaFinalizationDecision } from "../worker/backend/delivery-finality.ts";

test("waits for every pharmacy attempt before deciding client-visible dispatch finality", () => {
  assert.equal(clientMediaFinalizationDecision({ total: 10, delivered: 1, unfinished: 9 }), "wait");
  assert.equal(clientMediaFinalizationDecision({ total: 10, delivered: 0, unfinished: 1 }), "wait");
  assert.equal(clientMediaFinalizationDecision({ total: 0, delivered: 0, unfinished: 0 }), "wait");
});

test("confirms only actual deliveries and closes an all-failed request", () => {
  assert.equal(clientMediaFinalizationDecision({ total: 10, delivered: 7, unfinished: 0 }), "confirm_delivered");
  assert.equal(clientMediaFinalizationDecision({ total: 10, delivered: 0, unfinished: 0 }), "close_failed");
  assert.throws(
    () => clientMediaFinalizationDecision({ total: 3, delivered: 4, unfinished: 0 }),
    /inconsistent/,
  );
});

test("runs bounded, idempotent WhatsApp lifecycle maintenance every minute", async () => {
  const [repository, entrypoint] = await Promise.all([
    readFile(new URL("../worker/backend/whatsapp-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(repository, /expired_private_media_grants_revoked/);
  assert.match(repository, /media_processing_timeout/);
  assert.match(repository, /stale_inbound_event_closed/);
  assert.match(repository, /client_request_all_pharmacy_deliveries_failed/);
  assert.match(entrypoint, /scheduleWhatsAppOperationalMaintenance\(ctx, env\)/);
});
