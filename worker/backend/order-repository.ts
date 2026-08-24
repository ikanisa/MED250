import {
  allRows,
  atomicBatch,
  d1Boolean,
  firstRow,
  inClause,
  newId,
  newReference,
  normalizedE164,
  nowIso,
  runStatement,
  type D1Row,
} from "../../db/index.ts";
import { ACTIVE_PUBLIC_PRODUCT_IMAGE_SQL } from "./product-image-rights.ts";
import { dispatchToNearestPharmacies } from "./dispatch-repository.ts";

const HEX_64 = /^[0-9a-f]{64}$/;
const CONTENT_EXTENSIONS = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

function stringField(row: D1Row, key: string): string {
  const value = Reflect.get(row, key);
  if (typeof value !== "string" || !value) throw new Error(`Database field ${key} is invalid.`);
  return value;
}

function numberField(row: D1Row, key: string): number {
  const parsed = Number(Reflect.get(row, key));
  if (!Number.isFinite(parsed)) throw new Error(`Database field ${key} is invalid.`);
  return parsed;
}

function referenceFor(clientRequestId: string): string {
  const value = clientRequestId.replaceAll("-", "").slice(0, 10).toUpperCase();
  return value ? `MED-${value}` : newReference("MED");
}

export class OrderRepository {
  constructor(private readonly database: D1Database) {}

  async beginPrescriptionUpload(input: {
    principalId: string;
    mediaId: string;
    r2Key: string;
    contentType: string;
  }): Promise<void> {
    const extension = CONTENT_EXTENSIONS.get(input.contentType);
    if (!extension || input.r2Key !== `web-prescriptions/${input.principalId}/${input.mediaId}${extension}`) {
      throw new Error("prescription upload is invalid");
    }
    const principal = await firstRow(this.database, `
      select id from med250_web_principals where id = ? and subject_type = 'client'
    `, [input.principalId]);
    if (!principal) throw new Error("client principal is invalid");
    const now = nowIso();
    await runStatement(this.database, `
      insert into med250_web_prescription_media (
        id, principal_id, r2_key, content_type, processing_status,
        retention_expires_at, created_at, updated_at
      ) values (?, ?, ?, ?, 'uploading', ?, ?, ?)
    `, [
      input.mediaId, input.principalId, input.r2Key, input.contentType,
      new Date(Date.now() + 30 * 86_400_000).toISOString(), now, now,
    ]);
  }

  async finishPrescriptionUpload(input: {
    principalId: string;
    mediaId: string;
    byteSize: number;
    sha256Hex: string;
    succeeded: boolean;
  }): Promise<boolean> {
    if (input.succeeded && (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1
      || input.byteSize > 10_485_760 || !HEX_64.test(input.sha256Hex))) {
      throw new Error("prescription upload receipt is invalid");
    }
    const result = await runStatement(this.database, `
      update med250_web_prescription_media
      set processing_status = ?, byte_size = ?, sha256 = ?, updated_at = ?
      where id = ? and principal_id = ? and processing_status = 'uploading'
    `, [
      input.succeeded ? "ready" : "failed",
      input.succeeded ? input.byteSize : null,
      input.succeeded ? input.sha256Hex : null,
      nowIso(), input.mediaId, input.principalId,
    ]);
    return (result.meta.changes ?? 0) > 0;
  }

  async beginDeletePrescription(principalId: string, mediaId: string): Promise<string | null> {
    const row = await firstRow<D1Row>(this.database, `
      select r2_key from med250_web_prescription_media
      where id = ? and principal_id = ? and attached_request_id is null
        and processing_status in ('uploading', 'ready', 'failed')
    `, [mediaId, principalId]);
    if (!row) return null;
    await runStatement(this.database, `
      update med250_web_prescription_media
      set processing_status = 'deleted', deleted_at = ?, updated_at = ?
      where id = ? and principal_id = ? and attached_request_id is null
        and processing_status in ('uploading', 'ready', 'failed')
    `, [nowIso(), nowIso(), mediaId, principalId]);
    return stringField(row, "r2_key");
  }

