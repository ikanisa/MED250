import type { Metadata } from "next";
import InfoShell from "../info-shell";

export const metadata: Metadata = { title: "Marketplace terms", description: "The marketplace roles and ordering boundaries for MED+250 customers and pharmacies.", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return <InfoShell eyebrow="MARKETPLACE TERMS" title="Using MED+250" intro="MED+250 is an information and pharmacy-connection marketplace. Customers search one central catalogue, request availability, and continue directly with a pharmacy on WhatsApp.">
    <section><h2>Marketplace role</h2><p>MED+250 publishes central product information and indicative From RWF prices. It helps customers identify pharmacies that confirm availability for a private request. Only pharmacies are sellers and dispensing parties. MED+250 does not publish pharmacy-specific stock or price lists.</p></section>
    <section><h2>No diagnosis or prescribing</h2><p>MED+250 does not diagnose, prescribe, recommend treatment, or replace a pharmacist, clinician, or other qualified health professional. Product catalogue presence is not medical advice.</p></section>
    <section><h2>Availability requests and optional orders</h2><p>A pharmacy confirmation is not a completed purchase. Any pharmacy price entered with a response is optional, private, indicative, and not final. The customer and pharmacy reconfirm the product, final price, and fulfilment on WhatsApp before deciding whether to proceed with an order.</p></section>
    <section><h2>Prescriptions and substitutes</h2><p>Catalogue presence does not authorise dispensing. Customers must provide a valid prescription when legally required. A pharmacy may propose a substitute only when the customer has allowed it and the pharmacy is satisfied that the substitute is appropriate under applicable professional rules.</p></section>
    <section><h2>Payments</h2><p>MED+250 does not currently collect payment. WhatsApp coordination and MoMo USSD are direct interactions between the customer, pharmacy, mobile operator, and relevant messaging or payment provider.</p></section>
  </InfoShell>;
}
