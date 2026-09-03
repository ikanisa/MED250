import {
  allRows,
  atomicBatch,
  firstRow,
  newId,
  normalizedE164,
  nowIso,
  parseJsonObject,
  runStatement,
  type D1Row,
} from "../../db/index.ts";
import { clientMediaFinalizationDecision } from "./delivery-finality.ts";
import { ConversationError, WhatsAppConversation } from "./whatsapp-conversation.ts";

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

export class WhatsAppRepository {
  constructor(private readonly database: D1Database) {}

  private async finalizeClientMediaRequest(requestId: string): Promise<{
    failedRequestClosed: boolean;
    clientConfirmationQueued: boolean;
  }> {
    const cancelled = await firstRow<D1Row>(this.database, `SELECT 1 AS found FROM med250_dispatch_outbox
      WHERE request_id=? AND last_error_code='request_cancelled' LIMIT 1`,[requestId]);
    if(cancelled) return {failedRequestClosed:false,clientConfirmationQueued:false};
    const { total, delivered, unfinished } = await new WhatsAppConversation(this.database).deliveryCounts(requestId);
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
        SELECT ?, 'client-confirmation:' || request.id || ':' || ?, 'client_confirmation', request.id,
          request.customer_e164, json_object('recipient_count', ?), 'pending', ?, ?, ?
        FROM med250_client_requests request WHERE request.id = ?
      `, [newId(), delivered, delivered, at, at, at, requestId]);
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
    const request = await firstRow<D1Row>(this.database, "SELECT customer_e164 FROM med250_client_requests WHERE id = ?", [requestId]);
    if (request) await new WhatsAppConversation(this.database).queue(stringValue(request, "customer_e164"),
      "delivery_failed", `delivery-failed:${requestId}`, requestId);
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
    return new WhatsAppConversation(this.database).beginImage(eventId, contentType);
  }

  async finishClientImage(input: {
    eventId: string; requestId: string; mediaId: string; r2Key: string | null;
    byteSize: number | null; sha256: string | null; succeeded: boolean; errorCode: string | null;
  }): Promise<void> {
    return new WhatsAppConversation(this.database).finishImage(input);
  }

  async activeClientRequest(actorId: string): Promise<string | null> {
    return new WhatsAppConversation(this.database).active(actorId);
  }

  async saveLocation(input: {
    actorId: string; requestId: string | null; latitude: number; longitude: number; accuracyM: number | null;
    address: string | null; label: string | null; source: "whatsapp_native" | "secure_webview" | "web_order";
    captureKeyHex: string; eventId: string | null;
  }): Promise<{ locationId: string; recipientCount: number }> {
    return new WhatsAppConversation(this.database).location(input);
  }

  async useSavedLocation(input: { eventId: string; actorId: string; requestId: string; locationId: string }): Promise<number> {
    return new WhatsAppConversation(this.database).useSaved(input);
  }

  async requestNewLocation(input: { eventId: string; actorId: string; requestId: string }): Promise<void> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT request.id, actor.e164 FROM med250_actors actor JOIN med250_client_requests request ON request.actor_id = actor.id
      WHERE actor.id = ? AND actor.actor_type = 'client' AND request.id = ?
        AND request.status IN ('awaiting_location_choice', 'awaiting_location') AND request.expires_at>?
    `, [input.actorId, input.requestId, nowIso()]);
    if (!row) throw new ConversationError("expired");
    const at = nowIso();
    await atomicBatch(this.database, [
      this.database.prepare("UPDATE med250_client_requests SET status = 'awaiting_location', location_id = NULL, updated_at = ? WHERE id = ?")
        .bind(at, input.requestId),
      this.database.prepare(`
        INSERT OR IGNORE INTO med250_dispatch_outbox (
          id, dedupe_key, kind, request_id, recipient_e164, payload, status, available_at, created_at, updated_at
        ) VALUES (?, ?, 'location_capture', ?, ?, json_object('actor_id', ?, 'request_id', ?), 'pending', ?, ?, ?)
      `).bind(newId(), `client-native-location:${input.eventId}`, input.requestId, stringValue(row, "e164"),
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
      SELECT request.source,request.reference FROM med250_actors actor
      JOIN med250_request_recipients recipient ON recipient.pharmacy_id = actor.pharmacy_id
      JOIN med250_client_requests request ON request.id = recipient.request_id
      WHERE actor.id = ? AND actor.actor_type = 'pharmacy' AND actor.pharmacy_id = ?
        AND recipient.request_id = ? AND recipient.recipient_e164 = actor.e164
        AND request.status='dispatched' AND request.expires_at>?
    `, [input.actorId, input.pharmacyId, input.requestId,nowIso()]);
    if (!assigned) throw new ConversationError("pharmacy_expired");
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
    await atomicBatch(this.database, statements);
    const actor = await firstRow<D1Row>(this.database, "SELECT e164 FROM med250_actors WHERE id = ?", [input.actorId]);
    if (actor) await new WhatsAppConversation(this.database).queue(stringValue(actor, "e164"), "pharmacy_ack",
      `pharmacy-ack:${input.eventId}`, input.requestId,
      { "1": input.responseStatus === "can_fulfil" ? "Available" : "Not Available", "2": stringValue(assigned,"reference") });
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

  async checkOutboundEligibility(outboxId:string):Promise<boolean> {
    const row=await firstRow<D1Row>(this.database,`SELECT o.*,a.whatsapp_opted_out_at,r.status AS request_status,r.expires_at AS request_expires_at,
      (SELECT max(e.received_at) FROM med250_inbound_events e JOIN med250_actors sender ON sender.id=e.actor_id WHERE sender.e164=o.recipient_e164) AS last_inbound,
      coalesce(otp.expires_at,admin.expires_at) AS otp_expires_at
      FROM med250_dispatch_outbox o LEFT JOIN med250_actors a ON a.e164=o.recipient_e164
      LEFT JOIN med250_client_requests r ON r.id=o.request_id
      LEFT JOIN med250_otp_challenges otp ON otp.id=o.otp_challenge_id
      LEFT JOIN med250_admin_otp_challenges admin ON admin.id=o.admin_otp_challenge_id WHERE o.id=?`,[outboxId]);
    if(!row || !["enqueued","sending"].includes(stringValue(row,"status"))) return false;
    const payload=parseJsonObject(row.payload,"payload");
    const isPharmacy=["client_media_request","web_catalogue_order"].includes(stringValue(row,"kind"));
    const isOtp=row.kind==="otp";
    let code:string|null=null;
    if(row.whatsapp_opted_out_at && !["stopped","resumed","help","privacy","forgotten"].includes(String(payload.guidance??""))) code="recipient_opted_out";
    else if(isPharmacy && (["cancelled","expired","completed"].includes(String(row.request_status)) || String(row.request_expires_at)<=nowIso())) code="request_cancelled";
    else if(isOtp && (!row.otp_expires_at || String(row.otp_expires_at)<=nowIso())) code="otp_expired";
    else if(!isPharmacy && !isOtp && (!row.last_inbound || Date.now()-Date.parse(String(row.last_inbound))>=24*3600_000)) code="service_window_closed";
    else if(row.request_id && ["draft","consent","waiting_media"].includes(String(payload.guidance??""))
      && (["cancelled","expired","completed","dispatched"].includes(String(row.request_status)) || String(row.request_expires_at)<=nowIso())) code="stale_request_prompt";
    else if(["location_capture","location_choice"].includes(String(row.kind))
      && !["awaiting_location","awaiting_location_choice"].includes(String(row.request_status))) code="stale_request_prompt";
    if(!code && isPharmacy) {
      const initial=payload.permission_basis==='owner_attested_initial';
      const permitted=await firstRow<D1Row>(this.database,`SELECT c.id FROM med250_pharmacy_contacts c
        JOIN med250_pharmacies p ON p.id=c.pharmacy_id
        WHERE c.pharmacy_id=? AND c.e164=? AND c.channel='whatsapp'
          AND c.active=1 AND c.dispatch_enabled=1 AND c.verified_at IS NOT NULL
          AND p.marketplace_approved=1 AND p.dispatch_enabled=1 AND p.geocode_status='verified'
          AND p.licence_status='current' AND p.licence_expires_on>=?
          AND p.latitude BETWEEN -3 AND -0.8 AND p.longitude BETWEEN 28.7 AND 30.9
          AND ((?=0 AND c.messaging_opt_in_at IS NOT NULL) OR (?=1 AND EXISTS (
            SELECT 1 FROM med250_partner_initial_permissions permission
            JOIN med250_client_requests request ON request.id=permission.claimed_request_id
            WHERE permission.contact_id=c.id AND permission.e164=c.e164 AND permission.pharmacy_id=c.pharmacy_id
              AND permission.contact_id=? AND permission.attestation_id=? AND permission.claimed_request_id=?
              AND permission.revoked_at IS NULL AND request.created_at>=permission.recorded_at
          )))`,[row.pharmacy_id,row.recipient_e164,nowIso().slice(0,10),initial?1:0,initial?1:0,
        String(payload.permission_contact_id??''),String(payload.permission_attestation_id??''),row.request_id]);
      if(!permitted) code=initial?"partner_initial_permission_unavailable":"pharmacy_not_opted_in";
    }
    if(!code) return true;
    await runStatement(this.database,`UPDATE med250_dispatch_outbox SET status='failed',last_error_code=?,failed_at=?,updated_at=?
      WHERE id=? AND status IN ('enqueued','sending')`,[code,nowIso(),nowIso(),outboxId]);
    await this.revokeMediaGrants(outboxId);
    if(isPharmacy && row.request_id) await this.finalizeClientMediaRequest(stringValue(row,"request_id"));
    return false;
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
        ) VALUES (?, ?, ?, NULL, ?, ?, 'twilio_delivery', 3, 0, ?, ?)
      `).bind(newId(), input.tokenHashHex, input.outboxId, input.pharmacyId, input.r2Key, future(2 * 60 * 60_000), at),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
        SELECT 'private_media_grant_created', request_id, id,
          json_object('purpose', 'twilio_delivery', 'allowed_fetches', 3, 'ttl_seconds', 7200), ?
        FROM med250_dispatch_outbox WHERE id = ?
      `).bind(at, input.outboxId),
    ]);
  }

  async revokeMediaGrants(outboxId: string): Promise<void> {
    await runStatement(this.database, "UPDATE med250_media_access_grants SET revoked_at = coalesce(revoked_at, ?) WHERE outbox_id = ? AND revoked_at IS NULL", [nowIso(), outboxId]);
  }

  async inspectMediaGrant(tokenHashHex: string): Promise<string | null> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT r2_key FROM med250_media_access_grants WHERE token_hash = ? AND purpose = 'twilio_delivery'
        AND revoked_at IS NULL AND expires_at > ? AND fetch_count < allowed_fetches
    `, [tokenHashHex, nowIso()]);
    return row ? stringValue(row, "r2_key") : null;
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
    const pending = await allRows<D1Row>(this.database,"SELECT * FROM med250_pending_delivery_callbacks WHERE message_sid=? ORDER BY occurred_at,event_key",[messageSid]);
    for(const callback of pending) await this.recordDeliveryEvent({eventKey:stringValue(callback,"event_key"),messageSid,
      providerStatus:stringValue(callback,"provider_status"),errorCode:nullableString(callback,"error_code"),occurredAt:new Date(stringValue(callback,"occurred_at"))});
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
    const mapped = ["accepted", "queued", "sending", "sent"].includes(input.providerStatus) ? "sent"
      : input.providerStatus === "delivered" ? "delivered" : input.providerStatus === "read" ? "read"
        : ["failed", "undelivered"].includes(input.providerStatus) ? "failed" : null;
    if (!mapped) throw new Error("unsupported delivery status");
    const eventId = newId();
    const at = nowIso();
    const occurred = input.occurredAt.toISOString();
    await runStatement(this.database, `INSERT OR IGNORE INTO med250_pending_delivery_callbacks
      (event_key,message_sid,provider_status,error_code,occurred_at,received_at) VALUES (?,?,?,?,?,?)`,
      [input.eventKey,input.messageSid,input.providerStatus,bounded(input.errorCode,120),occurred,at]);
    const outbox = await firstRow<D1Row>(this.database, `
      SELECT id, kind, request_id, otp_challenge_id, admin_otp_challenge_id FROM med250_dispatch_outbox WHERE provider_message_sid = ?
    `, [input.messageSid]);
    if (!outbox) return true; // Authenticated receipt retained for later reconciliation.
    const outboxId = stringValue(outbox,"id");
    const statements: D1PreparedStatement[] = [
      this.database.prepare(`INSERT OR IGNORE INTO med250_provider_delivery_events
        (id,provider,provider_event_key,outbox_id,provider_message_sid,delivery_status,error_code,signature_verified,occurred_at,received_at)
        VALUES (?,'twilio',?,?,?,?,?,1,?,?)`).bind(eventId,input.eventKey,outboxId,input.messageSid,input.providerStatus,bounded(input.errorCode,120),occurred,at),
      this.database.prepare(`
        UPDATE med250_dispatch_outbox SET status = CASE
          WHEN status='read' OR ?='read' THEN 'read'
          WHEN status='delivered' OR ?='delivered' THEN 'delivered'
          WHEN status IN ('failed','dead_letter') THEN status ELSE ? END,
          delivered_at = CASE WHEN ? IN ('delivered', 'read') THEN coalesce(delivered_at, ?) ELSE delivered_at END,
          read_at = CASE WHEN ? = 'read' THEN coalesce(read_at, ?) ELSE read_at END,
          failed_at = CASE WHEN ? = 'failed' AND status NOT IN ('delivered','read') THEN coalesce(failed_at, ?) ELSE failed_at END,
          last_error_code = CASE WHEN ? IN ('delivered','read') THEN NULL
            WHEN ? = 'failed' AND status NOT IN ('delivered','read') THEN ? ELSE last_error_code END, updated_at = ? WHERE id = ?
      `).bind(mapped,mapped,mapped,mapped,occurred,mapped,occurred,mapped,occurred,mapped,mapped,bounded(input.errorCode,120),at,outboxId),
      this.database.prepare(`INSERT INTO med250_audit_events (event_type, request_id, outbox_id, details, created_at)
        SELECT ?, ?, ?, json_object('provider_status', ?), ? WHERE EXISTS (SELECT 1 FROM med250_provider_delivery_events WHERE id=?)`)
        .bind(`provider_delivery_${mapped}`,outbox.request_id??null,outboxId,input.providerStatus,at,eventId),
    ];
    for(const [table,id] of [["med250_otp_challenges",outbox.otp_challenge_id],["med250_admin_otp_challenges",outbox.admin_otp_challenge_id]]) {
      if(id) statements.push(this.database.prepare(`UPDATE ${table} SET delivery_status=(SELECT status FROM med250_dispatch_outbox WHERE id=?),
        provider_message_sid=coalesce(provider_message_sid,?),failed_at=(SELECT failed_at FROM med250_dispatch_outbox WHERE id=?) WHERE id=?`)
        .bind(outboxId,input.messageSid,outboxId,id));
    }
    statements.push(this.database.prepare("DELETE FROM med250_pending_delivery_callbacks WHERE event_key=?").bind(input.eventKey));
    await atomicBatch(this.database, statements);
    if (stringValue(outbox, "kind") === "client_media_request" && outbox.request_id) {
      // "Dispatched" means WhatsApp delivered the request to at least one
      // pharmacy, never merely that Twilio accepted the API call.
      await this.finalizeClientMediaRequest(stringValue(outbox, "request_id"));
    }
    return true;
  }

