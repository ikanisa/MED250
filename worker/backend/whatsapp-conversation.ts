import { allRows, atomicBatch, firstRow, newId, newReference, nowIso, runStatement, type D1Row } from "../../db/index.ts";
import { dispatchToNearestPharmacies } from "./dispatch-repository.ts";
import type { ClientImageReceipt, InboundReceipt } from "./whatsapp-repository.ts";
import { WHATSAPP_IMAGE_MAX_BYTES } from "./r2-media.ts";

export const WHATSAPP_NOTICE_VERSION = "med250-request-sharing-2026-09-02";
export class ConversationError extends Error {
  constructor(readonly guidance: string) { super(guidance); this.name = "ConversationError"; }
}
const text = (row: D1Row, key: string) => String(row[key] ?? "");
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

export class WhatsAppConversation {
  constructor(private readonly db: D1Database) {}

  async queue(e164: string, key: string, dedupe: string, requestId: string | null = null, variables: Record<string, string> = {}): Promise<void> {
    const at = nowIso();
    await runStatement(this.db, `INSERT OR IGNORE INTO med250_dispatch_outbox
      (id, dedupe_key, kind, request_id, recipient_e164, payload, status, available_at, created_at, updated_at)
      VALUES (?, ?, 'client_guidance', ?, ?, ?, 'pending', ?, ?, ?)`,
    [newId(), dedupe, requestId, e164, JSON.stringify({ guidance: key, variables }), at, at, at]);
  }

  async active(actorId: string): Promise<string | null> {
    const row = await firstRow(this.db, `SELECT request.id FROM med250_whatsapp_drafts draft
      JOIN med250_client_requests request ON request.id = draft.request_id
      WHERE draft.actor_id = ? AND request.status IN ('processing_media','awaiting_location','awaiting_location_choice','ready')
      AND request.expires_at > ?`, [actorId, nowIso()]);
    return row ? text(row, "id") : null;
  }

  async request(actorId: string, requestId: string): Promise<D1Row> {
    const row = await firstRow(this.db, `SELECT * FROM med250_client_requests WHERE id = ? AND actor_id = ?
      AND source = 'whatsapp_image' AND expires_at > ? AND status NOT IN ('cancelled','expired','completed')`, [requestId, actorId, nowIso()]);
    if (!row) throw new ConversationError("expired");
    return row;
  }

  async complete(eventId: string, outcome: string, requestId?: string): Promise<void> {
    await runStatement(this.db, `UPDATE med250_inbound_events SET outcome = ?, processed_at = ?,
      request_id = coalesce(?, request_id), last_error_code = NULL WHERE id = ?`, [outcome, nowIso(), requestId ?? null, eventId]);
  }

