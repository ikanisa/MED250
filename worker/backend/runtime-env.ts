const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const API_KEY_SID = /^SK[0-9a-f]{32}$/i;
const CONTENT_SID = /^HX[0-9a-f]{32}$/i;
const E164 = /^[1-9][0-9]{7,14}$/;

export class RuntimeConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
    this.code = code;
  }
}

function binding(env: Env, key: string): unknown {
  return Reflect.get(env, key);
}

function requiredString(env: Env, key: string): string {
  const value = binding(env, key);
  if (typeof value !== "string" || !value.trim()) {
    throw new RuntimeConfigurationError("missing_binding", `Required Worker binding ${key} is unavailable.`);
  }
  return value.trim();
}

function matchingString(env: Env, key: string, pattern: RegExp): string {
  const value = requiredString(env, key);
  if (!pattern.test(value)) {
    throw new RuntimeConfigurationError("invalid_binding", `Worker binding ${key} has an invalid format.`);
  }
  return value;
}

function minimumSecret(env: Env, key: string, length: number): string {
  const value = requiredString(env, key);
  if (value.length < length) {
    throw new RuntimeConfigurationError("invalid_secret", `Worker secret ${key} is invalid.`);
  }
  return value;
}

function e164Digits(value: string): string {
  const digits = value.replace(/^whatsapp:/i, "").replace(/\D/g, "");
  if (!E164.test(digits)) {
    throw new RuntimeConfigurationError("invalid_sender", "Configured WhatsApp sender is not a valid E.164 number.");
  }
  return digits;
}

function secureUrl(env: Env, key: string, expectedPath: string): string {
  const value = requiredString(env, key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RuntimeConfigurationError("invalid_url", `Worker binding ${key} is not a valid URL.`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
    || url.pathname !== expectedPath
  ) {
    throw new RuntimeConfigurationError("invalid_url", `Worker binding ${key} must be the canonical HTTPS ${expectedPath} URL.`);
  }
  return url.toString();
}

export function d1Database(env: Env): D1Database {
  const value = binding(env, "DB");
  if (
    typeof value !== "object"
    || value === null
    || typeof Reflect.get(value, "prepare") !== "function"
    || typeof Reflect.get(value, "batch") !== "function"
  ) {
    throw new RuntimeConfigurationError("missing_d1", "The Cloudflare D1 DB binding is unavailable.");
  }
  return value as D1Database;
}

export function healthProbeToken(env: Env): string {
  return minimumSecret(env, "MED250_HEALTH_PROBE_TOKEN", 32);
}

export function operatorAdminToken(env: Env): string {
  return minimumSecret(env, "MED250_ADMIN_TOKEN", 32);
}

export function googleMapsApiKey(env: Env): string | null {
  const value = binding(env, "GOOGLE_MAPS_API_KEY");
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length < 20) {
    throw new RuntimeConfigurationError("invalid_secret", "Worker secret GOOGLE_MAPS_API_KEY is invalid.");
  }
  return value.trim();
}

export type TwilioInboundRuntime = {
  accountSid: string;
  authToken: string;
  fromE164: string;
  inboundWebhookUrl: string;
  statusCallbackUrl: string;
};

export function twilioInboundRuntime(env: Env): TwilioInboundRuntime {
  return {
    accountSid: matchingString(env, "TWILIO_ACCOUNT_ID", ACCOUNT_SID),
    authToken: minimumSecret(env, "TWILIO_AUTH_TOKEN", 16),
    fromE164: e164Digits(requiredString(env, "TWILIO_WHATSAPP_FROM")),
    inboundWebhookUrl: secureUrl(env, "TWILIO_WHATSAPP_WEBHOOK_URL", "/api/twilio/whatsapp/inbound"),
    statusCallbackUrl: secureUrl(env, "TWILIO_WHATSAPP_STATUS_CALLBACK_URL", "/api/twilio/whatsapp/status"),
  };
}

export type TwilioSendRuntime = TwilioInboundRuntime & {
  apiKey: string;
  apiSecret: string;
  clientDispatchConfirmationContentSid: string;
  locationCaptureContentSid: string;
  locationChoiceContentSid: string;
  pharmacyClientMediaContentSid: string;
  pharmacyRequestContentSid: string;
  pharmacyOtpContentSid: string;
  customerOtpContentSid: string;
  otpEncryptionSecret: string;
};

