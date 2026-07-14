import type { Metadata } from "next";
import Marketplace from "../../marketplace";
import { getInitialMarketplaceProducts } from "../../../lib/product-seo";

export const metadata: Metadata = { title: "Medicines in Rwanda", description: "Search current medicine catalogue records by brand, generic name, symptom, strength, dosage form, or pack size.", alternates: { canonical: "/category/medicines" } };

export default function MedicinesPage() {
  return <Marketplace initialCategory="Medicines" pageTitle="Medicines" pageDescription="Search by brand, generic name, symptom, strength, dosage form, or pack size across the current product register." pageImage="/marketplace/category-medicines.webp" initialProducts={getInitialMarketplaceProducts("Medicines")} />;
}
