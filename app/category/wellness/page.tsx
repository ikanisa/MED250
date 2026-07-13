import type { Metadata } from "next";
import Marketplace from "../../marketplace";

export const metadata: Metadata = { title: "Wellness & Devices | MED+250" };

export default function WellnessPage() {
  return <Marketplace initialCategory="Wellness" pageTitle="Wellness & devices" pageDescription="Explore supplements, monitoring devices, and wellness products with semantic search and useful form filters." pageImage="/marketplace/category-wellness-devices.png" />;
}
