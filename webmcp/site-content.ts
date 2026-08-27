import { marketplaceMessage } from "../lib/marketplace-messages";

export type SiteContentSection = {
  title: string;
  text: string;
  sourcePath: string;
  keywords: string[];
};

export const siteContentSections: SiteContentSection[] = [
  {
    title: "How MED+250 works",
    text: "Search the central catalogue, add products to an availability-request basket, share the required details in the visible request flow, and review private pharmacy confirmations. A request is not a purchase. Availability, final price, and fulfilment are confirmed with the selected pharmacy on WhatsApp.",
    sourcePath: "/",
    keywords: ["how", "works", "request", "order", "availability", "pharmacy", "whatsapp", "purchase"],
  },
  {
    title: "Catalogue and indicative prices",
    text: "MED+250 publishes central catalogue information and may show an indicative From RWF price. It does not publish pharmacy-specific stock or price lists. A pharmacy privately confirms availability and any final price.",
    sourcePath: "/categories",
    keywords: ["catalogue", "product", "medicine", "price", "indicative", "stock", "availability"],
  },
  {
    title: "Health-information boundary",
    text: marketplaceMessage("clinical.marketplace_disclaimer"),
    sourcePath: "/",
    keywords: ["medical", "advice", "diagnose", "prescribe", "treatment", "recommendation", "doctor"],
  },
  {
    title: marketplaceMessage("inventory.f1bcd650fb8d"),
    text: marketplaceMessage("inventory.0f91ad22b6e6"),
    sourcePath: "/privacy",
    keywords: ["privacy", "collect", "data", "information", "contact"],
  },
  {
    title: marketplaceMessage("inventory.ef4903cec8c5"),
    text: marketplaceMessage("inventory.b610143dd4e0"),
    sourcePath: "/privacy",
    keywords: ["location", "gps", "nearby", "pharmacy", "coordinates"],
  },
  {
    title: marketplaceMessage("inventory.ac8d2d623440"),
    text: marketplaceMessage("inventory.3ae751db9645"),
    sourcePath: "/privacy",
    keywords: ["prescription", "image", "upload", "health", "retention"],
  },
  {
    title: marketplaceMessage("inventory.ad2ded1604fd"),
    text: marketplaceMessage("inventory.bba907c266ce"),
    sourcePath: "/privacy",
    keywords: ["share", "pharmacy", "recipient", "whatsapp", "data"],
  },
  {
    title: marketplaceMessage("inventory.764e1f17bc8b"),
    text: marketplaceMessage("inventory.b2547a8aa861"),
    sourcePath: "/privacy",
    keywords: ["rights", "privacy", "delete", "contact", "support"],
  },
  {
    title: marketplaceMessage("inventory.34fdfeb1a74f"),
    text: marketplaceMessage("inventory.bab154b09440"),
    sourcePath: "/terms",
    keywords: ["terms", "service", "marketplace", "scope"],
  },
  {
    title: marketplaceMessage("inventory.0c9735eb46ff"),
    text: marketplaceMessage("inventory.d1e31ba567c1"),
    sourcePath: "/terms",
    keywords: ["price", "availability", "pharmacy", "confirm", "indicative"],
  },
  {
    title: marketplaceMessage("inventory.abb6a0114714"),
    text: marketplaceMessage("inventory.aa0f09787efd"),
    sourcePath: "/terms",
    keywords: ["prescription", "medicine", "request", "responsibility"],
  },
  {
    title: marketplaceMessage("inventory.035dadf132d1"),
    text: marketplaceMessage("inventory.135e5dcfa13a"),
    sourcePath: "/terms",
    keywords: ["delivery", "pickup", "fulfilment", "pharmacy"],
  },
  {
    title: marketplaceMessage("inventory.632e1c583941"),
    text: marketplaceMessage("inventory.8051138b54d4"),
    sourcePath: "/terms",
    keywords: ["contact", "whatsapp", "dispute", "support"],
  },
];
