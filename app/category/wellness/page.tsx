import type { Metadata } from "next";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";

export const metadata: Metadata = { title: "Wellness products and devices", description: "Explore supplements, monitoring devices, and wellness products with intelligent search and useful form filters.", alternates: { canonical: "/category/wellness" } };

export default function WellnessPage() {
  return <Marketplace initialCategory="Wellness" pageTitle="Wellness & devices" pageDescription="Explore supplements, monitoring devices, and wellness products with semantic search and useful form filters." pageImage="/marketplace/category-wellness-devices.webp" initialProducts={getInitialMarketplaceProducts("Wellness")} />;
}
