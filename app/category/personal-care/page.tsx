import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";
import { getPublicCatalogueTaxonomy } from "../../../lib/public-marketplace-product";
import { marketplaceAlternates } from "../../../lib/marketplace-locale";

export const metadata: Metadata = { title: "Beauty and personal care products", description: "Browse source-backed beauty and personal care products currently present in the MED+250 catalogue.", alternates: marketplaceAlternates("/category/personal-care") };

export default async function PersonalCarePage() {
  const initialTaxonomy = await getPublicCatalogueTaxonomy();
  if (initialTaxonomy.length > 0 && !initialTaxonomy.some((row) => row.department === "Beauty & Personal Care")) redirect("/categories");
  return <Marketplace initialCategory="Beauty & Personal Care" pageTitle="Beauty & Personal Care" pageDescription="Browse source-backed products currently present in this department." pageImage="/marketplace/category-personal-care.webp" initialProducts={getInitialMarketplaceProducts("Personal care")} initialTaxonomy={initialTaxonomy} />;
}
