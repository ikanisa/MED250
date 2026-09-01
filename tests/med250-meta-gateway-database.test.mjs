import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = new URL(
  "../supabase/migrations/20260828090000_med250_meta_gateway_security.sql",
  import.meta.url,
);

const prerequisiteSchema = `
  create role anon;
  create role authenticated;
  create role service_role;
  create table public.dawanear_whatsapp_outbox (
    id uuid primary key,
    whatsapp_message_id text unique,
    status text not null check (status in ('queued','sending','retry','sent','delivered','read','failed')),
    last_error_code text,
    sent_at timestamptz,
    delivered_at timestamptz,
    read_at timestamptz,
    failed_at timestamptz,
    updated_at timestamptz not null default now()
  );
`;

async function database() {
  const db = new PGlite();
  await db.exec(prerequisiteSchema);
  await db.exec(await readFile(migrationPath, "utf8"));
  return db;
}

test("claims, retries, completes, deduplicates and rejects digest conflicts", async () => {
  const db = await database();
  const eventKey = "a".repeat(64);
  const digest = "b".repeat(64);
  const reference = "c".repeat(64);
  let result = await db.query(
    `select * from public.dawanear_claim_meta_webhook_event('${eventKey}','${digest}',120)`,
  );
  assert.deepEqual(result.rows, [{ claimed: true, conflict: false }]);

  result = await db.query(
    `select * from public.dawanear_claim_meta_webhook_event('${eventKey}','${digest}',120)`,
  );
  assert.deepEqual(result.rows, [{ claimed: false, conflict: false }]);

  await db.exec(`select public.dawanear_fail_meta_webhook_event('${eventKey}','database_error')`);
  result = await db.query(
    `select * from public.dawanear_claim_meta_webhook_event('${eventKey}','${digest}',120)`,
  );
  assert.deepEqual(result.rows, [{ claimed: true, conflict: false }]);
  await db.exec(
    `select public.dawanear_complete_meta_webhook_event('${eventKey}','${reference}','delivered')`,
  );

  result = await db.query(
    `select * from public.dawanear_claim_meta_webhook_event('${eventKey}','${digest}',120)`,
  );
  assert.deepEqual(result.rows, [{ claimed: false, conflict: false }]);
  result = await db.query(
    `select * from public.dawanear_claim_meta_webhook_event('${eventKey}','${"d".repeat(64)}',120)`,
  );
  assert.deepEqual(result.rows, [{ claimed: false, conflict: true }]);

  const receipt = await db.query(
    `select state, attempt_count, event_reference, delivery_state, error_class
     from public.dawanear_meta_webhook_receipts where event_key='${eventKey}'`,
  );
  assert.deepEqual(receipt.rows, [{
    state: "completed",
    attempt_count: 2,
    event_reference: reference,
    delivery_state: "delivered",
    error_class: null,
  }]);
});

test("enforces a pseudonymous fixed-window rate limit", async () => {
  const db = await database();
  const identifier = "e".repeat(64);
  const first = await db.query(
    `select * from public.dawanear_consume_meta_webhook_rate('delivery_recipient','${identifier}',60,1)`,
  );
  const second = await db.query(
    `select * from public.dawanear_consume_meta_webhook_rate('delivery_recipient','${identifier}',60,1)`,
  );
  assert.equal(first.rows[0].allowed, true);
  assert.equal(first.rows[0].request_count, 1);
  assert.equal(second.rows[0].allowed, false);
  assert.equal(second.rows[0].request_count, 2);
  assert.ok(second.rows[0].retry_after_seconds >= 1);
});

test("prevents delivery-state regression under out-of-order callbacks", async () => {
  const db = await database();
  const rowId = "00000000-0000-4000-8000-000000000001";
  await db.exec(`
    insert into public.dawanear_whatsapp_outbox(id, whatsapp_message_id, status)
    values ('${rowId}', 'wamid.security-test', 'sent');
    select public.dawanear_record_whatsapp_delivery('wamid.security-test','failed','131047');
    select public.dawanear_record_whatsapp_delivery('wamid.security-test','delivered',null);
    select public.dawanear_record_whatsapp_delivery('wamid.security-test','read',null);
    select public.dawanear_record_whatsapp_delivery('wamid.security-test','sent',null);
    select public.dawanear_record_whatsapp_delivery('wamid.security-test','failed','late-failure');
  `);
  const result = await db.query(
    `select status, sent_at is not null as sent, delivered_at is not null as delivered,
            read_at is not null as read, last_error_code
     from public.dawanear_whatsapp_outbox where id='${rowId}'`,
  );
  assert.deepEqual(result.rows, [{
    status: "read",
    sent: true,
    delivered: true,
    read: true,
    last_error_code: "131047",
  }]);
});

test("keeps security state service-role only", async () => {
  const db = await database();
  await assert.rejects(
    db.exec("set role authenticated; select * from public.dawanear_meta_webhook_receipts"),
    /permission denied/,
  );
  await db.exec("reset role");
  await db.exec(`
    set role service_role;
    select * from public.dawanear_meta_webhook_receipts;
    reset role;
  `);
});
