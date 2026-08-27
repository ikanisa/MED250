import type { Metadata } from "next";
import Link from "next/link";
import InfoShell from "../info-shell";
import { marketplaceAlternates } from "../../lib/marketplace-locale";

export const metadata: Metadata = {
  title: "Trust, Sources and Editorial Policy",
  description: "Review MED+250 Rwanda catalogue sources, editorial controls, availability boundaries, corrections process, and localisation safeguards.",
  alternates: marketplaceAlternates("/trust"),
};

export default function TrustPage() {
  return <InfoShell eyebrow="TRUST CENTRE" title="How MED+250 separates verified facts from marketplace estimates" intro="Health-search pages must make their evidence, limits, and correction path visible. This page explains the controls used across the Rwanda marketplace.">
    <section id="medicine-sources"><h2>Medicine catalogue sources</h2><p>Medicine identity and regulatory fields are based on governed catalogue records and Rwanda FDA source material. A regulatory listing supports product identity; it does not prove live pharmacy stock. Visit the <a href="https://rwandafda.gov.rw/" target="_blank" rel="noreferrer">Rwanda Food and Drugs Authority</a> for the authority’s current public information.</p></section>
    <section id="editorial-policy"><h2>Editorial and product-content policy</h2><p>MED+250 preserves the official source title and applies restrained display cleanup for readability. Product descriptions are public only when their source rights, approval, and accountable review are recorded. Missing facts are left blank rather than inferred from a product name.</p></section>
    <section><h2>Prices and availability</h2><p>Indicative prices are labelled as estimates and are not offers. Availability and final prices require a recent pharmacy confirmation. Structured offer data is withheld unless a current, positive, pharmacy-backed verification record passes the publication gate.</p></section>
    <section><h2>Clinical and prescription boundaries</h2><p>Catalogue information is not medical advice. Prescription medicines require the applicable prescription and professional dispensing controls. For urgent or severe symptoms, contact qualified emergency or clinical services rather than relying on a marketplace search.</p></section>
    <section><h2>Localisation and local coverage</h2><p>English is the currently approved public source language. Kinyarwanda remains blocked until qualified translation, glossary, clinical, and legal review evidence is complete. District or pharmacy-area pages are not published without verified operational coverage and partner consent.</p></section>
    <section id="corrections"><h2>Corrections</h2><p>If a product detail, source, or marketplace statement appears wrong, use the public contact route and include the page address and the field to review. MED+250 can investigate the governed source record without treating a user report as an automatic catalogue change.</p><Link href="/contact">Contact MED+250</Link></section>
    <p className="info-reviewed">Policy reviewed 27 August 2026. <Link href="/about">About MED+250</Link></p>
  </InfoShell>;
}
