import type { Metadata } from "next";
import Marketplace from "../marketplace";

export const metadata: Metadata = { title: "All Categories | MED+250" };

export default function CategoriesPage() {
  return <Marketplace initialCategory="All products" pageTitle="All pharmacy categories" pageDescription="Search across registered medicines, personal care, baby and family products, wellness essentials, and health devices." pageImage="/marketplace/hero-pharmacy-still-life.png" showDepartments />;
}
