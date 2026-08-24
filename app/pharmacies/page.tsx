import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Pharmacy portal", robots: { index: false, follow: false } };

export default function PharmaciesPage() {
  redirect("/?pharmacy-portal=open");
}
