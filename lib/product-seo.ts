import type { Product } from "./dawanear-client";
import { customerProductTitle } from "./product-display";
import products from "../data/product-seo-index.json";
import relatedProducts from "../data/product-related-index.json";
import { selectRelatedCatalogueRecords, type RelatedCatalogueRecord } from "./product-related";

export type ProductSeoRecord = {
  id: string;
  brand: string;
  generic: string;
  strength: string;
  form: string;
  packSize: string;
  manufacturer: string;
  manufacturerCountry: string;
  category: string;
  regulatoryStatus: string;
  registrationNumber: string;
};

export const productSeoIndex = products as ProductSeoRecord[];
const productRelatedIndex = relatedProducts as RelatedCatalogueRecord[];
const productSeoById = new Map(productSeoIndex.map((product) => [product.id, product]));
const nonPrescriptionLegacyCategories = new Set(["Personal care", "Baby & family", "Wellness"]);

export function getProductSeo(id: string) {
  return productSeoById.get(id) ?? null;
}

export function productSeoDescription(product: ProductSeoRecord) {
  const details = [product.generic, product.strength, product.form, product.packSize ? `pack ${product.packSize}` : ""]
    .filter(Boolean)
    .join(" · ");
  const productSummary = `${customerProductTitle(product.brand)}${details ? ` — ${details}` : ""}.`;
  const mode = process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_MODE || process.env.NEXT_PUBLIC_MARKETPLACE_MODE;
  return mode === "catalog"
    ? `${productSummary} Browse central product information and indicative pricing in the public MED+250 Rwanda pharmacy catalogue.`
    : `${productSummary} Request availability and continue on WhatsApp with a pharmacy that confirms it can help.`;
}

export function toMarketplaceProduct(product: ProductSeoRecord): Product {
  return {
    id: product.id,
    brand: product.brand,
    generic: product.generic,
    strength: product.strength,
    form: product.form,
    packSize: product.packSize,
    manufacturer: product.manufacturer,
    manufacturerCountry: product.manufacturerCountry,
    registrationNumber: product.registrationNumber,
    category: product.category,
    productType: "human_medicine",
    prescriptionStatus: nonPrescriptionLegacyCategories.has(product.category) ? "non_prescription" : "unclassified",
    regulatoryStatus: product.regulatoryStatus,
    min: 0,
    max: 0,
    priceContributors: 0,
    indicativePriceRwf: 0,
    priceIsIndicative: false,
    indicativePriceBasis: "",
    indicativePriceSourceUrl: null,
    indicativePriceUpdatedAt: null,
    imageUrl: null,
    isOrderable: ["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase()),
    accent: ["coral", "blue", "mint", "violet", "amber"][Number(product.id.slice(-4)) % 5],
  };
}

export function getInitialMarketplaceProducts(category = "All products", limit = 12) {
  return productSeoIndex
    .filter((product) => (
      category === "All products"
      || product.category === category
    ))
    .filter((product) => ["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase()))
    .sort((left, right) => left.brand.localeCompare(right.brand, "en", { numeric: true, sensitivity: "base" }))
    .slice(0, limit)
    .map(toMarketplaceProduct);
}

export function getRelatedMarketplaceProducts(
  product: Pick<Product, "id" | "brand" | "category" | "subcategory" | "generic" | "strength" | "form" | "packSize" | "manufacturer" | "productType" | "prescriptionStatus">,
  limit = 8,
) {
  const governedSeed = productRelatedIndex.find((candidate) => candidate.id === product.id);
  return selectRelatedCatalogueRecords(governedSeed ?? {
    ...product,
    subcategory: product.subcategory ?? "",
  }, productRelatedIndex, limit).map((candidate, index): Product => ({
    id: candidate.id,
    brand: candidate.brand,
    generic: candidate.generic,
    strength: candidate.strength,
    form: candidate.form,
    packSize: candidate.packSize,
    manufacturer: candidate.manufacturer,
    manufacturerCountry: candidate.manufacturerCountry,
    registrationNumber: candidate.registrationNumber,
    category: candidate.category,
    subcategory: candidate.subcategory || undefined,
    productType: candidate.productType,
    prescriptionStatus: candidate.prescriptionStatus,
    regulatoryStatus: candidate.regulatoryStatus,
    min: 0,
    max: 0,
    priceContributors: 0,
    indicativePriceRwf: 0,
    priceIsIndicative: false,
    indicativePriceBasis: "",
    indicativePriceSourceUrl: null,
    indicativePriceUpdatedAt: null,
    imageUrl: null,
    isOrderable: candidate.isRequestable,
    accent: ["coral", "blue", "mint", "violet", "amber"][index % 5],
  }));
}
