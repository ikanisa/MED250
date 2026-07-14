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

export function getProductSeo(id: string) {
  return productSeoIndex.find((product) => product.id === id) ?? null;
}

export function productSeoDescription(product: ProductSeoRecord) {
  const details = [product.generic, product.strength, product.form, product.packSize ? `pack ${product.packSize}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `${product.brand}${details ? ` — ${details}` : ""}. Add it to one MED+250 order and receive confirmations from pharmacies serving your location in Rwanda.`;
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
    prescriptionStatus: "unclassified",
    regulatoryStatus: product.regulatoryStatus,
    min: 0,
    max: 0,
    priceContributors: 0,
    imageUrl: null,
    isOrderable: ["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase()),
    accent: ["coral", "blue", "mint", "violet", "amber"][Number(product.id.slice(-4)) % 5],
  };
}

const medicineCategories = new Set(["Medicines", "Pain & fever", "Digestive health", "Allergy", "Diabetes care"]);

export function getInitialMarketplaceProducts(category = "All products", limit = 24) {
  return productSeoIndex
    .filter((product) => (
      category === "All products"
      || (category === "Medicines" ? medicineCategories.has(product.category) : product.category === category)
    ))
    .filter((product) => ["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase()))
    .sort((left, right) => left.brand.localeCompare(right.brand, "en", { numeric: true, sensitivity: "base" }))
    .slice(0, limit)
    .map(toMarketplaceProduct);
}
