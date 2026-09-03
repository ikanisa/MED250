import {
  allRows,
  atomicBatch,
  firstRow,
  newId,
  nowIso,
  type D1Row,
} from "../../db/index.ts";
import { BUSINESS_CONTENT } from "./whatsapp-content.ts";

type DispatchKind = "client_media_request" | "web_catalogue_order";

type DispatchInput = {
  requestId: string;
  actorId: string;
  latitude: number;
  longitude: number;
  kind: DispatchKind;
  dedupePrefix: "client" | "web";
  primaryMediaId: string | null;
  basePayload: Record<string, unknown>;
  emptyOutcome: "error" | "cancel";
  auditEvent: string;
  emptyAuditEvent?: string;
  auditDetails?: Record<string, unknown>;
};

type EligiblePharmacy = {
  id: string;
  e164: string;
  distanceM: number;
  latitude: number;
  longitude: number;
  licenceExpiresOn: string;
  contactId: string;
  attestationId: string | null;
  permissionBasis: "recipient_opt_in" | "owner_attested_initial";
};

function haversineMeters(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitude = radians(toLat - fromLat);
  const longitude = radians(toLon - fromLon);
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function eligiblePharmacies(
  database: D1Database,
  latitude: number,
  longitude: number,
  input: DispatchInput,
): Promise<EligiblePharmacy[]> {
  const today = nowIso().slice(0, 10);
  const initialKey = input.kind === "client_media_request" ? "image_initial" : "web_initial";
  const rows = await allRows<D1Row>(database, `
    select pharmacy.id, pharmacy.latitude, pharmacy.longitude, pharmacy.licence_expires_on,
      contact.id AS contact_id, contact.e164, contact.messaging_opt_in_at, permission.attestation_id
    from med250_pharmacies pharmacy
    join med250_pharmacy_contacts contact ON contact.pharmacy_id=pharmacy.id
    join med250_client_requests request ON request.id=?
    left join med250_partner_initial_permissions permission ON permission.contact_id=contact.id
      AND permission.e164=contact.e164 AND permission.pharmacy_id=pharmacy.id
    where contact.channel='whatsapp' AND contact.verified_at IS NOT NULL
      AND contact.active=1 AND contact.dispatch_enabled=1
      AND NOT EXISTS (SELECT 1 FROM med250_actors a WHERE a.e164=contact.e164 AND a.whatsapp_opted_out_at IS NOT NULL)
      AND (contact.messaging_opt_in_at IS NOT NULL OR (
        permission.revoked_at IS NULL AND permission.attestation_id IS NOT NULL
        AND (permission.claimed_request_id IS NULL OR permission.claimed_request_id=request.id)
        AND request.created_at>=permission.recorded_at
        AND EXISTS (SELECT 1 FROM med250_twilio_content_registry registry
          WHERE registry.definition_key=? AND registry.state='ready' AND registry.approval_status='approved')
      ))
      AND pharmacy.marketplace_approved = 1
      and pharmacy.dispatch_enabled = 1
      and pharmacy.geocode_status = 'verified'
      and pharmacy.licence_status = 'current'
      and pharmacy.licence_expires_on >= ?
      and pharmacy.latitude is not null
      and pharmacy.longitude is not null
    ORDER BY pharmacy.id, (contact.messaging_opt_in_at IS NOT NULL) DESC, contact.verified_at DESC, contact.id
  `, [input.requestId, `business:${BUSINESS_CONTENT[initialKey].content.friendly_name}`, today]);
  const pharmacies = new Set<string>();
  return rows.flatMap((row): EligiblePharmacy[] => {
    const id = typeof row.id === "string" ? row.id : "";
    const e164 = typeof row.e164 === "string" ? row.e164 : "";
    const targetLatitude = Number(row.latitude);
    const targetLongitude = Number(row.longitude);
    if (!id || pharmacies.has(id) || !/^[1-9][0-9]{7,14}$/.test(e164)
      || !Number.isFinite(targetLatitude) || !Number.isFinite(targetLongitude)
      || targetLatitude < -3 || targetLatitude > -0.8 || targetLongitude < 28.7 || targetLongitude > 30.9) return [];
    pharmacies.add(id);
    return [{ id, e164, distanceM: haversineMeters(latitude, longitude, targetLatitude, targetLongitude),
      latitude:targetLatitude,longitude:targetLongitude,licenceExpiresOn:String(row.licence_expires_on),
      contactId: String(row.contact_id), attestationId: row.messaging_opt_in_at ? null : String(row.attestation_id),
      permissionBasis: row.messaging_opt_in_at ? "recipient_opt_in" : "owner_attested_initial" }];
  }).sort((left, right) => left.distanceM - right.distanceM || left.id.localeCompare(right.id));
}

export async function dispatchToNearestPharmacies(
  database: D1Database,
  input: DispatchInput,
): Promise<number> {
  // A competing request may claim an initial grant after selection. D1 rolls
  // the entire batch back; reselect instead of reusing that recipient's grant.
  for (let attempt = 0; ; attempt++) {
    try { return await dispatchAttempt(database, input); }
    catch (error) {
      if (attempt >= 2 || !(error instanceof Error) || !error.message.includes("partner_initial_permission_changed")) throw error;
    }
  }
}

async function dispatchAttempt(database: D1Database, input: DispatchInput): Promise<number> {
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)
    || input.latitude < -3 || input.latitude > -0.8 || input.longitude < 28.7 || input.longitude > 30.9) throw new Error("Invalid dispatch location.");
  const existing = await firstRow<D1Row>(database, `
    select count(*) as recipient_count from med250_request_recipients where request_id = ?
  `, [input.requestId]);
  const existingCount = Number(existing?.recipient_count ?? 0);
  if (Number.isSafeInteger(existingCount) && existingCount > 0) return existingCount;

  const candidates = await eligiblePharmacies(database, input.latitude, input.longitude, input);
  const seen = new Set<string>();
  const recipients = candidates.filter((candidate) => !seen.has(candidate.e164) && Boolean(seen.add(candidate.e164))).slice(0,10);
  const media = input.kind === "client_media_request"
    ? await allRows<D1Row>(database, `SELECT id FROM med250_request_media WHERE request_id=? AND processing_status='ready' ORDER BY created_at,id`, [input.requestId])
    : [{ id: input.primaryMediaId }];
  if (input.kind === "client_media_request") {
    const permitted = await firstRow<D1Row>(database, `SELECT id FROM med250_client_requests r WHERE id=? AND actor_id=?
      AND status='ready' AND sealed_at IS NOT NULL AND dispatch_consented_at IS NOT NULL AND expires_at>?
      AND media_count=? AND media_count BETWEEN 1 AND 10
      AND NOT EXISTS (SELECT 1 FROM med250_request_media m WHERE m.request_id=r.id AND m.processing_status='processing')
      AND NOT EXISTS (SELECT 1 FROM med250_actors a WHERE a.id=r.actor_id AND a.whatsapp_opted_out_at IS NOT NULL)`,
    [input.requestId,input.actorId,nowIso(),media.length]);
    if (!permitted) throw new Error("The request is not ready and consented for dispatch.");
  }
  const now = nowIso();
  if (!recipients.length) {
    if (input.emptyOutcome === "error") throw new Error("no verified pharmacy is eligible for dispatch");
    await atomicBatch(database, [
      database.prepare(`
        update med250_client_requests
        set status = 'cancelled', broadcast_at = null, closed_at = coalesce(closed_at, ?), updated_at = ?
        where id = ? and status = 'ready'
          and not exists (select 1 from med250_request_recipients where request_id=med250_client_requests.id)
      `).bind(now, now, input.requestId),
      database.prepare(`
        insert into med250_audit_events (event_type, actor_id, request_id, details, created_at)
        values (?, ?, ?, ?, ?)
      `).bind(
        input.emptyAuditEvent ?? `${input.auditEvent}_unassigned`, input.actorId, input.requestId,
        JSON.stringify({ recipient_count: 0, dispatch_limit: 10, ...(input.auditDetails ?? {}) }), now,
      ),
    ]);
    const raced = await firstRow<D1Row>(database,"SELECT count(*) AS n FROM med250_request_recipients WHERE request_id=?",[input.requestId]);
    return Number(raced?.n ?? 0);
  }

  const statements: D1PreparedStatement[] = [];
  for (const recipient of recipients) {
    if (recipient.permissionBasis === "owner_attested_initial") statements.push(database.prepare(`
      UPDATE med250_partner_initial_permissions SET claimed_request_id=?,claimed_at=coalesce(claimed_at,?)
      WHERE contact_id=? AND attestation_id=?
    `).bind(input.requestId, now, recipient.contactId, recipient.attestationId));
    statements.push(
      database.prepare(`
        insert or ignore into med250_request_recipients (
          request_id, pharmacy_id, recipient_e164, distance_m, dispatched_at
        ) select ?, ?, ?, ?, ? from med250_client_requests where id=? and status='ready'
          AND NOT EXISTS (SELECT 1 FROM med250_actors a WHERE a.e164=? AND a.whatsapp_opted_out_at IS NOT NULL)
      `).bind(input.requestId, recipient.id, recipient.e164, recipient.distanceM, now, input.requestId, recipient.e164),
    );
    for (const [index, attachment] of media.entries()) statements.push(database.prepare(`
        insert or ignore into med250_dispatch_outbox (
          id, dedupe_key, kind, request_id, primary_media_id, pharmacy_id,
          recipient_e164, payload, status, available_at, created_at, updated_at
        ) select ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?
          from med250_client_requests where id=? and status='ready'
          AND EXISTS (SELECT 1 FROM med250_request_recipients recipient WHERE recipient.request_id=? AND recipient.pharmacy_id=?)
      `).bind(
        newId(), `${input.dedupePrefix}:${input.requestId}:pharmacy:${recipient.id}:media:${attachment.id ?? "none"}`, input.kind,
        input.requestId, attachment.id, recipient.id, recipient.e164,
        JSON.stringify({ ...input.basePayload, image_index:index, image_count:media.length, distance_m: Math.round(recipient.distanceM * 10) / 10,
          permission_basis: recipient.permissionBasis, permission_contact_id: recipient.contactId, permission_attestation_id: recipient.attestationId }),
        now, now, now,input.requestId,input.requestId,recipient.id,
      ));
  }
  statements.push(
    database.prepare(`
      insert into med250_audit_events (event_type, actor_id, request_id, details, created_at)
      select ?, ?, ?, json_set(?, '$.recipient_count',
        (SELECT count(*) FROM med250_request_recipients WHERE request_id=?)), ?
      from med250_client_requests where id=? and status='ready'
    `).bind(
      input.auditEvent, input.actorId, input.requestId,
      JSON.stringify({ recipient_count: recipients.length, dispatch_limit: 10, algorithm:"haversine_straight_line_v1",
        eligible_candidate_count:candidates.length,
        selected_candidate_snapshot:recipients.map((r,index)=>({pharmacy_id:r.id,rank:index+1,distance_m:r.distanceM,
          pharmacy_latitude:r.latitude,pharmacy_longitude:r.longitude,licence_expires_on:r.licenceExpiresOn,
          permission_basis:r.permissionBasis,attestation_id:r.attestationId,
          verified_messaging_opt_in:r.permissionBasis==='recipient_opt_in'})),...(input.auditDetails ?? {}) }),input.requestId,now,input.requestId,
    ),
    database.prepare(`
      update med250_client_requests
      set status = 'dispatched', broadcast_at = coalesce(broadcast_at, ?), updated_at = ?
      where id = ? and status = 'ready'
        AND EXISTS (SELECT 1 FROM med250_request_recipients WHERE request_id=med250_client_requests.id)
    `).bind(now, now, input.requestId),
  );
  await atomicBatch(database, statements);
  const stored = await firstRow<D1Row>(database,"SELECT count(*) AS n FROM med250_request_recipients WHERE request_id=?",[input.requestId]);
  return Number(stored?.n ?? 0);
}

export const __test = { haversineMeters };
