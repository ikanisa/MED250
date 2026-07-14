import Link from "next/link";
import type { ReactNode } from "react";
import BrandLogo from "./brand-logo";

export default function InfoShell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return <main className="info-page" id="main-content">
    <a className="skip-link" href="#info-content">Skip to content</a>
    <header className="info-header"><Link className="brand" href="/" aria-label="MED+250 home"><BrandLogo /></Link><nav aria-label="Main navigation"><Link href="/categories">Products</Link><Link href="/how-it-works">How it works</Link><Link href="/?pharmacy-portal=open">Pharmacy portal</Link></nav></header>
    <section className="info-hero" id="info-content"><div><span>{eyebrow}</span><h1>{title}</h1><p>{intro}</p></div></section>
    <article className="info-content">{children}</article>
    <footer><Link className="brand footer-brand" href="/" aria-label="MED+250 home"><BrandLogo /></Link><p>MED+250 does not diagnose, prescribe, advertise prescription medicines, or replace a qualified health professional.</p><nav aria-label="Footer"><Link href="/categories">Products</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/accessibility">Accessibility</Link></nav></footer>
  </main>;
}
