import type { CatalogueTaxonomyRow, Product } from "./dawanear-client";

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

function publicSupabaseEndpoint(path: string): { endpoint: URL; publishableKey: string } | null {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!baseUrl || !publishableKey) return null;
  try {
    const endpoint = new URL(path, baseUrl);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".supabase.co")) return null;
    return { endpoint, publishableKey };
  } catch {
    return null;
  }
}

export async function getPublicCatalogueTaxonomy(): Promise<CatalogueTaxonomyRow[]> {
  const connection = publicSupabaseEndpoint("/rest/v1/dawanear_catalogue_taxonomy");
  if (!connection) return [];
  connection.endpoint.searchParams.set("select", "department,subcategory,product_count");
  connection.endpoint.searchParams.set("product_count", "gt.0");
  connection.endpoint.searchParams.set("order", "department.asc,subcategory.asc.nullsfirst");

  const response = await fetch(connection.endpoint, {
    headers: {
      apikey: connection.publishableKey,
      Authorization: `Bearer ${connection.publishableKey}`,
    },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((row): row is CatalogueRow => typeof row === "object" && row !== null)
    .map((row) => ({
      department: text(row, "department"),
      subcategory: text(row, "subcategory") || null,
      productCount: Math.max(0, Math.round(number(row, "product_count"))),
    }))
    .filter((row) => row.department && row.productCount > 0);
}

export async function getPublicProductImages(id: string): Promise<string[]> {
  const productId = id.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) return [];

  const connection = publicSupabaseEndpoint("/rest/v1/dawanear_product_images");
  if (!connection) return [];
  const { endpoint, publishableKey } = connection;
  endpoint.searchParams.set("select", "public_url,position");
  endpoint.searchParams.set("product_id", `eq.${productId}`);
  endpoint.searchParams.set("approved", "eq.true");
  endpoint.searchParams.set("order", "position.asc");
  endpoint.searchParams.set("limit", "3");

  const response = await fetch(endpoint, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((row): row is CatalogueRow => typeof row === "object" && row !== null)
    .map((row) => text(row, "public_url"))
    .filter(Boolean);
}

/** Loads one already-approved public product through the same RLS boundary as the storefront. */
export async function getPublicMarketplaceProduct(id: string): Promise<Product | null> {
  const productId = id.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) return null;

  const connection = publicSupabaseEndpoint("/rest/v1/dawanear_all_product_catalog");
  if (!connection) return null;
  const { endpoint, publishableKey } = connection;
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("id", `eq.${productId}`);
  endpoint.searchParams.set("limit", "1");

  const [response, imageUrls] = await Promise.all([
    fetch(endpoint, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
      cache: "no-store",
    }),
    getPublicProductImages(productId),
  ]);
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.length || typeof payload[0] !== "object" || payload[0] === null) return null;
  const row = payload[0] as CatalogueRow;
  const brand = text(row, "brand_name") || text(row, "generic_name") || productId;
  const indicativePriceRwf = Math.max(0, Math.round(number(row, "indicative_price_rwf") || number(row, "price_min_rwf")));

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
    min: indicativePriceRwf,
    max: indicativePriceRwf,
    priceContributors: 0,
    indicativePriceRwf,
    priceIsIndicative: row.price_is_indicative === true || indicativePriceRwf > 0,
    indicativePriceBasis: text(row, "indicative_price_basis"),
    indicativePriceSourceUrl: text(row, "indicative_price_source_url") || null,
    indicativePriceUpdatedAt: text(row, "indicative_price_updated_at") || null,
    imageUrl: imageUrls[0] || text(row, "image_url") || null,
    imageUrls: imageUrls.length ? imageUrls : textArray(row, "image_urls"),
    amazonProductUrl: text(row, "amazon_product_url") || null,
    isOrderable: row.is_orderable === true,
  };
}
