import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { adminClient } from "../_shared/dawanear-pharmacy-auth.ts";

function env(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

function timingSafeText(received: string, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function validSignature(body: Uint8Array, signature: string): Promise<boolean> {
  const secret = env("META_APP_SECRET");
  const received = signature.replace(/^sha256=/i, "").toLowerCase();
  if (!secret || !/^[0-9a-f]{64}$/.test(received)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, body)));
  return timingSafeText(received, expected);
}

type DeliveryStatus = { id?: string; status?: string; errors?: Array<{ code?: string | number }> };

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode") ?? "";
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const expected = env("WHATSAPP_VERIFY_TOKEN") || env("META_WABA_VERIFY_TOKEN") || env("WA_VERIFY_TOKEN");
    if (mode === "subscribe" && timingSafeText(token, expected) && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 1_000_000) return new Response("Payload too large", { status: 413 });
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > 1_000_000) return new Response("Payload too large", { status: 413 });
  if (!await validSignature(rawBody, request.headers.get("x-hub-signature-256") ?? "")) {
    return new Response("Forbidden", { status: 403 });
  }

  const payload = (() => {
    try { return JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>; }
    catch { return null; }
  })();
  if (!payload) return new Response("Invalid JSON", { status: 400 });

  const statuses: DeliveryStatus[] = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (Array.isArray(value?.statuses)) statuses.push(...value.statuses);
    }
  }

  const client = adminClient();
  for (const status of statuses.slice(0, 100)) {
    if (!status.id || !["sent", "delivered", "read", "failed"].includes(status.status ?? "")) continue;
    await client.rpc("dawanear_record_whatsapp_delivery", {
      p_message_id: status.id,
      p_status: status.status,
      p_error_code: status.errors?.[0]?.code != null ? String(status.errors[0].code) : null,
    });
  }
  return new Response("EVENT_RECEIVED", { status: 200, headers: { "Content-Type": "text/plain" } });
});
