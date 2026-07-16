export const siteName = "MED+250";
const configuredSiteUrl = process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL;
const configuredMarketplaceMode = process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_MODE || process.env.NEXT_PUBLIC_MARKETPLACE_MODE;
export const siteUrl = configuredSiteUrl?.replace(/\/$/, "") || "https://med250.gikundiro.com";
export const marketplaceMode = new Set(["preview", "catalog", "live"]).has(configuredMarketplaceMode ?? "")
  ? configuredMarketplaceMode as "preview" | "catalog" | "live"
  : "preview";
export const searchIndexingEnabled = marketplaceMode === "catalog" || marketplaceMode === "live";
export const defaultDescription = marketplaceMode === "catalog"
  ? "Search MED+250's public catalogue of pharmacy and wellness products in Rwanda."
  : "Find pharmacy products, place one order, and compare confirmations from verified pharmacies in Rwanda.";

export function absoluteUrl(path = "/") {
  return new URL(path, `${siteUrl}/`).toString();
}
