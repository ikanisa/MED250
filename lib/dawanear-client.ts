import type { Session, User } from "@supabase/supabase-js";

import { normalizeCatalogueText } from "./catalogue-search";
import {
  clearPharmacySession,
  customerSupabase,
  getPharmacySupabase,
  hasStoredPharmacySession,
  savePharmacySession,
  supabaseConfigured,
} from "./supabase";

const PRESCRIPTION_BUCKET = "dawanear-prescriptions";
const MAX_PRESCRIPTION_BYTES = 10 * 1024 * 1024;
const MAX_PAGE_SIZE = 1_000;
const MAX_BASKET_PRODUCT_IDS = 100;
const BASKET_PRODUCT_QUERY_SIZE = 50;

const PRESCRIPTION_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type JsonRecord = Record<string, unknown>;

export type Product = {
  id: string;
  brand: string;
  generic: string;
  strength: string;
  form: string;
  packSize: string;
  manufacturer: string;
  manufacturerCountry: string;
  registrationNumber: string;
  category: string;
  department?: string;
  subcategory?: string;
  productType: string;
  prescriptionStatus: string;
  regulatoryStatus: string;
  min: number;
  max: number;
  priceContributors: number;
  indicativePriceRwf: number;
  priceIsIndicative: boolean;
  indicativePriceBasis: string;
  indicativePriceSourceUrl: string | null;
  indicativePriceUpdatedAt: string | null;
  imageUrl: string | null;
  imageUrls?: string[];
  description?: string | null;
  descriptionSourceName?: string | null;
  descriptionSourceUrl?: string | null;
  isOrderable: boolean;
  accent?: string;
};

export type CartItem = Product & {
  quantity: number;
  customerMinRwf?: number | null;
  customerMaxRwf?: number | null;
  substitutesAllowed?: boolean;
};

export type CatalogueSearchInput = {
  query?: string;
  category?: string;
  prescriptionStatus?: string;
  formGroup?: string;
  availability?: string;
  sort?: "relevance" | "az" | "za" | "price";
  limit?: number;
  offset?: number;
};

export type CatalogueSearchResult = {
  products: Product[];
  total: number;
  explanations: Map<string, string>;
};

export type CatalogueTaxonomyRow = {
  department: string;
  subcategory: string | null;
  productCount: number;
};

