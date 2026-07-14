import type { Metadata } from "next";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";

export const metadata: Metadata = { title: "Baby and family care products", description: "Find infant, child, and family care products using plain-language, brand, and generic-name search.", alternates: { canonical: "/category/baby-family" } };

export default function BabyFamilyPage() {
  return <Marketplace initialCategory="Baby & family" pageTitle="Baby & family" pageDescription="Find infant, child, and family care products using plain-language, brand, and generic-name search." pageImage="/marketplace/category-baby-family.webp" initialProducts={getInitialMarketplaceProducts("Baby & family")} />;
}
