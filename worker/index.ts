/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { authResponse } from "./backend/auth-api.ts";
import { catalogueResponse } from "./backend/catalogue-api.ts";
import { locationPageResponse } from "./backend/location-page.ts";
import { marketplaceResponse, pharmacyPrescriptionResponse } from "./backend/marketplace-api.ts";
import { sweepPrivateMediaRetention } from "./backend/media-retention.ts";
import { orderResponse } from "./backend/order-api.ts";
import { operationalHealthResponse } from "./backend/operational-health.ts";
import { operatorResponse } from "./backend/operator-api.ts";
import {
  isDispatchDeadLetterQueue,
  processDeadLetterBatch,
  processDispatchBatch,
  sweepDispatchOutbox,
} from "./backend/outbox-runtime.ts";
import { privateMediaResponse } from "./backend/private-media-response.ts";
import { d1Database, locationLinkSecret } from "./backend/runtime-env.ts";
import { twilioInboundResponse, twilioStatusResponse } from "./backend/whatsapp-runtime.ts";
import { WhatsAppRepository } from "./backend/whatsapp-repository.ts";

type ReleaseMode = "preview" | "catalog" | "live";

function supportedImageOutputFormat(format: string):
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/avif"
  | "rgb"
  | "rgba" {
  switch (format) {
    case "image/jpeg":
    case "image/png":
    case "image/gif":
    case "image/webp":
    case "image/avif":
    case "rgb":
    case "rgba":
      return format;
    default:
      return "image/webp";
  }
}

function runtimeReleaseRevision(env: Env | undefined): string | undefined {
  if (!env || !("MED250_RELEASE_REVISION" in env)) return undefined;
  const value = env.MED250_RELEASE_REVISION;
  return typeof value === "string" ? value : undefined;
}

function runtimeIndexingMode(env: Env | undefined): "private" | "public" | undefined {
  if (!env) return undefined;
  const value: unknown = Reflect.get(env, "NEXT_PUBLIC_MED250_INDEXING_MODE");
  return value === "private" || value === "public" ? value : undefined;
}

function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com",
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
    "frame-src https://challenges.cloudflare.com https://www.openstreetmap.org",
    "upgrade-insecure-requests",
    "worker-src 'self' blob:",
  ].join("; ");
}

async function whatsappSampleMediaResponse(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/whatsapp-client-media/") && !url.pathname.startsWith("/whatsapp-order-media/")) return null;
  if (url.pathname !== "/whatsapp-client-media/sample.png" && url.pathname !== "/whatsapp-order-media/sample.png") return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }
  return env.ASSETS.fetch(new Request(new URL("/brand/app-icon-512.png", request.url), request));
}

async function locationResponse(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/whatsapp/location" && pathname !== "/api/whatsapp/location") return null;
  if (pathname === "/whatsapp/location") return locationPageResponse(request, null, locationLinkSecret(env));
  return locationPageResponse(request, new WhatsAppRepository(d1Database(env)), locationLinkSecret(env));
}

