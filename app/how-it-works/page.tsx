import type { Metadata } from "next";
import Link from "next/link";
import InfoShell from "../info-shell";

export const metadata: Metadata = {
  title: "How MED+250 works",
  description: "Choose pharmacy products, place one order, and compare confirmations from pharmacies that can fulfil it.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return <InfoShell eyebrow="ONE ORDER · PHARMACIES RESPOND" title="A simple product-first pharmacy order" intro="You choose products first. MED+250 sends the completed order to nearby pharmacies, and only pharmacies that confirm the complete order appear for your choice.">
    <section><h2>1. Find products</h2><p>Search by brand, generic name, symptom, strength, form, or category. Add everything you need to one order basket.</p></section>
    <section><h2>2. Place one order</h2><p>Share your location when you are ready to order. Add a WhatsApp number if you want the pharmacy to contact you, and attach a prescription only when a selected product requires one.</p></section>
    <section><h2>3. Choose a pharmacy that confirms</h2><p>Only pharmacies that respond to your order are shown. Compare the pharmacy name, approximate distance, confirmed products, total price, and readiness time.</p></section>
    <section><h2>4. Arrange fulfilment directly</h2><p>After choosing a pharmacy, use WhatsApp to arrange pickup or delivery. If the pharmacy provides a MoMo merchant code, MED+250 can open your phone&apos;s MoMo menu; payment remains directly between you and the pharmacy.</p></section>
    <div className="info-callout"><h2>Start with the products you need</h2><p>You do not need to browse pharmacy profiles or choose a seller before ordering.</p><Link href="/categories">Browse products</Link></div>
  </InfoShell>;
}
