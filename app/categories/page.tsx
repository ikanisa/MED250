import type { Metadata } from "next";
import Marketplace from "../marketplace";
import { getInitialMarketplaceProducts } from "../../lib/product-seo";

export const metadata: Metadata = { title: "Pharmacy products in Rwanda", description: "Search the MED+250 catalogue by product, generic name, symptom, strength, dosage form, or category.", alternates: { canonical: "/categories" } };

export default function CategoriesPage() {
  return <Marketplace initialCategory="All products" pageTitle="Explore products" showDepartments initialProducts={getInitialMarketplaceProducts()} />;
}
