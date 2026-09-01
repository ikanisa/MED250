import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { adminClient } from "../_shared/dawanear-pharmacy-auth.ts";
import {
  asRecord,
  enabledFlag,
  normalizeRecipient,
  parseCountryCodes,
  providerIdentifier,
  pseudonymousIdentifier,
  sha256Hex,
  timingSafeText,
  validateMetaSignature,
} from "../_shared/med250-meta-security.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 25;
const MAX_CHANGES = 25;
const MAX_REQUESTS_PER_RECIPIENT_MINUTE = 30;
const DELIVERY_STATES = new Set(["sent", "delivered", "read", "failed"]);

type SafeStatus = {
  eventKey: string;
  messageId: string;
  state: "sent" | "delivered" | "read" | "failed";
  recipient: string;
  errorCode: string | null;
  reference: string;
};

function env(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function active(): boolean {
  return enabledFlag(env("MED250_META_WEBHOOK_ENABLED"));
}

function response(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function readBody(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new RangeError("payload too large");
  }
  const raw = await request.text();
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new RangeError("payload too large");
  }
  return raw;
}

async function parseStatuses(payload: Record<string, unknown>): Promise<SafeStatus[]> {
  if (payload.object !== "whatsapp_business_account") throw new Error("unexpected Meta object");
  const expectedWaba = requiredEnv("MED250_META_WABA_ID");
  const expectedPhone = requiredEnv("MED250_META_PHONE_NUMBER_ID");
  const countries = parseCountryCodes(requiredEnv("MED250_META_ALLOWED_COUNTRY_CODES"));
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  if (entries.length === 0 || entries.length > MAX_EVENTS) throw new Error("invalid entry count");
  const result: SafeStatus[] = [];

  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    if (providerIdentifier(entry.id, 100) !== expectedWaba) throw new Error("wrong WABA");
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    if (changes.length === 0 || changes.length > MAX_CHANGES) throw new Error("invalid change count");
    for (const rawChange of changes) {
      const change = asRecord(rawChange);
      if (change.field !== "messages") throw new Error("unexpected subscription field");
      const value = asRecord(change.value);
      const metadata = asRecord(value.metadata);
      if (providerIdentifier(metadata.phone_number_id, 100) !== expectedPhone) {
        throw new Error("wrong phone number ID");
      }
      const inboundMessages = Array.isArray(value.messages) ? value.messages : [];
      if (inboundMessages.length > 0) {
        throw new Error("inbound message handling is not enabled on the recovery callback");
      }
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      if (result.length + statuses.length > MAX_EVENTS) throw new Error("status batch too large");
      for (const rawStatus of statuses) {
        const status = asRecord(rawStatus);
        const messageId = providerIdentifier(status.id);
        const state = typeof status.status === "string" && DELIVERY_STATES.has(status.status)
          ? status.status as SafeStatus["state"]
          : null;
        if (!state) throw new Error("invalid delivery state");
        const timestamp = providerIdentifier(status.timestamp, 24);
        if (!/^\d{1,20}$/.test(timestamp)) throw new Error("invalid provider timestamp");
        const recipient = normalizeRecipient(status.recipient_id, countries);
        if (!recipient) throw new Error("invalid status recipient");
        const error = Array.isArray(status.errors) ? asRecord(status.errors[0]) : {};
        const errorCode = error.code == null ? null : String(error.code).trim().slice(0, 40) || null;
        const eventMaterial = `${messageId}:${state}:${timestamp}`;
        result.push({
          eventKey: await sha256Hex(`meta-status:${eventMaterial}`),
          messageId,
          state,
          recipient,
          errorCode,
          reference: await sha256Hex(messageId),
        });
      }
    }
  }
  return result;
}

type AdminClient = ReturnType<typeof adminClient>;

