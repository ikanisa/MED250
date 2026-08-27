import type { Metadata } from "next";
import Link from "next/link";
import InfoShell from "../info-shell";
import { marketplaceAlternates } from "../../lib/marketplace-locale";

export const metadata: Metadata = {
  title: "Find a Medicine in Rwanda",
  description: "Search MED+250 by medicine brand, generic name, strength, form, or Rwanda FDA registration number, then request pharmacy availability.",
  alternates: marketplaceAlternates("/find-medicine"),
};

export default function FindMedicinePage() {
  return <InfoShell eyebrow="MEDICINE FINDER" title="Search medicine information, then ask a pharmacy to confirm" intro="Start with the medicine detail you know. MED+250 searches governed catalogue fields but does not claim that a search result is currently in stock.">
    <form className="medicine-search-form" action="/" method="get" role="search"><label htmlFor="medicine-query">Medicine brand, generic name, strength, form, or registration number</label><div><input id="medicine-query" name="search" type="search" maxLength={120} autoComplete="off" required /><button type="submit">Search medicines</button></div></form>
    <section><h2>What happens after you find a product?</h2><p>Add it to an availability request, review the quantity, and verify your WhatsApp number. Participating pharmacies can then confirm whether they can help. Final availability, price, prescription, and fulfilment details come from the pharmacy.</p></section>
    <section className="info-faq"><h2>Common questions</h2><details><summary>Does a product page mean it is in stock?</summary><p>No. Catalogue presence is product information. Stock is shown only after pharmacy confirmation.</p></details><details><summary>Can I search by generic name?</summary><p>Yes. You can use the generic name, brand, strength, dosage form, or registration number where the catalogue record contains it.</p></details><details><summary>Can MED+250 prescribe a medicine?</summary><p>No. MED+250 is not a diagnosis or prescribing service. Prescription and dispensing decisions remain with qualified professionals.</p></details></section>
    <section className="info-callout"><h2>Understand the evidence</h2><p>Read the source, price, availability, corrections, and clinical boundaries applied to catalogue pages.</p><Link href="/trust">Open the trust centre</Link></section>
  </InfoShell>;
}
