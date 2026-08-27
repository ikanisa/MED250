import type { Product } from "./dawanear-client.ts";
import { customerProductTitle } from "./product-display.ts";

function normalizedSeoText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2026\uFFFD]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/gu, "")
    .trim();
}

export function boundedSeoText(value: string, maximumLength: number) {
  const normalized = normalizedSeoText(value);
  if (normalized.length <= maximumLength) return normalized;
  const prefix = normalized.slice(0, maximumLength + 1);
  const lastWordBoundary = prefix.lastIndexOf(" ");
  return prefix
    .slice(0, lastWordBoundary >= Math.floor(maximumLength * .65) ? lastWordBoundary : maximumLength)
    .replace(/[|,;:–—-]+\s*$/u, "")
    .replace(/\s+\([^)]*$/u, "")
    .replace(/[|,;:–—-]+\s*$/u, "")
    .trimEnd();
}

export function productMetadataTitle(product: Pick<Product, "brand" | "strength">) {
  return boundedSeoText([customerProductTitle(product.brand), product.strength].filter(Boolean).join(" "), 65);
}

export function productMetadataDescription(
  product: Pick<Product, "brand" | "generic" | "strength" | "form" | "packSize" | "subcategory">,
  approvedDescription?: string | null,
) {
  const displayName = customerProductTitle(product.brand);
  const details = [product.generic, product.strength, product.form, product.packSize ? `pack ${product.packSize}` : ""]
    .filter(Boolean)
    .join(" · ");
  const fallback = `${displayName}${details ? ` — ${details}` : product.subcategory ? ` — ${product.subcategory}` : ""}. Request availability from a pharmacy in Rwanda and continue on WhatsApp after confirmation.`;
  return boundedSeoText(approvedDescription || fallback, 160);
}

export function verifiedAggregateOffer(
  product: Pick<Product, "isOrderable" | "verifiedOfferCount" | "verifiedOfferMinRwf" | "verifiedOfferMaxRwf" | "verifiedOfferUpdatedAt">,
  now = new Date(),
) {
  const count = product.verifiedOfferCount ?? 0;
  const lowPrice = product.verifiedOfferMinRwf ?? 0;
  const highPrice = product.verifiedOfferMaxRwf ?? 0;
  const updatedAt = product.verifiedOfferUpdatedAt ? new Date(product.verifiedOfferUpdatedAt) : null;
  const ageMs = updatedAt ? now.valueOf() - updatedAt.valueOf() : Number.POSITIVE_INFINITY;
  const fresh = ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1_000;
  if (!product.isOrderable || !Number.isInteger(count) || count < 1 || lowPrice <= 0 || highPrice < lowPrice || !fresh) return null;
  return {
    "@type": "AggregateOffer",
    priceCurrency: "RWF",
    lowPrice,
    highPrice,
    offerCount: count,
    availability: "https://schema.org/InStock",
  } as const;
}
