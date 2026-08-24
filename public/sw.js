const CACHE_PREFIX = "med250-marketplace-";
const CACHE_NAME = "med250-marketplace-static-v4";
const PAGE_CACHE_NAME = "med250-marketplace-pages-v4";
const PUBLIC_MEDIA_CACHE_NAME = "med250-marketplace-public-media-v4";
const LEGACY_CACHE_NAMES = new Set([
  "med250-static-v1",
  "med250-static-v2",
  "med250-static-v3",
  "med250-pages-v1",
  "med250-pages-v2",
  "med250-pages-v3",
  "med250-public-media-v1",
  "med250-public-media-v2",
  "med250-public-media-v3",
]);
const OFFLINE_URL = "/offline.html";
const NAVIGATION_TIMEOUT_MS = 4_000;
const MAX_STATIC_ENTRIES = 96;
const MAX_PAGE_ENTRIES = 24;
const MAX_PUBLIC_MEDIA_ENTRIES = 48;
const STATIC_SHELL = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/brand/app-icon-192.png",
  "/brand/app-icon-512.png",
  "/brand/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => (key.startsWith(CACHE_PREFIX) || LEGACY_CACHE_NAMES.has(key))
        && ![CACHE_NAME, PAGE_CACHE_NAME, PUBLIC_MEDIA_CACHE_NAME].includes(key))
      .map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_MED250_CACHES") {
    event.waitUntil(caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) || LEGACY_CACHE_NAMES.has(key))
        .map((key) => caches.delete(key))))
      .then(() => event.source?.postMessage({ type: "MED250_CACHES_CLEARED" })));
  }
});

function isPrivatePath(url) {
  return url.pathname.startsWith("/api/auth/")
    || url.pathname.startsWith("/api/orders")
    || url.pathname.startsWith("/api/pharmacy/")
    || url.pathname.startsWith("/api/internal/")
    || url.pathname.startsWith("/api/twilio/")
    || url.pathname.startsWith("/pharmacies")
    || url.pathname.startsWith("/pharmacy-prescription/")
    || url.pathname.startsWith("/whatsapp/")
    || url.pathname.startsWith("/whatsapp-client-media/")
    || url.pathname.startsWith("/whatsapp-order-media/")
    || url.searchParams.has("request")
    || url.searchParams.has("pharmacy-portal")
    || url.searchParams.has("token");
}

function responseCanBeStored(response, requirePublic = false) {
  if (!response.ok || response.type !== "basic") return false;
  const cacheControl = response.headers.get("Cache-Control")?.toLowerCase() ?? "";
  if (cacheControl.includes("no-store") || cacheControl.includes("private")) return false;
  return !requirePublic || cacheControl.includes("public") || cacheControl.includes("immutable");
}

async function trimCache(cacheName, maximumEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maximumEntries)).map((key) => cache.delete(key)));
}

async function store(cacheName, request, response, maximumEntries, requirePublic = false) {
  if (!responseCanBeStored(response, requirePublic)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  await trimCache(cacheName, maximumEntries);
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isCacheableNavigation(url) {
  if (isPrivatePath(url)) return false;
  return url.pathname === "/"
    || url.pathname === "/categories"
    || url.pathname === "/privacy"
    || url.pathname === "/terms"
    || url.pathname === "/accessibility"
    || url.pathname.startsWith("/category/")
    || url.pathname.startsWith("/product/");
}

async function publicNavigationResponse(event, request, url) {
  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    if (isCacheableNavigation(url)) event.waitUntil(store(PAGE_CACHE_NAME, request, response, MAX_PAGE_ENTRIES));
    return response;
  } catch {
    const pageCache = await caches.open(PAGE_CACHE_NAME);
    const staticCache = await caches.open(CACHE_NAME);
    const cached = await pageCache.match(request)
      || await pageCache.match(url.pathname)
      || await staticCache.match(OFFLINE_URL);
    return cached;
  }
}

function isImmutableStaticAsset(url) {
  return url.pathname.startsWith("/assets/")
    || url.pathname.startsWith("/brand/")
    || url.pathname.startsWith("/marketplace/");
}

async function immutableAssetResponse(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  event.waitUntil(store(CACHE_NAME, request, response, MAX_STATIC_ENTRIES));
  return response;
}

async function publicMediaResponse(event, request) {
  const cache = await caches.open(PUBLIC_MEDIA_CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    event.waitUntil(store(PUBLIC_MEDIA_CACHE_NAME, request, response, MAX_PUBLIC_MEDIA_ENTRIES, true));
    return response;
  });
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivatePath(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(publicNavigationResponse(event, request, url));
    return;
  }

  if (/^\/api\/catalogue\/media\/[A-Za-z0-9-]{1,80}\/[1-6]$/.test(url.pathname)) {
    event.respondWith(publicMediaResponse(event, request));
    return;
  }

  if (["font", "image", "script", "style"].includes(request.destination) && isImmutableStaticAsset(url)) {
    event.respondWith(immutableAssetResponse(event, request));
  }
});