  async beginImage(eventId: string, contentType: string): Promise<ClientImageReceipt> {
    const event = await firstRow(this.db, `SELECT event.*, actor.e164, actor.actor_type, actor.whatsapp_opted_out_at
      FROM med250_inbound_events event JOIN med250_actors actor ON actor.id = event.actor_id WHERE event.id = ?`, [eventId]);
    if (!event || event.actor_type !== "client") throw new ConversationError("expired");
    if (event.whatsapp_opted_out_at) throw new ConversationError("stopped");
    const existing = await firstRow(this.db, `SELECT * FROM med250_request_media WHERE provider_message_sid = ? AND media_index = 0`, [event.provider_message_sid]);
    let requestId = existing ? text(existing, "request_id") : "";
    if (!existing) {
      const activeId = await this.active(text(event, "actor_id"));
      if (activeId) {
        const request = await this.request(text(event, "actor_id"), activeId);
        if (request.sealed_at) throw new ConversationError("request_locked");
      }
      const id = newId();
      const at = nowIso();
      // Every statement observes the same D1 transaction. Only one active draft wins.
      await atomicBatch(this.db, [
        this.db.prepare(`INSERT INTO med250_client_requests
          (id, reference, actor_id, customer_e164, source, status, dispatch_limit, media_count, expires_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, 'whatsapp_image','processing_media',10,0,?,?,?
          WHERE NOT EXISTS (SELECT 1 FROM med250_whatsapp_drafts d JOIN med250_client_requests r ON r.id=d.request_id
            WHERE d.actor_id=? AND r.status IN ('processing_media','awaiting_location','awaiting_location_choice','ready') AND r.expires_at>?)`)
          .bind(id, newReference("WA"), event.actor_id, event.e164, later(2 * 60 * 60_000), at, at, event.actor_id, at),
        this.db.prepare(`INSERT INTO med250_whatsapp_drafts(actor_id,request_id,updated_at)
          SELECT actor_id,id,? FROM med250_client_requests WHERE id=?
          ON CONFLICT(actor_id) DO UPDATE SET request_id=excluded.request_id,updated_at=excluded.updated_at`).bind(at, id),
        this.db.prepare(`INSERT OR IGNORE INTO med250_request_media
          (id,request_id,provider_message_sid,media_index,content_type,processing_status,retention_expires_at,created_at,updated_at)
          SELECT ?,r.id,?,0,?,'processing',?,?,? FROM med250_whatsapp_drafts d JOIN med250_client_requests r ON r.id=d.request_id
          WHERE d.actor_id=? AND r.sealed_at IS NULL AND r.expires_at>?
          AND r.status IN ('processing_media','awaiting_location','awaiting_location_choice','ready')
          AND (SELECT count(*) FROM med250_request_media m WHERE m.request_id=r.id AND m.processing_status<>'failed')<10`)
          .bind(newId(), event.provider_message_sid, contentType, later(30 * 86400_000), at, at, event.actor_id, at),
        this.db.prepare(`UPDATE med250_inbound_events SET request_id=(SELECT request_id FROM med250_request_media WHERE provider_message_sid=? AND media_index=0),
          outcome='client_image_processing' WHERE id=? AND request_id IS NULL`).bind(event.provider_message_sid, eventId),
      ]);
      const stored = await firstRow(this.db, `SELECT request_id FROM med250_request_media WHERE provider_message_sid=? AND media_index=0`, [event.provider_message_sid]);
      if (!stored) throw new ConversationError("limit");
      requestId = text(stored, "request_id");
    }
    const media = await firstRow(this.db, `SELECT id,processing_status FROM med250_request_media WHERE provider_message_sid=? AND media_index=0`, [event.provider_message_sid]);
    if (!media) throw new Error("Image receipt was not persisted.");
    return { requestId, mediaId: text(media, "id"), actorId: text(event, "actor_id"), customerE164: text(event, "e164"),
      savedLocationId: null, mediaStatus: text(media, "processing_status") as ClientImageReceipt["mediaStatus"] };
  }

  async finishImage(input: { eventId: string; requestId: string; mediaId: string; r2Key: string | null;
    byteSize: number | null; sha256: string | null; succeeded: boolean; errorCode: string | null }): Promise<void> {
    if (input.succeeded && (!input.r2Key || !input.byteSize || input.byteSize > WHATSAPP_IMAGE_MAX_BYTES || !/^[0-9a-f]{64}$/.test(input.sha256 ?? ""))) {
      throw new Error("Invalid ready-image receipt.");
    }
    const at = nowIso();
    await atomicBatch(this.db, [
      this.db.prepare(`UPDATE med250_request_media SET r2_key=?,byte_size=?,sha256=?,processing_status=?,processing_error_code=?,updated_at=?
        WHERE id=? AND request_id=? AND processing_status='processing'`).bind(input.r2Key,input.byteSize,input.sha256,
        input.succeeded ? "ready" : "failed", input.errorCode,at,input.mediaId,input.requestId),
      this.db.prepare(`UPDATE med250_client_requests SET media_count=(SELECT count(*) FROM med250_request_media WHERE request_id=? AND processing_status='ready'),updated_at=? WHERE id=?`)
        .bind(input.requestId,at,input.requestId),
      this.db.prepare(`UPDATE med250_inbound_events SET outcome=?,processed_at=?,last_error_code=? WHERE id=?`)
        .bind(input.succeeded ? "client_image_stored_private_r2" : "client_image_failed",at,input.errorCode,input.eventId),
    ]);
    const request = await firstRow(this.db, `SELECT * FROM med250_client_requests WHERE id=?`, [input.requestId]);
    if (!request || ["cancelled", "expired"].includes(text(request,"status"))) return;
    if (!input.succeeded) {
      // A failed second photo must not silently produce a one-photo dispatch.
      await runStatement(this.db, `UPDATE med250_client_requests SET sealed_at=NULL,status='processing_media' WHERE id=? AND status<>'dispatched'`, [input.requestId]);
      await this.queue(text(request,"customer_e164"), "media_failed", `media-failed:${input.mediaId}`, input.requestId);
    } else if (request.sealed_at) {
      await this.ready(text(request,"actor_id"), input.requestId, input.eventId);
    } else {
      await this.queue(text(request,"customer_e164"), "draft", `draft-photo:${input.mediaId}`, input.requestId,
        { "1": String(request.media_count), "2": input.requestId });
    }
  }

