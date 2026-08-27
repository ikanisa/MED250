import type { MetadataRoute } from "next";
import productSitemapIndex from "../data/product-sitemap-index.json";
import { absoluteUrl, searchIndexingEnabled } from "../lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!searchIndexingEnabled) return [];
  const updated = new Date("2026-08-27T00:00:00+02:00");
  const routes = ["/", "/categories", "/find-medicine", "/category/medicines", "/category/personal-care", "/category/baby-family", "/category/wellness", "/about", "/trust", "/contact", "/privacy", "/terms"];
  return [
    ...routes.map((path, index) => ({ url: absoluteUrl(path), lastModified: updated, changeFrequency: index < 2 ? "daily" as const : "monthly" as const, priority: index === 0 ? 1 : index === 1 ? .9 : .7 })),
    ...productSitemapIndex.map((product) => ({ url: absoluteUrl(`/product/${encodeURIComponent(product.id)}`), lastModified: product.lastModified, changeFrequency: "weekly" as const, priority: .6 })),
  ];
}
