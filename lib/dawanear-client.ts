import { normalizeCatalogueText } from "./catalogue-search";
import { jsonRequest, med250ApiJson } from "./med250-api";

const MAX_PRESCRIPTION_BYTES = 10 * 1024 * 1024;
const MAX_PAGE_SIZE = 1_000;
const MAX_BASKET_PRODUCT_IDS = 100;
const BASKET_PRODUCT_QUERY_SIZE = 50;
const MAX_FEATURED_IMAGE_IDS = 24;

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
  verifiedOfferCount?: number;
  verifiedOfferMinRwf?: number;
  verifiedOfferMaxRwf?: number;
  verifiedOfferUpdatedAt?: string | null;
  imageUrl: string | null;
  imageUrls?: string[];
  description?: string | null;
  descriptionSourceName?: string | null;
  descriptionSourceUrl?: string | null;
  isOrderable: boolean;
  accent?: string;
};

export type ProductImagePresentation = {
  productId: string;
  qualityScore: number;
  sourceKind: string;
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

/** MED250 has one operating backend: the same-origin Cloudflare Worker and D1. */
export const catalogueBackendConfigured = true;
export const authBackendConfigured = true;
export const orderBackendConfigured = true;
export const orderingBackendConfigured = true;
export const pharmacyWorkspaceBackendConfigured = true;
export const backendConfigured = true;
export const pharmacyPortalBackendConfigured = true;

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

/** Converts Worker/API errors into concise, actionable UI errors. */
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
  } else if (/guest.*(disabled|not enabled)|anonymous_provider_disabled/.test(lower)) {
    message = "Guest checkout is not enabled on the MED250 Worker.";
  } else if (/invalid login credentials|email not confirmed/.test(lower)) {
    message = "The pharmacy sign-in could not be verified. Send a new WhatsApp code and try again.";
  } else if (/rate.?limit|over_email_send_rate_limit|429/.test(lower)) {
    message = "Too many attempts were made. Wait a moment, then try again.";
  } else if (/jwt.*expired|refresh_token.*(invalid|not found)|session.*expired/.test(lower)) {
    message = "Your session expired. Sign in again, then retry this action.";
  } else if (/row-level security|violates row-level|permission denied|42501|unauthorized|403/.test(lower)) {
    message = "You do not have permission for this action. Check that you are signed in with the correct account.";
  } else if (/d1_error|no such table|no such column|database schema/.test(lower)) {
    message = "The MED250 D1 schema is incomplete. Apply the required Cloudflare D1 migrations and retry.";
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

function normalizeInternationalWhatsapp(value: string | null | undefined): string | null {
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

async function requirePermanentPharmacyUser(context: string): Promise<void> {
  if (!(await hasPermanentPharmacySession())) {
    throw new Error(`${context}: Sign in with your pharmacy WhatsApp number first.`);
  }
}

export async function hasAnonymousCustomerSession(): Promise<boolean> {
  const payload = await med250ApiJson("/api/auth/client/session");
  return isRecord(payload) && payload.authenticated === true && Boolean(stringValue(payload, "userId"));
}

export async function ensureAnonymousCustomer(captchaToken?: string): Promise<{ id: string; is_anonymous: true }> {
  const restored = await med250ApiJson("/api/auth/client/session");
  if (isRecord(restored) && restored.authenticated === true && stringValue(restored, "userId")) {
    return { id: stringValue(restored, "userId"), is_anonymous: true };
  }
  const created = await med250ApiJson(
    "/api/auth/client/session",
    jsonRequest({ captchaToken: captchaToken?.trim() || null }),
  );
  if (!isRecord(created) || created.authenticated !== true || !stringValue(created, "userId")) {
    throw new Error("Could not start a private MED250 guest session.");
  }
  return { id: stringValue(created, "userId"), is_anonymous: true };
}

export async function hasPermanentPharmacySession(): Promise<boolean> {
  const payload = await med250ApiJson("/api/auth/pharmacy/session");
  return isRecord(payload) && payload.authenticated === true && stringValue(payload, "actorType") === "pharmacy";
}

export async function loadCustomerProfile(): Promise<CustomerProfile | null> {
  const user = await ensureAnonymousCustomer();
  const payload = await med250ApiJson("/api/auth/client/session");
  if (!isRecord(payload) || payload.authenticated !== true) return null;
  return {
    userId: stringValue(payload, "userId") || user.id,
    whatsapp: nullableString(payload, "whatsapp"),
    whatsappVerifiedAt: nullableString(payload, "whatsappVerifiedAt"),
    preferredLanguage: stringValue(payload, "preferredLanguage") || "en",
    createdAt: null,
    updatedAt: null,
  };
}

export async function requestCustomerWhatsappOtp(phone: string): Promise<CustomerWhatsappOtpChallenge> {
  const normalizedPhone = normalizeInternationalWhatsapp(phone);
  if (!normalizedPhone) throw new Error("Enter the WhatsApp number you want to verify.");
  await ensureAnonymousCustomer();
  const payload = await med250ApiJson(
    "/api/auth/client/otp/request",
    jsonRequest({ phone: normalizedPhone }),
  );
  if (!isRecord(payload) || !stringValue(payload, "challengeId") || !stringValue(payload, "expiresAt")) {
    throw new Error("Could not start WhatsApp verification. Please try again.");
  }
  return { challengeId: stringValue(payload, "challengeId"), expiresAt: stringValue(payload, "expiresAt") };
}

export async function verifyCustomerWhatsappOtp(
  phone: string,
  challengeId: string,
  token: string,
): Promise<VerifiedCustomerWhatsapp> {
  const normalizedPhone = normalizeInternationalWhatsapp(phone);
  if (!normalizedPhone) throw new Error("Enter the WhatsApp number you want to verify.");
  const cleanedToken = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanedToken)) throw new Error("Enter the complete 6-digit WhatsApp code.");
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new Error("Send a new WhatsApp code.");
  await ensureAnonymousCustomer();
  const payload = await med250ApiJson(
    "/api/auth/client/otp/verify",
    jsonRequest({ phone: normalizedPhone, challengeId, code: cleanedToken }),
  );
  if (!isRecord(payload) || payload.verified !== true || !stringValue(payload, "phone") || !stringValue(payload, "verifiedAt")) {
    throw new Error("WhatsApp verification completed without a profile receipt. Please retry.");
  }
  return { phone: stringValue(payload, "phone"), verifiedAt: stringValue(payload, "verifiedAt") };
}

function pageSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Page size must be a whole number between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value;
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
    verifiedOfferCount: Math.max(0, Math.round(numericValue(row, "verified_offer_count", "verifiedOfferCount") ?? 0)),
    verifiedOfferMinRwf: Math.max(0, Math.round(numericValue(row, "verified_offer_min_rwf", "verifiedOfferMinRwf") ?? 0)),
    verifiedOfferMaxRwf: Math.max(0, Math.round(numericValue(row, "verified_offer_max_rwf", "verifiedOfferMaxRwf") ?? 0)),
    verifiedOfferUpdatedAt: nullableString(row, "verified_offer_updated_at", "verifiedOfferUpdatedAt"),
    imageUrl: nullableString(row, "image_url", "imageUrl"),
    imageUrls: stringArray(row, "image_urls", "imageUrls"),
    description: nullableString(row, "description"),
    descriptionSourceName: nullableString(row, "description_source_name", "descriptionSourceName"),
    descriptionSourceUrl: nullableString(row, "description_source_url", "descriptionSourceUrl"),
    isOrderable: booleanValue(row, defaultOrderable, "is_orderable", "isOrderable"),
  };
}

export async function loadCatalogueTaxonomy(): Promise<CatalogueTaxonomyRow[]> {
  const payload = await med250ApiJson("/api/catalogue/taxonomy");
  const rows = isRecord(payload) ? asRows(payload.rows) : [];
  return rows
    .map((row) => ({
      department: stringValue(row, "department"),
      subcategory: nullableString(row, "subcategory"),
      productCount: Math.max(0, Math.round(numericValue(row, "product_count") ?? 0)),
    }))
    .filter((row) => row.department && row.productCount > 0);
}