export type CustomerProfile = {
  userId: string;
  whatsapp: string | null;
  whatsappVerifiedAt: string | null;
  preferredLanguage: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CustomerWhatsappOtpChallenge = {
  challengeId: string;
  expiresAt: string;
};

export type VerifiedCustomerWhatsapp = {
  phone: string;
  verifiedAt: string;
};

export type OfferItem = {
  id: string;
  orderItemId: string;
  offeredProductId: string | null;
  available: boolean;
  isSubstitute: boolean;
  unitPriceRwf: number | null;
  quantity: number | null;
  note: string | null;
  product: Product | null;
};

export type OrderOffer = {
  id: string;
  orderId: string;
  pharmacyId: string;
  status: string;
  complete: boolean;
  totalRwf: number;
  fulfilmentMethod: "pickup" | "delivery" | "either";
  readyInMinutes: number | null;
  note: string | null;
  createdAt: string;
  pharmacyName: string;
  distanceM: number;
  items: OfferItem[];
};

export type PharmacyMembership = {
  membershipId: string | null;
  pharmacyId: string;
  pharmacyName: string;
  licenseNumber: string;
  role: string;
  status: string;
  whatsapp: string | null;
  momoCode: string | null;
  address: string | null;
  googleMapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  onlineLicenseVerified: boolean;
};

export type PharmacyContact = {
  id: string;
  contactType: "phone" | "whatsapp";
  e164: string;
  displayNumber: string;
  isPrimary: boolean;
  isLoginEnabled: boolean;
  verificationStatus: string;
};

export type PharmacyContactEdit = {
  id: string;
  contactId: string | null;
  action: "add" | "update" | "remove";
  contactType: "phone" | "whatsapp";
  requestedE164: string | null;
  note: string | null;
  createdAt: string;
};

export type PharmacyContactState = {
  contacts: PharmacyContact[];
  pendingRequests: PharmacyContactEdit[];
};

export type PharmacyRequestItem = {
  orderItemId: string;
  productId: string;
  productName: string;
  brand: string;
  generic: string;
  strength: string;
  form: string;
  packSize: string;
  quantity: number;
  customerMinRwf: number | null;
  customerMaxRwf: number | null;
  substitutesAllowed: boolean;
};

export type PharmacyRequest = {
  orderId: string;
  reference: string;
  status: string;
  distanceM: number;
  createdAt: string;
  expiresAt: string;
  deliveryPreference: "pickup" | "delivery" | "either";
  substitutesAllowed: boolean;
  locationAccuracyM: number | null;
  hasPrescription: boolean;
  itemCount: number;
  items: PharmacyRequestItem[];
};

export type OfferItemDraft = {
  orderItemId: string;
  available: boolean;
  offeredProductId?: string | null;
  isSubstitute?: boolean;
  unitPriceRwf?: number | null;
  quantity?: number | null;
  note?: string | null;
};

export type OfferDraft = {
  pharmacyId: string;
  orderId: string;
  fulfilmentMethod: "pickup" | "delivery" | "either";
  readyInMinutes?: number | null;
  note?: string | null;
  items: OfferItemDraft[];
};

export type CreateOrderInput = {
  clientRequestId: string;
  latitude: number;
  longitude: number;
  locationAccuracyM?: number | null;
  whatsapp: string;
  deliveryPreference?: "pickup" | "delivery" | "either";
  substitutesAllowed?: boolean;
  prescriptionPath?: string | null;
  items: CreateOrderItem[];
};

export type CreateOrderItem = {
  productId: string;
  quantity: number;
  customerMinRwf?: number | null;
  customerMaxRwf?: number | null;
  substitutesAllowed?: boolean;
};

export type CreateOrderResult = {
  orderId: string;
  recipientCount: number;
};

export type CloseOrderResult = {
  orderId: string;
  status: "completed" | "cancelled";
  closedAt: string;
};

export type SubmitOfferResult = {
  offerId: string;
  totalRwf: number;
  complete: boolean;
};

export type CentralPriceContributionResult = {
  contributionId: string;
  productId: string;
  submittedPriceRwf: number;
  previousPriceRwf: number | null;
  centralPriceRwf: number;
  becameLowest: boolean;
  status: "initialized" | "lowered" | "not_lower";
};

export type PharmacyClaimInput = {
  pharmacyId: string;
  contactEmail: string;
  contactPhone?: string | null;
  note?: string | null;
};

export type PharmacyClaim = {
  id: string;
  pharmacyId: string;
  status: string;
  contactEmail: string;
  contactPhone: string | null;
  note: string | null;
  createdAt: string;
};

export type SelectedPharmacyContact = {
  orderId: string;
  offerId: string;
  pharmacyId: string;
  pharmacyName: string;
  whatsapp: string | null;
  momoCode: string | null;
};

export type ActiveOrder = {
  orderId: string;
  reference: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  deliveryPreference: "pickup" | "delivery" | "either";
  substitutesAllowed: boolean;
  recipientCount: number;
  offerCount: number;
  selectedOfferId: string | null;
};

export type PharmacySelectedOrder = {
  orderId: string;
  reference: string;
  customerWhatsapp: string | null;
  deliveryPreference: "pickup" | "delivery" | "either";
  prescriptionPath: string | null;
  prescriptionUrl: string | null;
  prescriptionAccessSecondsRemaining: number | null;
  selectedAt: string;
  updatedAt: string;
};

/** True when the shared project URL and publishable key are configured. */
export const backendConfigured = supabaseConfigured;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstValue(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return null;
}

function stringValue(record: JsonRecord, ...keys: string[]): string {
  const value = firstValue(record, ...keys);
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function catalogueText(record: JsonRecord, ...keys: string[]): string {
  const value = stringValue(record, ...keys);
  return !value || /^(?:—+|-+|n\/?a|null)$/i.test(value) ? "" : value;
}

function nullableString(record: JsonRecord, ...keys: string[]): string | null {
  const value = stringValue(record, ...keys);
  return value || null;
}

function stringArray(record: JsonRecord, ...keys: string[]): string[] {
  const value = firstValue(record, ...keys);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  } catch {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function numericValue(record: JsonRecord, ...keys: string[]): number | null {
  const value = firstValue(record, ...keys);
  if (value === "" || value == null) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(record: JsonRecord, fallback: boolean, ...keys: string[]): boolean {
  const value = firstValue(record, ...keys);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (["true", "t", "1", "yes"].includes(value.toLowerCase())) return true;
    if (["false", "f", "0", "no"].includes(value.toLowerCase())) return false;
  }
  return fallback;
}

function requiredString(record: JsonRecord, label: string, ...keys: string[]): string {
  const value = stringValue(record, ...keys);
  if (!value) throw new Error(`The backend returned a ${label} without its required identifier.`);
  return value;
}

function asRows(data: unknown): JsonRecord[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  return isRecord(data) ? [data] : [];
}

function parseJsonRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function cleanContext(context: string): string {
  return context.replace(/[.:\s]+$/, "");
}

/** Converts Supabase/PostgREST/Storage/Auth errors into concise, actionable UI errors. */
export function normalizeDawaNearError(error: unknown, context = "MED+250 order failed"): Error {
  if (error instanceof Error && error.name === "DawaNearError") return error;

  const record = isRecord(error) ? error : null;
  const rawMessage = error instanceof Error
    ? error.message
    : record
      ? stringValue(record, "message", "error_description", "details", "hint", "error")
      : typeof error === "string"
        ? error
        : "Unknown backend error";
  const code = record ? stringValue(record, "code", "statusCode", "status") : "";
  const lower = `${code} ${rawMessage}`.toLowerCase();

  let message = rawMessage || "Unknown backend error";
  if (/failed to fetch|fetcherror|networkerror|network request failed/.test(lower)) {
    message = "Could not reach MED250. Check your internet connection and try again.";
  } else if (/anonymous.*(disabled|not enabled)|anonymous_provider_disabled/.test(lower)) {
    message = "Guest checkout is not enabled yet. Enable Anonymous Sign-Ins in Supabase Auth.";
  } else if (/invalid login credentials|email not confirmed/.test(lower)) {
    message = "The pharmacy sign-in could not be verified. Send a new WhatsApp code and try again.";
  } else if (/rate.?limit|over_email_send_rate_limit|429/.test(lower)) {
    message = "Too many attempts were made. Wait a moment, then try again.";
  } else if (/jwt.*expired|refresh_token.*(invalid|not found)|session.*expired/.test(lower)) {
    message = "Your session expired. Sign in again, then retry this action.";
  } else if (/row-level security|violates row-level|permission denied|42501|unauthorized|403/.test(lower)) {
    message = "You do not have permission for this action. Check that you are signed in with the correct account.";
  } else if (/pgrst202|42883|function .* does not exist|could not find the function/.test(lower)) {
    message = "This marketplace action is not installed in the configured Supabase project. Apply the MED250 marketplace migration and retry.";
  } else if (/42p01|relation .* does not exist|could not find the table/.test(lower)) {
    message = "The MED250 database schema is missing from the configured Supabase project.";
  } else if (/23505|duplicate key|already exists/.test(lower)) {
    message = "That record already exists. Refresh the page before trying again.";
  } else if (/payload too large|file.*too large|413/.test(lower)) {
    message = "The prescription file is too large. Upload a file no larger than 10 MB.";
  }

  const normalized = new Error(`${cleanContext(context)}: ${message}`);
  normalized.name = "DawaNearError";
  return normalized;
}

export function readableDawaNearError(error: unknown): string {
  return normalizeDawaNearError(error).message;
}

function requireCustomerBackend() {
  if (!customerSupabase) {
    throw normalizeDawaNearError(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the site.",
      "MED250 customer backend is not configured",
    );
  }
  return customerSupabase;
}

function requirePharmacyBackend() {
  const pharmacySupabase = getPharmacySupabase();
  if (!pharmacySupabase) {
    throw normalizeDawaNearError(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the site.",
      "MED250 pharmacy backend is not configured",
    );
  }
  return pharmacySupabase;
}

function rethrow(context: string, error: unknown): never {
  throw normalizeDawaNearError(error, context);
}

function requireNonEmpty(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function requireInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function normalizeRwandaWhatsapp(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `250${digits.slice(1)}`;
  else if (digits.length === 9 && digits.startsWith("7")) digits = `250${digits}`;
  if (!/^2507[2389]\d{7}$/.test(digits)) {
    throw new Error("Enter a valid Rwanda mobile number, for example +250 788 123 456.");
  }
  return digits;
}

function normalizeCustomerWhatsapp(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new Error("Enter a valid international WhatsApp number including its country code.");
  }
  return digits;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid pharmacy email address.");
  }
  return email;
}

async function customerSession(context: string): Promise<Session | null> {
  const client = requireCustomerBackend();
  const { data, error } = await client.auth.getSession();
  if (error) rethrow(context, error);
  return data.session;
}

async function requirePermanentPharmacyUser(context: string): Promise<void> {
  if (!await hasStoredPharmacySession()) {
    throw new Error(`${context}: Sign in with your pharmacy WhatsApp number first.`);
  }
}

export async function hasAnonymousCustomerSession(): Promise<boolean> {
  const client = requireCustomerBackend();
  const { data, error } = await client.auth.getSession();
  if (error) rethrow("Could not restore your customer session", error);
  if (!data.session?.user) return false;
  if (data.session.user.is_anonymous !== true) {
    throw new Error("Customer session isolation failed: the customer auth store contains a permanent identity.");
  }
  return true;
}

export async function ensureAnonymousCustomer(captchaToken?: string): Promise<User> {
  const client = requireCustomerBackend();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) rethrow("Could not restore your customer session", sessionError);
  if (sessionData.session?.user) {
    if (sessionData.session.user.is_anonymous !== true) {
      throw new Error("Customer session isolation failed: the customer auth store contains a permanent identity.");
    }
    return sessionData.session.user;
  }

  const cleanedCaptchaToken = captchaToken?.trim() || "";
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !cleanedCaptchaToken) {
    throw new Error("Complete the security check before placing your order.");
  }
  const { data, error } = await client.auth.signInAnonymously(cleanedCaptchaToken
    ? { options: { captchaToken: cleanedCaptchaToken } }
    : undefined);
  if (error) rethrow("Could not start a private guest session", error);
  if (!data.session || !data.user) {
    throw new Error("Could not start a private guest session: Supabase returned no authenticated user.");
  }
  return data.user;
}

export async function hasPermanentPharmacySession(): Promise<boolean> {
  requirePharmacyBackend();
  return await hasStoredPharmacySession();
}

