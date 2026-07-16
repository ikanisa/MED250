import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "https://med250.gikundiro.com",
  "https://med250-rwanda.ikanisa.chatgpt.site",
];

export class HttpError extends Error {
  constructor(message: string, readonly status = 400, readonly retryAfter?: number) {
    super(message);
  }
}

function env(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new HttpError(`Missing server configuration: ${name}`, 500);
  return value;
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  throw new HttpError(`Missing server configuration: ${names.join(" or ")}`, 500);
}

function allowedOrigins(): Set<string> {
  const configured = env("MED250_ALLOWED_ORIGINS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...configured]);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (origin && !allowedOrigins().has(origin)) {
    throw new HttpError("This website is not allowed to request pharmacy access.", 403);
  }
  return {
    "Access-Control-Allow-Origin": origin || DEFAULT_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function json(request: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), ...extraHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(request: Request, error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 500;
  const publicMessage = error instanceof HttpError
    ? error.message
    : "Pharmacy WhatsApp verification is temporarily unavailable.";
  const retryAfter = error instanceof HttpError ? error.retryAfter : undefined;
  let headers: Record<string, string> = { "Vary": "Origin" };
  try {
    headers = corsHeaders(request);
  } catch {
    // A rejected origin must not receive an allow-origin header, and the error
    // response itself must not repeat the same origin validation exception.
  }
  return new Response(
    JSON.stringify({ error: publicMessage, ...(retryAfter ? { retryAfterSeconds: retryAfter } : {}) }),
    {
      status,
      headers: {
        ...headers,
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

export function adminClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function anonClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function normalizeRwandaPhone(value: unknown): string {
  if (typeof value !== "string") throw new HttpError("Enter a valid Rwanda WhatsApp number.");
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `250${digits.slice(1)}`;
  else if (digits.length === 9 && digits.startsWith("7")) digits = `250${digits}`;
  if (!/^2507[2389]\d{7}$/.test(digits)) throw new HttpError("Enter a valid Rwanda WhatsApp number.");
  return digits;
}

export function normalizeOtp(value: unknown): string {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (!/^\d{6}$/.test(digits)) throw new HttpError("Enter the complete 6-digit WhatsApp code.");
  return digits;
}

export function normalizeChallengeId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError("Request a new WhatsApp code.");
  }
  return id;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

function otpSecret(): string {
  return env("DAWANEAR_PHARMACY_OTP_SECRET") || requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export async function hashOtp(phone: string, code: string): Promise<string> {
  return sha256(`${phone}:pharmacy_login:${code}:${otpSecret()}`);
}

export async function requestSourceHash(request: Request): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || forwarded
    || "no-ip";
  return sha256(`${ip}:${otpSecret()}`);
}

export function generateOtp(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

async function countChallenges(
  client: SupabaseClient,
  since: string,
  filters: { phone?: string; sourceHash?: string } = {},
): Promise<number> {
  let query = client
    .from("dawanear_pharmacy_otp_challenges")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (filters.phone) query = query.eq("phone", filters.phone);
  if (filters.sourceHash) query = query.eq("source_hash", filters.sourceHash);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function enforceOtpRateLimits(client: SupabaseClient, phone: string, sourceHash: string): Promise<void> {
  const now = Date.now();
  const [phoneMinute, phoneHour, sourceFiveMinutes, sourceHour, globalMinute] = await Promise.all([
    countChallenges(client, new Date(now - 60_000).toISOString(), { phone }),
    countChallenges(client, new Date(now - 3_600_000).toISOString(), { phone }),
    countChallenges(client, new Date(now - 300_000).toISOString(), { sourceHash }),
    countChallenges(client, new Date(now - 3_600_000).toISOString(), { sourceHash }),
    countChallenges(client, new Date(now - 60_000).toISOString()),
  ]);
  if (phoneMinute >= 1) throw new HttpError("Please wait 60 seconds before requesting another code.", 429, 60);
  if (phoneHour >= 5) throw new HttpError("Too many codes requested for this number. Try again later.", 429, 900);
  if (sourceFiveMinutes >= 10 || sourceHour >= 30 || globalMinute >= 60) {
    throw new HttpError("Too many verification requests. Try again shortly.", 429, 300);
  }
}

export type EligiblePharmacy = { id: string; name: string };

export async function eligiblePharmacies(client: SupabaseClient, phone: string): Promise<EligiblePharmacy[]> {
  const { data: contacts, error: contactError } = await client
    .from("dawanear_pharmacy_contacts")
    .select("pharmacy_id")
    .eq("contact_type", "whatsapp")
    .eq("e164", phone)
    .eq("is_login_enabled", true)
    .in("verification_status", ["source_verified", "admin_verified"]);
  if (contactError) throw contactError;
  const pharmacyIds = [...new Set((contacts ?? []).map((contact) => contact.pharmacy_id as string).filter(Boolean))];
  if (!pharmacyIds.length) return [];

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await client
    .from("dawanear_pharmacies")
    .select("id, name")
    .in("id", pharmacyIds)
    .eq("is_active", true)
    .gte("license_expires_on", today);
  if (error) throw error;
  return (data ?? []) as EligiblePharmacy[];
}

export async function sendWhatsappOtp(phone: string, code: string): Promise<void> {
  const accessToken = firstEnv(
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_CLOUD_API_TOKEN",
    "WHATSAPP_CLOUD_ACCESS_TOKEN",
    "WABA_ACCESS_TOKEN",
  );
  const phoneNumberId = firstEnv(
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
    "WABA_PHONE_NUMBER_ID",
  );
  const templateName = firstEnv(
    "WHATSAPP_TEMPLATE_NAME",
    "WHATSAPP_CLOUD_OTP_TEMPLATE_NAME",
    "WABA_OTP_TEMPLATE_NAME",
  );
  const language = env("WHATSAPP_TEMPLATE_LANGUAGE") || env("WHATSAPP_CLOUD_TEMPLATE_LANGUAGE_CODE") || "en_US";
  const graphVersion = env("WHATSAPP_GRAPH_API_VERSION") || env("WHATSAPP_CLOUD_API_VERSION") || "v25.0";
  const buttonIndex = env("WHATSAPP_TEMPLATE_URL_BUTTON_INDEX") || "0";

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: buttonIndex, parameters: [{ type: "text", text: code }] },
        ],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("WhatsApp Cloud API rejected the pharmacy OTP", response.status, body.slice(0, 500));
    throw new HttpError("Could not deliver the WhatsApp code. Please try again.", 502);
  }
}

export async function internalEmailForPhone(phone: string): Promise<string> {
  const phoneHash = await sha256(`med250:${phone}`);
  return `pharmacy-${phoneHash.slice(0, 32)}@auth.med250.invalid`;
}
