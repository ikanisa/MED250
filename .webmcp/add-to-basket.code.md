import { defineTool } from "@nekuda/webmcp-sdk";
import { loadCatalogueProductsByIds } from "../lib/dawanear-client";
import { requireMarketplaceRuntime } from "./marketplace-runtime";

type AddToBasketInput = {
  product_id: string;
  quantity: number;
  substitutes_allowed: boolean;
};

export const addToOrderBasket = defineTool<AddToBasketInput>({
  stableKey: "request_basket.add",
  name: "add_to_order_basket",
  title: "Add to MED+250 request basket",
  description: "Add an approved, orderable MED+250 product to the visitor's local request basket. Use when the visitor chooses a product and quantity. Returns the updated basket summary and opens the visible basket. This changes only reversible local basket state and does not contact a pharmacy.",
  inputSchema: {
    type: "object",
    properties: {
      product_id: { type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9-]+$", description: "The approved MED+250 product identifier." },
      quantity: { type: "integer", minimum: 1, maximum: 99, description: "Quantity to add, from 1 to 99." },
      substitutes_allowed: { type: "boolean", description: "Whether the visitor permits a pharmacy-proposed substitute." },
    },
    required: ["product_id", "quantity", "substitutes_allowed"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  async execute({ product_id, quantity, substitutes_allowed }) {
    const productId = product_id.trim();
    if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) throw new Error("The MED+250 product identifier is invalid.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error("Request-basket quantity must be between 1 and 99.");
    }
    const [product] = await loadCatalogueProductsByIds([productId]);
    if (!product) throw new Error("The MED+250 product is not available in the public catalogue.");
    if (!product.isOrderable) throw new Error("This MED+250 product is visible but cannot be added to an availability request.");
    const basket = requireMarketplaceRuntime().addToBasket(product, quantity, substitutes_allowed);
    return {
      basket,
      note: "The visible request basket is open. No pharmacy has been contacted.",
    };
  },
});
