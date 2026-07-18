import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";
import { getPublicCatalogueTaxonomy } from "../../../lib/public-marketplace-product";
import { marketplaceAlternates } from "../../../lib/marketplace-locale";

export const metadata: Metadata = { title: "Medicines in Rwanda", description: "Search current medicine catalogue records by brand, generic name, symptom, strength, dosage form, or pack size.", alternates: marketplaceAlternates("/category/medicines") };

export default async function MedicinesPage() {
  const initialTaxonomy = await getPublicCatalogueTaxonomy();
  if (initialTaxonomy.length > 0 && !initialTaxonomy.some((row) => row.department === "Medicines")) redirect("/categories");
  return <Marketplace initialCategory="Medicines" pageTitle="Medicines" pageDescription="Search by brand, generic name, symptom, strength, dosage form, or pack size across the current product register." pageImage="/marketplace/category-medicines.webp" initialProducts={getInitialMarketplaceProducts("Medicines")} initialTaxonomy={initialTaxonomy} />;
}
