import { d1Database, privateMediaBucket } from "./runtime-env.ts";
import { sha256Hex } from "./secure-token.ts";
import { WhatsAppRepository } from "./whatsapp-repository.ts";
import { WHATSAPP_IMAGE_MAX_BYTES } from "./r2-media.ts";
import { SERVICE_VCARD } from "./whatsapp-content.ts";

const MEDIA_PATH = /^\/whatsapp-(?:client|order)-media\/([A-Za-z0-9_-]{43})\.png$/;

export async function privateMediaResponse(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/whatsapp/med250.vcf" && ["GET", "HEAD"].includes(request.method)) {
    return new Response(request.method === "HEAD" ? null : SERVICE_VCARD, { headers: {
      "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": 'inline; filename="Med250.vcf"',
      "Content-Length": String(new TextEncoder().encode(SERVICE_VCARD).length), "Cache-Control": "public, max-age=3600",
    } });
  }
  if (!url.pathname.startsWith("/whatsapp-client-media/") && !url.pathname.startsWith("/whatsapp-order-media/")) return null;
  if (url.pathname === "/whatsapp-client-media/sample.png" || url.pathname === "/whatsapp-order-media/sample.png") return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }
  const token = url.pathname.match(MEDIA_PATH)?.[1];
  if (!token) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const repository = new WhatsAppRepository(d1Database(env));
  const tokenHash = await sha256Hex(token);
  const r2Key = await repository.inspectMediaGrant(tokenHash);
  if (!r2Key) return new Response("Media link expired", { status: 410, headers: { "Cache-Control": "no-store" } });

  const bucket = privateMediaBucket(env);
  const object = await bucket.get(r2Key);
  if (!object) {
    console.error(JSON.stringify({ event: "private_media_object_missing" }));
    return new Response("Media unavailable", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const contentType = object.httpMetadata?.contentType;
  if (!contentType || !["image/jpeg", "image/png"].includes(contentType) || object.size > WHATSAPP_IMAGE_MAX_BYTES) {
    await object.body.cancel("invalid_content_type");
    return new Response("Media unavailable", { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  if (request.method === "GET" && await repository.consumeMediaGrant(tokenHash) !== r2Key) {
    await object.body.cancel("grant_expired");
    return new Response("Media link expired", { status: 410, headers: { "Cache-Control": "no-store" } });
  }
  if (request.method === "HEAD") await object.body.cancel("head_metadata_only");
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="request.${contentType === "image/png" ? "png" : "jpg"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
