import { AuthHttpError, assertMutationOrigin, requireSession } from "./auth-api.ts";
import { AuthRepository } from "./auth-repository.ts";
import { PayloadTooLargeError, readBodyBytes, readBodyText } from "./bounded-body.ts";
import { MarketplaceRepository } from "./marketplace-repository.ts";
import { OrderRepository } from "./order-repository.ts";
import { d1Database, privateMediaBucket, webAuthRuntime } from "./runtime-env.ts";
import { hmacSha256Hex, sha256BytesHex, sha256Hex } from "./secure-token.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_ID = /^[A-Za-z0-9-]{1,80}$/;
const ORDER_BODY_LIMIT = 64 * 1024;
const PRESCRIPTION_LIMIT = 10 * 1024 * 1024;

type JsonObject = Record<string, unknown>;
type ContentType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

const EXTENSION: Readonly<Record<ContentType, string>> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

function orderError(error: unknown): Response {
  if (error instanceof PayloadTooLargeError) return json({ error: "payload_too_large", message: error.message }, 413);
  if (error instanceof AuthHttpError) return json({ error: error.code, message: error.message }, error.status);
  const message = error instanceof Error ? error.message : "Order request failed.";
  if (/required|invalid|outside Rwanda|must contain|not orderable|prescription/i.test(message)) {
    return json({ error: "invalid_order", message: message.slice(0, 400) }, 400);
  }
  if (/rate limit|too many active/i.test(message)) {
    return json({ error: "order_rate_limited", message: "Too many active orders. Close an existing order or try again later." }, 429);
  }
  if (/verified client|must match|registered pharmacy|not available to this client/i.test(message)) {
    return json({ error: "order_forbidden", message: "This order is not authorized for the current client session." }, 403);
  }
  if (/reused with different order data|duplicate key/i.test(message)) {
    return json({ error: "idempotency_conflict", message: "This order identifier was already used with different details." }, 409);
  }
  return json({ error: "order_unavailable", message: "Secure ordering is temporarily unavailable." }, 503);
}

async function readJson(request: Request): Promise<JsonObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBodyText(request, ORDER_BODY_LIMIT));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw error;
    throw new AuthHttpError(400, "invalid_json", "The order request body is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AuthHttpError(400, "invalid_json", "The order request body is invalid.");
  }
  return parsed as JsonObject;
}

function requiredString(body: JsonObject, key: string, maximum = 160): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AuthHttpError(400, "invalid_order", `${key} is invalid.`);
  }
  return value.trim();
}

function finiteNumber(body: JsonObject, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AuthHttpError(400, "invalid_order", `${key} is invalid.`);
  }
  return value;
}

function integerOrNull(value: unknown, minimum = 0): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > 100_000_000) {
    throw new AuthHttpError(400, "invalid_order", "An order price range is invalid.");
  }
  return value;
}

function normalizedItems(value: unknown, defaultSubstitutes: boolean) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new AuthHttpError(400, "invalid_order", "An order must contain 1 to 10 products.");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new AuthHttpError(400, "invalid_order", "An order item is invalid.");
    }
    const row = entry as JsonObject;
    const productId = requiredString(row, "product_id", 80);
    if (!PRODUCT_ID.test(productId) || seen.has(productId)) {
      throw new AuthHttpError(400, "invalid_order", "Order products must be valid and unique.");
    }
    seen.add(productId);
    const quantity = row.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new AuthHttpError(400, "invalid_order", "Order quantities must be between 1 and 99.");
    }
    const minimum = integerOrNull(row.customer_min_rwf);
    const maximum = integerOrNull(row.customer_max_rwf);
    if (minimum !== null && maximum !== null && minimum > maximum) {
      throw new AuthHttpError(400, "invalid_order", "An order minimum price cannot exceed its maximum price.");
    }
    return {
      product_id: productId,
      quantity,
      customer_min_rwf: minimum,
      customer_max_rwf: maximum,
      substitutes_allowed: typeof row.substitutes_allowed === "boolean" ? row.substitutes_allowed : defaultSubstitutes,
    };
  });
}

function contentType(request: Request): ContentType {
  const value = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!(value in EXTENSION)) throw new AuthHttpError(400, "invalid_prescription", "Upload a PDF, JPG, PNG or WebP prescription.");
  return value as ContentType;
}

