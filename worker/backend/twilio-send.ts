import { readResponseText } from "./bounded-body.ts";
import type { TwilioSendRuntime } from "./runtime-env.ts";
import { decryptOtpCode } from "./secure-token.ts";
import type { OutboxDelivery } from "./whatsapp-repository.ts";

const MESSAGE_SID = /^(?:SM|MM)[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Pharmacy registry rows use stable governed keys such as
// `retail-rw-fda-123`, not UUIDs. Keep this stricter than an arbitrary string
// because the value is embedded in signed-inbound quick-reply payloads.
const PHARMACY_ID = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)$/i;

export class TwilioSendError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;

  constructor(code: string, message: string, options: { retryable: boolean; outcomeUnknown?: boolean }) {
    super(message);
    this.name = "TwilioSendError";
    this.code = code;
    this.retryable = options.retryable;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
  }
}

export type TwilioOutboundMessage =
  | { kind: "content"; toE164: string; contentSid: string; variables: Record<string, string> }
  | { kind: "text"; toE164: string; body: string };

function payloadString(payload: Record<string, unknown>, key: string): string {
  const found = payload[key];
  if (typeof found !== "string" || !found.trim()) throw new Error(`Outbox payload ${key} is invalid.`);
  return found.trim();
}

function payloadUuid(payload: Record<string, unknown>, key: string): string {
  const found = payloadString(payload, key);
  if (!UUID.test(found)) throw new Error(`Outbox payload ${key} is invalid.`);
  return found.toLowerCase();
}

