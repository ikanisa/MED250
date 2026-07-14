import type { Metadata } from "next";
import InfoShell from "../info-shell";

export const metadata: Metadata = { title: "Marketplace terms", description: "The marketplace roles and ordering boundaries for MED+250 customers and pharmacies.", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return <InfoShell eyebrow="MARKETPLACE TERMS" title="Using MED+250" intro="MED+250 is a product discovery and order-routing marketplace. These launch terms describe the implemented service boundaries and require formal legal approval before public operation.">
    <section><h2>Marketplace role</h2><p>MED+250 lets customers create one product order and lets pharmacies confirm whether they can fulfil it. Each responding pharmacy is responsible for its product availability, price, professional review, fulfilment, and customer communication.</p></section>
    <section><h2>No diagnosis or prescribing</h2><p>MED+250 does not diagnose, prescribe, recommend treatment, or replace a pharmacist, clinician, or other qualified health professional. Product catalogue presence is not medical advice.</p></section>
    <section><h2>Orders and confirmations</h2><p>An order is not a completed purchase until a customer chooses a pharmacy and the parties arrange fulfilment. Prices and readiness information are supplied by pharmacies and may need confirmation on WhatsApp.</p></section>
    <section><h2>Prescriptions and substitutes</h2><p>Customers must provide a valid prescription when legally required. A pharmacy may propose a substitute only when the customer has allowed it and the pharmacy is satisfied that the substitute is appropriate under applicable professional rules.</p></section>
    <section><h2>Payments</h2><p>MED+250 does not currently collect payment. WhatsApp coordination and MoMo USSD are direct interactions between the customer, pharmacy, mobile operator, and relevant messaging or payment provider.</p></section>
  </InfoShell>;
}
