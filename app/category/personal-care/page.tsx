import type { Metadata } from "next";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";

export const metadata: Metadata = { title: "Beauty and personal care products", description: "Browse non-prescription makeup, skin, hair, fragrance, oral care, and personal care products on MED+250.", alternates: { canonical: "/category/personal-care" } };

export default function PersonalCarePage() {
  return <Marketplace initialCategory="Beauty & Personal Care" pageTitle="Beauty & Personal Care" pageDescription="Browse non-prescription makeup, skin care, hair care, fragrance, oral care, grooming tools, and daily personal care essentials." pageImage="/marketplace/category-personal-care.webp" initialProducts={getInitialMarketplaceProducts("Personal care")} />;
}
