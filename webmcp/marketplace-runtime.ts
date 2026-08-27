import type { Product } from "../lib/dawanear-client";

export type MarketplaceSearchView = {
  query: string;
  category?: string;
  prescriptionStatus?: string;
  formGroup?: string;
};

export type MarketplaceBasketItemSummary = {
  productId: string;
  name: string;
  quantity: number;
  substitutesAllowed: boolean;
};

export type MarketplaceBasketSummary = {
  itemKinds: number;
  itemCount: number;
  items: MarketplaceBasketItemSummary[];
};

export type MarketplaceSearchResult = {
  products: Product[];
  total: number;
  explanations: Map<string, string>;
};

export type MarketplaceToolRuntime = {
  searchPreview(input: MarketplaceSearchView & { limit: number }): MarketplaceSearchResult;
  showSearch(input: MarketplaceSearchView): void;
  showProduct(productId: string): void;
  addToBasket(product: Product, quantity: number, substitutesAllowed: boolean): MarketplaceBasketSummary;
  updateBasket(productId: string, quantity: number, substitutesAllowed: boolean): MarketplaceBasketSummary;
  prepareRequest(): MarketplaceBasketSummary;
};

let runtimeResolver: (() => MarketplaceToolRuntime | null) | null = null;

export function setMarketplaceRuntimeResolver(resolver: () => MarketplaceToolRuntime | null) {
  runtimeResolver = resolver;
  return () => {
    if (runtimeResolver === resolver) runtimeResolver = null;
  };
}

export function requireMarketplaceRuntime(): MarketplaceToolRuntime {
  const runtime = runtimeResolver?.() ?? null;
  if (!runtime) throw new Error("The MED+250 marketplace is not available on this page.");
  return runtime;
}