export async function loadCustomerProfile(): Promise<CustomerProfile | null> {
  const user = await ensureAnonymousCustomer();
  const client = requireCustomerBackend();
  const { data, error } = await client
    .from("dawanear_customer_profiles")
    .select("user_id,whatsapp,whatsapp_verified_at,preferred_language,created_at,updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) rethrow("Could not load your MED250 profile", error);
  if (!isRecord(data)) return null;
  return {
    userId: requiredString(data, "profile", "user_id"),
    whatsapp: nullableString(data, "whatsapp"),
    whatsappVerifiedAt: nullableString(data, "whatsapp_verified_at"),
    preferredLanguage: stringValue(data, "preferred_language") || "en",
    createdAt: nullableString(data, "created_at"),
    updatedAt: nullableString(data, "updated_at"),
  };
}

export async function requestCustomerWhatsappOtp(phone: string): Promise<CustomerWhatsappOtpChallenge> {
  const normalizedPhone = normalizeCustomerWhatsapp(phone);
  if (!normalizedPhone) throw new Error("Enter the WhatsApp number you want to verify.");
  await ensureAnonymousCustomer();
  const client = requireCustomerBackend();
  const { data, error } = await client.functions.invoke<CustomerWhatsappOtpChallenge & { error?: string }>(
    "dawanear-customer-send-otp",
    { body: { phone: normalizedPhone } },
  );
  if (error) rethrow("Could not send your WhatsApp verification code", error);
  if (data?.error) throw new Error(data.error);
  if (!data?.challengeId || !data.expiresAt) {
    throw new Error("Could not start WhatsApp verification. Please try again.");
  }
  return { challengeId: data.challengeId, expiresAt: data.expiresAt };
}

export async function verifyCustomerWhatsappOtp(
  phone: string,
  challengeId: string,
  token: string,
): Promise<VerifiedCustomerWhatsapp> {
  const normalizedPhone = normalizeCustomerWhatsapp(phone);
  if (!normalizedPhone) throw new Error("Enter the WhatsApp number you want to verify.");
  const cleanedToken = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanedToken)) throw new Error("Enter the complete 6-digit WhatsApp code.");
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new Error("Send a new WhatsApp code.");
  await ensureAnonymousCustomer();
  const client = requireCustomerBackend();
  const { data, error } = await client.functions.invoke<VerifiedCustomerWhatsapp & { error?: string }>(
    "dawanear-customer-verify-otp",
    { body: { phone: normalizedPhone, challengeId, code: cleanedToken } },
  );
  if (error) rethrow("Could not verify your WhatsApp code", error);
  if (data?.error) throw new Error(data.error);
  if (!data?.phone || !data.verifiedAt) {
    throw new Error("WhatsApp verification completed without a profile receipt. Please retry.");
  }
  return { phone: data.phone, verifiedAt: data.verifiedAt };
}

function pageSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Page size must be a whole number between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value;
}

async function loadAllRows(table: string, orderColumn: string, requestedPageSize: number): Promise<JsonRecord[]> {
  const client = requireCustomerBackend();
  const size = pageSize(requestedPageSize);
  const rows: JsonRecord[] = [];

  for (let from = 0; ; from += size) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) rethrow(`Could not load ${table.replaceAll("_", " ")}`, error);
    const page = asRows(data);
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

function mapProduct(row: JsonRecord): Product {
  const id = requiredString(row, "catalogue product", "id", "product_id");
  const registration = catalogueText(row, "registration_number");
  const generic = catalogueText(row, "generic", "generic_name");
  const brand = catalogueText(row, "brand", "brand_name") || generic || registration || id;
  const prescriptionStatus = stringValue(row, "prescription_status")
    || (booleanValue(row, false, "prescription_required") ? "prescription" : "unclassified");
  const regulatoryStatus = stringValue(row, "regulatory_status") || "unclassified";
  const rawIndicative = numericValue(row, "indicative_price_rwf", "min", "price_min_rwf");
  const indicativePriceRwf = Math.max(0, Math.round(rawIndicative ?? 0));
  const min = indicativePriceRwf;
  const max = indicativePriceRwf;
  const defaultOrderable = !["expired", "withdrawn", "suspended"].includes(regulatoryStatus.toLowerCase());

  return {
    id,
    brand,
    generic,
    strength: catalogueText(row, "strength"),
    form: catalogueText(row, "form", "dosage_form"),
    packSize: catalogueText(row, "pack_size", "packSize"),
    manufacturer: catalogueText(row, "manufacturer"),
    manufacturerCountry: catalogueText(row, "manufacturer_country", "manufacturerCountry"),
    registrationNumber: registration,
    // Categories and subcategories are source-backed catalogue fields. Never
    // infer a medicine taxonomy from its name, ingredient, or dosage form.
    category: stringValue(row, "category") || "Medicines",
    department: stringValue(row, "department") || undefined,
    subcategory: stringValue(row, "subcategory") || undefined,
    productType: stringValue(row, "product_type", "productType") || "medicine",
    prescriptionStatus,
    regulatoryStatus,
    min,
    max,
    priceContributors: 0,
    indicativePriceRwf,
    priceIsIndicative: booleanValue(row, indicativePriceRwf > 0, "price_is_indicative", "priceIsIndicative"),
    indicativePriceBasis: stringValue(row, "indicative_price_basis", "indicativePriceBasis"),
    indicativePriceSourceUrl: nullableString(row, "indicative_price_source_url", "indicativePriceSourceUrl"),
    indicativePriceUpdatedAt: nullableString(row, "indicative_price_updated_at", "indicativePriceUpdatedAt"),
    imageUrl: nullableString(row, "image_url", "imageUrl"),
    imageUrls: stringArray(row, "image_urls", "imageUrls"),
    description: nullableString(row, "description"),
    descriptionSourceName: nullableString(row, "description_source_name", "descriptionSourceName"),
    descriptionSourceUrl: nullableString(row, "description_source_url", "descriptionSourceUrl"),
    isOrderable: booleanValue(row, defaultOrderable, "is_orderable", "isOrderable"),
  };
}

export async function loadCatalogueTaxonomy(): Promise<CatalogueTaxonomyRow[]> {
  const client = requireCustomerBackend();
  const { data, error } = await client
    .from("dawanear_catalogue_taxonomy")
    .select("department, subcategory, product_count")
    .order("department", { ascending: true })
    .order("subcategory", { ascending: true, nullsFirst: true });
  if (error) rethrow("Could not load catalogue categories", error);
  return asRows(data)
    .map((row) => ({
      department: stringValue(row, "department"),
      subcategory: nullableString(row, "subcategory"),
      productCount: Math.max(0, Math.round(numericValue(row, "product_count") ?? 0)),
    }))
    .filter((row) => row.department && row.productCount > 0);
}

export async function loadCatalogue(requestedPageSize = MAX_PAGE_SIZE): Promise<Product[]> {
  const rows = await loadAllRows("dawanear_all_product_catalog", "brand_name", requestedPageSize);
  return rows.map(mapProduct);
}

/**
 * Refreshes persisted basket snapshots from the current public catalogue.
 * Basket state intentionally stores enough product data to work offline, but
 * older snapshots can predate newly published names, prices, or images.
 */
