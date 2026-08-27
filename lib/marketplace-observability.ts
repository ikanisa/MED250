export type MarketplaceEventName =
  | "catalogue_search"
  | "catalogue_hierarchy_selected"
  | "catalogue_view_changed"
  | "product_added"
  | "order_started"
  | "order_placed"
  | "order_failed"
  | "pharmacy_selected"
  | "whatsapp_handoff"
  | "momo_handoff";

type SafeMarketplaceProperties = Record<string, string | number | boolean | null>;

/**
 * Emits deliberately low-cardinality marketplace signals without product names,
 * phone numbers, coordinates, order IDs, prescription data, or pharmacy IDs.
 */
export function trackMarketplaceEvent(name: MarketplaceEventName, properties: SafeMarketplaceProperties = {}) {
  if (typeof window === "undefined") return;
  const detail = { name, properties, occurredAt: new Date().toISOString() };
  const observabilityMode = String(process.env.NEXT_PUBLIC_MED250_OBSERVABILITY ?? "");
  window.dispatchEvent(new CustomEvent("med250:marketplace-event", { detail }));
  if (observabilityMode === "debug") {
    console.info("[MED+250 marketplace]", detail);
  }
  if (process.env.NEXT_PUBLIC_MED250_OBSERVABILITY === "cloud") {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, properties }),
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  }
}
