import {
  allRows,
  atomicBatch,
  firstRow,
  newId,
  newReference,
  normalizedE164,
  nowIso,
  parseJsonObject,
  runStatement,
  type D1Row,
} from "../../db/index.ts";
import { clientMediaFinalizationDecision } from "./delivery-finality.ts";
import { dispatchToNearestPharmacies } from "./dispatch-repository.ts";

export { parseClientAction } from "./whatsapp-actions.ts";

export type ActorType = "pharmacy" | "client";
export type InboundReceipt = {
  eventId: string;
  actorId: string;
  actorType: ActorType;
  pharmacyId: string | null;
  requestId: string | null;
  eventOutcome: string;
  alreadyProcessed: boolean;
};

export type ClientImageReceipt = {
  requestId: string;
  mediaId: string;
  actorId: string;
  customerE164: string;
  savedLocationId: string | null;
  mediaStatus: "processing" | "ready" | "failed" | "deleted";
};

export type OutboxClaim = { id: string; claimToken: string };

export type OutboxDelivery = {
  id: string;
  kind: string;
  requestId: string | null;
  pharmacyId: string | null;
  recipientE164: string;
  payload: Record<string, unknown>;
  requestReference: string | null;
  customerE164: string | null;
  mediaCount: number | null;
  mediaIndex: number | null;
  r2Key: string | null;
  distanceM: number | null;
};

export type WhatsAppMaintenanceReceipt = {
  expiredGrantsRevoked: number;
  staleMediaFailed: number;
  staleInboundClosed: number;
  failedRequestsClosed: number;
  clientConfirmationsQueued: number;
};

function stringValue(row: D1Row, key: string): string {
  const found = row[key];
  if (typeof found !== "string" || !found) throw new Error(`Database field ${key} is invalid.`);
  return found;
}

function nullableString(row: D1Row, key: string): string | null {
  const found = row[key];
  if (found === null || found === undefined) return null;
  if (typeof found !== "string") throw new Error(`Database field ${key} is invalid.`);
  return found;
}

function nullableNumber(row: D1Row, key: string): number | null {
  const found = row[key];
  if (found === null || found === undefined) return null;
  const parsed = typeof found === "number" ? found : Number(found);
  if (!Number.isFinite(parsed)) throw new Error(`Database field ${key} is invalid.`);
  return parsed;
}

function changes(result: D1Result<unknown>): number {
  return typeof result.meta?.changes === "number" ? result.meta.changes : 0;
}