  async ready(actorId: string, requestId: string, eventId: string): Promise<void> {
    const request = await this.request(actorId, requestId);
    if (request.status === "dispatched") { await this.status(actorId,requestId,eventId); return; }
    const counts = await firstRow(this.db, `SELECT sum(processing_status='ready') AS ready,sum(processing_status='processing') AS processing
      FROM med250_request_media WHERE request_id=?`, [requestId]);
    if (!Number(counts?.ready) && !Number(counts?.processing)) throw new ConversationError("send_image");
    await runStatement(this.db, `UPDATE med250_client_requests SET sealed_at=coalesce(sealed_at,?),updated_at=? WHERE id=? AND status IN ('processing_media','awaiting_location','awaiting_location_choice','ready')`, [nowIso(),nowIso(),requestId]);
    // Recheck after seal: no later image can join this bundle.
    const pending = await firstRow(this.db, `SELECT count(*) AS n FROM med250_request_media WHERE request_id=? AND processing_status='processing'`, [requestId]);
    if (Number(pending?.n)) {
      await this.queue(text(request,"customer_e164"),"waiting_media",`waiting:${eventId}`,requestId);
    } else if (request.location_id) {
      await this.consentPrompt(requestId,eventId);
    } else {
      const saved = await firstRow(this.db, `SELECT id FROM med250_client_locations WHERE actor_id=? AND is_current=1 ORDER BY captured_at DESC LIMIT 1`, [actorId]);
      const at = nowIso();
      await atomicBatch(this.db, [
        this.db.prepare(`UPDATE med250_client_requests SET status=? WHERE id=? AND status IN ('processing_media','awaiting_location','awaiting_location_choice','ready')`).bind(saved ? "awaiting_location_choice" : "awaiting_location",requestId),
        this.db.prepare(`INSERT OR IGNORE INTO med250_dispatch_outbox
          (id,dedupe_key,kind,request_id,recipient_e164,payload,status,available_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'pending',?,?,?)`).bind(newId(),`sealed-location:${requestId}`,saved ? "location_choice" : "location_capture",requestId,
          request.customer_e164,JSON.stringify({actor_id:actorId,request_id:requestId,location_id:saved?.id ?? null}),at,at,at),
      ]);
    }
    await this.complete(eventId,"draft_ready",requestId);
  }

  async consentPrompt(requestId: string, eventId: string): Promise<void> {
    const request = await firstRow(this.db, `SELECT * FROM med250_client_requests WHERE id=? AND sealed_at IS NOT NULL
      AND location_id IS NOT NULL AND status IN ('processing_media','awaiting_location','awaiting_location_choice','ready') AND expires_at>?`, [requestId,nowIso()]);
    if (!request) return;
    const updated=await runStatement(this.db, `UPDATE med250_client_requests SET status='ready',updated_at=? WHERE id=? AND status IN ('processing_media','awaiting_location','awaiting_location_choice','ready')`, [nowIso(),requestId]);
    if(!updated.meta.changes) return;
    await this.queue(text(request,"customer_e164"),"consent",`consent:${eventId}`,requestId,{"1":String(request.media_count),"2":requestId});
  }

