import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";
import { getPublicCatalogueTaxonomy } from "../../../lib/public-marketplace-product";

export const metadata: Metadata = { title: "Baby products", description: "Browse source-backed baby products currently present in the MED+250 catalogue.", alternates: { canonical: "/category/baby-family" } };

export default async function BabyFamilyPage() {
  const initialTaxonomy = await getPublicCatalogueTaxonomy();
  if (initialTaxonomy.length > 0 && !initialTaxonomy.some((row) => row.department === "Baby")) redirect("/categories");
  return <Marketplace initialCategory="Baby" pageTitle="Baby" pageDescription="Browse source-backed products currently present in this department." pageImage="/marketplace/category-baby-family.webp" initialProducts={getInitialMarketplaceProducts("Baby & family")} initialTaxonomy={initialTaxonomy} />;
}
