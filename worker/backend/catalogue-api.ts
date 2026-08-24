import { PayloadTooLargeError, readBodyText } from "./bounded-body.ts";
import { CatalogueRepository, type CatalogueSearch } from "./catalogue-repository.ts";
import { d1Database, privateMediaBucket } from "./runtime-env.ts";

const JSON_BODY_LIMIT = 16 * 1024;
const CATALOGUE_CACHE = "public, max-age=60, stale-while-revalidate=300";
const MEDIA_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
const MEDIA_PATH = /^\/api\/catalogue\/media\/([A-Za-z0-9-]{1,80})\/([1-6])$/;

function integerParameter(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null || value === "") return fallback;
  if (!/^[0-9]{1,5}$/.test(value)) throw new Error("invalid_integer");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("invalid_integer");
  return parsed;
}

function boundedText(value: string | null, fallback: string, maximum: number): string {
  const text = value?.trim() ?? fallback;
  if (text.length > maximum) throw new Error("invalid_text");
  return text;
}

function enumValue<T extends string>(value: string | null, fallback: T, allowed: readonly T[]): T {
  const candidate = value?.trim() || fallback;
  if (!allowed.includes(candidate as T)) throw new Error("invalid_enum");
  return candidate as T;
}

function parsedSearch(url: URL): CatalogueSearch {
  return {
    query: boundedText(url.searchParams.get("query"), "", 160),
    category: boundedText(url.searchParams.get("category"), "All products", 160),
    prescriptionStatus: boundedText(url.searchParams.get("prescriptionStatus"), "all", 40),
    formGroup: enumValue(
      url.searchParams.get("formGroup"),
      "all",
      ["all", "tablets", "liquids", "injections", "topical", "devices", "other"] as const,
    ),
    availability: enumValue(
      url.searchParams.get("availability"),
      "all",
      ["all", "priced", "orderable", "registered"] as const,
    ),
    sort: enumValue(
      url.searchParams.get("sort"),
      "relevance",
      ["relevance", "az", "za", "price"] as const,
    ),
    limit: integerParameter(url.searchParams.get("limit"), 24, 1, 120),
    offset: integerParameter(url.searchParams.get("offset"), 0, 0, 10_000),
  };
}

async function parsedIds(request: Request, maximum: number): Promise<string[]> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new TypeError("unsupported_content_type");
  }
  const raw = await readBodyText(request, JSON_BODY_LIMIT);
  const payload: unknown = JSON.parse(raw);
  if (typeof payload !== "object" || payload === null) throw new Error("invalid_payload");
  const ids: unknown = Reflect.get(payload, "ids");
  if (!Array.isArray(ids) || !ids.length || ids.length > maximum || ids.some((id) => typeof id !== "string")) {
    throw new Error("invalid_ids");
  }
  return ids;
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", (init.status ?? 200) >= 400 ? "no-store" : CATALOGUE_CACHE);
  return Response.json(payload, { ...init, headers });
}

export async function catalogueApiResponse(
  request: Request,
  repository: CatalogueRepository,
): Promise<Response | null> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/catalogue") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
      const receipt = await repository.search(parsedSearch(url));
      return json(receipt);
    }
    if (url.pathname === "/api/catalogue/taxonomy") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
      return json({ rows: await repository.taxonomy() });
    }
    if (url.pathname === "/api/catalogue/products") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
      return json({ rows: await repository.productsByIds(await parsedIds(request, 100)) });
    }
    if (url.pathname === "/api/catalogue/image-presentations") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
      return json({ rows: await repository.imagePresentations(await parsedIds(request, 24)) });
    }
    return null;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: "payload_too_large" }, { status: 413 });
    if (error instanceof TypeError && error.message === "unsupported_content_type") {
      return json({ error: "unsupported_content_type" }, { status: 415 });
    }
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof Error && /^invalid_/.test(error.message)) {
      return json({ error: "invalid_request" }, { status: 400 });
    }
    throw error;
  }
}

export async function catalogueResponse(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/catalogue")) return null;
  const mediaMatch = path.match(MEDIA_PATH);
  if (mediaMatch) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
    }
    const media = await new CatalogueRepository(d1Database(env)).publicMedia(mediaMatch[1], Number(mediaMatch[2]));
    if (!media) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    const etag = `"${media.sha256}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { "Cache-Control": MEDIA_CACHE, "ETag": etag },
      });
    }
    const object = await privateMediaBucket(env).get(media.r2Key);
    if (!object) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    const contentType = object.httpMetadata?.contentType;
    if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      await object.body.cancel("invalid_content_type");
      return new Response("Unsupported media", { status: 415, headers: { "Cache-Control": "no-store" } });
    }
    const headers = new Headers({
      "Cache-Control": MEDIA_CACHE,
      "Content-Length": String(object.size),
      "Content-Type": contentType,
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") {
      await object.body.cancel("head_request");
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  }
  if (!["/api/catalogue", "/api/catalogue/taxonomy", "/api/catalogue/products", "/api/catalogue/image-presentations"].includes(path)) {
    return null;
  }
  return catalogueApiResponse(request, new CatalogueRepository(d1Database(env)));
}