export async function loadCatalogueProductsByIds(productIds: string[]): Promise<Product[]> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length > MAX_BASKET_PRODUCT_IDS) {
    throw new Error(`A basket can refresh no more than ${MAX_BASKET_PRODUCT_IDS} products at once.`);
  }

  const client = requireCustomerBackend();
  const rows: JsonRecord[] = [];
  for (let index = 0; index < ids.length; index += BASKET_PRODUCT_QUERY_SIZE) {
    const { data, error } = await client
      .from("dawanear_all_product_catalog")
      .select("*")
      .in("id", ids.slice(index, index + BASKET_PRODUCT_QUERY_SIZE));
    if (error) rethrow("Could not refresh basket products", error);
    rows.push(...asRows(data));
  }
  return rows.map(mapProduct);
}

/**
 * Runs the public, server-ranked catalogue query used by the live storefront.
 * It returns central catalogue information and indicative prices. It never
 * returns pharmacy-specific price lists, pharmacy stock, or pharmacy identity.
 */
export async function searchCatalogue(input: CatalogueSearchInput = {}): Promise<CatalogueSearchResult> {
  const limit = input.limit ?? 24;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 120) {
    throw new Error("Catalogue search limit must be between 1 and 120.");
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
    throw new Error("Catalogue search offset must be between 0 and 10,000.");
  }
  const rawQuery = input.query?.trim() ?? "";
  if (rawQuery.length > 160) throw new Error("Catalogue search must be no longer than 160 characters.");
  // The server search intentionally uses the `simple` text-search dictionary.
  // Normalising here keeps French accents and equivalent Unicode forms aligned
  // with its multilingual alias vocabulary without weakening exact product
  // and ingredient matching.
  const query = normalizeCatalogueText(rawQuery);

  const client = requireCustomerBackend();
  const { data, error } = await client.rpc("dawanear_search_marketplace_catalogue", {
    p_query: query,
    p_category: input.category ?? "All products",
    p_prescription_status: input.prescriptionStatus ?? "all",
    p_form_group: input.formGroup ?? "all",
    p_availability: input.availability ?? "all",
    p_sort: input.sort ?? "relevance",
    p_limit: limit,
    p_offset: offset,
  });
  if (error) rethrow("Could not search the MED250 catalogue", error);
  const rows = asRows(data);
  const explanations = new Map<string, string>();
  const products = rows.map((row) => {
    const product = mapProduct(row);
    const explanation = stringValue(row, "match_explanation");
    if (explanation) explanations.set(product.id, explanation);
    return product;
  });
  const total = rows.length ? Math.max(0, Math.round(numericValue(rows[0], "total_count") ?? products.length)) : 0;
  return { products, total, explanations };
}

export async function uploadPrescription(file: File): Promise<string> {
  if (!file || typeof file.name !== "string" || typeof file.size !== "number" || typeof file.type !== "string") {
    throw new Error("Choose a prescription PDF or image before uploading.");
  }
  if (file.size < 1) throw new Error("The selected prescription file is empty.");
  if (file.size > MAX_PRESCRIPTION_BYTES) {
    throw new Error("The prescription file is too large. Upload a file no larger than 10 MB.");
  }
  const contentType = file.type.toLowerCase().split(";")[0].trim();
  const extension = PRESCRIPTION_TYPES[contentType];
  if (!extension) {
    throw new Error("Unsupported prescription file. Upload a PDF, JPG, PNG, or WebP image.");
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signatureMatches = contentType === "application/pdf"
    ? header.length >= 5 && String.fromCharCode(...header.slice(0, 5)) === "%PDF-"
    : contentType === "image/jpeg"
      ? header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      : contentType === "image/png"
        ? header.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => header[index] === byte)
        : contentType === "image/webp"
          ? header.length >= 12
            && String.fromCharCode(...header.slice(0, 4)) === "RIFF"
            && String.fromCharCode(...header.slice(8, 12)) === "WEBP"
          : false;
  if (!signatureMatches) {
    throw new Error("The prescription file content does not match its PDF or image type.");
  }

  const user = await ensureAnonymousCustomer();
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Secure file naming is unavailable in this browser. Update your browser and try again.");
  }
  const path = `${user.id}/${globalThis.crypto.randomUUID()}.${extension}`;
  const client = requireCustomerBackend();
  const { data, error } = await client.storage.from(PRESCRIPTION_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType,
    upsert: false,
  });
  if (error) rethrow("Could not upload the prescription", error);
  if (!data?.path) throw new Error("Could not upload the prescription: Supabase returned no private file path.");
  return data.path;
}

/** Removes a newly uploaded prescription that was not attached to a matched order. */
export async function deletePrescription(path: string): Promise<void> {
  const cleanedPath = requireNonEmpty(path, "Prescription path");
  const user = await ensureAnonymousCustomer();
  if (!cleanedPath.startsWith(`${user.id}/`)) {
    throw new Error("The prescription can only be removed from the customer session that uploaded it.");
  }
  const client = requireCustomerBackend();
  const { error } = await client.storage.from(PRESCRIPTION_BUCKET).remove([cleanedPath]);
  if (error) rethrow("Could not remove the unused prescription upload", error);
}

function orderItemsPayload(items: CreateOrderItem[], defaultSubstitutesAllowed: boolean): JsonRecord[] {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Add at least one product before sending your order.");
  const seen = new Set<string>();
  return items.map((item, index) => {
    const productId = requireNonEmpty(item.productId, `Product ${index + 1}`);
    if (seen.has(productId)) throw new Error(`Product ${productId} appears more than once in the order.`);
    seen.add(productId);
    const quantity = requireInteger(item.quantity, `Product ${index + 1} quantity`, 1, 99);
    const min = item.customerMinRwf ?? null;
    const max = item.customerMaxRwf ?? null;
    if (min != null && (!Number.isInteger(min) || min < 0)) throw new Error(`Product ${index + 1} minimum price must be a positive whole RWF amount.`);
    if (max != null && (!Number.isInteger(max) || max < 0)) throw new Error(`Product ${index + 1} maximum price must be a positive whole RWF amount.`);
    if (min != null && max != null && min > max) throw new Error(`Product ${index + 1} minimum price cannot exceed its maximum price.`);
    return {
      product_id: productId,
      quantity,
      customer_min_rwf: min,
      customer_max_rwf: max,
      substitutes_allowed: item.substitutesAllowed ?? defaultSubstitutesAllowed,
    };
  });
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const clientRequestId = requireNonEmpty(input.clientRequestId, "Client order ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestId)) {
    throw new Error("Client order ID must be a valid UUID.");
  }
  if (!Number.isFinite(input.latitude) || input.latitude < -3 || input.latitude > -0.8) {
    throw new Error("The shared latitude is outside MED250's Rwanda service area.");
  }
  if (!Number.isFinite(input.longitude) || input.longitude < 28.7 || input.longitude > 30.9) {
    throw new Error("The shared longitude is outside MED250's Rwanda service area.");
  }
  const accuracy = input.locationAccuracyM ?? null;
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 5_000) {
    throw new Error("Location accuracy must be between 1 and 5,000 metres.");
  }
  const deliveryPreference = input.deliveryPreference ?? "either";
  if (!["pickup", "delivery", "either"].includes(deliveryPreference)) {
    throw new Error("Delivery preference must be pickup, delivery, or either.");
  }
  const substitutesAllowed = input.substitutesAllowed
    ?? input.items.some((item) => item.substitutesAllowed === true);
  const items = orderItemsPayload(input.items, substitutesAllowed);
  const whatsapp = normalizeCustomerWhatsapp(input.whatsapp);
  if (!whatsapp) throw new Error("WhatsApp number is required.");
  const user = await ensureAnonymousCustomer();
  const prescriptionPath = input.prescriptionPath?.trim() || null;
  if (prescriptionPath && !prescriptionPath.startsWith(`${user.id}/`)) {
    throw new Error("The prescription must be uploaded from the current customer session.");
  }

  const client = requireCustomerBackend();
  const { data, error } = await client.rpc("dawanear_create_order", {
    p_client_request_id: clientRequestId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_location_accuracy_m: accuracy,
    p_whatsapp: whatsapp,
    p_delivery_preference: deliveryPreference,
    p_substitutes_allowed: substitutesAllowed,
    p_prescription_path: prescriptionPath,
    p_items: items,
  });
  if (error) rethrow("Could not send your order to verified pharmacies", error);
  const row = asRows(data)[0];
  if (!row) throw new Error("Could not create the order: the backend returned no order receipt.");
  const recipientCount = numericValue(row, "recipient_count");
  if (recipientCount == null || recipientCount < 0) {
    throw new Error("Could not create the order: the backend returned an invalid pharmacy recipient count.");
  }
  return {
    orderId: requiredString(row, "created order", "order_id"),
    recipientCount: Math.round(recipientCount),
  };
}

