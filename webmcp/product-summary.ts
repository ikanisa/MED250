import type { Product } from "../lib/dawanear-client";
import { customerProductTitle } from "../lib/product-display";

export function publicProductSummary(product: Product) {
  return {
    productId: product.id,
    name: customerProductTitle(product.brand),
    genericName: product.generic || null,
    strength: product.strength || null,
    form: product.form || null,
    packSize: product.packSize || null,
    manufacturer: product.manufacturer || null,
    manufacturerCountry: product.manufacturerCountry || null,
    registrationNumber: product.registrationNumber || null,
    category: product.category,
    department: product.department ?? null,
    subcategory: product.subcategory ?? null,
    prescriptionStatus: product.prescriptionStatus,
    regulatoryStatus: product.regulatoryStatus,
    indicativePriceRwf: product.indicativePriceRwf || null,
    priceIsIndicative: product.priceIsIndicative,
    requestable: product.isOrderable,
    description: product.description || null,
    imageUrl: product.imageUrl ?? product.imageUrls?.[0] ?? null,
    path: `/product/${encodeURIComponent(product.id)}`,
  };
}