function scheduleOutboxSweep(ctx: ExecutionContext, env: Env): void {
  ctx.waitUntil(sweepDispatchOutbox(env).catch((error) => {
    console.error(JSON.stringify({
      event: "dispatch_outbox_sweep_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
  }));
}

function schedulePrivateMediaRetention(ctx: ExecutionContext, env: Env): void {
  ctx.waitUntil(sweepPrivateMediaRetention(env).catch((error) => {
    console.error(JSON.stringify({
      event: "private_media_retention_sweep_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
  }));
}

function normalizedReleaseRevision(value: string | undefined) {
  const revision = value?.trim() ?? "";
  return /^[A-Za-z0-9._-]{7,64}$/.test(revision) ? revision : "";
}

function withSecurityHeaders(
  request: Request,
  response: Response,
  requestId: string,
  durationMs: number,
  releaseMode: ReleaseMode | undefined,
  indexingMode: "private" | "public" | undefined,
  releaseRevision: string | undefined,
) {
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  const hostname = url.hostname;
  headers.set("Content-Security-Policy", contentSecurityPolicy());
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-site");
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set("Permissions-Policy", "accelerometer=(), browsing-topics=(), camera=(), geolocation=(self), gyroscope=(), microphone=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("X-Request-Id", requestId);
  headers.set("Server-Timing", `app;dur=${durationMs.toFixed(1)}`);
  const revision = normalizedReleaseRevision(releaseRevision);
  if (revision) headers.set("X-MED250-Release-Revision", revision);
  if (indexingMode === "private" || releaseMode === "preview" || !releaseMode || hostname.endsWith(".workers.dev")) {
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (url.pathname === "/sw.js") headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  else if (url.pathname === "/manifest.webmanifest" || url.pathname === "/offline.html") headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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
    const loggedPath = url.pathname.startsWith("/whatsapp-client-media/") || url.pathname.startsWith("/whatsapp-order-media/")
      ? "/whatsapp-media/[redacted].png"
      : url.pathname.startsWith("/pharmacy-prescription/")
        ? "/pharmacy-prescription/[redacted]"
      : url.pathname;
    let response: Response;

    try {
      if (url.pathname === "/api/internal/health") {
        response = env
          ? await operationalHealthResponse(request, env) ?? new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
          : new Response("Service temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      } else if (url.pathname.startsWith("/api/internal/operator/")) {
        response = env
          ? await operatorResponse(request, env) ?? new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
          : new Response("Service temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      } else if (url.pathname === "/api/twilio/whatsapp/inbound") {
        response = env
          ? await twilioInboundResponse(request, env)
          : new Response("Service temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
        if (env && response.ok) scheduleOutboxSweep(ctx, env);
      } else if (url.pathname === "/api/twilio/whatsapp/status") {
        response = env
          ? await twilioStatusResponse(request, env)
          : new Response("Service temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      } else if (url.pathname.startsWith("/api/auth/")) {
        response = env
          ? await authResponse(request, env) ?? new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
          : new Response("Service temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
        if (env && response.ok && url.pathname.endsWith("/otp/request")) scheduleOutboxSweep(ctx, env);
      } else if (url.pathname === "/api/orders" || url.pathname.startsWith("/api/orders/")) {
        response = env
          ? await orderResponse(request, env) ?? new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
          : new Response("Service temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
        if (env && response.ok && url.pathname === "/api/orders" && request.method === "POST") scheduleOutboxSweep(ctx, env);
      } else if (url.pathname.startsWith("/api/pharmacy/")) {
        response = env
          ? await marketplaceResponse(request, env) ?? new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
          : new Response("Service temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      } else if (url.pathname === "/api/catalogue" || url.pathname.startsWith("/api/catalogue/")) {
        response = env
          ? await catalogueResponse(request, env) ?? new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
          : new Response("Service temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      } else {
        const resolvedLocation = env ? await locationResponse(request, env) : null;
        const prescriptionMedia = env && !resolvedLocation ? await pharmacyPrescriptionResponse(request, env) : null;
        const sampleMedia = env && !resolvedLocation && !prescriptionMedia ? await whatsappSampleMediaResponse(request, env) : null;
        const clientMedia = env && !resolvedLocation && !prescriptionMedia && !sampleMedia ? await privateMediaResponse(request, env) : null;
        if (resolvedLocation) {
          response = resolvedLocation;
          if (env && request.method === "POST" && response.ok) scheduleOutboxSweep(ctx, env);
        } else if (prescriptionMedia) {
          response = prescriptionMedia;
        } else if (sampleMedia) {
          response = sampleMedia;
        } else if (clientMedia) {
          response = clientMedia;
        } else if (url.pathname === "/_vinext/image" && env?.ASSETS && env.IMAGES) {
          const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
          const imageResponse = await handleImageOptimization(request, {
            fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
            transformImage: async (body, { width, format, quality }) => {
              const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({
                format: supportedImageOutputFormat(format),
                quality,
              });
              return result.response();
            },
          }, allowedWidths);
          response = imageResponse;
        } else {
          response = await handler.fetch(request, env ?? ({} as Env), ctx);
        }
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "http_request_failed",
        requestId,
        method: request.method,
        path: loggedPath,
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
      path: loggedPath,
      status: response.status,
      durationMs: Math.round(durationMs),
    }));
    return withSecurityHeaders(
      request,
      response,
      requestId,
      durationMs,
      env?.MED250_RELEASE_MODE as ReleaseMode | undefined,
      runtimeIndexingMode(env),
      runtimeReleaseRevision(env),
    );
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (isDispatchDeadLetterQueue(batch.queue)) await processDeadLetterBatch(batch, env);
    else await processDispatchBatch(batch, env);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    scheduleOutboxSweep(ctx, env);
    schedulePrivateMediaRetention(ctx, env);
  },
} satisfies ExportedHandler<Env>;

export default worker;