/** Closes a customer-owned request after off-platform completion or cancellation. */
export async function closeOrder(orderId: string, outcome: "completed" | "cancelled"): Promise<CloseOrderResult> {
  await ensureAnonymousCustomer();
  if (outcome !== "completed" && outcome !== "cancelled") {
    throw new Error("Order outcome must be completed or cancelled.");
  }
  const client = requireCustomerBackend();
  const { data, error } = await client.rpc("dawanear_close_order", {
    p_order_id: requireNonEmpty(orderId, "Order ID"),
    p_outcome: outcome,
  });
  if (error) rethrow(`Could not mark the order ${outcome}`, error);
  const row = asRows(data)[0];
  if (!row) throw new Error("Could not close the order: the backend returned no receipt.");
  const status = stringValue(row, "status");
  if (status !== "completed" && status !== "cancelled") {
    throw new Error("Could not close the order: the backend returned an invalid status.");
  }
  return {
    orderId: requiredString(row, "closed order", "order_id"),
    status,
    closedAt: requiredString(row, "closed order", "closed_at"),
  };
}

function mapActiveOrder(row: JsonRecord): ActiveOrder {
  const preference = stringValue(row, "delivery_preference");
  const confirmedOffers = parseJsonRows(firstValue(row, "offers")).filter((offer) => (
    booleanValue(offer, false, "complete")
    && ["submitted", "selected"].includes(stringValue(offer, "status"))
  ));
  return {
    orderId: requiredString(row, "active order", "order_id"),
    reference: stringValue(row, "reference") || requiredString(row, "active order", "order_id"),
    status: stringValue(row, "status") || "broadcast",
    createdAt: requiredString(row, "active order", "created_at"),
    expiresAt: requiredString(row, "active order", "expires_at"),
    updatedAt: requiredString(row, "active order", "updated_at"),
    deliveryPreference: preference === "pickup" || preference === "delivery" ? preference : "either",
    substitutesAllowed: booleanValue(row, false, "substitutes_allowed"),
    recipientCount: Math.max(0, Math.round(numericValue(row, "recipient_count") ?? 0)),
    offerCount: confirmedOffers.length,
    selectedOfferId: nullableString(row, "selected_offer_id"),
  };
}

