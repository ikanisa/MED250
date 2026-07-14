import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Marketplace from "../../marketplace";
import { getProductSeo, productSeoDescription, toMarketplaceProduct } from "../../../lib/product-seo";
import { absoluteUrl } from "../../../lib/site";
import { safeJsonLd } from "../../../lib/safe-json-ld";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = getProductSeo(id);
  if (!product) return { title: "Product not found", robots: { index: false, follow: false } };
  const description = productSeoDescription(product);
  const title = [product.brand, product.strength].filter(Boolean).join(" ");
  return {
    title,
    description,
    alternates: { canonical: `/product/${encodeURIComponent(product.id)}` },
    openGraph: { type: "website", title, description, url: `/product/${encodeURIComponent(product.id)}`, images: [{ url: "/og-marketplace-v2.png", width: 1200, height: 630, alt: "MED+250 Rwanda pharmacy marketplace" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og-marketplace-v2.png"] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = getProductSeo(id);
  if (!product) notFound();
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: [product.brand, product.strength].filter(Boolean).join(" "),
    description: productSeoDescription(product),
    sku: product.registrationNumber || product.id,
    category: product.category,
    url: absoluteUrl(`/product/${encodeURIComponent(product.id)}`),
    additionalProperty: [
      product.generic ? { "@type": "PropertyValue", name: "Generic name", value: product.generic } : null,
      product.form ? { "@type": "PropertyValue", name: "Dosage form", value: product.form } : null,
      product.packSize ? { "@type": "PropertyValue", name: "Pack size", value: product.packSize } : null,
      product.manufacturer || product.manufacturerCountry ? { "@type": "PropertyValue", name: "Manufacturer", value: [product.manufacturer, product.manufacturerCountry].filter(Boolean).join(" · ") } : null,
      product.registrationNumber ? { "@type": "PropertyValue", name: "Rwanda FDA registration", value: product.registrationNumber } : null,
    ].filter(Boolean),
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Products", item: absoluteUrl("/categories") },
      { "@type": "ListItem", position: 3, name: product.brand, item: absoluteUrl(`/product/${encodeURIComponent(product.id)}`) },
    ],
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(productSchema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} /><Marketplace initialProductId={id} initialProduct={toMarketplaceProduct(product)} /></>;
}
