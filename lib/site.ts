export const siteName = "MED+250";
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://med250.rw";
export const searchIndexingEnabled = process.env.NEXT_PUBLIC_MARKETPLACE_MODE === "live";
export const defaultDescription = "Find pharmacy products, place one order, and compare confirmations from nearby pharmacies in Rwanda.";

export function absoluteUrl(path = "/") {
  return new URL(path, `${siteUrl}/`).toString();
}
