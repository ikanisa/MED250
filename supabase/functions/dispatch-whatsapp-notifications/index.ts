import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { adminClient } from "../_shared/dawanear-pharmacy-auth.ts";
import {
  enabledFlag,
  explicitGraphVersion,
  explicitTemplateName,
  normalizeRecipient,
  parseCountryCodes,
  safeTemplateText,
} from "../_shared/med250-meta-security.mjs";

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

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
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
  return safeTemplateText(value, fallback, 400);
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function supportedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const configuredOrigin = new URL(requiredEnv("MED250_META_MEDIA_ORIGIN"));
    return url.protocol === "https:" && url.origin === configuredOrigin.origin &&
      /\.(?:jpe?g|png)$/i.test(url.pathname);
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
  const imageUrl = items.map((item) => text(item.image_url)).find(supportedImageUrl) ?? null;
  const availableCount = items.filter((item) => item.available !== false).length;
  return {
    summary: visible.join("\n").slice(0, 900),
    imageUrl,
    availableCount,
    itemCount: items.length,
  };
}

function bodyText(value: string): { type: "text"; text: string } {
  return { type: "text", text: safeTemplateText(value, "—", 1000) };
}

function templateComponents(message: OutboxMessage): Array<JsonRecord> {
  const payload = record(message.payload);
  const items = compactItems(payload);
  const components: Array<JsonRecord> = [];
  const mediaHeaderEnabled = enabledFlag(env("MED250_META_NOTIFICATION_IMAGE_HEADERS"));
  if (mediaHeaderEnabled && items.imageUrl) {
    components.push({ type: "header", parameters: [{ type: "image", image: { link: items.imageUrl } }] });
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
    if (!/^[A-Za-z0-9_=&%.-]{1,256}$/.test(portalPath)) {
      throw new Error("INVALID_PORTAL_PATH");
    }
    components.push({
      type: "button",
      sub_type: "url",
      index: env("MED250_META_NOTIFICATION_URL_BUTTON_INDEX") || "0",
      parameters: [bodyText(portalPath)],
    });
  }
  return components;
}

function templateName(kind: OutboxMessage["kind"]): string {
  if (kind === "pharmacy_request") {
    return explicitTemplateName(requiredEnv("MED250_META_PHARMACY_REQUEST_TEMPLATE_NAME"));
  }
  if (kind === "pharmacy_selected") {
    return explicitTemplateName(requiredEnv("MED250_META_PHARMACY_SELECTED_TEMPLATE_NAME"));
  }
  return explicitTemplateName(requiredEnv("MED250_META_CUSTOMER_OFFER_TEMPLATE_NAME"));
}

async function sendTemplate(message: OutboxMessage): Promise<string> {
  const accessToken = requiredEnv("MED250_META_ACCESS_TOKEN");
  const wabaId = requiredEnv("MED250_META_WABA_ID");
  const phoneNumberId = requiredEnv("MED250_META_PHONE_NUMBER_ID");
  if (!/^\d{5,30}$/.test(wabaId) || !/^\d{5,30}$/.test(phoneNumberId)) {
    throw new Error("INVALID_META_ASSET_BINDING");
  }
  const graphVersion = explicitGraphVersion(requiredEnv("MED250_META_GRAPH_API_VERSION"));
  const language = requiredEnv("MED250_META_TEMPLATE_LANGUAGE");
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) throw new Error("INVALID_TEMPLATE_LANGUAGE");
  const countries = parseCountryCodes(requiredEnv("MED250_META_ALLOWED_COUNTRY_CODES"));
  const recipient = normalizeRecipient(message.recipient_e164, countries);
  if (!recipient) throw new Error("RECIPIENT_COUNTRY_NOT_ALLOWED");
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "template",
      template: {
        name: templateName(message.kind),
        language: { code: language },
        components: templateComponents(message),
      },
    }),
  });
  const raw = (await response.text()).slice(0, 65_536);
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

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expectedSecret = env("MED250_META_DISPATCH_TOKEN");
  const receivedSecret = request.headers.get("X-DawaNear-Cron-Token") ?? "";
  if (!secretMatches(receivedSecret, expectedSecret)) return new Response("Forbidden", { status: 403 });
  if (!enabledFlag(env("MED250_META_NOTIFICATION_SEND_ENABLED"))) {
    return new Response("Service unavailable", { status: 503 });
  }
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return new Response("Unsupported media type", { status: 415 });
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 4096)) {
    return new Response("Payload too large", { status: 413 });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 4096) return new Response("Payload too large", { status: 413 });
  const body = (() => {
    try { return JSON.parse(rawBody) as JsonRecord; }
    catch { return null; }
  })();
  if (!body) return new Response("Invalid JSON", { status: 400 });
  const requestedLimit = Number(body.batch_limit ?? 20);
  const batchLimit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 20, 1), 25);
  const client = adminClient();
  const { data, error } = await client.rpc("dawanear_claim_whatsapp_outbox", { p_limit: batchLimit });
  if (error) return Response.json({ error: "Could not claim WhatsApp delivery work." }, { status: 500 });

  const messages = (data ?? []) as OutboxMessage[];
  const results: Array<{ id: string; outcome: "sent" | "retry" }> = [];
  for (const message of messages) {
    try {
      const messageId = await sendTemplate(message);
      const { error: finishError } = await client.rpc("dawanear_finish_whatsapp_outbox", {
        p_id: message.id,
        p_succeeded: true,
        p_message_id: messageId,
        p_error_code: null,
      });
      if (finishError) throw finishError;
      results.push({ id: message.id, outcome: "sent" });
    } catch (sendError) {
      const errorCode = sendError instanceof Error ? sendError.message.slice(0, 120) : "UNKNOWN";
      const { error: finishError } = await client.rpc("dawanear_finish_whatsapp_outbox", {
        p_id: message.id,
        p_succeeded: false,
        p_message_id: null,
        p_error_code: errorCode,
      });
      if (finishError) {
        console.error(JSON.stringify({ event: "whatsapp_outbox_finish_failed", error_class: "database_error" }));
        return Response.json({ error: "Could not reconcile WhatsApp delivery work." }, { status: 500 });
      }
      results.push({ id: message.id, outcome: "retry" });
    }
  }
  return Response.json({
    claimed: messages.length,
    sent: results.filter((item) => item.outcome === "sent").length,
    retry: results.filter((item) => item.outcome === "retry").length,
  });
});