  async createOrder(input: {
    principalId: string;
    clientRequestId: string;
    idempotencyHashHex: string;
    locationCaptureHashHex: string;
    latitude: number;
    longitude: number;
    locationAccuracyM: number;
    whatsapp: string;
    deliveryPreference: "pickup" | "delivery" | "either";
    substitutesAllowed: boolean;
    prescriptionMediaId: string | null;
    items: Array<{
      product_id: string;
      quantity: number;
      customer_min_rwf: number | null;
      customer_max_rwf: number | null;
      substitutes_allowed: boolean;
    }>;
  }): Promise<{ orderId: string; recipientCount: number }> {
    const normalizedWhatsapp = normalizedE164(input.whatsapp);
    if (!HEX_64.test(input.idempotencyHashHex) || !HEX_64.test(input.locationCaptureHashHex)) {
      throw new Error("order fingerprint is invalid");
    }
    if (input.latitude < -3 || input.latitude > -0.8 || input.longitude < 28.7 || input.longitude > 30.9) {
      throw new Error("order location is outside Rwanda bounds");
    }
    if (!Number.isFinite(input.locationAccuracyM) || input.locationAccuracyM <= 0 || input.locationAccuracyM > 5000) {
      throw new Error("order location accuracy is invalid");
    }
    if (!new Set(["pickup", "delivery", "either"]).has(input.deliveryPreference)) {
      throw new Error("delivery preference is invalid");
    }
    if (input.items.length < 1 || input.items.length > 10
      || new Set(input.items.map((item) => item.product_id)).size !== input.items.length) {
      throw new Error("order must contain 1 to 10 unique products");
    }

    const existing = await firstRow<D1Row>(this.database, `
      select id, idempotency_hash from med250_client_requests
      where web_principal_id = ? and client_request_id = ? and source = 'web_catalogue'
    `, [input.principalId, input.clientRequestId]);
    if (existing) {
      if (stringField(existing, "idempotency_hash") !== input.idempotencyHashHex) {
        throw new Error("client request id was reused with different order data");
      }
      const count = await firstRow<D1Row>(this.database, `
        select count(*) as count from med250_request_recipients where request_id = ?
      `, [stringField(existing, "id")]);
      return { orderId: stringField(existing, "id"), recipientCount: Number(count?.count ?? 0) };
    }

    const principal = await firstRow<D1Row>(this.database, `
      select principal.actor_id, principal.verified_at, actor.e164, actor.actor_type
      from med250_web_principals principal
      join med250_actors actor on actor.id = principal.actor_id
      where principal.id = ? and principal.subject_type = 'client'
    `, [input.principalId]);
    if (!principal || !principal.verified_at || stringField(principal, "actor_type") !== "client"
      || stringField(principal, "e164") !== normalizedWhatsapp) {
      throw new Error("order WhatsApp must match the verified client number");
    }
    const registeredPharmacy = await firstRow(this.database, `
      select 1 as found
      from med250_known_pharmacy_numbers number
      where number.e164 = ? and number.resolution_status <> 'retired'
      union all
      select 1
      from med250_pharmacy_contacts contact
      where contact.e164 = ? and contact.channel = 'whatsapp'
        and contact.verified_at is not null and contact.active = 1
      limit 1
    `, [normalizedWhatsapp, normalizedWhatsapp]);
    if (registeredPharmacy) throw new Error("registered pharmacy numbers cannot create client orders");

    const now = Date.now();
    const rates = await firstRow<D1Row>(this.database, `
      select
        sum(case when created_at >= ? then 1 else 0 end) as daily_count,
        sum(case when status in ('ready', 'dispatched', 'selected') and expires_at > ? then 1 else 0 end) as active_count
      from med250_client_requests
      where web_principal_id = ? and source = 'web_catalogue'
    `, [new Date(now - 86_400_000).toISOString(), nowIso(), input.principalId]);
    if (Number(rates?.daily_count ?? 0) >= 10) throw new Error("web order daily rate limit reached");
    if (Number(rates?.active_count ?? 0) >= 3) throw new Error("too many active web orders");

    for (const item of input.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
        || item.customer_min_rwf !== null && item.customer_min_rwf < 0
        || item.customer_max_rwf !== null && item.customer_max_rwf < 0
        || item.customer_min_rwf !== null && item.customer_max_rwf !== null && item.customer_min_rwf > item.customer_max_rwf) {
        throw new Error("one or more order items are invalid or not orderable");
      }
    }
    const productIds = input.items.map((item) => item.product_id);
    const products = await allRows<D1Row>(this.database, `
      select product.id, product.brand_name, product.generic_name, product.strength,
             product.dosage_form, product.pack_size, product.prescription_status,
             product.regulatory_status, product.is_active, product.is_orderable,
             (select image.r2_key from med250_product_images image
               where image.product_id = product.id and image.position = 1
                 and ${ACTIVE_PUBLIC_PRODUCT_IMAGE_SQL}
               limit 1) as image_r2_key
      from med250_catalogue_products product
      where product.id in (${inClause(productIds.length)})
    `, productIds);
    const byId = new Map(products.map((product) => [stringField(product, "id"), product]));
    if (products.length !== productIds.length || input.items.some((item) => {
      const product = byId.get(item.product_id);
      return !product || !d1Boolean(product.is_active, "is_active") || !d1Boolean(product.is_orderable, "is_orderable")
        || new Set(["expired", "withdrawn", "suspended"]).has(stringField(product, "regulatory_status").toLowerCase());
    })) throw new Error("one or more order items are invalid or not orderable");

    const requiresPrescription = products.some((product) => stringField(product, "prescription_status").toLowerCase() === "prescription");
    if (requiresPrescription && !input.prescriptionMediaId) throw new Error("a prescription is required for this order");
    if (input.prescriptionMediaId) {
      const media = await firstRow(this.database, `
        select id from med250_web_prescription_media
        where id = ? and principal_id = ? and processing_status = 'ready'
          and attached_request_id is null and created_at >= ?
      `, [input.prescriptionMediaId, input.principalId, new Date(now - 86_400_000).toISOString()]);
      if (!media) throw new Error("prescription upload is not available to this client session");
    }

