import { d1Database, privateMediaBucket } from "./runtime-env.ts";
import { sha256Hex } from "./secure-token.ts";
import { WhatsAppRepository } from "./whatsapp-repository.ts";

const MEDIA_PATH = /^\/whatsapp-(?:client|order)-media\/([A-Za-z0-9_-]{43})\.png$/;

export async function privateMediaResponse(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/whatsapp-client-media/") && !url.pathname.startsWith("/whatsapp-order-media/")) return null;
  if (url.pathname === "/whatsapp-client-media/sample.png" || url.pathname === "/whatsapp-order-media/sample.png") return null;
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "no-store" },
    });
  }
  const token = url.pathname.match(MEDIA_PATH)?.[1];
  if (!token) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const r2Key = await new WhatsAppRepository(d1Database(env)).consumeMediaGrant(await sha256Hex(token));
  if (!r2Key) return new Response("Media link expired", { status: 410, headers: { "Cache-Control": "no-store" } });

  const object = await privateMediaBucket(env).get(r2Key);
  if (!object) {
    console.error(JSON.stringify({ event: "private_media_object_missing" }));
    return new Response("Media unavailable", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const contentType = object.httpMetadata?.contentType;
  if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    await object.body.cancel("invalid_content_type");
    return new Response("Media unavailable", { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(object.size),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