  async location(input: {actorId:string;requestId:string|null;latitude:number;longitude:number;accuracyM:number|null;address:string|null;
    label:string|null;source:"whatsapp_native"|"secure_webview"|"web_order";captureKeyHex:string;eventId:string|null}): Promise<{locationId:string;recipientCount:number}> {
    if (![input.latitude,input.longitude].every(Number.isFinite) || input.latitude < -3 || input.latitude > -0.8 || input.longitude < 28.7 || input.longitude > 30.9) throw new ConversationError("expired");
    if (!input.requestId) throw new ConversationError("send_image");
    const request = await this.request(input.actorId,input.requestId);
    if (request.status === "dispatched") throw new ConversationError("request_locked");
    if (!/^[0-9a-f]{64}$/.test(input.captureKeyHex)) throw new Error("Invalid capture key.");
    const at = nowIso();
    await runStatement(this.db, `INSERT OR IGNORE INTO med250_client_locations
      (id,actor_id,latitude,longitude,accuracy_m,address,label,source,capture_key,is_current,consented_at,captured_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?)`, [newId(),input.actorId,input.latitude,input.longitude,input.accuracyM,
      input.address?.slice(0,500) ?? null,input.label?.slice(0,120) ?? null,input.source,input.captureKeyHex,at,at,at,at]);
    const location = await firstRow(this.db, `SELECT id FROM med250_client_locations WHERE capture_key=? AND actor_id=?`, [input.captureKeyHex,input.actorId]);
    if (!location) throw new Error("Location was not persisted.");
    await runStatement(this.db, `UPDATE med250_client_requests SET location_id=?,updated_at=? WHERE id=? AND status IN ('processing_media','awaiting_location','awaiting_location_choice','ready')`, [location.id,at,input.requestId]);
    if (request.sealed_at) await this.consentPrompt(input.requestId,input.eventId ?? input.captureKeyHex);
    else await this.queue(text(request,"customer_e164"),"draft",`location-draft:${input.captureKeyHex}`,input.requestId,{"1":String(request.media_count),"2":input.requestId});
    if (input.eventId) await this.complete(input.eventId,"location_received_for_request",input.requestId);
    return {locationId:text(location,"id"),recipientCount:0};
  }

  async useSaved(input:{eventId:string;actorId:string;requestId:string;locationId:string}):Promise<number> {
    const request=await this.request(input.actorId,input.requestId);
    if (request.status === "dispatched") throw new ConversationError("request_locked");
    const point=await firstRow(this.db,`SELECT id FROM med250_client_locations WHERE id=? AND actor_id=? AND is_current=1`,[input.locationId,input.actorId]);
    if(!point) throw new ConversationError("expired");
    await runStatement(this.db,`UPDATE med250_client_requests SET location_id=?,sealed_at=coalesce(sealed_at,?) WHERE id=? AND status IN ('processing_media','awaiting_location','awaiting_location_choice','ready')`,[input.locationId,nowIso(),input.requestId]);
    await this.consentPrompt(input.requestId,input.eventId);
    await this.complete(input.eventId,"saved_location_selected",input.requestId);
    return 0;
  }

