import type { MetadataRoute } from "next";
import { searchIndexingEnabled, siteUrl } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  if (!searchIndexingEnabled) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/pharmacies", "/*?pharmacy-portal="] }], sitemap: `${siteUrl}/sitemap.xml`, host: siteUrl };
}
