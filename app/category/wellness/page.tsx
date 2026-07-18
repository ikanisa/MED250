import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";
import { getPublicCatalogueTaxonomy } from "../../../lib/public-marketplace-product";
import { marketplaceAlternates } from "../../../lib/marketplace-locale";

export const metadata: Metadata = { title: "Health and household products", description: "Browse source-backed health and household products currently present in the MED+250 catalogue.", alternates: marketplaceAlternates("/category/wellness") };

export default async function WellnessPage() {
  const initialTaxonomy = await getPublicCatalogueTaxonomy();
  if (initialTaxonomy.length > 0 && !initialTaxonomy.some((row) => row.department === "Health & Household")) redirect("/categories");
  return <Marketplace initialCategory="Health & Household" pageTitle="Health & Household" pageDescription="Browse source-backed products currently present in this department." pageImage="/marketplace/category-wellness-devices.webp" initialProducts={getInitialMarketplaceProducts("Wellness")} initialTaxonomy={initialTaxonomy} />;
}
