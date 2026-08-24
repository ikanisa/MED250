import { AuthHttpError, assertMutationOrigin, requireSession } from "./auth-api.ts";
import { AuthRepository } from "./auth-repository.ts";
import { readBodyText } from "./bounded-body.ts";
import { MarketplaceRepository } from "./marketplace-repository.ts";
import { d1Database, privateMediaBucket, webAuthRuntime } from "./runtime-env.ts";
import { createOpaqueToken, sha256Hex } from "./secure-token.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const BODY_LIMIT = 64 * 1024;

type JsonObject = Record<string, unknown>;

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthHttpError) return json({ error: error.code, message: error.message }, error.status);
  const message = error instanceof Error ? error.message : "Marketplace request failed.";
  if (/not found|unavailable/i.test(message)) return json({ error: "not_found", message: "The requested marketplace record is unavailable." }, 404);
  if (/not authorized|required|outside the assigned order/i.test(message)) return json({ error: "forbidden", message: "This marketplace action is not authorized." }, 403);
  if (/invalid|must|cannot|incompatible|reviewed|selectable|different offer/i.test(message)) return json({ error: "invalid_marketplace_action", message: message.slice(0, 400) }, 400);
  return json({ error: "marketplace_unavailable", message: "The secure marketplace is temporarily unavailable." }, 503);
}

async function body(request: Request): Promise<JsonObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBodyText(request, BODY_LIMIT));
  } catch {
    throw new AuthHttpError(400, "invalid_json", "The request body is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AuthHttpError(400, "invalid_json", "The request body is invalid.");
  }
  return parsed as JsonObject;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new AuthHttpError(400, "invalid_id", `${label} is invalid.`);
  return value.toLowerCase();
}

function optionalString(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maximum) throw new AuthHttpError(400, "invalid_offer", "Offer text is invalid.");
  return value.trim() || null;
}

async function pharmacyJson(
  request: Request,
  env: Env,
  csrf: boolean,
  work: (repository: MarketplaceRepository, principalId: string, pharmacyId: string) => Promise<unknown>,
) {
  if (csrf) assertMutationOrigin(request, webAuthRuntime(env));
  const database = d1Database(env);
  const session = await requireSession(request, new AuthRepository(database), "pharmacy", csrf);
  if (!session.receipt.pharmacyId) throw new AuthHttpError(403, "pharmacy_required", "An eligible pharmacy session is required.");
  return json(await work(new MarketplaceRepository(database), session.receipt.principalId, session.receipt.pharmacyId));
}

