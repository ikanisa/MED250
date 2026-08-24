import twilio from "twilio";
import { readBodyText } from "./bounded-body.ts";

const TWILIO_FORM_LIMIT_BYTES = 64 * 1024;
const MESSAGE_SID_PATTERN = /^(?:SM|MM)[0-9a-f]{32}$/i;
const ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
type ImageContentType = "image/jpeg" | "image/png" | "image/webp";
const IMAGE_CONTENT_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp"]);

function isImageContentType(value: string): value is ImageContentType {
  return IMAGE_CONTENT_TYPES.has(value);
}

export class TwilioWebhookError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TwilioWebhookError";
    this.status = status;
    this.code = code;
  }
}

type TwilioParameters = Record<string, string | string[]>;

export type TwilioInboundMessage = {
  accountSid: string;
  messageSid: string;
  fromE164: string;
  toE164: string;
  profileName: string | null;
  body: string;
  buttonPayload: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  label: string | null;
  media: null | {
    url: string;
    contentType: ImageContentType;
  };
  allParameters: TwilioParameters;
};

export type TwilioWebhookValidation = {
  authToken: string;
  expectedAccountSid: string;
  expectedToE164: string;
  canonicalUrl?: string;
};

export type TwilioStatusCallback = {
  accountSid: string;
  messageSid: string;
  providerStatus: "accepted" | "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "undelivered";
  errorCode: string | null;
  channelStatusMessage: string | null;
  eventType: string | null;
  allParameters: TwilioParameters;
};

function addParameter(target: TwilioParameters, key: string, value: string): void {
  const existing = target[key];
  if (existing === undefined) {
    target[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    target[key] = [existing, value];
  }
}

function normalizeE164(value: string, field: string): string {
  const digits = value.replace(/^whatsapp:/i, "").replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    throw new TwilioWebhookError(400, `invalid_${field}`, `Twilio ${field} is not a valid E.164 number.`);
  }
  return digits;
}

function required(parameters: URLSearchParams, name: string): string {
  const value = parameters.get(name)?.trim() ?? "";
  if (!value) throw new TwilioWebhookError(400, `missing_${name.toLowerCase()}`, `Twilio ${name} is required.`);
  return value;
}

function nullable(parameters: URLSearchParams, name: string): string | null {
  return parameters.get(name)?.trim() || null;
}

async function signedForm(
  request: Request,
  validation: Pick<TwilioWebhookValidation, "authToken" | "expectedAccountSid" | "canonicalUrl">,
): Promise<{ search: URLSearchParams; allParameters: TwilioParameters }> {
  if (request.method !== "POST") {
    throw new TwilioWebhookError(405, "method_not_allowed", "Twilio webhooks must use POST.");
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new TwilioWebhookError(415, "unsupported_content_type", "Twilio webhook must be form encoded.");
  }
  if (!ACCOUNT_SID_PATTERN.test(validation.expectedAccountSid)) {
    throw new Error("Configured Twilio Account SID is invalid.");
  }
  if (!validation.authToken) throw new Error("Configured Twilio Auth Token is missing.");

  const rawBody = await readBodyText(request, TWILIO_FORM_LIMIT_BYTES);
  const search = new URLSearchParams(rawBody);
  const allParameters: TwilioParameters = {};
  for (const [key, value] of search) addParameter(allParameters, key, value);

  const signature = request.headers.get("x-twilio-signature")?.trim() ?? "";
  const signatureUrl = validation.canonicalUrl ?? request.url;
  if (!signature || !twilio.validateRequest(validation.authToken, signature, signatureUrl, allParameters)) {
    throw new TwilioWebhookError(403, "invalid_signature", "Twilio signature validation failed.");
  }
  const accountSid = required(search, "AccountSid");
  if (accountSid !== validation.expectedAccountSid) {
    throw new TwilioWebhookError(403, "wrong_account", "Twilio webhook belongs to a different account.");
  }
  return { search, allParameters };
}

function coordinate(parameters: URLSearchParams, name: "Latitude" | "Longitude"): number | null {
  const value = nullable(parameters, name);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TwilioWebhookError(400, `invalid_${name.toLowerCase()}`, `Twilio ${name} is invalid.`);
  }
  const valid = name === "Latitude"
    ? parsed >= -3.0 && parsed <= -0.8
    : parsed >= 28.7 && parsed <= 30.9;
  if (!valid) {
    throw new TwilioWebhookError(400, `outside_rwanda_${name.toLowerCase()}`, `Twilio ${name} is outside Rwanda.`);
  }
  return parsed;
}

