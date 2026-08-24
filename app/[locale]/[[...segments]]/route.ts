import {
  DEFAULT_MARKETPLACE_LOCALE,
  isPublicMarketplaceLocale,
  marketplaceCanonicalRoute,
  marketplaceLocaleFromSegment,
} from "../../../lib/marketplace-locale";

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

async function localeAliasResponse(
  request: Request,
  { params }: { params: Promise<{ locale: string; segments?: string[] }> },
) {
  const { locale: localeSegment, segments = [] } = await params;
  const locale = marketplaceLocaleFromSegment(localeSegment);
  if (!locale || !isPublicMarketplaceLocale(locale)) return notFoundResponse();

  const canonicalRoute = marketplaceCanonicalRoute(segments);
  if (!canonicalRoute) return notFoundResponse();

  if (locale === DEFAULT_MARKETPLACE_LOCALE) {
    const incoming = new URL(request.url);
    const destination = new URL(canonicalRoute, incoming.origin);
    destination.search = incoming.search;
    return Response.redirect(destination, 308);
  }

  // Non-default releases stay unreachable until their complete catalog,
  // renderer, and clinical/legal review evidence pass the release validator.
  return notFoundResponse();
}

export const GET = localeAliasResponse;
export const HEAD = localeAliasResponse;
