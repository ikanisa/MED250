import { defineTool } from "@nekuda/webmcp-sdk";
import { loadCatalogueProductsByIds } from "../lib/dawanear-client";
import { requireMarketplaceRuntime } from "./marketplace-runtime";
import { publicProductSummary } from "./product-summary";

type ProductDetailsInput = {
  product_id: string;
};

export const getProductDetails = defineTool<ProductDetailsInput>({
  stableKey: "catalogue.product_details",
  name: "get_product_details",
  title: "Get MED+250 product details",
  description: "Get current public details for one MED+250 catalogue product and open its visible product page. Use after search when a visitor wants strength, form, pack size, manufacturer, prescription status, indicative price or requestability. Returns the product summary and product-page path.",
  inputSchema: {
    type: "object",
    properties: {
      product_id: { type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9-]+$", description: "The MED+250 catalogue product identifier." },
    },
    required: ["product_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
  async execute({ product_id }) {
    const productId = product_id.trim();
    if (!/^[A-Za-z0-9-]{1,80}$/.test(productId)) throw new Error("The MED+250 product identifier is invalid.");
    const [product] = await loadCatalogueProductsByIds([productId]);
    if (!product) {
      return {
        product: null,
        note: "MED+250 has no current public catalogue product with this identifier.",
      };
    }
    requireMarketplaceRuntime().showProduct(product.id);
    return {
      product: publicProductSummary(product),
      note: "The visible MED+250 product page is opening.",
    };
  },
});