function validatedMedia(
  parameters: URLSearchParams,
  expectedAccountSid: string,
): TwilioInboundMessage["media"] {
  const rawCount = parameters.get("NumMedia")?.trim() || "0";
  if (!/^\d+$/.test(rawCount)) {
    throw new TwilioWebhookError(400, "invalid_media_count", "Twilio NumMedia is invalid.");
  }
  const count = Number(rawCount);
  if (count === 0) return null;
  if (count !== 1) {
    throw new TwilioWebhookError(400, "unsupported_media_count", "Send one medicine or prescription image per WhatsApp message.");
  }

  const contentType = required(parameters, "MediaContentType0").toLowerCase();
  if (!isImageContentType(contentType)) {
    throw new TwilioWebhookError(415, "unsupported_media_type", "Only JPEG, PNG or WebP images are accepted.");
  }
  const rawUrl = required(parameters, "MediaUrl0");
  let mediaUrl: URL;
  try {
    mediaUrl = new URL(rawUrl);
  } catch {
    throw new TwilioWebhookError(400, "invalid_media_url", "Twilio MediaUrl0 is invalid.");
  }
  if (
    mediaUrl.protocol !== "https:"
    || mediaUrl.hostname !== "api.twilio.com"
    || !mediaUrl.pathname.includes(`/Accounts/${expectedAccountSid}/Messages/`)
  ) {
    throw new TwilioWebhookError(400, "untrusted_media_url", "Twilio media URL is outside the configured account.");
  }

  return {
    url: mediaUrl.toString(),
    contentType,
  };
}

export async function parseTwilioInboundMessage(
  request: Request,
  validation: TwilioWebhookValidation,
): Promise<TwilioInboundMessage> {
  const { search, allParameters } = await signedForm(request, validation);
  const accountSid = validation.expectedAccountSid;
  const messageSid = required(search, "MessageSid");
  if (!MESSAGE_SID_PATTERN.test(messageSid)) {
    throw new TwilioWebhookError(400, "invalid_message_sid", "Twilio MessageSid is invalid.");
  }

  const fromE164 = normalizeE164(required(search, "From"), "from");
  const toE164 = normalizeE164(required(search, "To"), "to");
  if (toE164 !== normalizeE164(validation.expectedToE164, "configured_to")) {
    throw new TwilioWebhookError(403, "wrong_sender", "Twilio webhook targets a different WhatsApp sender.");
  }

  const latitude = coordinate(search, "Latitude");
  const longitude = coordinate(search, "Longitude");
  if ((latitude === null) !== (longitude === null)) {
    throw new TwilioWebhookError(400, "incomplete_location", "Twilio location requires latitude and longitude.");
  }

  return {
    accountSid,
    messageSid,
    fromE164,
    toE164,
    profileName: nullable(search, "ProfileName"),
    body: search.get("Body") ?? "",
    buttonPayload: nullable(search, "ButtonPayload"),
    latitude,
    longitude,
    address: nullable(search, "Address"),
    label: nullable(search, "Label"),
    media: validatedMedia(search, validation.expectedAccountSid),
    allParameters,
  };
}

export async function parseTwilioStatusCallback(
  request: Request,
  validation: TwilioWebhookValidation,
): Promise<TwilioStatusCallback> {
  const { search, allParameters } = await signedForm(request, validation);
  const messageSid = (search.get("MessageSid") ?? search.get("SmsSid") ?? "").trim();
  if (!MESSAGE_SID_PATTERN.test(messageSid)) {
    throw new TwilioWebhookError(400, "invalid_message_sid", "Twilio MessageSid is invalid.");
  }
  const from = nullable(search, "From");
  if (from && normalizeE164(from, "from") !== normalizeE164(validation.expectedToE164, "configured_from")) {
    throw new TwilioWebhookError(403, "wrong_sender", "Twilio callback belongs to a different WhatsApp sender.");
  }

  const eventType = nullable(search, "EventType")?.toUpperCase() ?? null;
  const rawStatus = (search.get("MessageStatus") ?? search.get("SmsStatus") ?? "").trim().toLowerCase();
  const providerStatus = eventType === "READ" ? "read" : rawStatus === "canceled" ? "failed" : rawStatus;
  if (![
    "accepted", "queued", "sending", "sent", "delivered", "read", "failed", "undelivered",
  ].includes(providerStatus)) {
    throw new TwilioWebhookError(400, "unsupported_message_status", "Twilio MessageStatus is unsupported.");
  }

  return {
    accountSid: validation.expectedAccountSid,
    messageSid: messageSid.toUpperCase(),
    providerStatus: providerStatus as TwilioStatusCallback["providerStatus"],
    errorCode: nullable(search, "ErrorCode"),
    channelStatusMessage: nullable(search, "ChannelStatusMessage"),
    eventType,
    allParameters,
  };
}
