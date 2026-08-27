"use client";

import { useEffect, type RefObject } from "react";
import { registerTools } from "@nekuda/webmcp-sdk";
import { addToOrderBasket } from "./add-to-basket";
import { getProductDetails } from "./product-details";
import { prepareOrderRequest } from "./prepare-request";
import { searchProducts } from "./search-products";
import { setMarketplaceRuntimeResolver, type MarketplaceToolRuntime } from "./marketplace-runtime";
import { updateOrderBasket } from "./update-basket";

type MarketplaceWebMcpRegistrarProps = {
  basketCount: number;
  runtimeRef: RefObject<MarketplaceToolRuntime | null>;
};

export function MarketplaceWebMcpRegistrar({ basketCount, runtimeRef }: MarketplaceWebMcpRegistrarProps) {
  useEffect(() => {
    const clearRuntime = setMarketplaceRuntimeResolver(() => runtimeRef.current);
    const tools = basketCount > 0
      ? [searchProducts, getProductDetails, addToOrderBasket, updateOrderBasket, prepareOrderRequest]
      : [searchProducts, getProductDetails, addToOrderBasket];
    const registration = registerTools(tools, { telemetry: false });
    return () => {
      registration.unregister();
      clearRuntime();
    };
  }, [basketCount, runtimeRef]);
  return null;
}
