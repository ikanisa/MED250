/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  MED250_RELEASE_MODE?: "preview" | "catalog" | "live";
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://uskfnszcdqpcfrhjxitl.supabase.co wss://uskfnszcdqpcfrhjxitl.supabase.co https://maps.googleapis.com https://maps.gstatic.com",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.gstatic.com",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://maps.googleapis.com https://maps.gstatic.com https://static.cloudflareinsights.com",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "frame-src https://challenges.cloudflare.com",
  "upgrade-insecure-requests",
  "worker-src 'self' blob:",
].join("; ");

function withSecurityHeaders(request: Request, response: Response, requestId: string, durationMs: number, releaseMode: Env["MED250_RELEASE_MODE"]) {
  const headers = new Headers(response.headers);
  const hostname = new URL(request.url).hostname;
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-site");
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set("Permissions-Policy", "camera=(), geolocation=(self), microphone=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("X-Request-Id", requestId);
  headers.set("Server-Timing", `app;dur=${durationMs.toFixed(1)}`);
  if (releaseMode === "preview" || !releaseMode || hostname.endsWith(".workers.dev")) headers.set("X-Robots-Tag", "noindex, nofollow");
  if (new URL(request.url).protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    let response: Response;

    try {
      if (url.pathname === "/_vinext/image" && env?.ASSETS && env.IMAGES) {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        const imageResponse = await handleImageOptimization(request, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
            return result.response();
          },
        }, allowedWidths);
        response = imageResponse;
      } else {
        response = await handler.fetch(request, env ?? {}, ctx);
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "http_request_failed",
        requestId,
        method: request.method,
        path: url.pathname,
        errorType: error instanceof Error ? error.name : "UnknownError",
      }));
      response = new Response("Service temporarily unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const durationMs = performance.now() - startedAt;
    console.log(JSON.stringify({
      event: "http_request",
      requestId,
      method: request.method,
      path: url.pathname,
      status: response.status,
      durationMs: Math.round(durationMs),
    }));
    return withSecurityHeaders(request, response, requestId, durationMs, env?.MED250_RELEASE_MODE);
  },
};

export default worker;
