import { cache } from "react";
import type { CatalogueTaxonomyRow, Product } from "./dawanear-client";
import { governPublicProductMedia, isPublicProductMediaHeld } from "./product-media-governance";

type CatalogueRow = Record<string, unknown>;
const PUBLIC_FETCH_TIMEOUT_MS = 8_000;
const MAX_RELATED_PRODUCT_IDS = 12;

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

function httpsUrl(row: CatalogueRow, field: string) {
  const value = text(row, field);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
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

async function fetchPublicRows(endpoint: URL, publishableKey: string): Promise<CatalogueRow[]> {
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(PUBLIC_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return [];
    return payload.filter((row): row is CatalogueRow => typeof row === "object" && row !== null);
  } catch {
    // Public pages retain their source-backed build snapshot and hydrate again
    // in the browser. A transient upstream failure must not turn the route into
    // an HTTP 503 or invent an empty-state label.
    return [];
  }
}

function mapPublicMarketplaceProduct(row: CatalogueRow, fallbackId: string): Product {
  const id = text(row, "id") || fallbackId;
  const brand = text(row, "brand_name") || text(row, "generic_name") || id;
  const indicativePriceRwf = Math.max(0, Math.round(number(row, "indicative_price_rwf") || number(row, "price_min_rwf")));

  const media = governPublicProductMedia(
    id,
    text(row, "image_url") || null,
    textArray(row, "image_urls"),
  );

  return {
    id,
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
    imageUrl: media.imageUrl,
    imageUrls: media.imageUrls,
    description: text(row, "description") || null,
    descriptionSourceName: text(row, "description_source_name") || null,
    descriptionSourceUrl: httpsUrl(row, "description_source_url"),
    isOrderable: row.is_orderable === true,
  };
}

export const getPublicCatalogueTaxonomy = cache(async function getPublicCatalogueTaxonomy(): Promise<CatalogueTaxonomyRow[]> {
  const connection = publicSupabaseEndpoint("/rest/v1/dawanear_catalogue_taxonomy");
  if (!connection) return [];
  connection.endpoint.searchParams.set("select", "department,subcategory,product_count");
  connection.endpoint.searchParams.set("product_count", "gt.0");
  connection.endpoint.searchParams.set("order", "department.asc,subcategory.asc.nullsfirst");

  const rows = await fetchPublicRows(connection.endpoint, connection.publishableKey);
  return rows
    .map((row) => ({
      department: text(row, "department"),
      subcategory: text(row, "subcategory") || null,
      productCount: Math.max(0, Math.round(number(row, "product_count"))),
    }))
    .filter((row) => row.department && row.productCount > 0);
});

export const getPublicProductImages = cache(async function getPublicProductImages(id: string): Promise<string[]> {
  const productId = id.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(productId) || isPublicProductMediaHeld(productId)) return [];

  const connection = publicSupabaseEndpoint("/rest/v1/dawanear_product_images");
  if (!connection) return [];
  const { endpoint, publishableKey } = connection;
  endpoint.searchParams.set("select", "public_url,position");
  endpoint.searchParams.set("product_id", `eq.${productId}`);
  endpoint.searchParams.set("approved", "eq.true");
  endpoint.searchParams.set("order", "position.asc");
  endpoint.searchParams.set("limit", "3");

  const rows = await fetchPublicRows(endpoint, publishableKey);
  return rows
    .map((row) => text(row, "public_url"))
    .filter(Boolean);
});

/** Loads a bounded related-product set in one public catalogue request. */
export async function getPublicMarketplaceProducts(productIds: string[]): Promise<Product[]> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter((id) => /^[A-Za-z0-9-]{1,80}$/.test(id)))];
  if (!ids.length || ids.length > MAX_RELATED_PRODUCT_IDS) return [];

  const connection = publicSupabaseEndpoint("/rest/v1/dawanear_all_product_catalog");
  if (!connection) return [];
  const { endpoint, publishableKey } = connection;
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("id", `in.(${ids.join(",")})`);
  endpoint.searchParams.set("limit", String(ids.length));

  const rows = await fetchPublicRows(endpoint, publishableKey);
  const productsById = new Map(rows.map((row) => {
    const product = mapPublicMarketplaceProduct(row, text(row, "id"));
    return [product.id, product] as const;
  }));
  return ids.map((id) => productsById.get(id)).filter((product): product is Product => Boolean(product));
}

/** Loads one already-approved public product through the same RLS boundary as the storefront. */
export const getPublicMarketplaceProduct = cache(async function getPublicMarketplaceProduct(id: string): Promise<Product | null> {
  const productId = id.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) return null;

  const connection = publicSupabaseEndpoint("/rest/v1/dawanear_all_product_catalog");
  if (!connection) return null;
  const { endpoint, publishableKey } = connection;
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("id", `eq.${productId}`);
  endpoint.searchParams.set("limit", "1");

  const [rows, imageUrls] = await Promise.all([
    fetchPublicRows(endpoint, publishableKey),
    getPublicProductImages(productId),
  ]);
  const row = rows[0];
  if (!row) return null;
  const product = mapPublicMarketplaceProduct(row, productId);
  return {
    ...product,
    imageUrl: imageUrls[0] || product.imageUrl,
    imageUrls: imageUrls.length ? imageUrls : product.imageUrls,
  };
});
