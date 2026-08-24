import { cache } from "react";
import type { CatalogueTaxonomyRow, Product } from "./dawanear-client";
import {
  serverD1CatalogueConfigured,
  withServerCatalogueRepository,
} from "./d1-catalogue-server.ts";

type CatalogueRow = Record<string, unknown>;
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

function mapPublicMarketplaceProduct(row: CatalogueRow, fallbackId: string): Product {
  const id = text(row, "id") || fallbackId;
  const brand = text(row, "brand_name") || text(row, "generic_name") || id;
  const indicativePriceRwf = Math.max(0, Math.round(number(row, "indicative_price_rwf") || number(row, "price_min_rwf")));

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
    imageUrl: text(row, "image_url") || null,
    imageUrls: textArray(row, "image_urls"),
    description: text(row, "description") || null,
    descriptionSourceName: text(row, "description_source_name") || null,
    descriptionSourceUrl: httpsUrl(row, "description_source_url"),
    isOrderable: row.is_orderable === true,
  };
}

export const getPublicCatalogueTaxonomy = cache(async function getPublicCatalogueTaxonomy(): Promise<CatalogueTaxonomyRow[]> {
  if (serverD1CatalogueConfigured) {
    const rows = await withServerCatalogueRepository((repository) => repository.taxonomy());
    return (rows ?? [])
      .map((row) => ({
        department: text(row, "department"),
        subcategory: text(row, "subcategory") || null,
        productCount: Math.max(0, Math.round(number(row, "product_count"))),
      }))
      .filter((row) => row.department && row.productCount > 0);
  }
  return [];
});

export const getPublicProductImages = cache(async function getPublicProductImages(id: string): Promise<string[]> {
  const productId = id.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) return [];

  if (serverD1CatalogueConfigured) {
    const rows = await withServerCatalogueRepository((repository) => repository.productsByIds([productId]));
    return rows?.[0] ? textArray(rows[0], "image_urls") : [];
  }

  return [];
});

/** Loads a bounded related-product set in one public catalogue request. */
export async function getPublicMarketplaceProducts(productIds: string[]): Promise<Product[]> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter((id) => /^[A-Za-z0-9-]{1,80}$/.test(id)))];
  if (!ids.length || ids.length > MAX_RELATED_PRODUCT_IDS) return [];

  if (serverD1CatalogueConfigured) {
    const rows = await withServerCatalogueRepository((repository) => repository.productsByIds(ids));
    return (rows ?? []).map((row) => mapPublicMarketplaceProduct(row, text(row, "id")));
  }

  return [];
}

/** Loads one already-approved public product through the same RLS boundary as the storefront. */
export const getPublicMarketplaceProduct = cache(async function getPublicMarketplaceProduct(id: string): Promise<Product | null> {
  const productId = id.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) return null;

  if (serverD1CatalogueConfigured) {
    const rows = await withServerCatalogueRepository((repository) => repository.productsByIds([productId]));
    return rows?.[0] ? mapPublicMarketplaceProduct(rows[0], productId) : null;
  }

  return null;
});
