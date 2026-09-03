import { allRows, atomicBatch, firstRow, newId, nowIso, runStatement } from '../../db/index.ts';
import type { InboundReceipt } from './whatsapp-repository.ts';
import { BUSINESS_CONTENT } from './whatsapp-content.ts';

export const PARTNER_LOCATION_GUIDANCE = 'partner_location_outreach';
export const PARTNER_LOCATION_REGISTRY_KEY = `business:${BUSINESS_CONTENT.location_initial.content.friendly_name}`;

// Missing coordinates are the reason for this message, not a send exclusion.
// Contact identity, the exact permission and opt-outs still gate every send.
const permittedJoins = `FROM med250_partner_location_permissions permission
  JOIN med250_pharmacy_contacts c ON c.id=permission.contact_id
    AND c.pharmacy_id=permission.pharmacy_id AND c.e164=permission.e164
  JOIN med250_pharmacies p ON p.id=c.pharmacy_id
  JOIN med250_known_pharmacy_numbers known ON known.e164=c.e164
    AND known.pharmacy_id=c.pharmacy_id AND known.resolution_status='resolved'`;
const permittedWhere = `permission.revoked_at IS NULL AND permission.expires_at>?
  AND c.channel='whatsapp' AND c.active=1 AND c.verified_at IS NOT NULL AND c.dispatch_enabled=1
  AND p.licence_status='current' AND p.licence_expires_on>=?
  AND NOT EXISTS(SELECT 1 FROM med250_actors a WHERE a.e164=c.e164 AND a.whatsapp_opted_out_at IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM med250_partner_initial_permissions old
    WHERE old.contact_id=c.id AND old.revoked_at IS NOT NULL)`;

export async function enqueuePartnerLocationOutreach(db:D1Database, limit=10):Promise<number> {
  const at=nowIso();
  const approved=await firstRow(db,`SELECT 1 AS found FROM med250_twilio_content_registry
    WHERE definition_key=? AND state='ready' AND approval_status='approved' AND content_sid IS NOT NULL`,[PARTNER_LOCATION_REGISTRY_KEY]);
  if(!approved) return 0;
  const candidates=await allRows(db,`SELECT permission.id ${permittedJoins} WHERE ${permittedWhere}
    AND permission.outbox_id IS NULL AND p.geocode_status<>'verified'
    ORDER BY permission.recorded_at,permission.id LIMIT ?`,[at,at.slice(0,10),Math.max(1,Math.min(limit,25))]);
  let queued=0;
  for(const candidate of candidates) {
    const outboxId=newId();
    const results=await atomicBatch(db,[
      db.prepare(`INSERT OR IGNORE INTO med250_dispatch_outbox
        (id,dedupe_key,kind,pharmacy_id,recipient_e164,payload,status,max_provider_attempts,available_at,created_at,updated_at)
        SELECT ?, 'partner-location:'||permission.id,'client_guidance',permission.pharmacy_id,permission.e164,
          json_object('guidance',?,'permission_id',permission.id),'pending',1,?,?,?
        ${permittedJoins} WHERE ${permittedWhere} AND permission.id=? AND permission.outbox_id IS NULL
          AND p.geocode_status<>'verified'`).bind(outboxId,PARTNER_LOCATION_GUIDANCE,at,at,at,at,at.slice(0,10),candidate.id),
      db.prepare(`UPDATE med250_partner_location_permissions SET outbox_id=? WHERE id=? AND outbox_id IS NULL
        AND EXISTS(SELECT 1 FROM med250_dispatch_outbox WHERE id=? AND dedupe_key='partner-location:'||med250_partner_location_permissions.id)`)
        .bind(outboxId,candidate.id,outboxId),
    ]);
    queued+=Number(results[0].meta.changes??0);
  }
  return queued;
}

