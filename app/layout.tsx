import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const display = Manrope({ variable: "--font-display", subsets: ["latin"] });
const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "med250.rw";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "MED+250 — Rwanda pharmacy marketplace",
    description: "A multi-pharmacy marketplace for building one basket, comparing itemised offers, and choosing a pharmacy in Rwanda.",
    applicationName: "MED+250",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
        { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/brand/favicon-48.png", sizes: "48x48", type: "image/png" },
      ],
      apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
      shortcut: "/brand/favicon-32.png",
    },
    openGraph: { title: "MED+250", description: "A privacy-first Rwanda pharmacy marketplace.", images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "MED+250", description: "A privacy-first Rwanda pharmacy marketplace.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${display.variable} ${sans.variable}`}>{children}</body></html>;
}