/** Restores the current customer's unexpired request state after a reload. */
export async function loadMyActiveOrders(): Promise<ActiveOrder[]> {
  await ensureAnonymousCustomer();
  const client = requireCustomerBackend();
  const { data, error } = await client.rpc("dawanear_my_active_orders");
  if (error) rethrow("Could not restore your active orders", error);
  return asRows(data)
    .map(mapActiveOrder)
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function mapOfferItem(row: JsonRecord, products: Map<string, Product>): OfferItem {
  const offeredProductId = nullableString(row, "offered_product_id");
  return {
    id: requiredString(row, "offer item", "id"),
    orderItemId: requiredString(row, "offer item", "order_item_id"),
    offeredProductId,
    available: booleanValue(row, false, "available"),
    isSubstitute: booleanValue(row, false, "is_substitute"),
    unitPriceRwf: numericValue(row, "unit_price_rwf"),
    quantity: numericValue(row, "quantity"),
    note: nullableString(row, "note"),
    product: offeredProductId ? products.get(offeredProductId) ?? null : null,
  };
}

export async function loadOffers(orderId: string): Promise<OrderOffer[]> {
  const cleanedOrderId = requireNonEmpty(orderId, "Order ID");
  const session = await customerSession("Could not load pharmacy offers");
  if (!session) throw new Error("Could not load pharmacy offers: your customer session is unavailable.");
  const client = requireCustomerBackend();
  const { data, error } = await client.rpc("dawanear_my_confirmed_offers", {
    p_order_id: cleanedOrderId,
  });
  if (error) rethrow("Could not load confirmed pharmacies", error);

  return asRows(data).map((row) => {
    const id = requiredString(row, "confirmed offer", "offer_id", "id");
    const pharmacyId = requiredString(row, "offer", "pharmacy_id");
    const totalRwf = numericValue(row, "total_rwf");
    if (totalRwf == null || totalRwf < 0) throw new Error(`Offer ${id} has an invalid total.`);
    const fulfilmentMethod = stringValue(row, "fulfilment_method");
    if (!["pickup", "delivery", "either"].includes(fulfilmentMethod)) {
      throw new Error(`Offer ${id} has an invalid fulfilment method.`);
    }
    const itemRows = parseJsonRows(firstValue(row, "items"));
    const products = new Map<string, Product>();
    for (const itemRow of itemRows) {
      const productId = nullableString(itemRow, "offered_product_id");
      if (!productId) continue;
      products.set(productId, mapProduct({
        ...itemRow,
        id: productId,
        price_min_rwf: 0,
        price_max_rwf: 0,
        price_contributors: 0,
      }));
    }
    return {
      id,
      orderId: requiredString(row, "offer", "order_id"),
      pharmacyId,
      status: stringValue(row, "status") || "submitted",
      complete: true,
      totalRwf: Math.round(totalRwf),
      fulfilmentMethod: fulfilmentMethod as "pickup" | "delivery" | "either",
      readyInMinutes: numericValue(row, "ready_in_minutes"),
      note: nullableString(row, "note"),
      createdAt: requiredString(row, "offer", "created_at"),
      pharmacyName: stringValue(row, "pharmacy_name") || pharmacyId,
      distanceM: numericValue(row, "distance_m") ?? 0,
      items: itemRows.map((itemRow) => mapOfferItem(itemRow, products)),
    };
  }).toSorted((a, b) => Number(a.distanceM < 0) - Number(b.distanceM < 0) || a.distanceM - b.distanceM || a.pharmacyName.localeCompare(b.pharmacyName));
}

export async function selectOffer(orderId: string, offerId: string): Promise<SelectedPharmacyContact> {
  const client = requireCustomerBackend();
  const cleanedOrderId = requireNonEmpty(orderId, "Order ID");
  const { data, error } = await client.rpc("dawanear_select_offer", {
    p_order_id: cleanedOrderId,
    p_offer_id: requireNonEmpty(offerId, "Offer ID"),
  });
  if (error) rethrow("Could not select this pharmacy offer", error);
  if (asRows(data).length === 0) {
    throw new Error("Could not select this pharmacy offer: the backend returned no selection receipt.");
  }
  return loadSelectedContact(cleanedOrderId);
}

export async function loadSelectedContact(orderId: string): Promise<SelectedPharmacyContact> {
  const client = requireCustomerBackend();
  const { data, error } = await client.rpc("dawanear_selected_contact", {
    p_order_id: requireNonEmpty(orderId, "Order ID"),
  });
  if (error) rethrow("Could not load the selected pharmacy contact", error);
  const row = asRows(data)[0];
  if (!row) throw new Error("No pharmacy contact is available until an offer has been selected.");
  const pharmacyId = requiredString(row, "selected pharmacy", "pharmacy_id");
  return {
    orderId: requiredString(row, "selected order", "order_id"),
    offerId: requiredString(row, "selected offer", "offer_id"),
    pharmacyId,
    pharmacyName: stringValue(row, "pharmacy_name", "name") || pharmacyId,
    whatsapp: nullableString(row, "whatsapp"),
    momoCode: nullableString(row, "momo_code"),
  };
}

let offerSubscriptionSequence = 0;

export function subscribeToOffers(
  orderId: string,
  onOffers: (offers: OrderOffer[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const cleanedOrderId = requireNonEmpty(orderId, "Order ID");
  const client = requireCustomerBackend();
  let closed = false;
  let refreshSequence = 0;

  const refresh = () => {
    const sequence = ++refreshSequence;
    void loadOffers(cleanedOrderId)
      .then((offers) => {
        if (!closed && sequence === refreshSequence) onOffers(offers);
      })
      .catch((error: unknown) => {
        if (!closed) onError?.(normalizeDawaNearError(error, "Could not refresh pharmacy offers"));
      });
  };

  const channel = client
    .channel(`dawanear-offers-${cleanedOrderId}-${++offerSubscriptionSequence}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "dawanear_offers",
        filter: `order_id=eq.${cleanedOrderId}`,
      },
      refresh,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
      if (!closed && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
        onError?.(new Error("Live pharmacy offers disconnected. Check your connection and refresh."));
      }
    });

  return () => {
    closed = true;
    refreshSequence += 1;
    void client.removeChannel(channel);
  };
}

export type PharmacyWhatsappOtpChallenge = {
  registered: true;
  challengeId: string;
  expiresAt: string;
};

export type PharmacyWhatsappNotRegistered = {
  registered: false;
  adminWhatsapp: string;
};

type PharmacyWhatsappOtpSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  error?: string;
};

export async function requestPharmacyWhatsappOtp(phone: string): Promise<PharmacyWhatsappOtpChallenge | PharmacyWhatsappNotRegistered> {
  const client = requirePharmacyBackend();
  const normalizedPhone = normalizeRwandaWhatsapp(phone);
  if (!normalizedPhone) throw new Error("Enter the pharmacy WhatsApp number.");
  const { data, error } = await client.functions.invoke<(PharmacyWhatsappOtpChallenge | PharmacyWhatsappNotRegistered) & { error?: string }>(
    "dawanear-pharmacy-send-otp",
    { body: { phone: normalizedPhone } },
  );
  if (error) rethrow("Could not send the pharmacy WhatsApp code", error);
  if (data?.error) throw new Error(data.error);
  if (data?.registered === false) {
    return { registered: false, adminWhatsapp: data.adminWhatsapp || "250795588248" };
  }
  if (!data?.challengeId || !data.expiresAt) {
    throw new Error("Could not start WhatsApp verification. Please try again.");
  }
  return { registered: true, challengeId: data.challengeId, expiresAt: data.expiresAt };
}

/** Ends the permanent pharmacy session. A later customer order starts a fresh guest session. */
export async function signOutPharmacy(): Promise<void> {
  requirePharmacyBackend();
  clearPharmacySession();
}

export async function verifyPharmacyWhatsappOtp(phone: string, challengeId: string, token: string): Promise<void> {
  const client = requirePharmacyBackend();
  const cleanedToken = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanedToken)) throw new Error("Enter the complete 6-digit WhatsApp code.");
  const normalizedPhone = normalizeRwandaWhatsapp(phone);
  if (!normalizedPhone) throw new Error("Enter the pharmacy WhatsApp number.");
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new Error("Send a new WhatsApp code.");

  const { data, error } = await client.functions.invoke<PharmacyWhatsappOtpSession>(
    "dawanear-pharmacy-verify-otp",
    { body: { phone: normalizedPhone, challengeId, code: cleanedToken } },
  );
  if (error) rethrow("Could not verify the pharmacy WhatsApp code", error);
  if (data?.error) throw new Error(data.error);
  if (!data?.accessToken || !data.refreshToken) {
    throw new Error("Could not verify the pharmacy WhatsApp code: no permanent session was returned.");
  }

  savePharmacySession(data.accessToken, data.refreshToken, data.expiresAt);
}

function mapMembership(row: JsonRecord): PharmacyMembership {
  const pharmacyId = requiredString(row, "pharmacy membership", "pharmacy_id");
  return {
    membershipId: nullableString(row, "membership_id", "id"),
    pharmacyId,
    pharmacyName: stringValue(row, "pharmacy_name", "name") || pharmacyId,
    licenseNumber: stringValue(row, "license_number"),
    role: stringValue(row, "role") || "staff",
    status: stringValue(row, "status", "membership_status") || "active",
    whatsapp: nullableString(row, "whatsapp"),
    momoCode: nullableString(row, "momo_code"),
    address: nullableString(row, "address"),
    googleMapsUrl: nullableString(row, "google_maps_url"),
    latitude: numericValue(row, "latitude"),
    longitude: numericValue(row, "longitude"),
    onlineLicenseVerified: booleanValue(row, false, "online_license_verified", "onlineLicenseVerified"),
  };
}

export async function loadMyPharmacies(): Promise<PharmacyMembership[]> {
  await requirePermanentPharmacyUser("Could not load your pharmacies");
  const client = requirePharmacyBackend();
  const { data, error } = await client.rpc("dawanear_my_pharmacies");
  if (error) rethrow("Could not load your pharmacies", error);
  return asRows(data).map(mapMembership);
}

export async function loadMyPharmacyContacts(pharmacyId: string): Promise<PharmacyContactState> {
  await requirePermanentPharmacyUser("Could not load pharmacy contacts");
  const client = requirePharmacyBackend();
  const { data, error } = await client.rpc("dawanear_my_pharmacy_contacts", {
    p_pharmacy_id: requireNonEmpty(pharmacyId, "Pharmacy ID"),
  });
  if (error) rethrow("Could not load pharmacy contacts", error);
  if (!isRecord(data)) throw new Error("Could not load pharmacy contacts: the backend returned no contact state.");
  const contacts = asRows(data.contacts).map((row): PharmacyContact => {
    const contactType = stringValue(row, "contact_type");
    if (contactType !== "phone" && contactType !== "whatsapp") throw new Error("The backend returned an invalid pharmacy contact type.");
    return {
      id: requiredString(row, "pharmacy contact", "id"),
      contactType,
      e164: requiredString(row, "pharmacy contact", "e164"),
      displayNumber: stringValue(row, "display_number") || `+${requiredString(row, "pharmacy contact", "e164")}`,
      isPrimary: booleanValue(row, false, "is_primary"),
      isLoginEnabled: booleanValue(row, false, "is_login_enabled"),
      verificationStatus: stringValue(row, "verification_status"),
    };
  });
  const pendingRequests = asRows(data.pending_requests).map((row): PharmacyContactEdit => {
    const action = stringValue(row, "requested_action");
    const contactType = stringValue(row, "requested_contact_type");
    if (action !== "add" && action !== "update" && action !== "remove") throw new Error("The backend returned an invalid contact edit action.");
    if (contactType !== "phone" && contactType !== "whatsapp") throw new Error("The backend returned an invalid contact edit type.");
    return {
      id: requiredString(row, "contact edit request", "id"),
      contactId: nullableString(row, "contact_id"),
      action,
      contactType,
      requestedE164: nullableString(row, "requested_e164"),
      note: nullableString(row, "note"),
      createdAt: requiredString(row, "contact edit request", "created_at"),
    };
  });
  return { contacts, pendingRequests };
}

function mapRequestItem(row: JsonRecord): PharmacyRequestItem {
  const productId = requiredString(row, "order product", "product_id");
  const brand = stringValue(row, "brand", "brand_name", "product_name") || productId;
  return {
    orderItemId: requiredString(row, "order item", "order_item_id", "id"),
    productId,
    productName: brand,
    brand,
    generic: stringValue(row, "generic", "generic_name"),
    strength: stringValue(row, "strength"),
    form: stringValue(row, "form", "dosage_form"),
    packSize: stringValue(row, "pack_size", "packSize"),
    quantity: Math.round(numericValue(row, "quantity") ?? 0),
    customerMinRwf: numericValue(row, "customer_min_rwf"),
    customerMaxRwf: numericValue(row, "customer_max_rwf"),
    substitutesAllowed: booleanValue(row, true, "substitutes_allowed"),
  };
}

function mapPharmacyRequest(row: JsonRecord): PharmacyRequest {
  const items = parseJsonRows(firstValue(row, "items", "order_items")).map(mapRequestItem);
  const preference = stringValue(row, "delivery_preference");
  return {
    orderId: requiredString(row, "pharmacy order", "order_id", "id"),
    reference: stringValue(row, "reference", "order_reference") || stringValue(row, "order_id", "id"),
    status: stringValue(row, "status") || "broadcast",
    distanceM: numericValue(row, "distance_m") ?? 0,
    createdAt: requiredString(row, "pharmacy order", "created_at"),
    expiresAt: requiredString(row, "pharmacy order", "expires_at"),
    deliveryPreference: preference === "pickup" || preference === "delivery" ? preference : "either",
    substitutesAllowed: booleanValue(row, true, "substitutes_allowed"),
    locationAccuracyM: numericValue(row, "location_accuracy_m"),
    hasPrescription: booleanValue(row, false, "has_prescription"),
    itemCount: Math.round(numericValue(row, "item_count") ?? items.length),
    items,
  };
}

export async function loadPharmacyRequests(pharmacyId: string): Promise<PharmacyRequest[]> {
  await requirePermanentPharmacyUser("Could not load assigned orders");
  const client = requirePharmacyBackend();
  const { data, error } = await client.rpc("dawanear_pharmacy_requests", {
    p_pharmacy_id: requireNonEmpty(pharmacyId, "Pharmacy ID"),
  });
  if (error) rethrow("Could not load assigned pharmacy orders", error);
  const requests = asRows(data).map(mapPharmacyRequest);
  const productIds = [...new Set(requests.flatMap((request) => request.items.map((item) => item.productId)))];
  if (productIds.length === 0 || requests.every((request) => request.items.every((item) => item.packSize))) {
    return requests;
  }
  const { data: productData, error: productError } = await client
    .from("dawanear_product_catalog")
    .select("id,pack_size")
    .in("id", productIds);
  if (productError) rethrow("Could not load order product pack sizes", productError);
  const packSizes = new Map(asRows(productData).map((row) => [
    requiredString(row, "order product", "id"),
    catalogueText(row, "pack_size"),
  ]));
  return requests.map((request) => ({
    ...request,
    items: request.items.map((item) => ({
      ...item,
      packSize: item.packSize || packSizes.get(item.productId) || "",
    })),
  }));
}

function mapPharmacySelectedOrder(row: JsonRecord): Omit<PharmacySelectedOrder, "prescriptionUrl"> {
  const preference = stringValue(row, "delivery_preference");
  return {
    orderId: requiredString(row, "selected pharmacy order", "order_id"),
    reference: stringValue(row, "reference") || requiredString(row, "selected pharmacy order", "order_id"),
    customerWhatsapp: nullableString(row, "customer_whatsapp"),
    deliveryPreference: preference === "pickup" || preference === "delivery" ? preference : "either",
    prescriptionPath: nullableString(row, "prescription_path"),
    prescriptionAccessSecondsRemaining: numericValue(row, "prescription_access_seconds_remaining"),
    selectedAt: requiredString(row, "selected pharmacy order", "selected_at"),
    updatedAt: requiredString(row, "selected pharmacy order", "updated_at"),
  };
}

/** Loads orders that selected this pharmacy and signs any private prescription link briefly. */
export async function loadPharmacySelectedOrders(pharmacyId: string): Promise<PharmacySelectedOrder[]> {
  await requirePermanentPharmacyUser("Could not load selected customer orders");
  const client = requirePharmacyBackend();
  const { data, error } = await client.rpc("dawanear_pharmacy_selected_orders", {
    p_pharmacy_id: requireNonEmpty(pharmacyId, "Pharmacy ID"),
  });
  if (error) rethrow("Could not load selected customer orders", error);
  const rows = asRows(data).map(mapPharmacySelectedOrder);
  return Promise.all(rows.map(async (row) => {
    if (!row.prescriptionPath) return { ...row, prescriptionUrl: null };
    const selectedAtMs = Date.parse(row.selectedAt);
    const serverRemaining = row.prescriptionAccessSecondsRemaining;
    const remainingSeconds = serverRemaining == null
      ? Number.isFinite(selectedAtMs)
        ? Math.floor((selectedAtMs + 24 * 60 * 60 * 1_000 - Date.now()) / 1_000)
        : 0
      : Math.floor(serverRemaining);
    const expiresIn = Math.min(10 * 60, remainingSeconds);
    if (expiresIn <= 0) return { ...row, prescriptionUrl: null };
    const { data: signed, error: signedError } = await client.storage
      .from(PRESCRIPTION_BUCKET)
      .createSignedUrl(row.prescriptionPath, expiresIn);
    if (signedError) rethrow("Could not open the selected customer's prescription", signedError);
    return { ...row, prescriptionUrl: signed?.signedUrl ?? null };
  }));
}

let pharmacyNotificationSubscriptionSequence = 0;

/** Refresh signal for open requests and customer selections assigned to one pharmacy. */
export function subscribeToPharmacyNotifications(
  pharmacyId: string,
  onChange: () => void,
  onError?: (error: Error) => void,
): () => void {
  const cleanedPharmacyId = requireNonEmpty(pharmacyId, "Pharmacy ID");
  const client = requirePharmacyBackend();
  let closed = false;
  const channel = client
    .channel(`dawanear-pharmacy-notifications-${cleanedPharmacyId}-${++pharmacyNotificationSubscriptionSequence}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "dawanear_pharmacy_notifications",
        filter: `pharmacy_id=eq.${cleanedPharmacyId}`,
      },
      () => {
        if (!closed) onChange();
      },
    )
    .subscribe((status) => {
      if (!closed && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
        onError?.(new Error("Live pharmacy order updates disconnected. Check your connection and refresh."));
      }
    });

  return () => {
    closed = true;
    void client.removeChannel(channel);
  };
}

function offerItemsPayload(items: OfferItemDraft[]): JsonRecord[] {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Review every ordered item before submitting an offer.");
  const seen = new Set<string>();
  return items.map((item, index) => {
    const orderItemId = requireNonEmpty(item.orderItemId, `Offer item ${index + 1}`);
    if (seen.has(orderItemId)) throw new Error(`Order item ${orderItemId} appears more than once in the offer.`);
    seen.add(orderItemId);
    const quantity = item.quantity == null ? null : requireInteger(item.quantity, `Offer item ${index + 1} quantity`, 1, 99);
    const unitPrice = item.available && item.unitPriceRwf != null ? item.unitPriceRwf : null;
    if (unitPrice != null && (!Number.isInteger(unitPrice) || unitPrice <= 0)) {
      throw new Error(`Optional price for available confirmation item ${index + 1} must be a positive whole RWF amount.`);
    }
    const offeredProductId = item.available ? item.offeredProductId?.trim() || null : null;
    if (item.available && item.isSubstitute && !offeredProductId) {
      throw new Error(`Choose the substitute product for offer item ${index + 1}.`);
    }
    return {
      order_item_id: orderItemId,
      offered_product_id: offeredProductId,
      available: item.available,
      is_substitute: item.available && (item.isSubstitute ?? false),
      unit_price_rwf: unitPrice,
      quantity,
      note: item.note?.trim() || null,
    };
  });
}

export async function submitOffer(draft: OfferDraft): Promise<SubmitOfferResult> {
  await requirePermanentPharmacyUser("Could not submit the pharmacy offer");
  const readyInMinutes = draft.readyInMinutes == null
    ? null
    : requireInteger(draft.readyInMinutes, "Preparation time", 0, 1_440);
  const client = requirePharmacyBackend();
  if (!["pickup", "delivery", "either"].includes(draft.fulfilmentMethod)) {
    throw new Error("Choose a valid pickup or delivery option.");
  }
  const { data, error } = await client.rpc("dawanear_submit_offer", {
    p_pharmacy_id: requireNonEmpty(draft.pharmacyId, "Pharmacy ID"),
    p_order_id: requireNonEmpty(draft.orderId, "Order ID"),
    p_ready_in_minutes: readyInMinutes,
    p_note: draft.note?.trim() || null,
    p_fulfilment_method: draft.fulfilmentMethod,
    p_items: offerItemsPayload(draft.items),
  });
  if (error) rethrow("Could not submit the pharmacy offer", error);
  const row = asRows(data)[0];
  if (!row) throw new Error("Could not submit the pharmacy offer: the backend returned no offer receipt.");
  const totalRwf = numericValue(row, "total_rwf");
  if (totalRwf == null || totalRwf < 0) throw new Error("The backend returned an invalid offer total.");
  return {
    offerId: requiredString(row, "submitted offer", "offer_id", "id"),
    totalRwf: Math.round(totalRwf),
    complete: booleanValue(row, false, "complete"),
  };
}

/**
 * Records one pharmacy's private price evidence and returns the resulting
 * shared catalogue price. The backend retains every submission for audit but
 * exposes only the single lowest central "From" price to customers.
 */
export async function contributeCentralPrice(input: {
  pharmacyId: string;
  productId: string;
  priceRwf: number;
}): Promise<CentralPriceContributionResult> {
  await requirePermanentPharmacyUser("Could not record the central price contribution");
  const priceRwf = requireInteger(input.priceRwf, "Price", 1, 100_000_000);
  const client = requirePharmacyBackend();
  const { data, error } = await client.rpc("dawanear_contribute_central_price", {
    p_pharmacy_id: requireNonEmpty(input.pharmacyId, "Pharmacy ID"),
    p_product_id: requireNonEmpty(input.productId, "Product ID"),
    p_price_rwf: priceRwf,
  });
  if (error) rethrow("Could not record the central price contribution", error);
  const row = asRows(data)[0];
  if (!row) throw new Error("Could not record the central price contribution: no receipt was returned.");
  const submittedPriceRwf = numericValue(row, "submitted_price_rwf");
  const previousPriceRwf = numericValue(row, "previous_price_rwf");
  const centralPriceRwf = numericValue(row, "central_price_rwf");
  const status = stringValue(row, "contribution_status");
  if (submittedPriceRwf == null || centralPriceRwf == null || !["initialized", "lowered", "not_lower"].includes(status)) {
    throw new Error("Could not record the central price contribution: the backend returned an invalid receipt.");
  }
  return {
    contributionId: requiredString(row, "central price contribution", "contribution_id"),
    productId: requiredString(row, "central price contribution", "product_id"),
    submittedPriceRwf: Math.round(submittedPriceRwf),
    previousPriceRwf: previousPriceRwf == null ? null : Math.round(previousPriceRwf),
    centralPriceRwf: Math.round(centralPriceRwf),
    becameLowest: booleanValue(row, false, "became_lowest"),
    status: status as CentralPriceContributionResult["status"],
  };
}

export async function requestPharmacyContactEdit(input: {
  pharmacyId: string;
  action: "add" | "update" | "remove";
  contactType: "phone" | "whatsapp";
  contactId?: string | null;
  e164?: string | null;
  note?: string;
}): Promise<string> {
  await requirePermanentPharmacyUser("Could not submit the pharmacy contact update");
  const client = requirePharmacyBackend();
  const normalized = input.action === "remove" ? null : normalizeRwandaWhatsapp(input.e164 || "");
  if (input.action !== "remove" && !normalized) throw new Error("Enter a valid Rwanda mobile number.");
  if ((input.action === "update" || input.action === "remove") && !input.contactId) {
    throw new Error("Choose the linked contact to change.");
  }
  const { data, error } = await client.rpc("dawanear_request_pharmacy_contact_edit", {
    p_pharmacy_id: requireNonEmpty(input.pharmacyId, "Pharmacy ID"),
    p_requested_action: input.action,
    p_requested_contact_type: input.contactType,
    p_contact_id: input.contactId || null,
    p_requested_e164: normalized,
    p_note: input.note?.trim() || `${input.action} this pharmacy ${input.contactType} contact`,
  });
  if (error) rethrow("Could not submit the pharmacy contact update", error);
  if (typeof data !== "string" || !/^[0-9a-f-]{36}$/i.test(data)) {
    throw new Error("Could not submit the pharmacy contact update: no update receipt was returned.");
  }
  return data;
}

export async function submitPharmacyClaim(input: PharmacyClaimInput): Promise<PharmacyClaim> {
  await requirePermanentPharmacyUser("Could not submit the pharmacy claim");
  const client = requirePharmacyBackend();
  const payload = {
    pharmacy_id: requireNonEmpty(input.pharmacyId, "Pharmacy ID"),
    contact_email: normalizeEmail(input.contactEmail),
    contact_phone: normalizeRwandaWhatsapp(input.contactPhone),
    note: input.note?.trim() || null,
  };
  const { data, error } = await client
    .from("dawanear_pharmacy_claims")
    .insert(payload)
    .select("*")
    .single();
  if (error) rethrow("Could not submit the pharmacy claim", error);
  if (!isRecord(data)) throw new Error("Could not submit the pharmacy claim: the backend returned no claim receipt.");
  return {
    id: requiredString(data, "pharmacy claim", "id"),
    pharmacyId: requiredString(data, "pharmacy claim", "pharmacy_id"),
    status: stringValue(data, "status") || "pending",
    contactEmail: requiredString(data, "pharmacy claim", "contact_email"),
    contactPhone: nullableString(data, "contact_phone"),
    note: nullableString(data, "note"),
    createdAt: requiredString(data, "pharmacy claim", "created_at"),
  };
}