// null means an ordinary outbox row: use its existing eligibility check.
export async function partnerLocationEligibility(db:D1Database,outboxId:string):Promise<boolean|null> {
  const row=await firstRow(db,`SELECT * FROM med250_dispatch_outbox WHERE id=? AND kind='client_guidance'
    AND json_extract(payload,'$.guidance')=?`,[outboxId,PARTNER_LOCATION_GUIDANCE]);
  if(!row) return null;
  if(!['enqueued','sending'].includes(String(row.status))) return false;
  const at=nowIso();
  const allowed=await firstRow(db,`SELECT permission.id ${permittedJoins}
    JOIN med250_dispatch_outbox o ON o.id=permission.outbox_id AND o.pharmacy_id=permission.pharmacy_id
      AND o.recipient_e164=permission.e164 AND json_extract(o.payload,'$.permission_id')=permission.id
    WHERE ${permittedWhere} AND o.id=? AND p.geocode_status<>'verified'`,[at,at.slice(0,10),outboxId]);
  if(allowed) return true;
  await runStatement(db,`UPDATE med250_dispatch_outbox SET status='failed',last_error_code='partner_location_permission_unavailable',
    failed_at=?,updated_at=? WHERE id=? AND status IN ('enqueued','sending')`,[at,at,outboxId]);
  return false;
}

export async function capturePartnerLocation(db:D1Database,event:InboundReceipt,input:{e164:string;latitude:number;longitude:number;address:string|null;label:string|null}):Promise<boolean> {
  if(event.actorType!=='pharmacy'||!event.pharmacyId) return false;
  const at=nowIso();
  const permission=await firstRow(db,`SELECT permission.id ${permittedJoins}
    JOIN med250_dispatch_outbox o ON o.id=permission.outbox_id AND o.pharmacy_id=permission.pharmacy_id AND o.recipient_e164=permission.e164
    JOIN med250_inbound_events e ON e.id=? AND e.actor_id=? AND e.provider='twilio' AND e.received_at>=permission.recorded_at
    JOIN med250_actors actor ON actor.id=e.actor_id AND actor.actor_type='pharmacy' AND actor.e164=permission.e164 AND actor.pharmacy_id=permission.pharmacy_id
    WHERE ${permittedWhere} AND permission.pharmacy_id=? AND permission.e164=?
      AND o.status IN ('sending','sent','delivered','read','provider_send_unknown') AND o.send_started_at IS NOT NULL
      AND e.received_at>=o.send_started_at`,
    [event.eventId,event.actorId,at,at.slice(0,10),event.pharmacyId,input.e164]);
  if(!permission) return false;
  const valid=Number.isFinite(input.latitude)&&Number.isFinite(input.longitude)
    &&input.latitude>=-3&&input.latitude<=-0.8&&input.longitude>=28.7&&input.longitude<=30.9;
  const statements=[];
  if(valid) statements.push(db.prepare(`INSERT OR IGNORE INTO med250_partner_location_submissions
    (id,permission_id,event_id,actor_id,pharmacy_id,contact_id,e164,latitude,longitude,address,label,source,received_at)
    SELECT ?,permission.id,?,?,permission.pharmacy_id,permission.contact_id,permission.e164,?,?,?,?,'signed_whatsapp_native',?
    ${permittedJoins} WHERE ${permittedWhere} AND permission.id=?`)
    .bind(newId(),event.eventId,event.actorId,input.latitude,input.longitude,input.address?.slice(0,500)??null,input.label?.slice(0,200)??null,at,at,at.slice(0,10),permission.id));
  statements.push(db.prepare(`INSERT OR IGNORE INTO med250_dispatch_outbox
    (id,dedupe_key,kind,recipient_e164,payload,status,available_at,created_at,updated_at)
    SELECT ?,?,'client_guidance',?,json_object('guidance',?),'pending',?,?,?
    WHERE ?=0 OR EXISTS(SELECT 1 FROM med250_partner_location_submissions WHERE event_id=?)`)
    .bind(newId(),`partner-location-reply:${event.eventId}`,input.e164,valid?'partner_location_received':'partner_location_retry',at,at,at,valid?1:0,event.eventId),
    db.prepare(`UPDATE med250_inbound_events SET outcome=CASE WHEN ?=1 AND NOT EXISTS
      (SELECT 1 FROM med250_partner_location_submissions WHERE event_id=?) THEN 'partner_location_permission_changed' ELSE ? END,
      processed_at=?,last_error_code=NULL WHERE id=? AND actor_id=?`)
      .bind(valid?1:0,event.eventId,valid?'partner_location_received_for_review':'partner_location_outside_rwanda',at,event.eventId,event.actorId));
  await atomicBatch(db,statements);
  return true;
}
