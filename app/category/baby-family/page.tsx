import type { Metadata } from "next";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";

export const metadata: Metadata = { title: "Baby products", description: "Find non-prescription baby care, diapering, feeding, nursery, pregnancy, and maternity products.", alternates: { canonical: "/category/baby-family" } };

export default function BabyFamilyPage() {
  return <Marketplace initialCategory="Baby" pageTitle="Baby" pageDescription="Find non-prescription baby care, diapering, feeding, nursery, pregnancy, and maternity essentials." pageImage="/marketplace/category-baby-family.webp" initialProducts={getInitialMarketplaceProducts("Baby & family")} />;
}
