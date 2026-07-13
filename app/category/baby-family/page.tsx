import type { Metadata } from "next";
import Marketplace from "../../marketplace";

export const metadata: Metadata = { title: "Baby & Family | MED+250" };

export default function BabyFamilyPage() {
  return <Marketplace initialCategory="Baby & family" pageTitle="Baby & family" pageDescription="Find infant, child, and family care products using plain-language, brand, and generic-name search." pageImage="/marketplace/category-baby-family.png" />;
}