export function twilioSendRuntime(env: Env): TwilioSendRuntime {
  return {
    ...twilioInboundRuntime(env),
    apiKey: matchingString(env, "TWILIO_API_KEY", API_KEY_SID),
    apiSecret: minimumSecret(env, "TWILIO_API_SECRET", 16),
    clientDispatchConfirmationContentSid: matchingString(env, "TWILIO_CLIENT_DISPATCH_CONFIRMATION_CONTENT_SID", CONTENT_SID),
    locationCaptureContentSid: matchingString(env, "TWILIO_CLIENT_LOCATION_CAPTURE_CONTENT_SID", CONTENT_SID),
    locationChoiceContentSid: matchingString(env, "TWILIO_CLIENT_LOCATION_CHOICE_CONTENT_SID", CONTENT_SID),
    pharmacyClientMediaContentSid: matchingString(env, "TWILIO_PHARMACY_CLIENT_MEDIA_REQUEST_CONTENT_SID", CONTENT_SID),
    pharmacyRequestContentSid: matchingString(env, "TWILIO_PHARMACY_REQUEST_CONTENT_SID", CONTENT_SID),
    pharmacyOtpContentSid: matchingString(env, "TWILIO_PHARMACY_OTP_CONTENT_SID", CONTENT_SID),
    customerOtpContentSid: matchingString(env, "TWILIO_CUSTOMER_OTP_CONTENT_SID", CONTENT_SID),
    otpEncryptionSecret: minimumSecret(env, "MED250_OTP_ENCRYPTION_SECRET", 32),
  };
}

export type WebAuthRuntime = {
  otpSecret: string;
  otpEncryptionSecret: string;
  turnstileSecretKey: string | null;
  allowedOrigins: ReadonlySet<string>;
  adminWhatsappE164: string;
  releaseMode: "preview" | "catalog" | "live";
};

function optionalString(env: Env, key: string): string | null {
  const value = binding(env, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function allowedOrigins(env: Env): ReadonlySet<string> {
  const configured = optionalString(env, "MED250_ALLOWED_ORIGINS");
  if (!configured) return new Set();
  const values = configured.split(",").map((value) => value.trim()).filter(Boolean);
  const normalized = new Set<string>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RuntimeConfigurationError("invalid_origin", "MED250_ALLOWED_ORIGINS contains an invalid URL.");
    }
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new RuntimeConfigurationError("invalid_origin", "MED250_ALLOWED_ORIGINS must contain HTTPS origins only.");
    }
    normalized.add(url.origin);
  }
  return normalized;
}

export function webAuthRuntime(env: Env): WebAuthRuntime {
  const releaseModeValue = optionalString(env, "MED250_RELEASE_MODE") ?? "preview";
  if (!["preview", "catalog", "live"].includes(releaseModeValue)) {
    throw new RuntimeConfigurationError("invalid_release_mode", "MED250_RELEASE_MODE is invalid.");
  }
  const turnstileSecretKey = optionalString(env, "TURNSTILE_SECRET_KEY");
  if (releaseModeValue === "live" && (!turnstileSecretKey || turnstileSecretKey.length < 16)) {
    throw new RuntimeConfigurationError("missing_turnstile", "Live web authentication requires TURNSTILE_SECRET_KEY.");
  }
  const configuredOrigins = allowedOrigins(env);
  if (releaseModeValue === "live" && configuredOrigins.size === 0) {
    throw new RuntimeConfigurationError("missing_origins", "Live web authentication requires MED250_ALLOWED_ORIGINS.");
  }
  return {
    otpSecret: minimumSecret(env, "MED250_OTP_SECRET", 32),
    otpEncryptionSecret: minimumSecret(env, "MED250_OTP_ENCRYPTION_SECRET", 32),
    turnstileSecretKey,
    allowedOrigins: configuredOrigins,
    adminWhatsappE164: e164Digits(optionalString(env, "MED250_ADMIN_WHATSAPP") ?? "250795588248"),
    releaseMode: releaseModeValue as WebAuthRuntime["releaseMode"],
  };
}

export function privateMediaBucket(env: Env): R2Bucket {
  const value = binding(env, "PRIVATE_MEDIA");
  if (typeof value !== "object" || value === null || typeof Reflect.get(value, "get") !== "function") {
    throw new RuntimeConfigurationError("missing_r2", "The PRIVATE_MEDIA R2 binding is unavailable.");
  }
  return value as R2Bucket;
}

export function dispatchQueue(env: Env): Queue {
  const value = binding(env, "DISPATCH_QUEUE");
  if (typeof value !== "object" || value === null || typeof Reflect.get(value, "send") !== "function") {
    throw new RuntimeConfigurationError("missing_queue", "The DISPATCH_QUEUE binding is unavailable.");
  }
  return value as Queue;
}
