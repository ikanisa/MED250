import type { Metadata } from "next";
import Marketplace from "../../marketplace";

export const metadata: Metadata = { title: "Medicines | MED+250" };

export default function MedicinesPage() {
  return <Marketplace initialCategory="Medicines" pageTitle="Medicines" pageDescription="Search by brand, generic name, symptom, strength, dosage form, or pack size across the current product register." pageImage="/marketplace/category-medicines.png" />;
}
