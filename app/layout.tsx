import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import type { Viewport } from "next";
import { absoluteUrl, defaultDescription, searchIndexingEnabled, siteName, siteUrl } from "../lib/site";
import { safeJsonLd } from "../lib/safe-json-ld";
import { DEFAULT_MARKETPLACE_LOCALE, marketplaceAlternates, marketplaceOpenGraphLocale } from "../lib/marketplace-locale";
import { marketplaceMessage } from "../lib/marketplace-messages";
import { companyLocation } from "../lib/company-location";
import NavigationFeedback from "./navigation-feedback";
import PwaManager from "./pwa-manager";
import { SiteWebMcpRegistrar } from "../webmcp/site-registrar";
import "./globals.css";

const display = Manrope({ variable: "--font-display", subsets: ["latin"] });
const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });
const googleSiteVerification = String(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ?? "").trim();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: marketplaceMessage("metadata.site_title"), template: "%s | MED+250" },
  description: defaultDescription,
  applicationName: siteName,
  appleWebApp: { capable: true, title: "MED+250", statusBarStyle: "default" },
  formatDetection: { telephone: false, address: false, email: false },
  authors: [{ name: siteName, url: siteUrl }],
  creator: siteName,
  publisher: siteName,
  category: "health marketplace",
  keywords: ["Rwanda pharmacy marketplace", "pharmacy products Rwanda", "medicines Rwanda", "medicine availability Rwanda", "Kigali pharmacy products", "find pharmacies Rwanda"],
  verification: googleSiteVerification ? { google: googleSiteVerification } : undefined,
  other: { "geo.region": "RW-01", "geo.placename": companyLocation.addressLocality },
  alternates: marketplaceAlternates("/"),
  robots: searchIndexingEnabled
    ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } }
    : { index: false, follow: false, noarchive: true, googleBot: { index: false, follow: false, noarchive: true } },
  openGraph: { type: "website", url: "/", siteName, title: marketplaceMessage("metadata.site_title"), description: defaultDescription, locale: marketplaceOpenGraphLocale(), images: [{ url: "/og-marketplace-v2.png", width: 1200, height: 630, alt: "Find products and connect with pharmacies on MED+250 Rwanda." }] },
  twitter: { card: "summary_large_image", title: "MED+250 — Rwanda pharmacy marketplace", description: defaultDescription, images: ["/og-marketplace-v2.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f6f8ff", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const organizationId = absoluteUrl("/#organization");
  const locationId = absoluteUrl("/#kigali-location");
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationId,
    name: siteName,
    url: siteUrl,
    logo: { "@type": "ImageObject", url: absoluteUrl("/brand/app-icon-512.png"), width: 512, height: 512 },
    description: defaultDescription,
    areaServed: { "@type": "Country", name: companyLocation.countryName },
    address: {
      "@type": "PostalAddress",
      streetAddress: `${companyLocation.venue}, ${companyLocation.streetLine}`,
      addressLocality: companyLocation.addressLocality,
      addressRegion: companyLocation.addressRegion,
      addressCountry: companyLocation.addressCountry,
    },
    location: {
      "@type": "Place",
      "@id": locationId,
      name: companyLocation.venue,
      address: {
        "@type": "PostalAddress",
        streetAddress: companyLocation.streetLine,
        addressLocality: companyLocation.addressLocality,
        addressRegion: companyLocation.addressRegion,
        addressCountry: companyLocation.addressCountry,
      },
      hasMap: companyLocation.googleMapsUrl,
    },
  };
  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: siteUrl,
    description: defaultDescription,
    inLanguage: DEFAULT_MARKETPLACE_LOCALE,
    publisher: { "@id": organizationId },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/?search={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
  return <html lang={DEFAULT_MARKETPLACE_LOCALE}><head>
    <script src="/seo-measurement.js" data-cloud={process.env.NEXT_PUBLIC_MED250_OBSERVABILITY === "cloud" ? "1" : "0"} defer />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/brand/favicon-16.png" sizes="16x16" type="image/png" />
    <link rel="icon" href="/brand/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="icon" href="/brand/favicon-48.png" sizes="48x48" type="image/png" />
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" sizes="180x180" type="image/png" />
  </head><body className={`${display.variable} ${sans.variable}`}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationSchema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteSchema) }} /><NavigationFeedback /><PwaManager /><SiteWebMcpRegistrar />{children}</body></html>;
}
