import localeReleases from "../data/localization/locale-releases.json";

export const MARKETPLACE_LOCALES = ["en-RW", "rw-RW", "fr-RW"] as const;
export type MarketplaceLocale = (typeof MARKETPLACE_LOCALES)[number];

export const DEFAULT_MARKETPLACE_LOCALE = "en-RW" satisfies MarketplaceLocale;
export const MARKETPLACE_TIME_ZONE = localeReleases.time_zone;

type Release = (typeof localeReleases.releases)[number];

const releasesByLocale = new Map(localeReleases.releases.map((release) => [release.locale, release]));
const releasesBySegment = new Map(localeReleases.releases.map((release) => [release.segment, release]));

export function marketplaceLocaleFromSegment(segment: string): MarketplaceLocale | null {
  const release = releasesBySegment.get(segment.toLowerCase());
  return release?.locale && MARKETPLACE_LOCALES.includes(release.locale as MarketplaceLocale)
    ? release.locale as MarketplaceLocale
    : null;
}

export function marketplaceLocaleRelease(locale: MarketplaceLocale): Release {
  const release = releasesByLocale.get(locale);
  if (!release) throw new Error(`Unsupported marketplace locale: ${locale}`);
  return release;
}

export function isPublicMarketplaceLocale(locale: MarketplaceLocale): boolean {
  return marketplaceLocaleRelease(locale).public;
}

export function requirePublicMarketplaceLocale(locale: MarketplaceLocale): MarketplaceLocale {
  if (!isPublicMarketplaceLocale(locale)) {
    throw new Error(`Marketplace locale is not approved for publication: ${locale}`);
  }
  return locale;
}

function normalizedPath(pathname: string): string {
  if (!pathname.startsWith("/")) throw new Error(`Marketplace paths must be absolute: ${pathname}`);
  const normalized = pathname.replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

export function localizedMarketplacePath(pathname: string, locale: MarketplaceLocale): string | null {
  const release = marketplaceLocaleRelease(locale);
  const path = normalizedPath(pathname);
  if (!release.public) return null;
  if (locale === DEFAULT_MARKETPLACE_LOCALE) return path;
  return path === "/" ? `/${release.segment}` : `/${release.segment}${path}`;
}

const supportedRoutePatterns = [
  /^\/$/,
  /^\/categories$/,
  /^\/category\/(medicines|personal-care|baby-family|wellness)$/,
  /^\/pharmacies$/,
  /^\/(contact|privacy|terms)$/,
  /^\/product\/[^/]+$/,
];

export function marketplaceCanonicalRoute(segments: readonly string[]): string | null {
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/"))) return null;
  const pathname = segments.length ? `/${segments.map(encodeURIComponent).join("/")}` : "/";
  return supportedRoutePatterns.some((pattern) => pattern.test(pathname)) ? pathname : null;
}

export function marketplaceLanguageAlternates(pathname: string): Record<string, string> {
  return Object.fromEntries(
    MARKETPLACE_LOCALES.flatMap((locale) => {
      const path = localizedMarketplacePath(pathname, locale);
      return path ? [[locale, path]] : [];
    }),
  );
}

export function marketplaceAlternates(pathname: string) {
  const canonical = localizedMarketplacePath(pathname, DEFAULT_MARKETPLACE_LOCALE) ?? pathname;
  return { canonical, languages: marketplaceLanguageAlternates(pathname) };
}

export function marketplaceOpenGraphLocale(locale: MarketplaceLocale = DEFAULT_MARKETPLACE_LOCALE): string {
  requirePublicMarketplaceLocale(locale);
  return locale.replace("-", "_");
}

export function marketplaceNumber(value: number, locale: MarketplaceLocale = DEFAULT_MARKETPLACE_LOCALE): string {
  requirePublicMarketplaceLocale(locale);
  return new Intl.NumberFormat(locale).format(value);
}

export function marketplaceDate(
  value: string | number | Date,
  locale: MarketplaceLocale = DEFAULT_MARKETPLACE_LOCALE,
  options: Intl.DateTimeFormatOptions = {},
): string {
  requirePublicMarketplaceLocale(locale);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return typeof value === "string" ? value : "";
  const displayOptions = Object.keys(options).length
    ? { timeZone: MARKETPLACE_TIME_ZONE, ...options }
    : { day: "numeric", month: "short", year: "numeric", timeZone: MARKETPLACE_TIME_ZONE } satisfies Intl.DateTimeFormatOptions;
  return new Intl.DateTimeFormat(locale, displayOptions).format(date);
}

export function marketplaceRegionName(region: string, locale: MarketplaceLocale = DEFAULT_MARKETPLACE_LOCALE): string {
  requirePublicMarketplaceLocale(locale);
  return new Intl.DisplayNames([locale], { type: "region" }).of(region) ?? region;
}
