import { defineTool } from "@nekuda/webmcp-sdk";
import { requireMarketplaceRuntime } from "./marketplace-runtime";

type UpdateBasketInput = {
  product_id: string;
  quantity: number;
  substitutes_allowed: boolean;
};

export const updateOrderBasket = defineTool<UpdateBasketInput>({
  stableKey: "request_basket.update",
  name: "update_order_basket",
  title: "Update MED+250 request basket",
  description: "Set a product quantity in the visitor's MED+250 request basket, or remove it by setting quantity to zero. Use when the visitor changes a reversible basket choice. Returns the updated basket summary and keeps the visible basket in sync. No pharmacy is contacted.",
  inputSchema: {
    type: "object",
    properties: {
      product_id: { type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9-]+$", description: "A product already present in the basket." },
      quantity: { type: "integer", minimum: 0, maximum: 99, description: "New quantity from 0 to 99; zero removes the product." },
      substitutes_allowed: { type: "boolean", description: "Whether substitutes remain permitted for this item." },
    },
    required: ["product_id", "quantity", "substitutes_allowed"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  async execute({ product_id, quantity, substitutes_allowed }) {
    const productId = product_id.trim();
    if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) throw new Error("The MED+250 product identifier is invalid.");
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
      throw new Error("Request-basket quantity must be between 0 and 99.");
    }
    const basket = requireMarketplaceRuntime().updateBasket(productId, quantity, substitutes_allowed);
    return {
      basket,
      note: quantity === 0
        ? "The product was removed from the visible request basket. No pharmacy has been contacted."
        : "The visible request basket was updated. No pharmacy has been contacted.",
    };
  },
});
