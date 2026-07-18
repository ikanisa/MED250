import type { Metadata } from "next";
import Marketplace from "../marketplace";
import { getInitialMarketplaceProducts } from "../../lib/product-seo";
import { getPublicCatalogueTaxonomy } from "../../lib/public-marketplace-product";
import { marketplaceAlternates } from "../../lib/marketplace-locale";

export const metadata: Metadata = { title: "Pharmacy products in Rwanda", description: "Search the MED+250 catalogue by product, generic name, symptom, strength, dosage form, or category.", alternates: marketplaceAlternates("/categories") };

export default async function CategoriesPage() {
  const initialTaxonomy = await getPublicCatalogueTaxonomy();
  return <Marketplace initialCategory="All products" pageTitle="Explore products" showDepartments initialProducts={getInitialMarketplaceProducts()} initialTaxonomy={initialTaxonomy} />;
}