  async send(actorId:string,requestId:string,eventId:string,save:boolean):Promise<void> {
    const request=await this.request(actorId,requestId);
    if(request.status === "dispatched") {await this.status(actorId,requestId,eventId);return;}
    const media=await firstRow(this.db,`SELECT count(*) AS n,sum(processing_status='processing') AS pending FROM med250_request_media WHERE request_id=? AND processing_status IN ('processing','ready')`,[requestId]);
    if(!request.sealed_at || !request.location_id || !Number(media?.n) || Number(media?.pending)) throw new ConversationError("waiting_media");
    const point=await firstRow(this.db,`SELECT * FROM med250_client_locations WHERE id=? AND actor_id=?`,[request.location_id,actorId]);
    if(!point) throw new ConversationError("expired");
    const at=nowIso();
    const statements=[
      this.db.prepare(`UPDATE med250_client_requests SET dispatch_consented_at=coalesce(dispatch_consented_at,?),privacy_notice_version=?,updated_at=? WHERE id=? AND status='ready'`).bind(at,WHATSAPP_NOTICE_VERSION,at,requestId),
      this.db.prepare(`INSERT OR IGNORE INTO med250_whatsapp_permissions(id,actor_id,request_id,event_id,purpose,notice_version,granted,created_at)
        VALUES (?,?,?,?,'request_disclosure',?,1,?)`).bind(newId(),actorId,requestId,eventId,WHATSAPP_NOTICE_VERSION,at),
      this.db.prepare(`INSERT OR IGNORE INTO med250_whatsapp_permissions(id,actor_id,request_id,event_id,purpose,notice_version,granted,created_at)
        VALUES (?,?,?,?,'saved_location',?,?,?)`).bind(newId(),actorId,requestId,eventId,WHATSAPP_NOTICE_VERSION,save?1:0,at),
    ];
    if(save) statements.push(
      this.db.prepare(`UPDATE med250_client_locations SET is_current=0,updated_at=? WHERE actor_id=? AND is_current=1`).bind(at,actorId),
      this.db.prepare(`UPDATE med250_client_locations SET is_current=1,consented_at=?,last_used_at=?,updated_at=? WHERE id=? AND actor_id=?`).bind(at,at,at,point.id,actorId),
    );
    await atomicBatch(this.db,statements);
    const count=await dispatchToNearestPharmacies(this.db,{requestId,actorId,latitude:Number(point.latitude),longitude:Number(point.longitude),kind:"client_media_request",
      dedupePrefix:"client",primaryMediaId:null,basePayload:{source:"whatsapp_image"},emptyOutcome:"cancel",auditEvent:"client_request_dispatched",emptyAuditEvent:"client_request_no_eligible_pharmacy"});
    if(!count) await this.queue(text(request,"customer_e164"),"no_pharmacy",`no-pharmacy:${requestId}`,requestId);
    await this.complete(eventId,count?"client_request_dispatched":"no_eligible_pharmacy",requestId);
  }

  async status(actorId:string,requestId:string,eventId:string):Promise<void> {
    const request=await firstRow(this.db,`SELECT customer_e164 FROM med250_client_requests WHERE id=? AND actor_id=?`,[requestId,actorId]);
    if(!request) throw new ConversationError("expired");
    const counts=await this.deliveryCounts(requestId);
    await this.queue(text(request,"customer_e164"),"status",`status:${eventId}`,requestId,{"1":String(counts.delivered),"2":String(counts.unfinished)});
    await this.complete(eventId,"status_requested",requestId);
  }

  async deliveryCounts(requestId:string):Promise<{total:number;delivered:number;unfinished:number}> {
    const row=await firstRow(this.db,`SELECT count(*) AS total,coalesce(sum(complete),0) AS delivered,coalesce(sum(pending),0) AS unfinished FROM (
      SELECT recipient.pharmacy_id,
        CASE WHEN count(o.id)=r.media_count AND sum(o.status IN ('delivered','read'))=r.media_count THEN 1 ELSE 0 END AS complete,
        CASE WHEN count(o.id)<r.media_count OR sum(o.status NOT IN ('delivered','read','failed','dead_letter'))>0 THEN 1 ELSE 0 END AS pending
      FROM med250_request_recipients recipient JOIN med250_client_requests r ON r.id=recipient.request_id
      LEFT JOIN med250_dispatch_outbox o ON o.request_id=recipient.request_id AND o.pharmacy_id=recipient.pharmacy_id AND o.kind='client_media_request'
      WHERE recipient.request_id=? GROUP BY recipient.pharmacy_id,r.media_count)`,[requestId]);
    return {total:Number(row?.total??0),delivered:Number(row?.delivered??0),unfinished:Number(row?.unfinished??0)};
  }

