import {
  allRows,
  atomicBatch,
  firstRow,
  newId,
  nowIso,
  type D1Row,
} from "../../db/index.ts";

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
): Promise<EligiblePharmacy[]> {
  const today = nowIso().slice(0, 10);
  const rows = await allRows<D1Row>(database, `
    select pharmacy.id, pharmacy.latitude, pharmacy.longitude,
           (select contact.e164
              from med250_pharmacy_contacts contact
             where contact.pharmacy_id = pharmacy.id
               and contact.channel = 'whatsapp'
               and contact.verified_at is not null
               and contact.active = 1
               and contact.dispatch_enabled = 1
             order by contact.verified_at desc, contact.id
             limit 1) as e164
    from med250_pharmacies pharmacy
    where pharmacy.marketplace_approved = 1
      and pharmacy.dispatch_enabled = 1
      and pharmacy.geocode_status = 'verified'
      and pharmacy.licence_status = 'current'
      and pharmacy.licence_expires_on >= ?
      and pharmacy.latitude is not null
      and pharmacy.longitude is not null
  `, [today]);
  return rows.flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    const e164 = typeof row.e164 === "string" ? row.e164 : "";
    const targetLatitude = Number(row.latitude);
    const targetLongitude = Number(row.longitude);
    if (!id || !/^[1-9][0-9]{7,14}$/.test(e164)
      || !Number.isFinite(targetLatitude) || !Number.isFinite(targetLongitude)) return [];
    return [{ id, e164, distanceM: haversineMeters(latitude, longitude, targetLatitude, targetLongitude) }];
  }).sort((left, right) => left.distanceM - right.distanceM || left.id.localeCompare(right.id)).slice(0, 10);
}

export async function dispatchToNearestPharmacies(
  database: D1Database,
  input: DispatchInput,
): Promise<number> {
  const existing = await firstRow<D1Row>(database, `
    select count(*) as recipient_count from med250_request_recipients where request_id = ?
  `, [input.requestId]);
  const existingCount = Number(existing?.recipient_count ?? 0);
  if (Number.isSafeInteger(existingCount) && existingCount > 0) return existingCount;

  const recipients = await eligiblePharmacies(database, input.latitude, input.longitude);
  const now = nowIso();
  if (!recipients.length) {
    if (input.emptyOutcome === "error") throw new Error("no verified pharmacy is eligible for dispatch");
    await atomicBatch(database, [
      database.prepare(`
        update med250_client_requests
        set status = 'cancelled', broadcast_at = null, closed_at = coalesce(closed_at, ?), updated_at = ?
        where id = ? and status in ('ready', 'dispatched')
      `).bind(now, now, input.requestId),
      database.prepare(`
        insert into med250_audit_events (event_type, actor_id, request_id, details, created_at)
        values (?, ?, ?, ?, ?)
      `).bind(
        input.emptyAuditEvent ?? `${input.auditEvent}_unassigned`, input.actorId, input.requestId,
        JSON.stringify({ recipient_count: 0, dispatch_limit: 10, ...(input.auditDetails ?? {}) }), now,
      ),
    ]);
    return 0;
  }

  const statements: D1PreparedStatement[] = [];
  for (const recipient of recipients) {
    statements.push(
      database.prepare(`
        insert or ignore into med250_request_recipients (
          request_id, pharmacy_id, recipient_e164, distance_m, dispatched_at
        ) values (?, ?, ?, ?, ?)
      `).bind(input.requestId, recipient.id, recipient.e164, recipient.distanceM, now),
      database.prepare(`
        insert or ignore into med250_dispatch_outbox (
          id, dedupe_key, kind, request_id, primary_media_id, pharmacy_id,
          recipient_e164, payload, status, available_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).bind(
        newId(), `${input.dedupePrefix}:${input.requestId}:pharmacy:${recipient.id}`, input.kind,
        input.requestId, input.primaryMediaId, recipient.id, recipient.e164,
        JSON.stringify({ ...input.basePayload, distance_m: Math.round(recipient.distanceM * 10) / 10 }),
        now, now, now,
      ),
    );
  }
  statements.push(
    database.prepare(`
      update med250_client_requests
      set status = 'dispatched', broadcast_at = coalesce(broadcast_at, ?), updated_at = ?
      where id = ? and status in ('ready', 'dispatched')
    `).bind(now, now, input.requestId),
    database.prepare(`
      insert into med250_audit_events (event_type, actor_id, request_id, details, created_at)
      values (?, ?, ?, ?, ?)
    `).bind(
      input.auditEvent, input.actorId, input.requestId,
      JSON.stringify({ recipient_count: recipients.length, dispatch_limit: 10, ...(input.auditDetails ?? {}) }), now,
    ),
  );
  await atomicBatch(database, statements);
  return recipients.length;
}

export const __test = { haversineMeters };
