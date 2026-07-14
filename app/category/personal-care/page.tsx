import type { Metadata } from "next";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";

export const metadata: Metadata = { title: "Personal care products", description: "Browse hygiene, oral care, skin care, and family essentials on Rwanda's MED+250 pharmacy marketplace.", alternates: { canonical: "/category/personal-care" } };

export default function PersonalCarePage() {
  return <Marketplace initialCategory="Personal care" pageTitle="Personal care" pageDescription="Browse everyday hygiene, oral care, skin care, and family essentials with intelligent product matching." pageImage="/marketplace/category-personal-care.webp" initialProducts={getInitialMarketplaceProducts("Personal care")} />;
}