  async cancel(actorId:string,eventId:string,requestId?:string):Promise<void> {
    const recent = requestId ? null : await firstRow(this.db, `SELECT id FROM med250_client_requests WHERE actor_id=?
      AND source='whatsapp_image' AND status='dispatched' AND expires_at>? ORDER BY created_at DESC LIMIT 1`, [actorId,nowIso()]);
    const id=requestId??await this.active(actorId)??(recent?text(recent,"id"):null);
    if(!id) throw new ConversationError("expired");
    const request=await this.request(actorId,id);
    const at=nowIso();
    await atomicBatch(this.db,[
      this.db.prepare(`UPDATE med250_client_requests SET status='cancelled',closed_at=?,updated_at=? WHERE id=? AND actor_id=?`).bind(at,at,id,actorId),
      this.db.prepare(`UPDATE med250_dispatch_outbox SET status='failed',failed_at=?,last_error_code='request_cancelled',updated_at=?
        WHERE request_id=? AND status IN ('pending','claimed','enqueued','retry')`).bind(at,at,id),
    ]);
    await this.queue(text(request,"customer_e164"),"cancelled",`cancel:${eventId}`,id);
    await this.complete(eventId,"client_cancelled",id);
  }

  async service(event:InboundReceipt,e164:string,action:string):Promise<void> {
    const at=nowIso();
    if(action === "cancel") {await this.cancel(event.actorId,event.eventId);return;}
    if(action === "stop" || action === "start") {
      const stop=action === "stop";
      const statements=[
        this.db.prepare(`UPDATE med250_actors SET whatsapp_opted_out_at=?,updated_at=? WHERE id=?`).bind(stop?at:null,at,event.actorId),
        this.db.prepare(`INSERT OR IGNORE INTO med250_whatsapp_permissions(id,actor_id,event_id,purpose,notice_version,granted,created_at)
          VALUES (?,?,?,?,?,?,?)`).bind(newId(),event.actorId,event.eventId,stop?"opt_out":event.actorType==="pharmacy"?"pharmacy_notifications":"client_notifications",WHATSAPP_NOTICE_VERSION,1,at),
      ];
      if(event.actorType === "pharmacy" && event.pharmacyId) statements.push(this.db.prepare(`UPDATE med250_pharmacy_contacts SET messaging_opt_in_at=?,messaging_opt_in_source=?
        WHERE pharmacy_id=? AND e164=? AND channel='whatsapp' AND active=1 AND verified_at IS NOT NULL`).bind(stop?null:at,stop?null:"signed_whatsapp_start",event.pharmacyId,e164));
      if(stop) statements.push(
        this.db.prepare(`UPDATE med250_partner_initial_permissions SET revoked_at=coalesce(revoked_at,?) WHERE e164=?`).bind(at,e164),
        this.db.prepare(`UPDATE med250_dispatch_outbox SET status='failed',last_error_code='recipient_opted_out',failed_at=?,updated_at=?
          WHERE recipient_e164=? AND status IN ('pending','claimed','enqueued','retry')`).bind(at,at,e164));
      await atomicBatch(this.db,statements);
      await this.queue(e164,stop?"stopped":"resumed",`preference:${event.eventId}`);
    } else if(action === "forget") {
      await runStatement(this.db,`UPDATE med250_client_locations SET is_current=0,updated_at=? WHERE actor_id=?`,[at,event.actorId]);
      await this.queue(e164,"forgotten",`forgotten:${event.eventId}`);
    } else if(action === "share") {
      await this.queue(e164,"share_invite",`share-invite:${event.eventId}`);
      await this.queue(e164,"share_contact",`share-contact:${event.eventId}`);
    } else {
      const key=action === "privacy"?"privacy":action === "help"?"help":event.actorType === "pharmacy"?"pharmacy_welcome":"send_image";
      await this.queue(e164,key,`service:${event.eventId}`);
    }
    await this.complete(event.eventId,`service_${action}`);
  }

  async expireDrafts():Promise<void> {
    const at=nowIso();
    const requests=await allRows(this.db,`SELECT id,customer_e164 FROM med250_client_requests WHERE source='whatsapp_image'
      AND status IN ('processing_media','awaiting_location','awaiting_location_choice','ready') AND expires_at<=? LIMIT 100`,[at]);
    for(const request of requests) {
      await runStatement(this.db,`UPDATE med250_client_requests SET status='expired',closed_at=?,updated_at=? WHERE id=? AND expires_at<=?`,[at,at,request.id,at]);
      await this.queue(text(request,"customer_e164"),"expired",`expired:${request.id}`,text(request,"id"));
    }
  }
}
