import type { Product } from "./dawanear-client";

type CatalogueRow = Record<string, unknown>;

function text(row: CatalogueRow, field: string) {
  const value = row[field];
  return typeof value === "string" ? value.trim() : "";
}

function number(row: CatalogueRow, field: string) {
  const value = row[field];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textArray(row: CatalogueRow, field: string) {
  const value = row[field];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }
}

/** Loads one already-approved public product through the same RLS boundary as the storefront. */
export async function getPublicMarketplaceProduct(id: string): Promise<Product | null> {
  const productId = id.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) return null;

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!baseUrl || !publishableKey) return null;

  let endpoint: URL;
  try {
    endpoint = new URL("/rest/v1/dawanear_all_product_catalog", baseUrl);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".supabase.co")) return null;
  } catch {
    return null;
  }
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("id", `eq.${productId}`);
  endpoint.searchParams.set("limit", "1");

  const response = await fetch(endpoint, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.length || typeof payload[0] !== "object" || payload[0] === null) return null;
  const row = payload[0] as CatalogueRow;
  const brand = text(row, "brand_name") || text(row, "generic_name") || productId;
  const min = Math.max(0, Math.round(number(row, "price_min_rwf")));
  const max = Math.max(min, Math.round(number(row, "price_max_rwf")));

  return {
    id: text(row, "id") || productId,
    brand,
    generic: text(row, "generic_name"),
    strength: text(row, "strength"),
    form: text(row, "dosage_form"),
    packSize: text(row, "pack_size"),
    manufacturer: text(row, "manufacturer"),
    manufacturerCountry: text(row, "manufacturer_country"),
    registrationNumber: text(row, "registration_number"),
    category: text(row, "category") || "Medicines",
    department: text(row, "department") || undefined,
    subcategory: text(row, "subcategory") || undefined,
    productType: text(row, "product_type") || "consumer_product",
    prescriptionStatus: text(row, "prescription_status") || "unclassified",
    regulatoryStatus: text(row, "regulatory_status") || "unclassified",
    min,
    max,
    priceContributors: Math.max(0, Math.round(number(row, "price_contributors"))),
    imageUrl: text(row, "image_url") || null,
    imageUrls: textArray(row, "image_urls"),
    amazonProductUrl: text(row, "amazon_product_url") || null,
    isOrderable: row.is_orderable === true,
  };
}
