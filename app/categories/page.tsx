import type { Metadata } from "next";
import Marketplace from "../marketplace";

export const metadata: Metadata = { title: "All Categories | MED+250" };

export default function CategoriesPage() {
  return <Marketplace initialCategory="All products" pageTitle="Explore products" showDepartments />;
}
