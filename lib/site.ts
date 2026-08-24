export const siteName = "MED+250";
const configuredSiteUrl = process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL;
const configuredMarketplaceMode = process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_MODE || process.env.NEXT_PUBLIC_MARKETPLACE_MODE;
const configuredIndexingMode = process.env.NEXT_PUBLIC_MED250_INDEXING_MODE;
export const siteUrl = configuredSiteUrl?.replace(/\/$/, "") || "https://med-250.com";
export const marketplaceMode = new Set(["preview", "catalog", "live"]).has(configuredMarketplaceMode ?? "")
  ? configuredMarketplaceMode as "preview" | "catalog" | "live"
  : "preview";
export const searchIndexingEnabled = configuredIndexingMode === "public"
  || (configuredIndexingMode !== "private" && (marketplaceMode === "catalog" || marketplaceMode === "live"));
export const defaultDescription = marketplaceMode === "catalog"
  ? "Search MED+250's central catalogue, view indicative From RWF prices, and connect with pharmacies in Rwanda."
  : "Find pharmacy products, request availability once, and continue on WhatsApp with a pharmacy that confirms it can help.";

export function absoluteUrl(path = "/") {
  return new URL(path, `${siteUrl}/`).toString();
}

export { publicContactChannels, publicContactChannelErrors } from "./public-contact-channels.mjs";