async function consumeRate(client: AdminClient, recipient: string): Promise<void> {
  const identifier = await pseudonymousIdentifier(
    requiredEnv("MED250_META_RATE_LIMIT_PEPPER"),
    "delivery-recipient",
    recipient,
  );
  const { data, error } = await client.rpc("dawanear_consume_meta_webhook_rate", {
    p_scope: "delivery_recipient",
    p_identifier: identifier,
    p_window_seconds: 60,
    p_max_requests: MAX_REQUESTS_PER_RECIPIENT_MINUTE,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.allowed !== true) throw new Error("webhook rate limit exceeded or unavailable");
}

async function claimEvent(client: AdminClient, status: SafeStatus, digest: string): Promise<boolean> {
  const { data, error } = await client.rpc("dawanear_claim_meta_webhook_event", {
    p_event_key: status.eventKey,
    p_body_digest: digest,
    p_lock_seconds: 120,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.claimed !== "boolean" || typeof row.conflict !== "boolean") {
    throw new Error("invalid replay-claim response");
  }
  if (row.conflict) throw new Error("provider event digest conflict");
  return row.claimed;
}

async function completeEvent(client: AdminClient, status: SafeStatus): Promise<void> {
  const { error: deliveryError } = await client.rpc("dawanear_record_whatsapp_delivery", {
    p_message_id: status.messageId,
    p_status: status.state,
    p_error_code: status.errorCode,
  });
  if (deliveryError) throw deliveryError;
  const { error: receiptError } = await client.rpc("dawanear_complete_meta_webhook_event", {
    p_event_key: status.eventKey,
    p_event_reference: status.reference,
    p_delivery_state: status.state,
  });
  if (receiptError) throw receiptError;
}

async function failEvent(client: AdminClient, status: SafeStatus, cause: unknown): Promise<void> {
  const errorClass = cause instanceof Error ? cause.name : "processing_error";
  const { error } = await client.rpc("dawanear_fail_meta_webhook_event", {
    p_event_key: status.eventKey,
    p_error_class: errorClass.slice(0, 80),
  });
  if (error) console.error("med250-meta-webhook: failed to release receipt");
}

Deno.serve(async (request: Request) => {
  if (request.method === "GET") {
    if (!active()) return response("Service Unavailable", 503);
    try {
      const url = new URL(request.url);
      const challenge = url.searchParams.get("hub.challenge") ?? "";
      const accepted = url.searchParams.get("hub.mode") === "subscribe" &&
        /^[A-Za-z0-9_-]{1,256}$/.test(challenge) &&
        timingSafeText(
          url.searchParams.get("hub.verify_token") ?? "",
          requiredEnv("MED250_META_WEBHOOK_VERIFY_TOKEN"),
        );
      return accepted ? response(challenge, 200) : response("Forbidden", 403);
    } catch {
      return response("Service Unavailable", 503);
    }
  }
  if (request.method !== "POST") return response("Method Not Allowed", 405);
  if (!active()) return response("Service Unavailable", 503);
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return response("Unsupported Media Type", 415);
  }

  let raw: string;
  try {
    raw = await readBody(request);
  } catch {
    return response("Payload Too Large", 413);
  }

  try {
    if (!await validateMetaSignature(
      requiredEnv("MED250_META_APP_SECRET"),
      raw,
      request.headers.get("x-hub-signature-256") ?? "",
    )) return response("Forbidden", 403);
    const payload = asRecord(JSON.parse(raw));
    const statuses = await parseStatuses(payload);
    const digest = await sha256Hex(raw);
    const client = adminClient();
    for (const recipient of new Set(statuses.map((status) => status.recipient))) {
      await consumeRate(client, recipient);
    }
    for (const status of statuses) {
      if (!await claimEvent(client, status, digest)) continue;
      try {
        await completeEvent(client, status);
      } catch (cause) {
        await failEvent(client, status, cause);
        throw cause;
      }
    }
    return response("EVENT_RECEIVED", 200);
  } catch (cause) {
    console.error("med250-meta-webhook: request rejected", cause instanceof Error ? cause.name : "processing_error");
    return response("Service Unavailable", 503);
  }
});
