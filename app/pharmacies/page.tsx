import type { Metadata } from "next";
import Marketplace from "../marketplace";

export const metadata: Metadata = { title: "Pharmacy Portal | MED+250" };

export default function PharmaciesPage() {
  return <Marketplace pharmacyPage />;
}
