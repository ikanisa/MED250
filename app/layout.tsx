import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import type { Viewport } from "next";
import { absoluteUrl, defaultDescription, searchIndexingEnabled, siteName, siteUrl } from "../lib/site";
import { safeJsonLd } from "../lib/safe-json-ld";
import "./globals.css";

const display = Manrope({ variable: "--font-display", subsets: ["latin"] });
const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "MED+250 — Rwanda pharmacy marketplace", template: "%s | MED+250" },
  description: defaultDescription,
  applicationName: siteName,
  authors: [{ name: siteName, url: siteUrl }],
  creator: siteName,
  publisher: siteName,
  category: "health marketplace",
  keywords: ["Rwanda pharmacy", "pharmacy marketplace", "medicines Rwanda", "pharmaceutical products", "Kigali pharmacy"],
  alternates: { canonical: "/" },
  robots: searchIndexingEnabled
    ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } }
    : { index: false, follow: false, noarchive: true, googleBot: { index: false, follow: false, noarchive: true } },
  openGraph: { type: "website", url: "/", siteName, title: "MED+250 — Rwanda pharmacy marketplace", description: defaultDescription, locale: "en_RW", images: [{ url: "/og-marketplace-v2.png", width: 1200, height: 630, alt: "One order. Verified pharmacies confirm. MED+250 Rwanda pharmacy marketplace." }] },
  twitter: { card: "summary_large_image", title: "MED+250 — Rwanda pharmacy marketplace", description: defaultDescription, images: ["/og-marketplace-v2.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#7878e8", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: siteUrl,
    description: defaultDescription,
    inLanguage: "en-RW",
    publisher: { "@type": "Organization", name: siteName, url: siteUrl, logo: absoluteUrl("/brand/app-icon-512.png") },
  };
  return <html lang="en-RW"><head>
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/brand/favicon-16.png" sizes="16x16" type="image/png" />
    <link rel="icon" href="/brand/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="icon" href="/brand/favicon-48.png" sizes="48x48" type="image/png" />
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" sizes="180x180" type="image/png" />
  </head><body className={`${display.variable} ${sans.variable}`}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteSchema) }} />{children}</body></html>;
}