function future(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

function bounded(value: string | null, maximum: number, fallback: string | null = null): string | null {
  const normalized = value?.trim().slice(0, maximum) ?? "";
  return normalized || fallback;
}

function deliveryRank(status: string): number {
  return ["pending", "claimed", "enqueued", "sending", "sent", "delivered", "read", "failed", "dead_letter"].indexOf(status);
}

export class WhatsAppRepository {
  constructor(private readonly database: D1Database) {}

  private async finalizeClientMediaRequest(requestId: string): Promise<{
    failedRequestClosed: boolean;
    clientConfirmationQueued: boolean;
  }> {
    const state = await firstRow<D1Row>(this.database, `
      SELECT
        count(*) AS total,
        sum(CASE WHEN status IN ('delivered', 'read') THEN 1 ELSE 0 END) AS delivered,
        sum(CASE WHEN status NOT IN ('delivered', 'read', 'failed', 'dead_letter') THEN 1 ELSE 0 END) AS unfinished
      FROM med250_dispatch_outbox
      WHERE request_id = ? AND kind = 'client_media_request'
    `, [requestId]);
    const total = nullableNumber(state ?? {}, "total") ?? 0;
    const delivered = nullableNumber(state ?? {}, "delivered") ?? 0;
    const unfinished = nullableNumber(state ?? {}, "unfinished") ?? 0;
    const decision = clientMediaFinalizationDecision({ total, delivered, unfinished });
    if (decision === "wait") {
      return { failedRequestClosed: false, clientConfirmationQueued: false };
    }

    const at = nowIso();
    if (decision === "confirm_delivered") {
      const inserted = await runStatement(this.database, `
        INSERT OR IGNORE INTO med250_dispatch_outbox (
          id, dedupe_key, kind, request_id, recipient_e164, payload, status,
          available_at, created_at, updated_at
        )
        SELECT ?, 'client-confirmation:' || request.id, 'client_confirmation', request.id,
          request.customer_e164, json_object('recipient_count', ?), 'pending', ?, ?, ?
        FROM med250_client_requests request WHERE request.id = ?
      `, [newId(), delivered, at, at, at, requestId]);
      return { failedRequestClosed: false, clientConfirmationQueued: changes(inserted) === 1 };
    }

    const closed = await runStatement(this.database, `
      UPDATE med250_client_requests
      SET status = 'cancelled', closed_at = coalesce(closed_at, ?), updated_at = ?
      WHERE id = ? AND source = 'whatsapp_image' AND status = 'dispatched'
    `, [at, at, requestId]);
    if (changes(closed) === 1) {
      await runStatement(this.database, `
        INSERT INTO med250_audit_events (event_type, request_id, details, created_at)
        VALUES ('client_request_all_pharmacy_deliveries_failed', ?,
          json_object('terminal_recipient_count', ?, 'delivered_recipient_count', 0), ?)
      `, [requestId, total, at]);
    }
    return { failedRequestClosed: changes(closed) === 1, clientConfirmationQueued: false };
  }

  async beginInbound(input: {
    accountSid: string; messageSid: string; fromE164: string; profileName: string | null;
    mediaCount: number; locationProvided: boolean; buttonPayload: string | null;
  }): Promise<InboundReceipt> {
    if (!input.accountSid.trim()) throw new Error("provider account ID is required");
    if (!/^(?:SM|MM)[0-9a-f]{32}$/i.test(input.messageSid)) throw new Error("Twilio provider message SID is invalid");
    if (input.mediaCount !== 0 && input.mediaCount !== 1) throw new Error("exactly zero or one inbound image is supported");
    const messageSid = input.messageSid.toUpperCase();
    const existing = await firstRow<D1Row>(this.database, `
      SELECT event.id AS event_id, event.request_id, event.outcome, event.processed_at,
        actor.id AS actor_id, actor.actor_type, actor.pharmacy_id
      FROM med250_inbound_events event JOIN med250_actors actor ON actor.id = event.actor_id
      WHERE event.provider = 'twilio' AND event.provider_account_id = ? AND event.provider_message_sid = ?
    `, [input.accountSid, messageSid]);
    if (existing) return {
      eventId: stringValue(existing, "event_id"), actorId: stringValue(existing, "actor_id"),
      actorType: stringValue(existing, "actor_type") as ActorType,
      pharmacyId: nullableString(existing, "pharmacy_id"), requestId: nullableString(existing, "request_id"),
      eventOutcome: stringValue(existing, "outcome"), alreadyProcessed: existing.processed_at !== null,
    };

    const e164 = normalizedE164(input.fromE164);
    const known = await firstRow<D1Row>(this.database, `
      SELECT resolution_status, pharmacy_id FROM med250_known_pharmacy_numbers
      WHERE e164 = ? AND resolution_status <> 'retired' LIMIT 1
    `, [e164]);
    const contact = known ? null : await firstRow<D1Row>(this.database, `
      SELECT pharmacy_id FROM med250_pharmacy_contacts
      WHERE channel = 'whatsapp' AND e164 = ? AND verified_at IS NOT NULL AND active = 1
      ORDER BY verified_at DESC, id LIMIT 1
    `, [e164]);
    const actorType: ActorType = known || contact ? "pharmacy" : "client";
    const pharmacyId = known ? nullableString(known, "pharmacy_id") : contact ? stringValue(contact, "pharmacy_id") : null;
    const at = nowIso();
    const proposedActorId = newId();
    await runStatement(this.database, `
      INSERT INTO med250_actors (
        id, e164, actor_type, pharmacy_id, profile_name, first_seen_at, last_seen_at,
        inbound_message_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(e164) DO UPDATE SET actor_type = excluded.actor_type,
        pharmacy_id = excluded.pharmacy_id, profile_name = coalesce(excluded.profile_name, med250_actors.profile_name),
        last_seen_at = excluded.last_seen_at, inbound_message_count = med250_actors.inbound_message_count + 1,
        updated_at = excluded.updated_at
    `, [proposedActorId, e164, actorType, pharmacyId, bounded(input.profileName, 180), at, at, at, at]);
    const actor = await firstRow<D1Row>(this.database, `
      SELECT id, actor_type, pharmacy_id FROM med250_actors WHERE e164 = ?
    `, [e164]);
    if (!actor) throw new Error("WhatsApp actor was not persisted.");
    const actorId = stringValue(actor, "id");
    const eventId = newId();
    const inserted = await runStatement(this.database, `
      INSERT OR IGNORE INTO med250_inbound_events (
        id, provider, provider_account_id, provider_message_sid, actor_id, signature_verified,
        media_count, location_provided, button_payload, outcome, received_at
      ) VALUES (?, 'twilio', ?, ?, ?, 1, ?, ?, ?, 'processing', ?)
    `, [eventId, input.accountSid, messageSid, actorId, input.mediaCount, input.locationProvided ? 1 : 0,
      bounded(input.buttonPayload, 240), at]);
    const event = await firstRow<D1Row>(this.database, `
      SELECT event.id AS event_id, event.request_id, event.outcome, event.processed_at,
        actor.id AS actor_id, actor.actor_type, actor.pharmacy_id
      FROM med250_inbound_events event JOIN med250_actors actor ON actor.id = event.actor_id
      WHERE event.provider = 'twilio' AND event.provider_account_id = ? AND event.provider_message_sid = ?
    `, [input.accountSid, messageSid]);
    if (!event) throw new Error("WhatsApp inbound event was not persisted.");
    if (changes(inserted) === 1) {
      await runStatement(this.database, `
        INSERT INTO med250_audit_events (event_type, actor_id, details, created_at)
        VALUES ('twilio_inbound_signature_verified', ?, json_object(
          'provider', 'twilio', 'media_count', ?, 'location_provided', ?, 'button_provided', ?
        ), ?)
      `, [actorId, input.mediaCount,
        input.locationProvided ? 1 : 0, input.buttonPayload?.trim() ? 1 : 0, at]);
    }
    return {
      eventId: stringValue(event, "event_id"), actorId: stringValue(event, "actor_id"),
      actorType: stringValue(event, "actor_type") as ActorType,
      pharmacyId: nullableString(event, "pharmacy_id"), requestId: nullableString(event, "request_id"),
      eventOutcome: stringValue(event, "outcome"), alreadyProcessed: event.processed_at !== null,
    };
  }

  async beginClientImage(eventId: string, contentType: string): Promise<ClientImageReceipt> {
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("unsupported client image type");
    const event = await firstRow<D1Row>(this.database, `
      SELECT event.request_id, event.provider_message_sid, event.media_count,
        actor.id AS actor_id, actor.e164, actor.actor_type
      FROM med250_inbound_events event JOIN med250_actors actor ON actor.id = event.actor_id WHERE event.id = ?
    `, [eventId]);
    if (!event) throw new Error("inbound event not found");
    if (stringValue(event, "actor_type") !== "client") throw new Error("pharmacy actors cannot create client image requests");
    if (nullableNumber(event, "media_count") !== 1) throw new Error("client image request requires one image");
    let requestId = nullableString(event, "request_id");
    let mediaId: string;
    if (requestId) {
      const media = await firstRow<D1Row>(this.database, `
        SELECT id, processing_status FROM med250_request_media
        WHERE request_id = ? AND provider_message_sid = ? AND media_index = 0
      `, [requestId, stringValue(event, "provider_message_sid")]);
      if (!media) throw new Error("client media not found");
      mediaId = stringValue(media, "id");
    } else {
      requestId = newId();
      mediaId = newId();
      const at = nowIso();
      await atomicBatch(this.database, [
        this.database.prepare(`
          INSERT INTO med250_client_requests (
            id, reference, actor_id, customer_e164, source, status, dispatch_limit,
            media_count, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'whatsapp_image', 'processing_media', 10, 0, ?, ?, ?)
        `).bind(requestId, newReference("WA"), stringValue(event, "actor_id"), stringValue(event, "e164"), future(2 * 60 * 60_000), at, at),
        this.database.prepare(`
          INSERT INTO med250_request_media (
            id, request_id, provider_message_sid, media_index, content_type, processing_status,
            retention_expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, 0, ?, 'processing', ?, ?, ?)
        `).bind(mediaId, requestId, stringValue(event, "provider_message_sid"), contentType, future(30 * 24 * 60 * 60_000), at, at),
        this.database.prepare(`
          UPDATE med250_inbound_events SET request_id = ?, outcome = 'client_image_processing' WHERE id = ? AND request_id IS NULL
        `).bind(requestId, eventId),
      ]);
    }
    const media = await firstRow<D1Row>(this.database, "SELECT processing_status FROM med250_request_media WHERE id = ?", [mediaId]);
    const saved = await firstRow<D1Row>(this.database, `
      SELECT id FROM med250_client_locations WHERE actor_id = ? AND is_current = 1
      ORDER BY captured_at DESC, id LIMIT 1
    `, [stringValue(event, "actor_id")]);
    const mediaStatus = stringValue(media ?? {}, "processing_status");
    if (!["processing", "ready", "failed", "deleted"].includes(mediaStatus)) throw new Error("Database media status is invalid.");
    return {
      requestId, mediaId, actorId: stringValue(event, "actor_id"), customerE164: stringValue(event, "e164"),
      savedLocationId: saved ? stringValue(saved, "id") : null, mediaStatus: mediaStatus as ClientImageReceipt["mediaStatus"],
    };
  }

  async finishClientImage(input: {
    eventId: string; requestId: string; mediaId: string; r2Key: string | null;
    byteSize: number | null; sha256: string | null; succeeded: boolean; errorCode: string | null;
  }): Promise<void> {
    const request = await firstRow<D1Row>(this.database, `
      SELECT actor_id, customer_e164 FROM med250_client_requests WHERE id = ?
    `, [input.requestId]);
    const media = await firstRow<D1Row>(this.database, `
      SELECT content_type FROM med250_request_media WHERE id = ? AND request_id = ?
    `, [input.mediaId, input.requestId]);
    if (!request) throw new Error("client request not found");
    if (!media) throw new Error("client media not found");
    const at = nowIso();
    if (input.succeeded) {
      if (!input.r2Key?.trim() || !Number.isSafeInteger(input.byteSize) || (input.byteSize as number) < 1
        || (input.byteSize as number) > 16_777_216 || !/^[0-9a-f]{64}$/.test(input.sha256 ?? "")) {
        throw new Error("ready media receipt is incomplete");
      }
      const saved = await firstRow<D1Row>(this.database, `
        SELECT id FROM med250_client_locations WHERE actor_id = ? AND is_current = 1
        ORDER BY captured_at DESC, id LIMIT 1
      `, [stringValue(request, "actor_id")]);
      const locationId = saved ? stringValue(saved, "id") : null;
      const promptKind = locationId ? "location_choice" : "location_capture";
      await atomicBatch(this.database, [
        this.database.prepare(`
          UPDATE med250_request_media SET r2_key = ?, byte_size = ?, sha256 = ?, processing_status = 'ready',
            processing_error_code = NULL, updated_at = ? WHERE id = ? AND processing_status IN ('processing', 'ready')
        `).bind(input.r2Key, input.byteSize, input.sha256, at, input.mediaId),
        this.database.prepare(`
          UPDATE med250_client_requests SET media_count = 1, status = ?, updated_at = ?
          WHERE id = ? AND status = 'processing_media'
        `).bind(locationId ? "awaiting_location_choice" : "awaiting_location", at, input.requestId),
        this.database.prepare(`
          INSERT OR IGNORE INTO med250_dispatch_outbox (
            id, dedupe_key, kind, request_id, recipient_e164, payload, status, available_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).bind(newId(), `client-prompt:${input.requestId}`, promptKind, input.requestId,
          stringValue(request, "customer_e164"), JSON.stringify({ actor_id: stringValue(request, "actor_id"), request_id: input.requestId, location_id: locationId }), at, at, at),
        this.database.prepare(`
          UPDATE med250_inbound_events SET outcome = ?, processed_at = ?, last_error_code = NULL
          WHERE id = ? AND request_id = ?
        `).bind(`${promptKind}_queued`, at, input.eventId, input.requestId),
        this.database.prepare(`
          INSERT INTO med250_audit_events (event_type, actor_id, request_id, details, created_at)
          VALUES ('client_image_stored_private_r2', ?, ?, json_object('content_type', ?, 'byte_size', ?), ?)
        `).bind(stringValue(request, "actor_id"), input.requestId, stringValue(media, "content_type"), input.byteSize, at),
      ]);
      return;
    }
    const errorCode = bounded(input.errorCode, 120, "media_processing_failed");
    await atomicBatch(this.database, [
      this.database.prepare(`UPDATE med250_request_media SET processing_status = 'failed', processing_error_code = ?, updated_at = ? WHERE id = ?`)
        .bind(errorCode, at, input.mediaId),
      this.database.prepare(`UPDATE med250_client_requests SET status = 'cancelled', closed_at = coalesce(closed_at, ?), updated_at = ? WHERE id = ?`)
        .bind(at, at, input.requestId),
      this.database.prepare(`UPDATE med250_inbound_events SET outcome = 'client_image_failed', processed_at = ?, last_error_code = ? WHERE id = ?`)
        .bind(at, errorCode, input.eventId),
      this.database.prepare(`
        INSERT OR IGNORE INTO med250_dispatch_outbox (
          id, dedupe_key, kind, request_id, recipient_e164, payload, status, available_at, created_at, updated_at
        ) VALUES (?, ?, 'client_guidance', ?, ?, json_object('guidance', 'media_failed'), 'pending', ?, ?, ?)
      `).bind(newId(), `client-media-failed:${input.requestId}`, input.requestId, stringValue(request, "customer_e164"), at, at, at),
    ]);
  }

  async activeClientRequest(actorId: string): Promise<string | null> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT id FROM med250_client_requests WHERE actor_id = ?
        AND status IN ('awaiting_location', 'awaiting_location_choice', 'processing_media', 'ready')
        AND expires_at > ? ORDER BY created_at DESC, id LIMIT 1
    `, [actorId, nowIso()]);
    return row ? stringValue(row, "id") : null;
  }

  async saveLocation(input: {
    actorId: string; requestId: string | null; latitude: number; longitude: number; accuracyM: number | null;
    address: string | null; label: string | null; source: "whatsapp_native" | "secure_webview" | "web_order";
    captureKeyHex: string; eventId: string | null;
  }): Promise<{ locationId: string; recipientCount: number }> {
    const actor = await firstRow<D1Row>(this.database, "SELECT e164, actor_type FROM med250_actors WHERE id = ?", [input.actorId]);
    if (!actor || stringValue(actor, "actor_type") !== "client") throw new Error("client actor not found");
    if (input.latitude < -3 || input.latitude > -0.8 || input.longitude < 28.7 || input.longitude > 30.9) throw new Error("location is outside Rwanda");
    if (!/^[0-9a-f]{64}$/.test(input.captureKeyHex)) throw new Error("location capture key is invalid");
    let location = await firstRow<D1Row>(this.database, "SELECT id FROM med250_client_locations WHERE capture_key = ?", [input.captureKeyHex]);
    const at = nowIso();
    let reused = true;
    if (!location) {
      reused = false;
      const locationId = newId();
      await atomicBatch(this.database, [
        this.database.prepare("UPDATE med250_client_locations SET is_current = 0, updated_at = ? WHERE actor_id = ? AND is_current = 1")
          .bind(at, input.actorId),
        this.database.prepare(`
          INSERT OR IGNORE INTO med250_client_locations (
            id, actor_id, latitude, longitude, accuracy_m, address, label, source, capture_key,
            is_current, consented_at, captured_at, last_used_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        `).bind(locationId, input.actorId, input.latitude, input.longitude, input.accuracyM,
          bounded(input.address, 500), bounded(input.label, 120), input.source, input.captureKeyHex,
          at, at, input.requestId ? at : null, at, at),
      ]);
      location = await firstRow<D1Row>(this.database, "SELECT id FROM med250_client_locations WHERE capture_key = ?", [input.captureKeyHex]);
    }
    if (!location) throw new Error("client location was not persisted");
    const locationId = stringValue(location, "id");
    let recipientCount = 0;
    if (input.requestId) {
      const request = await firstRow<D1Row>(this.database, `
        SELECT id FROM med250_client_requests WHERE id = ? AND actor_id = ?
          AND status IN ('awaiting_location', 'awaiting_location_choice', 'ready', 'dispatched') AND expires_at > ?
      `, [input.requestId, input.actorId, at]);
      if (!request) throw new Error("client request is not eligible for a location");
      await atomicBatch(this.database, [
        this.database.prepare("UPDATE med250_client_locations SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END, last_used_at = CASE WHEN id = ? THEN ? ELSE last_used_at END, updated_at = ? WHERE actor_id = ? AND (is_current = 1 OR id = ?)")
          .bind(locationId, locationId, at, at, input.actorId, locationId),
        this.database.prepare("UPDATE med250_client_requests SET location_id = ?, status = CASE WHEN status = 'dispatched' THEN status ELSE 'ready' END, updated_at = ? WHERE id = ?")
          .bind(locationId, at, input.requestId),
      ]);
      const media = await firstRow<D1Row>(this.database, `
        SELECT id FROM med250_request_media WHERE request_id = ? AND processing_status = 'ready' ORDER BY media_index LIMIT 1
      `, [input.requestId]);
      recipientCount = await dispatchToNearestPharmacies(this.database, {
        requestId: input.requestId, actorId: input.actorId, latitude: input.latitude, longitude: input.longitude,
        kind: "client_media_request", dedupePrefix: "client", primaryMediaId: media ? stringValue(media, "id") : null,
        basePayload: { source: "whatsapp_image" }, emptyOutcome: "cancel", auditEvent: "client_request_dispatched",
        emptyAuditEvent: "client_request_no_eligible_pharmacy",
      });
    } else {
      await runStatement(this.database, `
        INSERT OR IGNORE INTO med250_dispatch_outbox (
          id, dedupe_key, kind, recipient_e164, payload, status, available_at, created_at, updated_at
        ) VALUES (?, ?, 'client_guidance', ?, json_object('guidance', 'location_saved'), 'pending', ?, ?, ?)
      `, [newId(), `location-guidance:${locationId}`, stringValue(actor, "e164"), at, at, at]);
    }
    if (input.eventId) await runStatement(this.database, `
      UPDATE med250_inbound_events SET request_id = ?, outcome = ?, processed_at = ?, last_error_code = NULL
      WHERE id = ? AND actor_id = ?
    `, [input.requestId, input.requestId === null ? "location_saved_for_future_use"
      : recipientCount > 0 ? "location_saved_and_dispatched" : "location_saved_no_eligible_pharmacy", at, input.eventId, input.actorId]);
    await runStatement(this.database, `
      INSERT INTO med250_audit_events (event_type, actor_id, request_id, details, created_at)
      VALUES ('client_location_consented', ?, ?, json_object('source', ?, 'recipient_count', ?, 'reused_capture', ?), ?)
    `, [input.actorId, input.requestId, input.source, recipientCount, reused ? 1 : 0, at]);
    return { locationId, recipientCount };
  }

  async useSavedLocation(input: { eventId: string; actorId: string; requestId: string; locationId: string }): Promise<number> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT actor.e164, location.latitude, location.longitude
      FROM med250_actors actor JOIN med250_client_locations location ON location.actor_id = actor.id
      JOIN med250_client_requests request ON request.actor_id = actor.id
      WHERE actor.id = ? AND actor.actor_type = 'client' AND location.id = ? AND location.is_current = 1
        AND request.id = ? AND request.status IN ('awaiting_location_choice', 'ready', 'dispatched') AND request.expires_at > ?
    `, [input.actorId, input.locationId, input.requestId, nowIso()]);
    if (!row) throw new Error("saved location is not current for this client");
    const at = nowIso();
    await atomicBatch(this.database, [
      this.database.prepare("UPDATE med250_client_locations SET last_used_at = ?, updated_at = ? WHERE id = ?").bind(at, at, input.locationId),
      this.database.prepare("UPDATE med250_client_requests SET location_id = ?, status = CASE WHEN status = 'dispatched' THEN status ELSE 'ready' END, updated_at = ? WHERE id = ?")
        .bind(input.locationId, at, input.requestId),
    ]);
    const media = await firstRow<D1Row>(this.database, "SELECT id FROM med250_request_media WHERE request_id = ? AND processing_status = 'ready' ORDER BY media_index LIMIT 1", [input.requestId]);
    const recipientCount = await dispatchToNearestPharmacies(this.database, {
      requestId: input.requestId, actorId: input.actorId, latitude: Number(row.latitude), longitude: Number(row.longitude),
      kind: "client_media_request", dedupePrefix: "client", primaryMediaId: media ? stringValue(media, "id") : null,
      basePayload: { source: "whatsapp_image" }, emptyOutcome: "cancel", auditEvent: "saved_client_location_dispatched",
      emptyAuditEvent: "saved_client_location_no_eligible_pharmacy",
    });
    await atomicBatch(this.database, [
      this.database.prepare("UPDATE med250_inbound_events SET request_id = ?, outcome = ?, processed_at = ?, last_error_code = NULL WHERE id = ? AND actor_id = ?")
        .bind(input.requestId, recipientCount > 0 ? "saved_location_used_and_dispatched" : "saved_location_used_no_eligible_pharmacy", at, input.eventId, input.actorId),
      this.database.prepare(`INSERT INTO med250_audit_events (event_type, actor_id, request_id, details, created_at)
        VALUES ('saved_client_location_used', ?, ?, json_object('recipient_count', ?), ?)`)
        .bind(input.actorId, input.requestId, recipientCount, at),
    ]);
    return recipientCount;
  }

  async requestNewLocation(input: { eventId: string; actorId: string; requestId: string }): Promise<void> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT request.id, actor.e164 FROM med250_actors actor JOIN med250_client_requests request ON request.actor_id = actor.id
      WHERE actor.id = ? AND actor.actor_type = 'client' AND request.id = ?
        AND request.status IN ('awaiting_location_choice', 'awaiting_location')
    `, [input.actorId, input.requestId]);
    if (!row) throw new Error("client request cannot request a new location");
    const at = nowIso();
    await atomicBatch(this.database, [
      this.database.prepare("UPDATE med250_client_requests SET status = 'awaiting_location', location_id = NULL, updated_at = ? WHERE id = ?")
        .bind(at, input.requestId),
      this.database.prepare(`
        INSERT OR IGNORE INTO med250_dispatch_outbox (
          id, dedupe_key, kind, request_id, recipient_e164, payload, status, available_at, created_at, updated_at
        ) VALUES (?, ?, 'location_capture', ?, ?, json_object('actor_id', ?, 'request_id', ?), 'pending', ?, ?, ?)
      `).bind(newId(), `client-native-location:${input.requestId}`, input.requestId, stringValue(row, "e164"),
        input.actorId, input.requestId, at, at, at),
      this.database.prepare("UPDATE med250_inbound_events SET request_id = ?, outcome = 'native_location_share_selected', processed_at = ?, last_error_code = NULL WHERE id = ? AND actor_id = ?")
        .bind(input.requestId, at, input.eventId, input.actorId),
    ]);
  }

  async queueLocationCaptureRetry(input: {
    eventId: string;
    actorId: string;
    requestId: string | null;
    recipientE164: string;
  }): Promise<void> {
    const at = nowIso();
    if (!input.requestId) {
      await atomicBatch(this.database, [
        this.database.prepare(`
          INSERT OR IGNORE INTO med250_dispatch_outbox (
            id, dedupe_key, kind, recipient_e164, payload, status, available_at, created_at, updated_at
          ) VALUES (?, ?, 'client_guidance', ?, json_object('guidance', 'send_image'), 'pending', ?, ?, ?)
        `).bind(newId(), `client-maps-without-request:${input.eventId}`, input.recipientE164, at, at, at),
        this.database.prepare(`
          UPDATE med250_inbound_events SET outcome = 'google_maps_location_without_request', processed_at = ?,
            last_error_code = NULL WHERE id = ? AND actor_id = ?
        `).bind(at, input.eventId, input.actorId),
      ]);
      return;
    }
    const request = await firstRow<D1Row>(this.database, `
      SELECT id FROM med250_client_requests WHERE id = ? AND actor_id = ?
        AND status IN ('awaiting_location', 'awaiting_location_choice') AND expires_at > ?
    `, [input.requestId, input.actorId, at]);
    if (!request) throw new Error("client request cannot retry location capture");
    await atomicBatch(this.database, [
      this.database.prepare(`
        INSERT OR IGNORE INTO med250_dispatch_outbox (
          id, dedupe_key, kind, request_id, recipient_e164, payload, status, available_at, created_at, updated_at
        ) VALUES (?, ?, 'location_capture', ?, ?, json_object('actor_id', ?, 'request_id', ?), 'pending', ?, ?, ?)
      `).bind(newId(), `client-location-retry:${input.eventId}`, input.requestId, input.recipientE164,
        input.actorId, input.requestId, at, at, at),
      this.database.prepare(`
        UPDATE med250_inbound_events SET request_id = ?, outcome = 'google_maps_location_unresolved_reprompted',
          processed_at = ?, last_error_code = NULL WHERE id = ? AND actor_id = ?
      `).bind(input.requestId, at, input.eventId, input.actorId),
    ]);
  }

  async recordPharmacyResponse(input: {
    eventId: string; actorId: string; requestId: string; pharmacyId: string;
    responseStatus: "can_fulfil" | "cannot_fulfil"; messageSid: string;
  }): Promise<void> {
    const assigned = await firstRow<D1Row>(this.database, `
      SELECT request.source FROM med250_actors actor
      JOIN med250_request_recipients recipient ON recipient.pharmacy_id = actor.pharmacy_id
      JOIN med250_client_requests request ON request.id = recipient.request_id
      WHERE actor.id = ? AND actor.actor_type = 'pharmacy' AND actor.pharmacy_id = ?
        AND recipient.request_id = ? AND recipient.recipient_e164 = actor.e164
    `, [input.actorId, input.pharmacyId, input.requestId]);
    if (!assigned) throw new Error("pharmacy is not an assigned request recipient");
    const at = nowIso();
    const responseId = newId();
    const inserted = await runStatement(this.database, `
      INSERT OR IGNORE INTO med250_pharmacy_responses (
        id, provider_message_sid, request_id, pharmacy_id, response_status, received_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [responseId, input.messageSid, input.requestId, input.pharmacyId, input.responseStatus, at]);
    const statements: D1PreparedStatement[] = [
      this.database.prepare("UPDATE med250_request_recipients SET response_status = ?, responded_at = coalesce(responded_at, ?) WHERE request_id = ? AND pharmacy_id = ?")
        .bind(input.responseStatus, at, input.requestId, input.pharmacyId),
      this.database.prepare("UPDATE med250_inbound_events SET request_id = ?, outcome = 'client_image_response_recorded', processed_at = ?, last_error_code = NULL WHERE id = ? AND actor_id = ?")
        .bind(input.requestId, at, input.eventId, input.actorId),
    ];
    if (changes(inserted) === 1) statements.push(this.database.prepare(`
      INSERT INTO med250_audit_events (event_type, actor_id, request_id, details, created_at)
      VALUES ('pharmacy_whatsapp_response_recorded', ?, ?, json_object('pharmacy_id', ?, 'response_status', ?), ?)
    `).bind(input.actorId, input.requestId, input.pharmacyId, input.responseStatus, at));
    if (changes(inserted) === 1 && input.responseStatus === "can_fulfil" && stringValue(assigned, "source") === "web_catalogue") {
      const existingOffer = await firstRow<D1Row>(this.database, "SELECT id FROM med250_marketplace_offers WHERE request_id = ? AND pharmacy_id = ?", [input.requestId, input.pharmacyId]);
      const offerId = existingOffer ? stringValue(existingOffer, "id") : newId();
      statements.push(this.database.prepare(`
        INSERT OR IGNORE INTO med250_marketplace_offers (
          id, request_id, pharmacy_id, status, complete, total_rwf, fulfilment_method,
          note, submitted_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'submitted', 1, 0, 'either', 'Confirmed available via WhatsApp', ?, ?, ?)
      `).bind(offerId, input.requestId, input.pharmacyId, at, at, at));
      const items = await allRows<D1Row>(this.database, "SELECT id, product_id, quantity FROM med250_web_order_items WHERE request_id = ?", [input.requestId]);
      for (const item of items) statements.push(this.database.prepare(`
        INSERT OR IGNORE INTO med250_marketplace_offer_items (
          id, offer_id, order_item_id, offered_product_id, available, is_substitute, quantity, note, created_at
        ) VALUES (?, ?, ?, ?, 1, 0, ?, 'Confirmed via WhatsApp', ?)
      `).bind(newId(), offerId, stringValue(item, "id"), stringValue(item, "product_id"), nullableNumber(item, "quantity"), at));
      statements.push(this.database.prepare("UPDATE med250_pharmacy_responses SET offer_id = ? WHERE id = ?").bind(offerId, responseId));
    }
    await atomicBatch(this.database, statements);
  }

  async completeInbound(eventId: string, outcome: string, errorCode: string | null = null): Promise<void> {
    await runStatement(this.database, `
      UPDATE med250_inbound_events SET outcome = ?, processed_at = ?, last_error_code = ? WHERE id = ?
    `, [bounded(outcome, 120, "processed"), nowIso(), bounded(errorCode, 120), eventId]);
  }

  async queueClientGuidance(event: InboundReceipt, recipientE164: string, guidance: string): Promise<void> {
    const at = nowIso();
    await atomicBatch(this.database, [
      this.database.prepare(`
        INSERT OR IGNORE INTO med250_dispatch_outbox (
          id, dedupe_key, kind, request_id, recipient_e164, payload, status, available_at, created_at, updated_at
        ) VALUES (?, ?, 'client_guidance', ?, ?, json_object('guidance', ?), 'pending', ?, ?, ?)
      `).bind(newId(), `client-guidance:${event.eventId}`, event.requestId, recipientE164, guidance, at, at, at),
      this.database.prepare("UPDATE med250_inbound_events SET outcome = ?, processed_at = ?, last_error_code = NULL WHERE id = ?")
        .bind(`client_guidance_${guidance}_queued`, at, event.eventId),
    ]);
  }

  async claimOutbox(claimToken: string, limit = 25): Promise<OutboxClaim[]> {
    const at = nowIso();
    const expires = future(60_000);
    const rows = await allRows<D1Row>(this.database, `
      SELECT id FROM med250_dispatch_outbox
      WHERE (status IN ('pending', 'retry') OR (status = 'claimed' AND claim_expires_at < ?))
        AND available_at <= ? AND provider_attempts < max_provider_attempts
      ORDER BY available_at, created_at, id LIMIT ?
    `, [at, at, Math.max(1, Math.min(limit, 100))]);
    if (!rows.length) return [];
    await atomicBatch(this.database, rows.map((row) => this.database.prepare(`
      UPDATE med250_dispatch_outbox SET status = 'claimed', claim_token = ?, claimed_at = ?, claim_expires_at = ?, updated_at = ?
      WHERE id = ? AND (status IN ('pending', 'retry') OR (status = 'claimed' AND claim_expires_at < ?))
        AND available_at <= ? AND provider_attempts < max_provider_attempts
    `).bind(claimToken, at, expires, at, stringValue(row, "id"), at, at)));
    const claimed = await allRows<D1Row>(this.database, "SELECT id, claim_token FROM med250_dispatch_outbox WHERE claim_token = ? AND status = 'claimed'", [claimToken]);
    return claimed.map((row) => ({ id: stringValue(row, "id"), claimToken: stringValue(row, "claim_token") }));
  }

  async markEnqueued(outboxId: string, claimToken: string): Promise<boolean> {
    const result = await runStatement(this.database, `
      UPDATE med250_dispatch_outbox SET status = 'enqueued', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'claimed' AND claim_token = ?
    `, [nowIso(), outboxId, claimToken]);
    return changes(result) === 1;
  }

  async beginProviderSend(outboxId: string, queueDeliveryId: string): Promise<boolean> {
    const at = nowIso();
    const result = await runStatement(this.database, `
      UPDATE med250_dispatch_outbox SET status = 'sending', queue_delivery_id = ?, provider_attempts = provider_attempts + 1,
        send_started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'enqueued' AND available_at <= ? AND provider_attempts < max_provider_attempts
    `, [queueDeliveryId, at, at, outboxId, at]);
    return changes(result) === 1;
  }

  async loadOutboxDelivery(outboxId: string): Promise<OutboxDelivery> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT outbox.id, outbox.kind, outbox.request_id, outbox.pharmacy_id, outbox.recipient_e164, outbox.payload,
        request.reference AS request_reference, request.customer_e164, request.media_count,
        media.media_index, media.r2_key, recipient.distance_m
      FROM med250_dispatch_outbox outbox
      LEFT JOIN med250_client_requests request ON request.id = outbox.request_id
      LEFT JOIN med250_request_media media ON media.id = outbox.primary_media_id
      LEFT JOIN med250_request_recipients recipient ON recipient.request_id = outbox.request_id AND recipient.pharmacy_id = outbox.pharmacy_id
      WHERE outbox.id = ?
    `, [outboxId]);
    if (!row) throw new Error("load outbox delivery returned no receipt.");
    return {
      id: stringValue(row, "id"), kind: stringValue(row, "kind"), requestId: nullableString(row, "request_id"),
      pharmacyId: nullableString(row, "pharmacy_id"), recipientE164: stringValue(row, "recipient_e164"),
      payload: parseJsonObject(row.payload, "payload"), requestReference: nullableString(row, "request_reference"),
      customerE164: nullableString(row, "customer_e164"), mediaCount: nullableNumber(row, "media_count"),
      mediaIndex: nullableNumber(row, "media_index"), r2Key: nullableString(row, "r2_key"), distanceM: nullableNumber(row, "distance_m"),
    };
  }

  async createMediaGrant(input: { tokenHashHex: string; outboxId: string; pharmacyId: string; r2Key: string }): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(input.tokenHashHex)) throw new Error("media grant token is invalid");
    const at = nowIso();
    await atomicBatch(this.database, [
      this.database.prepare("UPDATE med250_media_access_grants SET revoked_at = coalesce(revoked_at, ?) WHERE outbox_id = ? AND purpose = 'twilio_delivery' AND revoked_at IS NULL")
        .bind(at, input.outboxId),
      this.database.prepare(`
        INSERT INTO med250_media_access_grants (
          id, token_hash, outbox_id, request_id, pharmacy_id, r2_key, purpose,
          allowed_fetches, fetch_count, expires_at, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?, 'twilio_delivery', 2, 0, ?, ?)
      `).bind(newId(), input.tokenHashHex, input.outboxId, input.pharmacyId, input.r2Key, future(2 * 60 * 60_000), at),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
        SELECT 'private_media_grant_created', request_id, id,
          json_object('purpose', 'twilio_delivery', 'allowed_fetches', 2, 'ttl_seconds', 7200), ?
        FROM med250_dispatch_outbox WHERE id = ?
      `).bind(at, input.outboxId),
    ]);
  }

  async revokeMediaGrants(outboxId: string): Promise<void> {
    await runStatement(this.database, "UPDATE med250_media_access_grants SET revoked_at = coalesce(revoked_at, ?) WHERE outbox_id = ? AND revoked_at IS NULL", [nowIso(), outboxId]);
  }

  async consumeMediaGrant(tokenHashHex: string): Promise<string | null> {
    const at = nowIso();
    const grant = await firstRow<D1Row>(this.database, `
      SELECT id, outbox_id, r2_key, fetch_count FROM med250_media_access_grants
      WHERE token_hash = ? AND purpose = 'twilio_delivery' AND revoked_at IS NULL
        AND expires_at > ? AND fetch_count < allowed_fetches
    `, [tokenHashHex, at]);
    if (!grant) return null;
    const fetchCount = nullableNumber(grant, "fetch_count") ?? 0;
    const updated = await runStatement(this.database, `
      UPDATE med250_media_access_grants SET fetch_count = fetch_count + 1, last_fetched_at = ?
      WHERE id = ? AND fetch_count = ? AND revoked_at IS NULL AND expires_at > ? AND fetch_count < allowed_fetches
    `, [at, stringValue(grant, "id"), fetchCount, at]);
    if (changes(updated) !== 1) return null;
    await runStatement(this.database, `
      INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
      SELECT 'private_media_grant_consumed', request_id, id, json_object('purpose', 'twilio_delivery', 'fetch_number', ?), ?
      FROM med250_dispatch_outbox WHERE id = ?
    `, [fetchCount + 1, at, stringValue(grant, "outbox_id")]);
    return stringValue(grant, "r2_key");
  }

  async recordProviderAcceptance(outboxId: string, messageSid: string): Promise<boolean> {
    const at = nowIso();
    const row = await firstRow<D1Row>(this.database, "SELECT request_id, otp_challenge_id, admin_otp_challenge_id FROM med250_dispatch_outbox WHERE id = ?", [outboxId]);
    if (!row) return false;
    const result = await runStatement(this.database, `
      UPDATE med250_dispatch_outbox SET status = 'sent', provider_message_sid = ?, sent_at = coalesce(sent_at, ?), updated_at = ?
      WHERE id = ? AND status IN ('sending', 'sent') AND (provider_message_sid IS NULL OR provider_message_sid = ?)
    `, [messageSid, at, at, outboxId, messageSid]);
    if (changes(result) !== 1) return false;
    const statements: D1PreparedStatement[] = [this.database.prepare(`
      INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
      SELECT 'provider_send_accepted', ?, ?, json_object('provider', 'twilio'), ?
      WHERE NOT EXISTS (SELECT 1 FROM med250_audit_events audit WHERE audit.outbox_id = ? AND audit.event_type = 'provider_send_accepted')
    `).bind(row.request_id ?? null, outboxId, at, outboxId)];
    if (row.otp_challenge_id) statements.push(this.database.prepare("UPDATE med250_otp_challenges SET delivery_status = 'sent', provider_message_sid = ? WHERE id = ?")
      .bind(messageSid, row.otp_challenge_id));
    if (row.admin_otp_challenge_id) statements.push(this.database.prepare("UPDATE med250_admin_otp_challenges SET delivery_status = 'sent', provider_message_sid = ? WHERE id = ?")
      .bind(messageSid, row.admin_otp_challenge_id));
    await atomicBatch(this.database, statements);
    return true;
  }

  async recordProviderFailure(input: {
    outboxId: string; queueDeliveryId: string; errorCode: string; retryable: boolean; retryDelaySeconds: number;
  }): Promise<boolean> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT request_id, kind, otp_challenge_id, admin_otp_challenge_id, provider_attempts, max_provider_attempts
      FROM med250_dispatch_outbox WHERE id = ? AND queue_delivery_id = ?
    `, [input.outboxId, input.queueDeliveryId]);
    if (!row) throw new Error("outbox delivery lease not found");
    const retry = input.retryable && (nullableNumber(row, "provider_attempts") ?? 0) < (nullableNumber(row, "max_provider_attempts") ?? 0);
    const at = nowIso();
    const status = retry ? "enqueued" : "failed";
    const available = future(Math.max(1, Math.min(input.retryDelaySeconds, 86_400)) * 1_000);
    await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_dispatch_outbox SET status = ?, available_at = CASE WHEN ? = 'enqueued' THEN ? ELSE available_at END,
          last_error_code = ?, failed_at = CASE WHEN ? = 'failed' THEN coalesce(failed_at, ?) ELSE failed_at END, updated_at = ?
        WHERE id = ? AND queue_delivery_id = ?
      `).bind(status, status, available, bounded(input.errorCode, 120, "provider_send_failed"), status, at, at, input.outboxId, input.queueDeliveryId),
      this.database.prepare(`INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
        VALUES (?, ?, ?, json_object('attempt', ?, 'retryable', ?), ?)`)
        .bind(retry ? "provider_send_retry_scheduled" : "provider_send_failed", row.request_id ?? null, input.outboxId,
          nullableNumber(row, "provider_attempts") ?? 0, input.retryable ? 1 : 0, at),
    ]);
    if (!retry && row.otp_challenge_id) await runStatement(this.database, "UPDATE med250_otp_challenges SET delivery_status = 'failed', failed_at = coalesce(failed_at, ?) WHERE id = ?", [at, row.otp_challenge_id]);
    if (!retry && row.admin_otp_challenge_id) await runStatement(this.database, "UPDATE med250_admin_otp_challenges SET delivery_status = 'failed', failed_at = coalesce(failed_at, ?) WHERE id = ?", [at, row.admin_otp_challenge_id]);
    if (!retry && stringValue(row, "kind") === "client_media_request" && row.request_id) {
      await this.finalizeClientMediaRequest(stringValue(row, "request_id"));
    }
    return retry;
  }

  async recordProviderUnknown(outboxId: string, queueDeliveryId: string, errorCode: string): Promise<void> {
    const row = await firstRow<D1Row>(this.database, "SELECT request_id FROM med250_dispatch_outbox WHERE id = ?", [outboxId]);
    const at = nowIso();
    const result = await runStatement(this.database, `
      UPDATE med250_dispatch_outbox SET status = 'provider_send_unknown', last_error_code = ?, updated_at = ?
      WHERE id = ? AND queue_delivery_id = ? AND status = 'sending'
    `, [bounded(errorCode, 120, "provider_send_outcome_unknown"), at, outboxId, queueDeliveryId]);
    if (changes(result) === 1) await runStatement(this.database, `
      INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
      VALUES ('provider_send_outcome_unknown', ?, ?, '{}', ?)
    `, [row?.request_id ?? null, outboxId, at]);
  }

  async recordDeliveryEvent(input: {
    eventKey: string; messageSid: string; providerStatus: string; errorCode: string | null; occurredAt: Date;
  }): Promise<boolean> {
    const outbox = await firstRow<D1Row>(this.database, `
      SELECT id, kind, request_id, otp_challenge_id, admin_otp_challenge_id, status FROM med250_dispatch_outbox WHERE provider_message_sid = ?
    `, [input.messageSid]);
    if (!outbox) return false;
    const mapped = ["accepted", "queued", "sending", "sent"].includes(input.providerStatus) ? "sent"
      : input.providerStatus === "delivered" ? "delivered" : input.providerStatus === "read" ? "read"
        : ["failed", "undelivered"].includes(input.providerStatus) ? "failed" : null;
    if (!mapped) throw new Error("unsupported delivery status");
    const eventId = newId();
    const at = nowIso();
    const inserted = await runStatement(this.database, `
      INSERT OR IGNORE INTO med250_provider_delivery_events (
        id, provider, provider_event_key, outbox_id, provider_message_sid, delivery_status,
        error_code, signature_verified, occurred_at, received_at
      ) VALUES (?, 'twilio', ?, ?, ?, ?, ?, 1, ?, ?)
    `, [eventId, input.eventKey, stringValue(outbox, "id"), input.messageSid, input.providerStatus,
      bounded(input.errorCode, 120), input.occurredAt.toISOString(), at]);
    if (changes(inserted) !== 1) return false;
    const current = stringValue(outbox, "status");
    const resulting = mapped === "failed" && ["delivered", "read"].includes(current) ? current
      : mapped !== "failed" && deliveryRank(mapped) < deliveryRank(current) ? current : mapped;
    const occurred = input.occurredAt.toISOString();
    const statements: D1PreparedStatement[] = [
      this.database.prepare(`
        UPDATE med250_dispatch_outbox SET status = ?,
          delivered_at = CASE WHEN ? IN ('delivered', 'read') THEN coalesce(delivered_at, ?) ELSE delivered_at END,
          read_at = CASE WHEN ? = 'read' THEN coalesce(read_at, ?) ELSE read_at END,
          failed_at = CASE WHEN ? = 'failed' THEN coalesce(failed_at, ?) ELSE failed_at END,
          last_error_code = CASE WHEN ? = 'failed' THEN ? ELSE last_error_code END, updated_at = ? WHERE id = ?
      `).bind(resulting, resulting, occurred, resulting, occurred, resulting, occurred, resulting,
        bounded(input.errorCode, 120), at, stringValue(outbox, "id")),
      this.database.prepare(`INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
        VALUES (?, ?, ?, json_object('provider_status', ?), ?)`)
        .bind(`provider_delivery_${resulting}`, outbox.request_id ?? null, stringValue(outbox, "id"), input.providerStatus, at),
    ];
    if (outbox.otp_challenge_id) statements.push(this.database.prepare(`
      UPDATE med250_otp_challenges SET delivery_status = ?, provider_message_sid = coalesce(provider_message_sid, ?),
        failed_at = CASE WHEN ? = 'failed' THEN coalesce(failed_at, ?) ELSE failed_at END WHERE id = ?
    `).bind(resulting, input.messageSid, resulting, occurred, outbox.otp_challenge_id));
    if (outbox.admin_otp_challenge_id) statements.push(this.database.prepare(`
      UPDATE med250_admin_otp_challenges SET delivery_status = ?, provider_message_sid = coalesce(provider_message_sid, ?),
        failed_at = CASE WHEN ? = 'failed' THEN coalesce(failed_at, ?) ELSE failed_at END WHERE id = ?
    `).bind(resulting, input.messageSid, resulting, occurred, outbox.admin_otp_challenge_id));
    await atomicBatch(this.database, statements);
    if (stringValue(outbox, "kind") === "client_media_request" && outbox.request_id) {
      // "Dispatched" means WhatsApp delivered the request to at least one
      // pharmacy, never merely that Twilio accepted the API call.
      await this.finalizeClientMediaRequest(stringValue(outbox, "request_id"));
    }
    return true;
  }

  async reconcileOperationalState(staleSeconds = 900, limit = 100): Promise<WhatsAppMaintenanceReceipt> {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const at = nowIso();
    const cutoff = new Date(Date.now() - Math.max(300, Math.min(staleSeconds, 86_400)) * 1_000).toISOString();

    const expiredGrantResult = await runStatement(this.database, `
      UPDATE med250_media_access_grants SET revoked_at = ?
      WHERE revoked_at IS NULL AND expires_at <= ?
    `, [at, at]);
    const expiredGrantsRevoked = changes(expiredGrantResult);
    if (expiredGrantsRevoked > 0) {
      await runStatement(this.database, `
        INSERT INTO med250_audit_events (event_type, details, created_at)
        VALUES ('expired_private_media_grants_revoked', json_object('grant_count', ?), ?)
      `, [expiredGrantsRevoked, at]);
    }

    const staleMedia = await allRows<D1Row>(this.database, `
      SELECT media.id, media.request_id, event.id AS event_id
      FROM med250_request_media media
      LEFT JOIN med250_inbound_events event
        ON event.request_id = media.request_id AND event.provider_message_sid = media.provider_message_sid
      WHERE media.processing_status = 'processing' AND media.created_at < ?
      ORDER BY media.created_at, media.id LIMIT ?
    `, [cutoff, boundedLimit]);
    let staleMediaFailed = 0;
    for (const media of staleMedia) {
      const mediaId = stringValue(media, "id");
      const requestId = stringValue(media, "request_id");
      const failed = await runStatement(this.database, `
        UPDATE med250_request_media
        SET processing_status = 'failed', processing_error_code = 'media_processing_timeout', updated_at = ?
        WHERE id = ? AND processing_status = 'processing' AND created_at < ?
      `, [at, mediaId, cutoff]);
      if (changes(failed) !== 1) continue;
      staleMediaFailed += 1;
      const statements: D1PreparedStatement[] = [
        this.database.prepare(`
          UPDATE med250_client_requests
          SET status = 'cancelled', closed_at = coalesce(closed_at, ?), updated_at = ?
          WHERE id = ? AND status = 'processing_media'
        `).bind(at, at, requestId),
        this.database.prepare(`
          INSERT INTO med250_audit_events (event_type, request_id, details, created_at)
          VALUES ('stale_client_media_failed_closed', ?, json_object('timeout_seconds', ?), ?)
        `).bind(requestId, Math.max(300, Math.min(staleSeconds, 86_400)), at),
      ];
      const eventId = nullableString(media, "event_id");
      if (eventId) statements.push(this.database.prepare(`
        UPDATE med250_inbound_events
        SET outcome = 'client_image_failed_timeout', processed_at = coalesce(processed_at, ?),
          last_error_code = 'media_processing_timeout'
        WHERE id = ? AND processed_at IS NULL
      `).bind(at, eventId));
      await atomicBatch(this.database, statements);
    }

    const staleEvents = await allRows<D1Row>(this.database, `
      SELECT id, actor_id, request_id FROM med250_inbound_events
      WHERE processed_at IS NULL AND received_at < ?
      ORDER BY received_at, id LIMIT ?
    `, [cutoff, boundedLimit]);
    let staleInboundClosed = 0;
    for (const event of staleEvents) {
      const eventId = stringValue(event, "id");
      const closed = await runStatement(this.database, `
        UPDATE med250_inbound_events
        SET outcome = 'stale_inbound_reconciled', processed_at = ?, last_error_code = 'inbound_processing_timeout'
        WHERE id = ? AND processed_at IS NULL AND received_at < ?
      `, [at, eventId, cutoff]);
      if (changes(closed) !== 1) continue;
      staleInboundClosed += 1;
      await runStatement(this.database, `
        INSERT INTO med250_audit_events (event_type, actor_id, request_id, details, created_at)
        VALUES ('stale_inbound_event_closed', ?, ?, json_object('timeout_seconds', ?), ?)
      `, [nullableString(event, "actor_id"), nullableString(event, "request_id"),
        Math.max(300, Math.min(staleSeconds, 86_400)), at]);
    }

    const terminalRequests = await allRows<D1Row>(this.database, `
      SELECT DISTINCT request.id
      FROM med250_client_requests request
      JOIN med250_dispatch_outbox outbox ON outbox.request_id = request.id
      WHERE request.source = 'whatsapp_image' AND request.status = 'dispatched'
        AND outbox.kind = 'client_media_request'
        AND NOT EXISTS (
          SELECT 1 FROM med250_dispatch_outbox unfinished
          WHERE unfinished.request_id = request.id AND unfinished.kind = 'client_media_request'
            AND unfinished.status NOT IN ('delivered', 'read', 'failed', 'dead_letter')
        )
      ORDER BY request.id LIMIT ?
    `, [boundedLimit]);
    let failedRequestsClosed = 0;
    let clientConfirmationsQueued = 0;
    for (const request of terminalRequests) {
      const finalized = await this.finalizeClientMediaRequest(stringValue(request, "id"));
      if (finalized.failedRequestClosed) failedRequestsClosed += 1;
      if (finalized.clientConfirmationQueued) clientConfirmationsQueued += 1;
    }

    return {
      expiredGrantsRevoked,
      staleMediaFailed,
      staleInboundClosed,
      failedRequestsClosed,
      clientConfirmationsQueued,
    };
  }

  async markStaleProviderSendsUnknown(staleSeconds = 600): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(60, Math.min(staleSeconds, 86_400)) * 1_000).toISOString();
    const rows = await allRows<D1Row>(this.database, "SELECT id, request_id FROM med250_dispatch_outbox WHERE status = 'sending' AND send_started_at < ?", [cutoff]);
    if (!rows.length) return 0;
    const at = nowIso();
    const results = await atomicBatch(this.database, rows.flatMap((row) => [
      this.database.prepare(`UPDATE med250_dispatch_outbox SET status = 'provider_send_unknown',
        last_error_code = coalesce(last_error_code, 'provider_acceptance_not_recorded'), updated_at = ?
        WHERE id = ? AND status = 'sending' AND send_started_at < ?`).bind(at, stringValue(row, "id"), cutoff),
      this.database.prepare(`INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
        SELECT 'stale_provider_send_marked_unknown', ?, ?, '{}', ?
        WHERE EXISTS (SELECT 1 FROM med250_dispatch_outbox outbox WHERE outbox.id = ? AND outbox.status = 'provider_send_unknown')`)
        .bind(row.request_id ?? null, stringValue(row, "id"), at, stringValue(row, "id")),
    ]));
    return results.filter((_result, index) => index % 2 === 0).reduce((count, result) => count + changes(result), 0);
  }

  async recordDeadLetter(input: { outboxId: string; queueDeliveryId: string; attempts: number }): Promise<boolean> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT request_id, kind, status, provider_message_sid FROM med250_dispatch_outbox WHERE id = ?
    `, [input.outboxId]);
    if (!row) return false;
    const status = stringValue(row, "status");
    if (status === "dead_letter") return true;
    if (row.provider_message_sid || ["sent", "delivered", "read", "provider_send_unknown"].includes(status)) return false;
    const at = nowIso();
    await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_dispatch_outbox SET status = 'dead_letter', queue_delivery_id = ?, claim_token = NULL,
          claimed_at = NULL, claim_expires_at = NULL, last_error_code = 'cloudflare_queue_retries_exhausted',
          failed_at = coalesce(failed_at, ?), updated_at = ? WHERE id = ?
      `).bind(input.queueDeliveryId, at, at, input.outboxId),
      this.database.prepare("UPDATE med250_media_access_grants SET revoked_at = coalesce(revoked_at, ?) WHERE outbox_id = ? AND revoked_at IS NULL")
        .bind(at, input.outboxId),
      this.database.prepare(`INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
        VALUES ('dispatch_dead_letter_recorded', ?, ?, json_object('dlq_receipt_attempts', ?, 'reason', 'cloudflare_queue_retries_exhausted'), ?)`)
        .bind(row.request_id ?? null, input.outboxId, Math.max(1, input.attempts), at),
    ]);
    if (stringValue(row, "kind") === "client_media_request" && row.request_id) {
      await this.finalizeClientMediaRequest(stringValue(row, "request_id"));
    }
    return true;
  }
}
