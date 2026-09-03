import type { Metadata } from "next";
import Link from "next/link";
import InfoShell from "../info-shell";
import { companyLocation } from "../../lib/company-location";
import { marketplaceAlternates } from "../../lib/marketplace-locale";
import { publicContactChannels } from "../../lib/public-contact-channels.mjs";

export const metadata: Metadata = {
  title: "MED+250 Kigali location and contact",
  description:
    "Find MED+250 at 1 KN 78 St, Kiyovu, Nyarugenge, Kigali, and use the Rwanda pharmacy marketplace online.",
  alternates: marketplaceAlternates(companyLocation.pagePath),
  openGraph: {
    title: "MED+250 Kigali location and contact",
    description:
      "MED+250 is based in Kigali and serves people across Rwanda through its online pharmacy marketplace.",
    url: companyLocation.pagePath,
  },
};

export default function ContactPage() {
  const publicChannels = publicContactChannels();
  return (
    <InfoShell
      eyebrow="Kigali · Rwanda"
      title="Find MED+250 in Kigali"
      intro="Our team is based in Kigali. MED+250 helps people across Rwanda search pharmacy products and request availability online."
    >
      <section className="location-card">
        <h2>Our location</h2>
        <address>
          <strong>{companyLocation.organizationName}</strong>
          <span>{companyLocation.streetAddress}</span>
          <span>{companyLocation.neighborhood}, {companyLocation.district}</span>
          <span>{companyLocation.addressLocality}, {companyLocation.countryName}</span>
        </address>
        <a
          className="location-directions"
          href={companyLocation.googleMapsUrl}
          target="_blank"
          rel="noreferrer"
        >
          {companyLocation.mapLabel}
        </a>
      </section>
      <section>
        <h2>Serving people across Rwanda</h2>
        <p>
          Search the MED+250 catalogue from anywhere in Rwanda, prepare one availability request,
          and continue with a pharmacy after it confirms it can help.
        </p>
        <Link className="location-catalogue-link" href="/categories">Search pharmacy products in Rwanda</Link>
      </section>
      <section>
        <h2>Contact MED+250</h2>
        <p>
          The Kigali address is our company location, not a pharmacy collection point. Product
          availability, pricing, prescriptions, and fulfilment are handled through the marketplace
          and the responding pharmacy.
        </p>
        {publicChannels.length ? <div className="location-contact-links">{publicChannels.map((channel) => (
          <a key={channel.label} href={channel.href} target={channel.href.startsWith("http") ? "_blank" : undefined} rel={channel.href.startsWith("http") ? "noreferrer" : undefined}>
            WhatsApp support: {channel.display}
          </a>
        ))}</div> : null}
      </section>
    </InfoShell>
  );
}
