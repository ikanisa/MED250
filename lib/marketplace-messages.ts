import runtimeCatalog from "../data/localization/runtime-messages.en-RW.json";
import { DEFAULT_MARKETPLACE_LOCALE, requirePublicMarketplaceLocale, type MarketplaceLocale } from "./marketplace-locale";

export type MarketplaceMessageId = keyof typeof runtimeCatalog.messages;

export function marketplaceMessage(
  id: MarketplaceMessageId,
  locale: MarketplaceLocale = DEFAULT_MARKETPLACE_LOCALE,
): string {
  requirePublicMarketplaceLocale(locale);
  if (locale !== runtimeCatalog.locale) {
    throw new Error(`No approved message catalog is loaded for ${locale}`);
  }
  return runtimeCatalog.messages[id];
}

export function marketplaceFormatMessage(
  id: MarketplaceMessageId,
  values: readonly (string | number)[],
  locale: MarketplaceLocale = DEFAULT_MARKETPLACE_LOCALE,
): string {
  const template = marketplaceMessage(id, locale);
  return template.replace(/\{(\d+)\}/g, (placeholder, rawIndex: string) => {
    const value = values[Number(rawIndex)];
    if (value === undefined || value === null) {
      throw new Error(`Missing value ${rawIndex} for marketplace message ${id}`);
    }
    return String(value);
  });
}

export const marketplaceSourceCatalogVersion = runtimeCatalog.version;