export async function loadCatalogue(requestedPageSize = MAX_PAGE_SIZE): Promise<Product[]> {
  const size = Math.min(120, pageSize(requestedPageSize));
  const products: Product[] = [];
  for (let offset = 0; offset <= 10_000; offset += size) {
    const result = await searchCatalogue({ limit: size, offset, sort: "az" });
    products.push(...result.products);
    if (!result.products.length || products.length >= result.total) return products;
  }
  throw new Error("The MED250 catalogue exceeds the supported pagination bound.");
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

  const rows: JsonRecord[] = [];
  for (let index = 0; index < ids.length; index += BASKET_PRODUCT_QUERY_SIZE) {
    const payload = await med250ApiJson(
      "/api/catalogue/products",
      jsonRequest({ ids: ids.slice(index, index + BASKET_PRODUCT_QUERY_SIZE) }),
    );
    rows.push(...(isRecord(payload) ? asRows(payload.rows) : []));
  }
  return rows.map(mapProduct);
}

/**
 * Loads the approved lead-image quality metadata used to rank prominent
 * storefront placements. Ordinary catalogue order must not decide which
 * source asset is enlarged into a featured visual.
 */
export async function loadProductImagePresentation(productIds: string[]): Promise<ProductImagePresentation[]> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length > MAX_FEATURED_IMAGE_IDS) {
    throw new Error(`Featured image ranking accepts no more than ${MAX_FEATURED_IMAGE_IDS} products at once.`);
  }

  const payload = await med250ApiJson(
    "/api/catalogue/image-presentations",
    jsonRequest({ ids }),
  );
  return (isRecord(payload) ? asRows(payload.rows) : []).map((row) => ({
    productId: requiredString(row, "product image presentation", "product_id"),
    qualityScore: Math.max(0, Math.min(100, numericValue(row, "quality_score") ?? 0)),
    sourceKind: stringValue(row, "source_kind"),
  }));
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

  const parameters = new URLSearchParams({
    query,
    category: input.category ?? "All products",
    prescriptionStatus: input.prescriptionStatus ?? "all",
    formGroup: input.formGroup ?? "all",
    availability: input.availability ?? "all",
    sort: input.sort ?? "relevance",
    limit: String(limit),
    offset: String(offset),
  });
  const payload = await med250ApiJson(`/api/catalogue?${parameters.toString()}`);
  const rows = isRecord(payload) ? asRows(payload.products) : [];
  const explanations = new Map<string, string>();
  const products = rows.map((row) => {
    const product = mapProduct(row);
    const explanation = stringValue(row, "match_explanation");
    if (explanation) explanations.set(product.id, explanation);
    return product;
  });
  const total = isRecord(payload)
    ? Math.max(0, Math.round(numericValue(payload, "total") ?? products.length))
    : products.length;
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

  await ensureAnonymousCustomer();
  const payload = await med250ApiJson("/api/orders/prescription", {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
    signal: AbortSignal.timeout(60_000),
  });
  if (!isRecord(payload) || !stringValue(payload, "mediaId")) {
    throw new Error("Could not upload the prescription: the secure backend returned no receipt.");
  }
  return stringValue(payload, "mediaId");
}