function validSignature(type: ContentType, bytes: Uint8Array): boolean {
  if (type === "application/pdf") return bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  return bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

async function createOrder(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const runtime = webAuthRuntime(env);
  assertMutationOrigin(request, runtime);
  const body = await readJson(request);
  const database = d1Database(env);
  {
    const session = await requireSession(request, new AuthRepository(database), "client", true);
    if (session.receipt.actorType !== "client" || !session.receipt.e164 || !session.receipt.verifiedAt) {
      throw new AuthHttpError(403, "verified_client_required", "Verify your client WhatsApp number before ordering.");
    }
    const clientRequestId = requiredString(body, "client_request_id", 40).toLowerCase();
    if (!UUID.test(clientRequestId)) throw new AuthHttpError(400, "invalid_order", "Client order ID is invalid.");
    const latitude = finiteNumber(body, "latitude");
    const longitude = finiteNumber(body, "longitude");
    const locationAccuracyM = finiteNumber(body, "location_accuracy_m");
    const whatsapp = requiredString(body, "whatsapp", 40).replace(/\D/g, "");
    if (whatsapp !== session.receipt.e164) {
      throw new AuthHttpError(403, "verified_phone_mismatch", "Order WhatsApp must match the verified client number.");
    }
    const deliveryPreference = requiredString(body, "delivery_preference", 16);
    if (deliveryPreference !== "pickup" && deliveryPreference !== "delivery" && deliveryPreference !== "either") {
      throw new AuthHttpError(400, "invalid_order", "Delivery preference is invalid.");
    }
    const substitutesAllowed = body.substitutes_allowed === true;
    const items = normalizedItems(body.items, substitutesAllowed);
    const prescriptionValue = body.prescription_media_id;
    const prescriptionMediaId = prescriptionValue === null || prescriptionValue === undefined || prescriptionValue === ""
      ? null
      : typeof prescriptionValue === "string" && UUID.test(prescriptionValue)
        ? prescriptionValue.toLowerCase()
        : (() => { throw new AuthHttpError(400, "invalid_order", "Prescription receipt is invalid."); })();
    const canonical = JSON.stringify({
      client_request_id: clientRequestId,
      latitude,
      longitude,
      location_accuracy_m: locationAccuracyM,
      whatsapp,
      delivery_preference: deliveryPreference,
      substitutes_allowed: substitutesAllowed,
      prescription_media_id: prescriptionMediaId,
      items,
    });
    const repository = new OrderRepository(database);
    const receipt = await repository.createOrder({
      principalId: session.receipt.principalId,
      clientRequestId,
      idempotencyHashHex: await sha256Hex(canonical),
      locationCaptureHashHex: await hmacSha256Hex(runtime.otpSecret, `web-order-location:${session.receipt.principalId}:${clientRequestId}`),
      latitude,
      longitude,
      locationAccuracyM,
      whatsapp,
      deliveryPreference,
      substitutesAllowed,
      prescriptionMediaId,
      items,
    });
    return json(receipt, 201);
  }
}

async function activeOrders(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const database = d1Database(env);
  const session = await requireSession(request, new AuthRepository(database), "client", false);
  return json(await new MarketplaceRepository(database).activeOrders(session.receipt.principalId));
}

async function orderLifecycle(
  request: Request,
  env: Env,
  requestId: string,
  action: "offers" | "select" | "contact" | "close",
): Promise<Response> {
  const mutation = action === "select" || action === "close";
  if ((mutation && request.method !== "POST") || (!mutation && request.method !== "GET")) {
    return json({ error: "method_not_allowed" }, 405);
  }
  const runtime = webAuthRuntime(env);
  if (mutation) assertMutationOrigin(request, runtime);
  const input = mutation ? await readJson(request) : null;
  const database = d1Database(env);
  {
    const session = await requireSession(request, new AuthRepository(database), "client", mutation);
    const repository = new MarketplaceRepository(database);
    if (action === "offers") return json(await repository.confirmedOffers(session.receipt.principalId, requestId));
    if (action === "contact") return json(await repository.selectedContact(session.receipt.principalId, requestId));
    if (action === "select") {
      const offerId = requiredString(input as JsonObject, "offer_id", 36).toLowerCase();
      if (!UUID.test(offerId)) throw new AuthHttpError(400, "invalid_offer", "Offer ID is invalid.");
      await repository.selectOffer(session.receipt.principalId, requestId, offerId);
      return json(await repository.selectedContact(session.receipt.principalId, requestId));
    }
    const outcome = requiredString(input as JsonObject, "outcome", 16);
    if (outcome !== "completed" && outcome !== "cancelled") {
      throw new AuthHttpError(400, "invalid_outcome", "Order outcome is invalid.");
    }
    return json(await repository.closeOrder(session.receipt.principalId, requestId, outcome));
  }
}

async function uploadPrescription(request: Request, env: Env): Promise<Response> {
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
  const runtime = webAuthRuntime(env);
  assertMutationOrigin(request, runtime);
  const type = contentType(request);
  const raw = await readBodyBytes(request, PRESCRIPTION_LIMIT);
  const bytes = new Uint8Array(raw);
  if (!bytes.byteLength || !validSignature(type, bytes)) {
    throw new AuthHttpError(400, "invalid_prescription", "The prescription content does not match its declared file type.");
  }
  const bucket = privateMediaBucket(env);
  const database = d1Database(env);
  {
    const session = await requireSession(request, new AuthRepository(database), "client", true);
    const mediaId = crypto.randomUUID();
    const r2Key = `web-prescriptions/${session.receipt.principalId}/${mediaId}.${EXTENSION[type]}`;
    const repository = new OrderRepository(database);
    await repository.beginPrescriptionUpload({
      principalId: session.receipt.principalId,
      mediaId,
      r2Key,
      contentType: type,
    });
    try {
      await bucket.put(r2Key, bytes.buffer, {
        httpMetadata: { contentType: type, cacheControl: "private, no-store" },
        customMetadata: { mediaId, purpose: "web_prescription" },
      });
      const finished = await repository.finishPrescriptionUpload({
        principalId: session.receipt.principalId,
        mediaId,
        byteSize: bytes.byteLength,
        sha256Hex: await sha256BytesHex(bytes),
        succeeded: true,
      });
      if (!finished) throw new Error("Prescription upload receipt was not persisted.");
      return json({ mediaId, contentType: type, byteSize: bytes.byteLength }, 201);
    } catch (error) {
      await bucket.delete(r2Key).catch(() => undefined);
      await repository.finishPrescriptionUpload({
        principalId: session.receipt.principalId,
        mediaId,
        byteSize: 0,
        sha256Hex: "0".repeat(64),
        succeeded: false,
      }).catch(() => false);
      throw error;
    }
  }
}

async function deletePrescription(request: Request, env: Env, mediaId: string): Promise<Response> {
  if (request.method !== "DELETE") return json({ error: "method_not_allowed" }, 405);
  const runtime = webAuthRuntime(env);
  assertMutationOrigin(request, runtime);
  const database = d1Database(env);
  const session = await requireSession(request, new AuthRepository(database), "client", true);
  const r2Key = await new OrderRepository(database).beginDeletePrescription(session.receipt.principalId, mediaId);
  if (!r2Key) throw new AuthHttpError(404, "prescription_not_found", "This unused prescription upload is unavailable.");
  await privateMediaBucket(env).delete(r2Key);
  return json({ deleted: true });
}

export async function orderResponse(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/orders" && !pathname.startsWith("/api/orders/")) return null;
  try {
    if (pathname === "/api/orders") return request.method === "GET"
      ? await activeOrders(request, env)
      : await createOrder(request, env);
    if (pathname === "/api/orders/prescription") return await uploadPrescription(request, env);
    const match = pathname.match(/^\/api\/orders\/prescription\/([0-9a-f-]{36})$/i);
    if (match && UUID.test(match[1])) return await deletePrescription(request, env, match[1].toLowerCase());
    const lifecycle = pathname.match(/^\/api\/orders\/([0-9a-f-]{36})\/(offers|select|contact|close)$/i);
    if (lifecycle && UUID.test(lifecycle[1])) {
      return await orderLifecycle(
        request,
        env,
        lifecycle[1].toLowerCase(),
        lifecycle[2].toLowerCase() as "offers" | "select" | "contact" | "close",
      );
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    return orderError(error);
  }
}
