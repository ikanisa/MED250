import type { Product } from "./dawanear-client";
import products from "../data/product-seo-index.json";

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
const nonPrescriptionLegacyCategories = new Set(["Personal care", "Baby & family", "Wellness"]);

export function getProductSeo(id: string) {
  return productSeoIndex.find((product) => product.id === id) ?? null;
}

export function productSeoDescription(product: ProductSeoRecord) {
  const details = [product.generic, product.strength, product.form, product.packSize ? `pack ${product.packSize}` : ""]
    .filter(Boolean)
    .join(" · ");
  const productSummary = `${product.brand}${details ? ` — ${details}` : ""}.`;
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

export function getInitialMarketplaceProducts(category = "All products", limit = 24) {
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
