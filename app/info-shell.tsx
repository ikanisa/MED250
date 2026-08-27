import Link from "next/link";
import type { ReactNode } from "react";
import BrandLogo from "./brand-logo";
import { marketplaceMessage } from "../lib/marketplace-messages";
import { publicContactChannels } from "../lib/public-contact-channels.mjs";
import { companyLocation } from "../lib/company-location";
export default function InfoShell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  const med250PublicContactChannels = publicContactChannels();
  return <main className="info-page" id="main-content">
    <a className="skip-link" href="#info-content">{marketplaceMessage("accessibility.skip_content")}</a>
    <header className="info-header"><Link className="brand" href="/" aria-label={marketplaceMessage("inventory.487d6543eeb5")}><BrandLogo /></Link><nav aria-label={marketplaceMessage("inventory.eb355944b92d")}><Link href="/find-medicine">{marketplaceMessage("catalogue.search_label")}</Link><Link href="/categories">{marketplaceMessage("navigation.products")}</Link><Link href="/?pharmacy-portal=open">{marketplaceMessage("navigation.pharmacies")}</Link></nav></header>
    <section className="info-hero" id="info-content"><div><span>{eyebrow}</span><h1>{title}</h1><p>{intro}</p></div></section>
    <article className="info-content">{children}</article>
    <footer><Link className="brand footer-brand" href="/" aria-label={marketplaceMessage("inventory.487d6543eeb5")}><BrandLogo /></Link><p>{marketplaceMessage("clinical.marketplace_disclaimer")}</p><nav aria-label={marketplaceMessage("inventory.26c87bb51e69")}><Link href="/categories">{marketplaceMessage("navigation.products")}</Link><Link href={companyLocation.pagePath}>{companyLocation.pageLabel}</Link><Link href="/privacy">{marketplaceMessage("navigation.privacy")}</Link><Link href="/terms">{marketplaceMessage("navigation.terms")}</Link></nav>{med250PublicContactChannels.length ? <div className="public-contact-links" aria-label={marketplaceMessage("public_contact.label")}>{med250PublicContactChannels.map((channel) => <a key={channel.label} href={channel.href} target={channel.href.startsWith("http") ? "_blank" : undefined} rel={channel.href.startsWith("http") ? "noreferrer" : undefined}>{channel.label === "email" ? marketplaceMessage("public_contact.email") : channel.label === "whatsapp" ? marketplaceMessage("public_contact.whatsapp") : marketplaceMessage("public_contact.booking")}</a>)}</div> : null}<address className="company-location"><a href={companyLocation.googleMapsUrl} target="_blank" rel="noreferrer">{companyLocation.footerLabel}</a></address></footer>
  </main>;
}