function compact(value: string, maxLength: number): string {
  return value.replace(/[\r\n]+/g, "; ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function recipientCount(payload: Record<string, unknown>): number {
  const found = payload.recipient_count;
  const parsed = typeof found === "number" ? found : Number(found);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : 0;
}

function positiveInteger(payload: Record<string, unknown>, key: string, maximum: number): number {
  const found = payload[key];
  const parsed = typeof found === "number" ? found : Number(found);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Outbox payload ${key} is invalid.`);
  }
  return parsed;
}

function approximateDistance(distanceM: number | null): string {
  return distanceM !== null && distanceM >= 0
    ? `Approx. ${(distanceM / 1_000).toFixed(1)} km away`
    : "Nearby verified pharmacy assignment";
}

export async function composeOutboxMessage(
  delivery: OutboxDelivery,
  runtime: TwilioSendRuntime,
  mediaToken: string | null,
): Promise<TwilioOutboundMessage> {
  if (delivery.kind === "otp") {
    const challengeId = payloadUuid(delivery.payload, "challenge_id");
    const actorType = payloadString(delivery.payload, "actor_type");
    if (actorType !== "client" && actorType !== "pharmacy" && actorType !== "admin") {
      throw new Error("OTP actor type is invalid.");
    }
    const code = await decryptOtpCode(
      {
        ciphertext: payloadString(delivery.payload, "ciphertext"),
        nonce: payloadString(delivery.payload, "nonce"),
      },
      { challengeId, e164: delivery.recipientE164, actorType },
      runtime.otpEncryptionSecret,
    );
    return {
      kind: "content",
      toE164: delivery.recipientE164,
      contentSid: actorType === "client" ? runtime.customerOtpContentSid : runtime.pharmacyOtpContentSid,
      variables: { "1": code },
    };
  }

  if (delivery.kind === "web_catalogue_order") {
    if (!delivery.requestId || !delivery.pharmacyId || !delivery.customerE164) {
      throw new Error("Web catalogue delivery context is incomplete.");
    }
    const preference = payloadString(delivery.payload, "delivery_preference");
    if (!["pickup", "delivery", "either"].includes(preference)) {
      throw new Error("Web catalogue delivery preference is invalid.");
    }
    return {
      kind: "content",
      toE164: delivery.recipientE164,
      contentSid: runtime.pharmacyRequestContentSid,
      variables: {
        "1": compact(delivery.requestReference ?? "MED250 request", 80),
        "2": compact(payloadString(delivery.payload, "item_summary"), 900),
        "3": String(positiveInteger(delivery.payload, "total_units", 990)),
        "4": `+${delivery.customerE164}`,
        "5": approximateDistance(delivery.distanceM),
        "6": preference,
        "7": mediaToken ?? "sample",
        "8": `med250:can:${delivery.requestId}:${delivery.pharmacyId}`,
        "9": `med250:cannot:${delivery.requestId}:${delivery.pharmacyId}`,
      },
    };
  }

  if (delivery.kind === "location_capture") {
    payloadUuid(delivery.payload, "actor_id");
    const requestId = delivery.requestId ?? payloadUuid(delivery.payload, "request_id");
    if (!UUID.test(requestId)) throw new Error("Location capture request ID is invalid.");
    return {
      kind: "content",
      toE164: delivery.recipientE164,
      contentSid: runtime.locationCaptureContentSid,
      variables: {},
    };
  }

  if (delivery.kind === "location_choice") {
    const requestId = delivery.requestId ?? payloadUuid(delivery.payload, "request_id");
    const locationId = payloadUuid(delivery.payload, "location_id");
    if (!UUID.test(requestId)) throw new Error("Location choice request ID is invalid.");
    return {
      kind: "content",
      toE164: delivery.recipientE164,
      contentSid: runtime.locationChoiceContentSid,
      variables: {
        "1": `med250:loc:saved:${requestId}:${locationId}`,
        "2": `med250:loc:new:${requestId}`,
      },
    };
  }

  if (delivery.kind === "client_media_request") {
    if (
      !delivery.requestId
      || !delivery.pharmacyId
      || !delivery.customerE164
      || !delivery.r2Key
      || !mediaToken
      || !UUID.test(delivery.requestId)
      || delivery.pharmacyId.length > 64
      || !PHARMACY_ID.test(delivery.pharmacyId)
    ) throw new Error("Client-media delivery context is incomplete.");
    const imageIndex = Math.max(1, (delivery.mediaIndex ?? 0) + 1);
    const mediaCount = Math.max(imageIndex, delivery.mediaCount ?? imageIndex);
    return {
      kind: "content",
      toE164: delivery.recipientE164,
      contentSid: runtime.pharmacyClientMediaContentSid,
      variables: {
        "1": compact(delivery.requestReference ?? "MED250 WhatsApp request", 80),
        "2": `${imageIndex} of ${mediaCount}`,
        "3": `+${delivery.customerE164}`,
        "4": approximateDistance(delivery.distanceM),
        "5": mediaToken,
        "6": `med250:media:can:${delivery.requestId}:${delivery.pharmacyId}`,
        "7": `med250:media:cannot:${delivery.requestId}:${delivery.pharmacyId}`,
      },
    };
  }

  if (delivery.kind === "client_confirmation") {
    const count = recipientCount(delivery.payload);
    return count > 0
      ? {
          kind: "content",
          toE164: delivery.recipientE164,
          contentSid: runtime.clientDispatchConfirmationContentSid,
          variables: { "1": String(count) },
        }
      : {
          kind: "text",
          toE164: delivery.recipientE164,
          body: "Your location was saved. No verified pharmacy could be assigned yet, so your image was not shared. Please try again later.",
        };
  }

  if (delivery.kind === "client_guidance") {
    const guidance = typeof delivery.payload.guidance === "string" ? delivery.payload.guidance : "send_image";
    const body = guidance === "media_failed"
      ? "We could not securely save that file. Please send one clear JPG, PNG or WebP image of the medicine or prescription, maximum 16 MB."
      : guidance === "location_saved"
        ? "Your location was saved for your next request. Now send one clear image of the medicine or prescription you need—no WhatsApp catalogue or typed medicine list is required."
        : "Send one clear image of the medicine or prescription you need. MED+250 does not require a WhatsApp catalogue or typed medicine list. We will then ask for your delivery location.";
    return { kind: "text", toE164: delivery.recipientE164, body };
  }

  throw new TwilioSendError("unsupported_outbox_kind", "This outbox delivery kind is not implemented.", { retryable: false });
}

function errorCodeFromResponse(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const code: unknown = Reflect.get(parsed, "code");
      if (typeof code === "number" || typeof code === "string") return `twilio_${String(code).slice(0, 40)}`;
    }
  } catch {
    // The HTTP status remains a safe provider error code when no JSON receipt exists.
  }
  return `twilio_http_${status}`;
}

function transportFailureCode(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "twilio_transport_timeout";
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    if (message.includes("redirect")) return "twilio_transport_redirect";
    if (message.includes("network") || message.includes("fetch")) return "twilio_transport_network";
    return "twilio_transport_type_error";
  }
  return "twilio_transport_failure";
}

export async function sendTwilioMessage(
  message: TwilioOutboundMessage,
  runtime: TwilioSendRuntime,
  fetcher: typeof fetch = fetch,
): Promise<{ sid: string; status: string | null }> {
  const form = new URLSearchParams({
    To: `whatsapp:+${message.toE164}`,
    From: `whatsapp:+${runtime.fromE164}`,
    StatusCallback: runtime.statusCallbackUrl,
  });
  if (message.kind === "content") {
    form.set("ContentSid", message.contentSid);
    form.set("ContentVariables", JSON.stringify(message.variables));
  } else {
    form.set("Body", message.body);
  }

  const request = async (username: string, password: string): Promise<Response> => {
    try {
      return await fetcher(
        `https://api.twilio.com/2010-04-01/Accounts/${runtime.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${username}:${password}`)}`,
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            Accept: "application/json",
          },
          body: form,
          // Keep redirects observable as definitive HTTP responses. A rejected
          // redirect otherwise surfaces only as a TypeError and leaves provider
          // finality ambiguous even though Twilio did not accept the request.
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error) {
      throw new TwilioSendError(
        transportFailureCode(error),
        "Twilio send outcome is unknown after a transport failure.",
        { retryable: false, outcomeUnknown: true },
      );
    }
  };

  const responseBody = async (response: Response): Promise<string> => {
    try {
      return await readResponseText(response, 64 * 1024);
    } catch {
      throw new TwilioSendError(
        response.ok ? "twilio_acceptance_receipt_unreadable" : `twilio_http_${response.status}`,
        "Twilio returned an unreadable response.",
        {
          retryable: !response.ok && (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500),
          outcomeUnknown: response.ok,
        },
      );
    }
  };

  let response = await request(runtime.apiKey, runtime.apiSecret);
  let body = await responseBody(response);
  const primaryErrorCode = response.ok ? null : errorCodeFromResponse(response.status, body);
  if (
    !response.ok
    && (response.status === 401 || response.status === 403)
    && (primaryErrorCode === "twilio_70051" || primaryErrorCode === "twilio_20003")
  ) {
    // Authentication rejection is definitive: Twilio did not create a Message.
    // The already-installed Auth Token is therefore a safe one-shot fallback.
    response = await request(runtime.accountSid, runtime.authToken);
    body = await responseBody(response);
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    throw new TwilioSendError(
      errorCodeFromResponse(response.status, body),
      "Twilio rejected the outbound message.",
      { retryable },
    );
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) throw new Error("receipt_not_object");
    const sid: unknown = Reflect.get(parsed, "sid");
    const status: unknown = Reflect.get(parsed, "status");
    if (typeof sid !== "string" || !MESSAGE_SID.test(sid)) throw new Error("receipt_sid_invalid");
    return { sid: sid.toUpperCase(), status: typeof status === "string" ? status : null };
  } catch {
    throw new TwilioSendError(
      "twilio_acceptance_receipt_invalid",
      "Twilio returned an unusable acceptance receipt.",
      { retryable: false, outcomeUnknown: true },
    );
  }
}
