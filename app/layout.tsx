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
    title: "MED250 — Rwanda pharmacy marketplace launch candidate",
    description: "An Amazon-style multi-pharmacy marketplace for building one basket, comparing itemised offers, and choosing a licensed pharmacy in Rwanda.",
    openGraph: { title: "MED250", description: "A privacy-first Rwanda pharmacy marketplace launch candidate.", images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "MED250", description: "A privacy-first Rwanda pharmacy marketplace launch candidate.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${display.variable} ${sans.variable}`}>{children}</body></html>;
}
