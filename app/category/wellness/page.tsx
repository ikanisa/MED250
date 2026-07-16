import type { Metadata } from "next";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";

export const metadata: Metadata = { title: "Health and household products", description: "Explore non-prescription health care, household supplies, medical equipment, oral care, nutrition, vision, and wellness products.", alternates: { canonical: "/category/wellness" } };

export default function WellnessPage() {
  return <Marketplace initialCategory="Health & Household" pageTitle="Health & Household" pageDescription="Explore non-prescription health care, household supplies, medical equipment, oral care, nutrition, vision care, and wellness products." pageImage="/marketplace/category-wellness-devices.webp" initialProducts={getInitialMarketplaceProducts("Wellness")} />;
}
