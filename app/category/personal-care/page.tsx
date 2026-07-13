import type { Metadata } from "next";
import Marketplace from "../../marketplace";

export const metadata: Metadata = { title: "Personal Care | MED+250" };

export default function PersonalCarePage() {
  return <Marketplace initialCategory="Personal care" pageTitle="Personal care" pageDescription="Browse everyday hygiene, oral care, skin care, and family essentials with intelligent product matching." pageImage="/marketplace/category-personal-care.png" />;
}
