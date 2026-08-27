import type { Metadata } from "next";
import Link from "next/link";
import InfoShell from "../info-shell";
import { marketplaceAlternates } from "../../lib/marketplace-locale";

export const metadata: Metadata = {
  title: "About MED+250 Rwanda",
  description: "Learn how MED+250 helps people browse governed product information and ask participating pharmacies in Rwanda to confirm availability.",
  alternates: marketplaceAlternates("/about"),
};

export default function AboutPage() {
  return <InfoShell eyebrow="ABOUT MED+250" title="A clearer route from medicine search to pharmacy confirmation" intro="MED+250 is a Rwanda-focused pharmacy marketplace. It organises governed product information and helps a customer send one availability request to pharmacies that may be able to help.">
    <section><h2>What the marketplace does</h2><p>Customers can browse medicines and other pharmacy products, review source-backed catalogue details, and request availability. A pharmacy must respond before MED+250 presents any availability as confirmed.</p></section>
    <section><h2>What it does not do</h2><p>MED+250 does not diagnose, prescribe, replace a pharmacist or doctor, or guarantee that a listed product is in stock. Catalogue visibility and indicative pricing are not inventory claims.</p></section>
    <section><h2>Built for Rwanda</h2><p>The service uses Rwanda-specific catalogue, regulatory, contact, and location context. Public translations and local coverage pages are released only after their evidence and accountable reviews are complete.</p></section>
    <section className="info-callout"><h2>Start with a governed search</h2><p>Find a medicine by the detail you know, then review the request and confirmation boundaries before continuing.</p><Link href="/find-medicine">Find a medicine</Link></section>
  </InfoShell>;
}