  async reconcileOperationalState(staleSeconds = 900, limit = 100): Promise<WhatsAppMaintenanceReceipt> {
    await new WhatsAppConversation(this.database).expireDrafts();
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const at = nowIso();
    const cutoff = new Date(Date.now() - Math.max(300, Math.min(staleSeconds, 86_400)) * 1_000).toISOString();
    const callbacks = await allRows<D1Row>(this.database,`SELECT callback.* FROM med250_pending_delivery_callbacks callback
      WHERE EXISTS (SELECT 1 FROM med250_dispatch_outbox o WHERE o.provider_message_sid=callback.message_sid)
      ORDER BY callback.received_at LIMIT ?`,[boundedLimit]);
    for(const callback of callbacks) await this.recordDeliveryEvent({eventKey:stringValue(callback,"event_key"),messageSid:stringValue(callback,"message_sid"),
      providerStatus:stringValue(callback,"provider_status"),errorCode:nullableString(callback,"error_code"),occurredAt:new Date(stringValue(callback,"occurred_at"))});

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
          SET status = 'processing_media', sealed_at=NULL, updated_at = ?
          WHERE id = ? AND status IN ('processing_media','awaiting_location','awaiting_location_choice','ready')
        `).bind(at, requestId),
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
      const customer = await firstRow<D1Row>(this.database,"SELECT customer_e164 FROM med250_client_requests WHERE id=? AND status='processing_media'",[requestId]);
      if(customer) await new WhatsAppConversation(this.database).queue(stringValue(customer,"customer_e164"),"media_failed",`media-timeout:${mediaId}`,requestId);
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

      ORDER BY request.id LIMIT ?
    `, [boundedLimit]);
    let failedRequestsClosed = 0;
    let clientConfirmationsQueued = 0;
    for (const request of terminalRequests) {
      const requestId = stringValue(request, "id");
      const finalized = await this.finalizeClientMediaRequest(requestId);
      const pending = await firstRow<D1Row>(this.database, "SELECT customer_e164, broadcast_at FROM med250_client_requests WHERE id = ?", [requestId]);
      if (pending?.broadcast_at && String(pending.broadcast_at) < cutoff) {
        const conversation = new WhatsAppConversation(this.database);
        const counts = await conversation.deliveryCounts(requestId);
        if (counts.unfinished > 0) await conversation.queue(stringValue(pending, "customer_e164"), "status",
          `pending-delivery:${requestId}:${counts.delivered}`, requestId,
          { "1": String(counts.delivered), "2": String(counts.unfinished) });
      }
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