export async function marketplaceResponse(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/pharmacy/")) return null;
  try {
    if (pathname === "/api/pharmacy/workspace" && request.method === "GET") {
      return pharmacyJson(request, env, false, (repository, principalId) => repository.pharmacyWorkspace(principalId));
    }
    if (pathname === "/api/pharmacy/requests" && request.method === "GET") {
      return pharmacyJson(request, env, false, (repository, principalId, pharmacyId) => repository.pharmacyRequests(principalId, pharmacyId));
    }
    if (pathname === "/api/pharmacy/contacts" && request.method === "GET") {
      return pharmacyJson(request, env, false, (repository, principalId, pharmacyId) => repository.pharmacyContacts(principalId, pharmacyId));
    }
    if (pathname === "/api/pharmacy/contact-changes" && request.method === "POST") {
      assertMutationOrigin(request, webAuthRuntime(env));
      const input = await body(request);
      const action = input.action;
      const contactType = input.contact_type;
      if (action !== "add" && action !== "update" && action !== "remove") throw new AuthHttpError(400, "invalid_contact_change", "Contact change action is invalid.");
      if (contactType !== "phone" && contactType !== "whatsapp") throw new AuthHttpError(400, "invalid_contact_change", "Contact type is invalid.");
      const contactId = input.contact_id === null || input.contact_id === undefined ? null : uuid(input.contact_id, "Contact ID");
      const e164 = input.e164 === null || input.e164 === undefined ? null : optionalString(input.e164, 20);
      return pharmacyJson(request, env, true, async (repository, principalId, pharmacyId) => ({
        requestId: await repository.requestPharmacyContactChange({
          principalId,
          pharmacyId,
          action,
          contactType,
          contactId,
          e164,
          note: optionalString(input.note, 1_000),
        }),
      }));
    }
    if (pathname === "/api/pharmacy/prices" && request.method === "POST") {
      assertMutationOrigin(request, webAuthRuntime(env));
      const input = await body(request);
      const productId = optionalString(input.product_id, 80);
      const priceRwf = Number(input.price_rwf);
      if (!productId || !/^[A-Za-z0-9-]{1,80}$/.test(productId) || !Number.isInteger(priceRwf) || priceRwf < 1 || priceRwf > 100_000_000) {
        throw new AuthHttpError(400, "invalid_price", "Product or price is invalid.");
      }
      return pharmacyJson(request, env, true, (repository, principalId, pharmacyId) => repository.contributePrice({
        principalId, pharmacyId, productId, priceRwf,
      }));
    }
    if (pathname === "/api/pharmacy/claims" && request.method === "POST") {
      assertMutationOrigin(request, webAuthRuntime(env));
      const input = await body(request);
      const contactEmail = optionalString(input.contact_email, 254);
      if (!contactEmail) throw new AuthHttpError(400, "invalid_claim", "Contact email is required.");
      return pharmacyJson(request, env, true, (repository, principalId, pharmacyId) => repository.submitClaim({
        principalId,
        pharmacyId,
        contactEmail,
        contactPhone: optionalString(input.contact_phone, 20),
        note: optionalString(input.note, 2_000),
      }));
    }
    if (pathname === "/api/pharmacy/offers" && request.method === "POST") {
      assertMutationOrigin(request, webAuthRuntime(env));
      const input = await body(request);
      const fulfilmentMethod = input.fulfilment_method;
      if (fulfilmentMethod !== "pickup" && fulfilmentMethod !== "delivery" && fulfilmentMethod !== "either") {
        throw new AuthHttpError(400, "invalid_offer", "Choose a valid fulfilment method.");
      }
      const ready = input.ready_in_minutes;
      const readyInMinutes = ready === null || ready === undefined ? null : Number(ready);
      if (readyInMinutes !== null && (!Number.isInteger(readyInMinutes) || readyInMinutes < 0 || readyInMinutes > 1440)) {
        throw new AuthHttpError(400, "invalid_offer", "Preparation time is invalid.");
      }
      if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 10) {
        throw new AuthHttpError(400, "invalid_offer", "Review every ordered item before submitting.");
      }
      const items = input.items;
      return pharmacyJson(request, env, true, (repository, principalId, pharmacyId) => repository.submitOffer({
        principalId,
        pharmacyId,
        requestId: uuid(input.order_id, "Order ID"),
        fulfilmentMethod,
        readyInMinutes,
        note: optionalString(input.note, 1_000),
        items,
      }));
    }
    if (pathname === "/api/pharmacy/selected-orders" && request.method === "POST") {
      return pharmacyJson(request, env, true, async (repository, principalId, pharmacyId) => {
        const rows = await repository.pharmacySelectedOrders(principalId, pharmacyId);
        if (!Array.isArray(rows)) throw new Error("Selected-order payload is invalid.");
        return Promise.all(rows.map(async (row) => {
          if (typeof row !== "object" || row === null || Array.isArray(row)) throw new Error("Selected-order row is invalid.");
          const record = row as JsonObject;
          const mediaId = record.prescription_media_id;
          if (typeof mediaId !== "string" || !UUID.test(mediaId)) {
            return { ...record, prescription_path: null, prescription_url: null };
          }
          const token = createOpaqueToken();
          await repository.createPrescriptionGrant({
            principalId,
            requestId: uuid(record.order_id, "Order ID"),
            tokenHashHex: await sha256Hex(token),
          });
          return {
            ...record,
            prescription_path: mediaId,
            prescription_url: `/pharmacy-prescription/${token}`,
          };
        }));
      });
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function pharmacyPrescriptionResponse(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/pharmacy-prescription/")) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  const token = pathname.match(/^\/pharmacy-prescription\/([A-Za-z0-9_-]{43})$/)?.[1] ?? "";
  if (!TOKEN.test(token)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const database = d1Database(env);
    const r2Key = await (async () => {
      const session = await requireSession(request, new AuthRepository(database), "pharmacy", false);
      if (!session.receipt.pharmacyId) throw new AuthHttpError(403, "pharmacy_required", "An eligible pharmacy session is required.");
      return new MarketplaceRepository(database).consumePrescriptionGrant(await sha256Hex(token), session.receipt.pharmacyId);
    })();
    if (!r2Key) return new Response("Prescription link expired", { status: 410, headers: { "Cache-Control": "no-store" } });
    const object = await privateMediaBucket(env).get(r2Key);
    if (!object) return new Response("Prescription unavailable", { status: 404, headers: { "Cache-Control": "no-store" } });
    const type = object.httpMetadata?.contentType ?? "";
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(type)) {
      await object.body.cancel("invalid_content_type");
      return new Response("Prescription unavailable", { status: 415, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(object.size),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthHttpError) return new Response("Session required", { status: error.status, headers: { "Cache-Control": "no-store" } });
    return new Response("Prescription unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
