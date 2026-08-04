import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { adminClient } from "../_shared/dawanear-pharmacy-auth.ts";

type JsonRecord = Record<string, unknown>;
type OutboxMessage = {
  id: string;
  recipient_e164: string;
  kind: "pharmacy_request" | "customer_offer" | "pharmacy_selected";
  payload: JsonRecord;
  attempt_number: number;
};

function env(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  throw new Error(`Missing server configuration: ${names.join(" or ")}`);
}

function secretMatches(received: string, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSupportedWhatsappImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /\.(?:jpe?g|png)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function compactItems(payload: JsonRecord): { summary: string; imageUrl: string | null; availableCount: number; itemCount: number } {
  const items = rows(payload.items);
  const visible = items.slice(0, 8).map((item) => {
    const name = text(item.brand, text(item.generic, "Product"));
    const strength = text(item.strength);
    const packSize = text(item.pack_size);
    const quantity = number(item.quantity) ?? 1;
    return [`${quantity}× ${name}`, strength, packSize ? `pack ${packSize}` : ""].filter(Boolean).join(" · ");
  });
  if (items.length > visible.length) visible.push(`+${items.length - visible.length} more`);
  const imageUrl = items.map((item) => text(item.image_url)).find(isSupportedWhatsappImageUrl) ?? null;
  const availableCount = items.filter((item) => item.available !== false).length;
  return {
    summary: visible.join("\n").slice(0, 900),
    imageUrl,
    availableCount,
    itemCount: items.length,
  };
}

function bodyText(value: string): { type: "text"; text: string } {
  return { type: "text", text: value || "—" };
}

function templateComponents(message: OutboxMessage): Array<JsonRecord> {
  const payload = record(message.payload);
  const items = compactItems(payload);
  const components: Array<JsonRecord> = [];
  const mediaHeaderEnabled = env("WHATSAPP_NOTIFICATION_IMAGE_HEADERS") === "true";
  if (mediaHeaderEnabled) {
    const configuredFallback = env("WHATSAPP_NOTIFICATION_FALLBACK_IMAGE_URL");
    const fallbackImageUrl = isSupportedWhatsappImageUrl(configuredFallback)
      ? configuredFallback
      : "https://med-250.com/brand/app-icon-512.png";
    components.push({ type: "header", parameters: [{ type: "image", image: { link: items.imageUrl ?? fallbackImageUrl } }] });
  }

  if (message.kind === "pharmacy_request") {
    const distanceM = number(payload.distance_m);
    const coverage = distanceM != null && distanceM >= 0
      ? `Approx. ${(distanceM / 1_000).toFixed(1)} km away`
      : "National service request";
    components.push({
      type: "body",
      parameters: [
        bodyText(text(payload.reference, "MED250 request")),
        bodyText(items.summary),
        bodyText(coverage),
        bodyText(text(payload.delivery_preference, "pickup or delivery")),
      ],
    });
  } else {
    const totalRwf = number(payload.total_rwf);
    const readyInMinutes = number(payload.ready_in_minutes);
    components.push({
      type: "body",
      parameters: [
        bodyText(text(payload.reference, "MED250 request")),
        bodyText(text(payload.pharmacy_name, "A pharmacy")),
        bodyText(items.itemCount ? `${items.availableCount} of ${items.itemCount} products confirmed` : "Availability confirmed"),
        bodyText([
          totalRwf && totalRwf > 0 ? `Indicative RWF ${Math.round(totalRwf).toLocaleString("en-US")}` : "Price to be confirmed",
          readyInMinutes != null ? `ready in about ${Math.round(readyInMinutes)} minutes` : "ready time to be confirmed",
        ].join(" · ")),
      ],
    });
  }

  const portalPath = text(payload.portal_path);
  if (portalPath) {
    components.push({
      type: "button",
      sub_type: "url",
      index: env("WHATSAPP_NOTIFICATION_URL_BUTTON_INDEX") || "0",
      parameters: [bodyText(portalPath)],
    });
  }
  return components;
}

function templateName(kind: OutboxMessage["kind"]): string {
  if (kind === "pharmacy_request") return firstEnv("WHATSAPP_PHARMACY_REQUEST_TEMPLATE_NAME");
  if (kind === "pharmacy_selected") return firstEnv("WHATSAPP_PHARMACY_SELECTED_TEMPLATE_NAME", "WHATSAPP_CUSTOMER_OFFER_TEMPLATE_NAME");
  return firstEnv("WHATSAPP_CUSTOMER_OFFER_TEMPLATE_NAME");
}

async function sendTemplate(message: OutboxMessage): Promise<string> {
  const accessToken = firstEnv("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_CLOUD_API_TOKEN", "WABA_ACCESS_TOKEN");
  const phoneNumberId = firstEnv("WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_CLOUD_PHONE_NUMBER_ID", "WABA_PHONE_NUMBER_ID");
  const graphVersion = env("WHATSAPP_GRAPH_API_VERSION") || "v25.0";
  const language = env("WHATSAPP_NOTIFICATION_TEMPLATE_LANGUAGE") || env("WHATSAPP_TEMPLATE_LANGUAGE") || "en_US";
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.recipient_e164,
      type: "template",
      template: {
        name: templateName(message.kind),
        language: { code: language },
        components: templateComponents(message),
      },
    }),
  });
  const raw = await response.text();
  const parsed = (() => { try { return JSON.parse(raw) as JsonRecord; } catch { return {}; } })();
  if (!response.ok) {
    const apiError = record(parsed.error);
    const code = text(apiError.code, `HTTP_${response.status}`);
    console.error(JSON.stringify({ event: "whatsapp_notification_rejected", kind: message.kind, code, attempt: message.attempt_number }));
    throw new Error(code);
  }
  const messageId = text(rows(parsed.messages)[0]?.id);
  if (!messageId) throw new Error("WHATSAPP_MESSAGE_ID_MISSING");
  return messageId;
}