/** Removes a newly uploaded prescription that was not attached to a matched order. */
export async function deletePrescription(path: string): Promise<void> {
  const cleanedPath = requireNonEmpty(path, "Prescription path");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanedPath)) {
    throw new Error("The prescription receipt is invalid.");
  }
  await ensureAnonymousCustomer();
  await med250ApiJson(`/api/orders/prescription/${cleanedPath.toLowerCase()}`, { method: "DELETE" });
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
  const whatsapp = normalizeInternationalWhatsapp(input.whatsapp);
  if (!whatsapp) throw new Error("WhatsApp number is required.");
  await ensureAnonymousCustomer();
  const prescriptionPath = input.prescriptionPath?.trim() || null;
  if (prescriptionPath && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(prescriptionPath)) {
    throw new Error("The prescription receipt is invalid for this customer session.");
  }
  const payload = await med250ApiJson("/api/orders", jsonRequest({
    client_request_id: clientRequestId,
    latitude: input.latitude,
    longitude: input.longitude,
    location_accuracy_m: accuracy,
    whatsapp,
    delivery_preference: deliveryPreference,
    substitutes_allowed: substitutesAllowed,
    prescription_media_id: prescriptionPath,
    items,
  }));
  if (!isRecord(payload)) throw new Error("Could not create the order: the secure backend returned no receipt.");
  const recipientCount = numericValue(payload, "recipientCount");
  if (recipientCount == null || recipientCount < 0) {
    throw new Error("Could not create the order: the secure backend returned an invalid pharmacy recipient count.");
  }
  return {
    orderId: requiredString(payload, "created order", "orderId"),
    recipientCount: Math.round(recipientCount),
  };
}

