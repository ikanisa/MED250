const RWANDA_BOUNDS = Object.freeze({
  minimumLatitude: -3,
  maximumLatitude: -0.8,
  minimumLongitude: 28.7,
  maximumLongitude: 30.9,
});

const GOOGLE_MAPS_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
]);

const GOOGLE_MAPS_SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const MAX_SHARED_URL_LENGTH = 2_048;

export type GoogleMapsLocation = {
  latitude: number;
  longitude: number;
  canonicalUrl: string;
};

export type GoogleMapsLocationResolution =
  | { matched: false; location: null }
  | { matched: true; location: GoogleMapsLocation | null };

function trustedMapsUrl(raw: string): URL | null {
  if (raw.length > MAX_SHARED_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
    || !GOOGLE_MAPS_HOSTS.has(url.hostname.toLowerCase())
  ) return null;
  return url;
}

function sharedMapsUrl(body: string): URL | null {
  const candidates = body.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  for (const candidate of candidates) {
    const withoutTrailingPunctuation = candidate.replace(/[),.;!?]+$/g, "");
    const url = trustedMapsUrl(withoutTrailingPunctuation);
    if (url) return url;
  }
  return null;
}

function rwandaCoordinates(latitude: number, longitude: number): Pick<GoogleMapsLocation, "latitude" | "longitude"> | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (
    latitude < RWANDA_BOUNDS.minimumLatitude
    || latitude > RWANDA_BOUNDS.maximumLatitude
    || longitude < RWANDA_BOUNDS.minimumLongitude
    || longitude > RWANDA_BOUNDS.maximumLongitude
  ) return null;
  return { latitude, longitude };
}

function coordinatePair(value: string): Pick<GoogleMapsLocation, "latitude" | "longitude"> | null {
  const match = value.match(/(?:^|[^0-9.-])(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)(?:$|[^0-9.])/);
  if (!match) return null;
  return rwandaCoordinates(Number(match[1]), Number(match[2]));
}

function coordinatesFromUrl(url: URL): GoogleMapsLocation | null {
  let decodedUrl = url.href;
  try {
    decodedUrl = decodeURIComponent(url.href);
  } catch {
    return null;
  }
  const atCoordinates = decodedUrl.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,|\/|$)/);
  const dataCoordinates = decodedUrl.match(/!3d(-?\d{1,2}(?:\.\d+)?).*?!4d(-?\d{1,3}(?:\.\d+)?)/);
  const pair = atCoordinates
    ? rwandaCoordinates(Number(atCoordinates[1]), Number(atCoordinates[2]))
    : dataCoordinates
      ? rwandaCoordinates(Number(dataCoordinates[1]), Number(dataCoordinates[2]))
      : ["query", "q", "center", "ll", "destination"]
        .map((name) => url.searchParams.get(name))
        .filter((value): value is string => Boolean(value))
        .map(coordinatePair)
        .find((value) => value !== null) ?? null;
  return pair ? { ...pair, canonicalUrl: url.toString() } : null;
}

async function cancelBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The redirect target and headers are sufficient; a closed body needs no recovery.
  }
}

export async function resolveGoogleMapsLocation(
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleMapsLocationResolution> {
  const sharedUrl = sharedMapsUrl(body);
  if (!sharedUrl) return { matched: false, location: null };

  let current = sharedUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const parsed = coordinatesFromUrl(current);
    if (parsed) return { matched: true, location: parsed };
    if (!GOOGLE_MAPS_SHORT_HOSTS.has(current.hostname.toLowerCase()) || redirects === MAX_REDIRECTS) {
      return { matched: true, location: null };
    }

    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      return { matched: true, location: null };
    }
    const nextLocation = response.headers.get("location");
    await cancelBody(response);
    if (!REDIRECT_STATUSES.has(response.status) || !nextLocation) return { matched: true, location: null };
    const next = trustedMapsUrl(new URL(nextLocation, current).toString());
    if (!next) return { matched: true, location: null };
    current = next;
  }
  return { matched: true, location: null };
}
