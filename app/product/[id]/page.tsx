import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Marketplace from "../../marketplace";
import { getProductSeo, productSeoDescription, toMarketplaceProduct } from "../../../lib/product-seo";
import { getPublicCatalogueTaxonomy, getPublicMarketplaceProduct, getPublicProductImages } from "../../../lib/public-marketplace-product";
import { absoluteUrl } from "../../../lib/site";
import { safeJsonLd } from "../../../lib/safe-json-ld";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const localProduct = getProductSeo(id);
  const baseProduct = localProduct ? toMarketplaceProduct(localProduct) : await getPublicMarketplaceProduct(id);
  const imageUrls = localProduct ? await getPublicProductImages(id) : baseProduct?.imageUrls ?? [];
  const product = baseProduct ? {
    ...baseProduct,
    imageUrl: imageUrls[0] ?? baseProduct.imageUrl,
    imageUrls: imageUrls.length ? imageUrls : baseProduct.imageUrls,
  } : null;
  if (!product) return { title: "Product not found", robots: { index: false, follow: false } };
  const description = localProduct
    ? productSeoDescription(localProduct)
    : `${product.brand}${product.subcategory ? ` — ${product.subcategory}` : ""}. View central product information, request availability, and continue with a pharmacy on WhatsApp.`;
  const title = [product.brand, product.strength].filter(Boolean).join(" ");
  return {
    title,
    description,
    alternates: { canonical: `/product/${encodeURIComponent(product.id)}` },
    openGraph: { type: "website", title, description, url: `/product/${encodeURIComponent(product.id)}`, images: [{ url: product.imageUrl ?? "/og-marketplace-v2.png", width: product.imageUrl ? 1400 : 1200, height: product.imageUrl ? 1400 : 630, alt: product.imageUrl ? title : "MED+250 Rwanda pharmacy marketplace" }] },
    twitter: { card: "summary_large_image", title, description, images: [product.imageUrl ?? "/og-marketplace-v2.png"] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const localProduct = getProductSeo(id);
  const [remoteProduct, initialTaxonomy] = await Promise.all([
    localProduct ? Promise.resolve(null) : getPublicMarketplaceProduct(id),
    getPublicCatalogueTaxonomy(),
  ]);
  const baseProduct = localProduct ? toMarketplaceProduct(localProduct) : remoteProduct;
  const imageUrls = localProduct ? await getPublicProductImages(id) : baseProduct?.imageUrls ?? [];
  const product = baseProduct ? {
    ...baseProduct,
    imageUrl: imageUrls[0] ?? baseProduct.imageUrl,
    imageUrls: imageUrls.length ? imageUrls : baseProduct.imageUrls,
  } : null;
  if (!product) notFound();
  const description = localProduct
    ? productSeoDescription(localProduct)
    : `${product.brand}${product.subcategory ? ` — ${product.subcategory}` : ""}. View central product information, request availability, and continue with a pharmacy on WhatsApp.`;
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: [product.brand, product.strength].filter(Boolean).join(" "),
    description,
    sku: product.registrationNumber || product.id,
    category: product.category,
    image: product.imageUrls?.length ? product.imageUrls : product.imageUrl ? [product.imageUrl] : undefined,
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
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(productSchema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} /><Marketplace initialProductId={id} initialProduct={product} initialTaxonomy={initialTaxonomy} /></>;
}