/** Closes a customer-owned request after off-platform completion or cancellation. */
export async function closeOrder(orderId: string, outcome: "completed" | "cancelled"): Promise<CloseOrderResult> {
  await ensureAnonymousCustomer();
  if (outcome !== "completed" && outcome !== "cancelled") {
    throw new Error("Order outcome must be completed or cancelled.");
  }
  const payload = await med250ApiJson(
    `/api/orders/${requireNonEmpty(orderId, "Order ID")}/close`,
    jsonRequest({ outcome }),
  );
  if (!isRecord(payload)) throw new Error("Could not close the order: the secure backend returned no receipt.");
  const status = stringValue(payload, "status");
  if (status !== "completed" && status !== "cancelled") throw new Error("Could not close the order: the backend returned an invalid status.");
  return {
    orderId: requiredString(payload, "closed order", "orderId"),
    status,
    closedAt: requiredString(payload, "closed order", "closedAt"),
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
  const payload = await med250ApiJson("/api/orders");
  return asRows(payload)
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
  const data = await med250ApiJson(`/api/orders/${cleanedOrderId}/offers`);

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
  const cleanedOrderId = requireNonEmpty(orderId, "Order ID");
  const payload = await med250ApiJson(
    `/api/orders/${cleanedOrderId}/select`,
    jsonRequest({ offer_id: requireNonEmpty(offerId, "Offer ID") }),
  );
  return mapSelectedContact(payload);
}

export async function loadSelectedContact(orderId: string): Promise<SelectedPharmacyContact> {
  return mapSelectedContact(await med250ApiJson(`/api/orders/${requireNonEmpty(orderId, "Order ID")}/contact`));
}

function mapSelectedContact(data: unknown): SelectedPharmacyContact {
  const row = isRecord(data) ? data : asRows(data)[0];
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

export function subscribeToOffers(
  orderId: string,
  onOffers: (offers: OrderOffer[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const cleanedOrderId = requireNonEmpty(orderId, "Order ID");
  let closed = false;
  let refreshSequence = 0;
  const refresh = () => {
    const sequence = ++refreshSequence;
    void loadOffers(cleanedOrderId).then((offers) => {
      if (!closed && sequence === refreshSequence) onOffers(offers);
    }).catch((error: unknown) => {
      if (!closed) onError?.(normalizeDawaNearError(error, "Could not refresh pharmacy offers"));
    });
  };
  const timer = globalThis.setInterval(refresh, 5_000);
  const visibility = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") refresh(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
  refresh();
  return () => {
    closed = true;
    refreshSequence += 1;
    globalThis.clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
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

export async function requestPharmacyWhatsappOtp(phone: string): Promise<PharmacyWhatsappOtpChallenge | PharmacyWhatsappNotRegistered> {
  const normalizedPhone = normalizeInternationalWhatsapp(phone);
  if (!normalizedPhone) throw new Error("Enter the pharmacy WhatsApp number.");
  const payload = await med250ApiJson(
    "/api/auth/pharmacy/otp/request",
    jsonRequest({ phone: normalizedPhone }),
  );
  if (!isRecord(payload)) throw new Error("Could not start WhatsApp verification. Please try again.");
  if (payload.registered === false) {
    return { registered: false, adminWhatsapp: stringValue(payload, "adminWhatsapp") || "250795588248" };
  }
  if (!stringValue(payload, "challengeId") || !stringValue(payload, "expiresAt")) {
    throw new Error("Could not start WhatsApp verification. Please try again.");
  }
  return { registered: true, challengeId: stringValue(payload, "challengeId"), expiresAt: stringValue(payload, "expiresAt") };
}

/** Ends the permanent pharmacy session. A later customer order starts a fresh guest session. */
export async function signOutPharmacy(): Promise<void> {
  await med250ApiJson("/api/auth/pharmacy/session", { method: "DELETE" });
}

export async function verifyPharmacyWhatsappOtp(phone: string, challengeId: string, token: string): Promise<void> {
  const cleanedToken = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanedToken)) throw new Error("Enter the complete 6-digit WhatsApp code.");
  const normalizedPhone = normalizeInternationalWhatsapp(phone);
  if (!normalizedPhone) throw new Error("Enter the pharmacy WhatsApp number.");
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new Error("Send a new WhatsApp code.");

  const payload = await med250ApiJson(
    "/api/auth/pharmacy/otp/verify",
    jsonRequest({ phone: normalizedPhone, challengeId, code: cleanedToken }),
  );
  if (!isRecord(payload) || payload.verified !== true || !stringValue(payload, "pharmacyId")) {
    throw new Error("Could not verify the pharmacy WhatsApp code: no permanent session was returned.");
  }
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
  return asRows(await med250ApiJson("/api/pharmacy/workspace")).map(mapMembership);
}

export async function loadMyPharmacyContacts(pharmacyId: string): Promise<PharmacyContactState> {
  await requirePermanentPharmacyUser("Could not load pharmacy contacts");
  requireNonEmpty(pharmacyId, "Pharmacy ID");
  const data = await med250ApiJson("/api/pharmacy/contacts");
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
  requireNonEmpty(pharmacyId, "Pharmacy ID");
  return asRows(await med250ApiJson("/api/pharmacy/requests")).map(mapPharmacyRequest);
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
  return asRows(await med250ApiJson("/api/pharmacy/selected-orders", jsonRequest({
    pharmacy_id: requireNonEmpty(pharmacyId, "Pharmacy ID"),
  }))).map((row) => ({
    ...mapPharmacySelectedOrder(row),
    prescriptionUrl: nullableString(row, "prescription_url"),
  }));
}

/** Refresh signal for open requests and customer selections assigned to one pharmacy. */
export function subscribeToPharmacyNotifications(
  pharmacyId: string,
  onChange: () => void,
  _onError?: (error: Error) => void,
): () => void {
  void _onError;
  requireNonEmpty(pharmacyId, "Pharmacy ID");
  let closed = false;
  const refresh = () => { if (!closed) onChange(); };
  const timer = globalThis.setInterval(refresh, 5_000);
  const visibility = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") refresh(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
  return () => {
    closed = true;
    globalThis.clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
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
  if (!["pickup", "delivery", "either"].includes(draft.fulfilmentMethod)) {
    throw new Error("Choose a valid pickup or delivery option.");
  }
  const payload = await med250ApiJson("/api/pharmacy/offers", jsonRequest({
    pharmacy_id: requireNonEmpty(draft.pharmacyId, "Pharmacy ID"),
    order_id: requireNonEmpty(draft.orderId, "Order ID"),
    ready_in_minutes: readyInMinutes,
    note: draft.note?.trim() || null,
    fulfilment_method: draft.fulfilmentMethod,
    items: offerItemsPayload(draft.items),
  }));
  if (!isRecord(payload)) throw new Error("Could not submit the pharmacy offer: the secure backend returned no receipt.");
  const totalRwf = numericValue(payload, "totalRwf");
  if (totalRwf == null || totalRwf < 0) throw new Error("The backend returned an invalid offer total.");
  return {
    offerId: requiredString(payload, "submitted offer", "offerId"),
    totalRwf: Math.round(totalRwf),
    complete: booleanValue(payload, false, "complete"),
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
  const payload = await med250ApiJson("/api/pharmacy/prices", jsonRequest({
    pharmacy_id: requireNonEmpty(input.pharmacyId, "Pharmacy ID"),
    product_id: requireNonEmpty(input.productId, "Product ID"),
    price_rwf: priceRwf,
  }));
  if (!isRecord(payload)) throw new Error("Could not record the central price contribution: no receipt was returned.");
  const status = stringValue(payload, "contributionStatus");
  const submittedPriceRwf = numericValue(payload, "submittedPriceRwf");
  const previousPriceRwf = numericValue(payload, "previousPriceRwf");
  const centralPriceRwf = numericValue(payload, "centralPriceRwf");
  if (submittedPriceRwf == null || centralPriceRwf == null || !["initialized", "lowered", "not_lower"].includes(status)) {
    throw new Error("Could not record the central price contribution: the backend returned an invalid receipt.");
  }
  return {
    contributionId: requiredString(payload, "central price contribution", "contributionId"),
    productId: requiredString(payload, "central price contribution", "productId"),
    submittedPriceRwf: Math.round(submittedPriceRwf),
    previousPriceRwf: previousPriceRwf == null ? null : Math.round(previousPriceRwf),
    centralPriceRwf: Math.round(centralPriceRwf),
    becameLowest: booleanValue(payload, false, "becameLowest"),
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
  const normalized = input.action === "remove" ? null : normalizeInternationalWhatsapp(input.e164 || "");
  if (input.action !== "remove" && !normalized) throw new Error("Enter a valid international mobile number.");
  if ((input.action === "update" || input.action === "remove") && !input.contactId) {
    throw new Error("Choose the linked contact to change.");
  }
  requireNonEmpty(input.pharmacyId, "Pharmacy ID");
  const payload = await med250ApiJson("/api/pharmacy/contact-changes", jsonRequest({
    action: input.action,
    contact_type: input.contactType,
    contact_id: input.contactId || null,
    e164: normalized,
    note: input.note?.trim() || `${input.action} this pharmacy ${input.contactType} contact`,
  }));
  if (!isRecord(payload) || !/^[0-9a-f-]{36}$/i.test(stringValue(payload, "requestId"))) {
    throw new Error("Could not submit the pharmacy contact update: no update receipt was returned.");
  }
  return stringValue(payload, "requestId");
}

export async function submitPharmacyClaim(input: PharmacyClaimInput): Promise<PharmacyClaim> {
  await requirePermanentPharmacyUser("Could not submit the pharmacy claim");
  const payload = {
    pharmacy_id: requireNonEmpty(input.pharmacyId, "Pharmacy ID"),
    contact_email: normalizeEmail(input.contactEmail),
    contact_phone: normalizeInternationalWhatsapp(input.contactPhone),
    note: input.note?.trim() || null,
  };
  const receipt = await med250ApiJson("/api/pharmacy/claims", jsonRequest(payload));
  if (!isRecord(receipt)) throw new Error("Could not submit the pharmacy claim: the backend returned no claim receipt.");
  return {
    id: requiredString(receipt, "pharmacy claim", "id"),
    pharmacyId: requiredString(receipt, "pharmacy claim", "pharmacyId"),
    status: stringValue(receipt, "status") || "pending",
    contactEmail: requiredString(receipt, "pharmacy claim", "contactEmail"),
    contactPhone: nullableString(receipt, "contactPhone"),
    note: nullableString(receipt, "note"),
    createdAt: requiredString(receipt, "pharmacy claim", "createdAt"),
  };
}