async function deliverMessage(client: ReturnType<typeof adminClient>, message: OutboxMessage) {
  try {
    const messageId = await sendTemplate(message);
    const { error: finishError } = await client.rpc("dawanear_finish_whatsapp_outbox", {
      p_id: message.id,
      p_succeeded: true,
      p_message_id: messageId,
      p_error_code: null,
    });
    if (finishError) throw finishError;
    return { outcome: "sent" as const };
  } catch (sendError) {
    const errorCode = sendError instanceof Error ? sendError.message.slice(0, 120) : "UNKNOWN";
    await client.rpc("dawanear_finish_whatsapp_outbox", {
      p_id: message.id,
      p_succeeded: false,
      p_message_id: null,
      p_error_code: errorCode,
    });
    return { outcome: "retry" as const };
  }
}

Deno.serve(async (request: Request) => {
  const startedAt = Date.now();
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expectedSecret = env("DAWANEAR_CRON_TOKEN");
  const receivedSecret = request.headers.get("X-DawaNear-Cron-Token") ?? "";
  if (!secretMatches(receivedSecret, expectedSecret)) return new Response("Forbidden", { status: 403 });

  const body = await request.json().catch(() => ({}));
  const batchLimit = Math.min(Math.max(Number(body?.batch_limit ?? 20), 1), 100);
  const client = adminClient();
  const { data, error } = await client.rpc("dawanear_claim_whatsapp_outbox", { p_limit: batchLimit });
  if (error) return Response.json({ error: "Could not claim WhatsApp delivery work." }, { status: 500 });

  const messages = (data ?? []) as OutboxMessage[];
  const results: Array<{ outcome: "sent" | "retry" }> = [];
  const requestedConcurrency = Number(env("WHATSAPP_DELIVERY_CONCURRENCY") || 4);
  const concurrency = Math.min(Math.max(Number.isInteger(requestedConcurrency) ? requestedConcurrency : 4, 1), 8);
  for (let index = 0; index < messages.length; index += concurrency) {
    results.push(...await Promise.all(messages.slice(index, index + concurrency).map((message) => deliverMessage(client, message))));
  }
  const sent = results.filter((result) => result.outcome === "sent").length;
  const retry = results.length - sent;
  const summary = {
    claimed: messages.length,
    sent,
    retry,
    concurrency,
    max_attempt: messages.reduce((highest, message) => Math.max(highest, message.attempt_number), 0),
    duration_ms: Date.now() - startedAt,
  };
  const summaryLog = JSON.stringify({ event: retry > 0 ? "whatsapp_dispatch_degraded" : "whatsapp_dispatch_completed", ...summary });
  if (retry > 0) console.error(summaryLog);
  else console.info(summaryLog);
  return Response.json(summary);
});
