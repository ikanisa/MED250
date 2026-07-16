export const siteName = "MED+250";
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://med250.gikundiro.com";
export const marketplaceMode = new Set(["preview", "catalog", "live"]).has(process.env.NEXT_PUBLIC_MARKETPLACE_MODE ?? "")
  ? process.env.NEXT_PUBLIC_MARKETPLACE_MODE as "preview" | "catalog" | "live"
  : "preview";
export const searchIndexingEnabled = marketplaceMode === "catalog" || marketplaceMode === "live";
export const defaultDescription = marketplaceMode === "catalog"
  ? "Search MED+250's public catalogue of pharmacy and wellness products in Rwanda."
  : "Find pharmacy products, place one order, and compare confirmations from nearby pharmacies in Rwanda.";

export function absoluteUrl(path = "/") {
  return new URL(path, `${siteUrl}/`).toString();
}