    const actorId = stringField(principal, "actor_id");
    const requestId = newId();
    const locationId = newId();
    const createdAt = nowIso();
    const statements: D1PreparedStatement[] = [
      this.database.prepare(`
        update med250_client_locations set is_current = 0, updated_at = ?
        where actor_id = ? and is_current = 1
      `).bind(createdAt, actorId),
      this.database.prepare(`
        insert into med250_client_locations (
          id, actor_id, latitude, longitude, accuracy_m, source, capture_key,
          is_current, consented_at, captured_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, 'web_order', ?, 1, ?, ?, ?, ?)
      `).bind(
        locationId, actorId, input.latitude, input.longitude, input.locationAccuracyM,
        input.locationCaptureHashHex, createdAt, createdAt, createdAt, createdAt,
      ),
      this.database.prepare(`
        insert into med250_client_requests (
          id, reference, actor_id, customer_e164, source, status, location_id,
          dispatch_limit, media_count, web_principal_id, client_request_id,
          idempotency_hash, delivery_preference, substitutes_allowed,
          location_accuracy_m, prescription_media_id, expires_at, created_at, updated_at
        ) values (?, ?, ?, ?, 'web_catalogue', 'ready', ?, 10, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        requestId, referenceFor(input.clientRequestId), actorId, normalizedWhatsapp, locationId,
        input.principalId, input.clientRequestId, input.idempotencyHashHex,
        input.deliveryPreference, input.substitutesAllowed ? 1 : 0, input.locationAccuracyM,
        input.prescriptionMediaId, new Date(Date.now() + 7_200_000).toISOString(), createdAt, createdAt,
      ),
    ];
    let totalUnits = 0;
    const summaries: string[] = [];
    let leadImageR2Key: string | null = null;
    input.items.forEach((item, index) => {
      const product = byId.get(item.product_id);
      if (!product) throw new Error("one or more order items are invalid or not orderable");
      const imageR2Key = typeof product.image_r2_key === "string" ? product.image_r2_key : null;
      leadImageR2Key ??= imageR2Key;
      totalUnits += item.quantity;
      summaries.push(`${item.quantity}x ${stringField(product, "brand_name").slice(0, 72)}`);
      statements.push(this.database.prepare(`
        insert into med250_web_order_items (
          id, request_id, position, product_id, product_name, generic_name,
          strength, dosage_form, pack_size, image_url, image_r2_key, quantity,
          customer_min_rwf, customer_max_rwf, substitutes_allowed, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        newId(), requestId, index + 1, item.product_id, stringField(product, "brand_name").slice(0, 220),
        product.generic_name ?? null, product.strength ?? null, product.dosage_form ?? null, product.pack_size ?? null,
        imageR2Key ? `/api/catalogue/media/${item.product_id}/1` : null, imageR2Key, item.quantity,
        item.customer_min_rwf, item.customer_max_rwf,
        item.substitutes_allowed ?? input.substitutesAllowed ? 1 : 0, createdAt,
      ));
    });
    if (input.prescriptionMediaId) {
      statements.push(this.database.prepare(`
        update med250_web_prescription_media set attached_request_id = ?, updated_at = ?
        where id = ? and principal_id = ? and attached_request_id is null
      `).bind(requestId, createdAt, input.prescriptionMediaId, input.principalId));
    }
    try {
      await atomicBatch(this.database, statements);
    } catch (error) {
      const raced = await firstRow<D1Row>(this.database, `
        select id, idempotency_hash from med250_client_requests
        where web_principal_id = ? and client_request_id = ? and source = 'web_catalogue'
      `, [input.principalId, input.clientRequestId]);
      if (!raced || stringField(raced, "idempotency_hash") !== input.idempotencyHashHex) throw error;
      const count = await firstRow<D1Row>(this.database, "select count(*) as count from med250_request_recipients where request_id = ?", [stringField(raced, "id")]);
      return { orderId: stringField(raced, "id"), recipientCount: numberField(count ?? {}, "count") };
    }

    const recipientCount = await dispatchToNearestPharmacies(this.database, {
      requestId,
      actorId,
      latitude: input.latitude,
      longitude: input.longitude,
      kind: "web_catalogue_order",
      dedupePrefix: "web",
      primaryMediaId: null,
      basePayload: {
        request_reference: referenceFor(input.clientRequestId),
        client_e164: normalizedWhatsapp,
        item_summary: summaries.join("; "),
        total_units: totalUnits,
        delivery_preference: input.deliveryPreference,
        lead_image_r2_key: leadImageR2Key,
      },
      emptyOutcome: "cancel",
      auditEvent: "web_catalogue_request_dispatched",
      emptyAuditEvent: "web_catalogue_request_unassigned",
      auditDetails: { item_count: input.items.length, total_units: totalUnits },
    });
    return { orderId: requestId, recipientCount };
  }
}
