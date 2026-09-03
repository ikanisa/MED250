import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { memoryD1 } from './helpers/d1-memory.mjs';
import { WhatsAppRepository } from '../worker/backend/whatsapp-repository.ts';
import { WhatsAppConversation } from '../worker/backend/whatsapp-conversation.ts';
import { dispatchToNearestPharmacies } from '../worker/backend/dispatch-repository.ts';
import { BUSINESS_CONTENT, businessContentKey } from '../worker/backend/whatsapp-content.ts';
import { verifyPharmacyContent } from '../worker/backend/twilio-content-runtime.ts';
import { sha256Hex } from '../worker/backend/secure-token.ts';
import { buildAttestationPlan, attestationSql, rosterSql } from '../scripts/record-partner-initial-permission.mjs';
import { OperationalHealthRepository } from '../worker/backend/operational-health.ts';

let sequence=0;
const sid=()=>`MM${(++sequence).toString(16).padStart(32,'0')}`;
const now=()=>new Date().toISOString();
const permissionAt='2026-01-01T00:00:00.000Z'; // Synthetic fixture, never production evidence.
function fixture(t) {
  const f=memoryD1();t.after(f.close);
  f.run(`INSERT INTO med250_partner_permission_attestations VALUES ('test-attestation','owner_confirmation','Synthetic fixture','local-test',?,?,?)`,permissionAt,'a'.repeat(64),12);
  for(const key of ['image_initial','web_initial']) f.run(`INSERT INTO med250_twilio_content_registry
    (definition_key,content_sid,state,approval_status,updated_at) VALUES (?,?,'ready','approved',?)`,
    `business:${BUSINESS_CONTENT[key].content.friendly_name}`,`HX${'1'.repeat(32)}`,now());
  return {...f,repo:new WhatsAppRepository(f.db),conversation:new WhatsAppConversation(f.db)};
}
function partner(f,n,attest=true) {
  const id=`pharmacy-${String(n).padStart(2,'0')}`,contact=`contact-${n}`,e164=`250788${String(n).padStart(6,'0')}`,at=now();
  f.run(`INSERT INTO med250_pharmacies(id,name,latitude,longitude,licence_status,licence_expires_on,marketplace_approved,dispatch_enabled,geocode_status,created_at,updated_at)
    VALUES (?,?,?,30.06,'current','2099-01-01',1,1,'verified',?,?)`,id,`Synthetic ${n}`,-1.95+n*0.001,at,at);
  f.run(`INSERT INTO med250_pharmacy_contacts(id,pharmacy_id,channel,e164,verified_at,source,login_enabled,dispatch_enabled,active,created_at,updated_at)
    VALUES (?,?,'whatsapp',?,?,'synthetic',1,1,1,?,?)`,contact,id,e164,at,at,at);
  if(attest) f.run(`INSERT INTO med250_partner_initial_permissions(contact_id,attestation_id,pharmacy_id,e164,recorded_at)
    VALUES (?,'test-attestation',?,?,?)`,contact,id,e164,permissionAt);
  return {id,contact,e164};
}
async function inbound(f,e164='250788900001',mediaCount=0) {
  return f.repo.beginInbound({accountSid:`AC${'1'.repeat(32)}`,messageSid:sid(),fromE164:e164,profileName:null,mediaCount,locationProvided:false,buttonPayload:null});
}
async function readyImage(f,e164='250788900001',count=1) {
  let receipt;
  for(let n=0;n<count;n++) {
    const event=await inbound(f,e164,1);
    receipt=await f.conversation.beginImage(event.eventId,'image/jpeg');
    await f.conversation.finishImage({eventId:event.eventId,requestId:receipt.requestId,mediaId:receipt.mediaId,
      r2Key:`synthetic/${receipt.mediaId}.jpg`,byteSize:123,sha256:'a'.repeat(64),succeeded:true,errorCode:null});
  }
  await f.conversation.ready(receipt.actorId,receipt.requestId,(await inbound(f,e164)).eventId);
  const event=await inbound(f,e164);
  await f.conversation.location({actorId:receipt.actorId,requestId:receipt.requestId,latitude:-1.95,longitude:30.06,
    accuracyM:null,address:null,label:null,source:'whatsapp_native',captureKeyHex:await sha256Hex(event.eventId),eventId:event.eventId});
  return {...receipt,e164};
}
async function send(f,r) {await f.conversation.send(r.actorId,r.requestId,(await inbound(f,r.e164)).eventId,false);}

test('first request uses nearest ten attested partners and all images; no recipient opt-in is fabricated',async t=>{
  const f=fixture(t);for(let n=1;n<=12;n++)partner(f,n);
  const r=await readyImage(f,undefined,2);await send(f,r);
  assert.deepEqual(f.all('SELECT pharmacy_id FROM med250_request_recipients ORDER BY distance_m').map(r=>r.pharmacy_id),
    Array.from({length:10},(_,i)=>`pharmacy-${String(i+1).padStart(2,'0')}`));
  const outboxes=f.all("SELECT * FROM med250_dispatch_outbox WHERE kind='client_media_request'");
  assert.equal(outboxes.length,20);
  for(const o of outboxes) {
    assert.equal(JSON.parse(o.payload).permission_basis,'owner_attested_initial');
    assert.equal(JSON.parse(o.payload).image_count,2);
    f.run("UPDATE med250_dispatch_outbox SET status='enqueued' WHERE id=?",o.id);
    assert.equal(await f.repo.checkOutboundEligibility(o.id),true);
  }
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_initial_permissions WHERE claimed_request_id=?',r.requestId).n,10);
  assert.equal(f.one('SELECT count(*) n FROM med250_pharmacy_contacts WHERE messaging_opt_in_at IS NOT NULL').n,0);
  assert.equal(f.one("SELECT count(*) n FROM med250_whatsapp_permissions WHERE purpose='pharmacy_notifications'").n,0);
  const audit=JSON.parse(f.one("SELECT details FROM med250_audit_events WHERE request_id=? AND json_extract(details,'$.algorithm') IS NOT NULL",r.requestId).details);
  assert.equal(audit.recipient_count,10);
  assert.ok(audit.selected_candidate_snapshot.every(r=>r.permission_basis==='owner_attested_initial'&&!r.verified_messaging_opt_in));
});

test('Available and Not Available do not grant future alerts; explicit START enables normal later dispatch',async t=>{
  const f=fixture(t),p=partner(f,1),r=await readyImage(f);await send(f,r);
  for(const responseStatus of ['can_fulfil','cannot_fulfil']) {
    const event=await inbound(f,p.e164);
    await f.repo.recordPharmacyResponse({eventId:event.eventId,actorId:event.actorId,requestId:r.requestId,pharmacyId:p.id,responseStatus,messageSid:sid()});
    assert.equal(f.one('SELECT messaging_opt_in_at FROM med250_pharmacy_contacts').messaging_opt_in_at,null);
  }
  const second=await readyImage(f);await send(f,second);
  assert.equal(f.one('SELECT count(*) n FROM med250_request_recipients WHERE request_id=?',second.requestId).n,0);
  await f.conversation.service(await inbound(f,p.e164),p.e164,'start');
  const third=await readyImage(f);await send(f,third);
  const payload=JSON.parse(f.one("SELECT payload FROM med250_dispatch_outbox WHERE kind='client_media_request' AND request_id=?",third.requestId).payload);
  assert.equal(payload.permission_basis,'recipient_opt_in');
  assert.equal(businessContentKey('client_media_request',payload),'image');
  assert.equal(f.one('SELECT claimed_request_id FROM med250_partner_initial_permissions').claimed_request_id,r.requestId);
});

test('two concurrent requests cannot reuse an initial permission; losing request reselects remaining partners',async t=>{
  const f=fixture(t);for(let n=1;n<=12;n++)partner(f,n);
  const a=await readyImage(f,'250788900001'),b=await readyImage(f,'250788900002');
  await Promise.all([send(f,a),send(f,b)]);
  const counts=f.all('SELECT request_id,count(*) n FROM med250_request_recipients GROUP BY request_id').map(r=>r.n).sort((a,b)=>a-b);
  assert.deepEqual(counts,[2,10]);
  assert.equal(f.one('SELECT count(DISTINCT recipient_e164) n FROM med250_request_recipients').n,12);
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_initial_permissions WHERE claimed_request_id IS NOT NULL').n,12);
});

test('STOP revokes claimed and unused initial permission; START never restores the one-time grant',async t=>{
  const f=fixture(t),p=partner(f,1),unused=partner(f,2);
  await f.conversation.service(await inbound(f,unused.e164),unused.e164,'stop');
  const r=await readyImage(f);await send(f,r);
  for(const item of [p,unused]) await f.conversation.service(await inbound(f,item.e164),item.e164,'stop');
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_initial_permissions WHERE revoked_at IS NOT NULL').n,2);
  assert.equal(f.one("SELECT count(*) n FROM med250_dispatch_outbox WHERE kind='client_media_request' AND status<>'failed'").n,0);
  await f.conversation.service(await inbound(f,p.e164),p.e164,'start');
  assert.ok(f.one('SELECT revoked_at FROM med250_partner_initial_permissions WHERE contact_id=?',p.contact).revoked_at);
  assert.throws(()=>f.run('UPDATE med250_partner_initial_permissions SET revoked_at=NULL WHERE contact_id=?',p.contact),/immutable/);
});

test('owner attestation import is exact-scoped and repeat-safe without fabricating recipient consent',t=>{
  const f=fixture(t);partner(f,1,false);partner(f,2,false);
  const contacts=f.all(rosterSql),plan=buildAttestationPlan(contacts);
  f.sqlite.exec(attestationSql(plan));
  f.sqlite.exec(attestationSql(plan));
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_initial_permissions').n,2);
  assert.equal(f.one('SELECT count(*) n FROM med250_whatsapp_permissions').n,0);
  assert.equal(f.one('SELECT count(*) n FROM med250_pharmacy_contacts WHERE messaging_opt_in_at IS NOT NULL').n,0);
  partner(f,3,false);
  f.sqlite.exec(attestationSql(plan));
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_initial_permissions').n,2);
  const tampered=structuredClone(plan);tampered.contacts[0].e164='250788999999';
  assert.throws(()=>attestationSql(tampered),/Invalid reviewed/);
  assert.throws(()=>attestationSql({...plan,recorded_at:'2020-01-01T00:00:00.000Z'}),/Invalid reviewed/);
});

test('owner attestation import rechecks opt-out and contact changes immediately before each grant',async t=>{
  const f=fixture(t),a=partner(f,1,false),b=partner(f,2,false);
  const plan=buildAttestationPlan(f.all(rosterSql));
  await f.conversation.service(await inbound(f,a.e164),a.e164,'stop');
  f.run("UPDATE med250_pharmacy_contacts SET e164='250788999999' WHERE id=?",b.contact);
  f.sqlite.exec(attestationSql(plan));
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_initial_permissions').n,0);
});

test('no attestation, unapproved intro, stale requests and revoked or reassigned contacts stay excluded',async t=>{
  for(const condition of ['no-attestation','pending','old-request','revoked','reassigned','licence']) {
    const f=fixture(t),p=partner(f,1,condition!=='no-attestation'),r=await readyImage(f);
    if(condition==='pending') f.run("UPDATE med250_twilio_content_registry SET approval_status='pending'");
    if(condition==='old-request') f.run("UPDATE med250_client_requests SET created_at='2025-01-01T00:00:00.000Z' WHERE id=?",r.requestId);
    if(condition==='revoked') f.run('UPDATE med250_partner_initial_permissions SET revoked_at=?',now());
    if(condition==='reassigned') f.run("UPDATE med250_pharmacy_contacts SET e164='250788999999' WHERE id=?",p.contact);
    if(condition==='licence') f.run("UPDATE med250_pharmacies SET licence_expires_on='2020-01-01'");
    await send(f,r);
    assert.equal(f.one('SELECT count(*) n FROM med250_request_recipients').n,0,condition);
    assert.equal(f.one('SELECT count(*) n FROM med250_partner_initial_permissions WHERE claimed_request_id IS NOT NULL').n,0,condition);
  }
});

test('send-time checks reject forged grant references, reassigned contact and newly expired licence',async t=>{
  for(const condition of ['grant','contact','licence','request','revoked']) {
    const f=fixture(t),p=partner(f,1),r=await readyImage(f);await send(f,r);
    const o=f.one("SELECT id FROM med250_dispatch_outbox WHERE kind='client_media_request'");
    f.run("UPDATE med250_dispatch_outbox SET status='enqueued' WHERE id=?",o.id);
    if(condition==='grant') f.run("UPDATE med250_dispatch_outbox SET payload=json_set(payload,'$.permission_attestation_id','forged') WHERE id=?",o.id);
    if(condition==='contact') f.run("UPDATE med250_pharmacy_contacts SET e164='250788999999' WHERE id=?",p.contact);
    if(condition==='licence') f.run("UPDATE med250_pharmacies SET licence_expires_on='2020-01-01'");
    if(condition==='request') f.run("UPDATE med250_client_requests SET status='cancelled' WHERE id=?",r.requestId);
    if(condition==='revoked') f.run('UPDATE med250_partner_initial_permissions SET revoked_at=?',now());
    assert.equal(await f.repo.checkOutboundEligibility(o.id),false,condition);
  }
});

test('web dispatch uses the same one-time permission and distinct initial web template',async t=>{
  const f=fixture(t);partner(f,1);const event=await inbound(f),id=crypto.randomUUID(),at=now();
  f.run(`INSERT INTO med250_web_principals(id,subject_type,actor_id,verified_at,created_at,updated_at,last_seen_at)
    VALUES ('synthetic-web','client',?,?,?,?,?)`,event.actorId,at,at,at,at);
  f.run(`INSERT INTO med250_client_requests(id,reference,actor_id,customer_e164,source,status,dispatch_limit,expires_at,created_at,updated_at,web_principal_id,client_request_id,idempotency_hash)
    VALUES (?,'SYNTHETIC-WEB',?,'250788900001','web_catalogue','ready',10,?,?,?,'synthetic-web','synthetic-request',?)`,id,event.actorId,new Date(Date.now()+3600_000).toISOString(),at,at,'b'.repeat(64));
  assert.equal(await dispatchToNearestPharmacies(f.db,{requestId:id,actorId:event.actorId,latitude:-1.95,longitude:30.06,kind:'web_catalogue_order',
    dedupePrefix:'web',primaryMediaId:null,basePayload:{item_summary:'synthetic'},emptyOutcome:'error',auditEvent:'synthetic_dispatch'}),1);
  const payload=JSON.parse(f.one("SELECT payload FROM med250_dispatch_outbox WHERE kind='web_catalogue_order'").payload);
  assert.equal(businessContentKey('web_catalogue_order',payload),'web_initial');
});

test('initial cards retain request details and enforce the explicit third opt-in action',async()=>{
  const runtime={accountSid:`AC${'1'.repeat(32)}`,authToken:'synthetic'};
  for(const key of ['image_initial','web_initial']) {
    const spec=BUSINESS_CONTENT[key].content,card=spec.types['twilio/card'];
    assert.equal(card.title.split('\n').length,2);
    assert.deepEqual(card.actions.map(a=>a.title),['Available','Not Available','Enable alerts']);
    assert.equal(card.actions[2].id,'med250:service:start');
    assert.match(card.title,/Reply STOP to stop/);
    const kind=key==='image_initial'?'client_media_request':'web_catalogue_order';
    await verifyPharmacyContent(runtime,`HX${'2'.repeat(32)}`,kind,spec.variables,async()=>Response.json(spec),true);
    const bad=structuredClone(spec);bad.types['twilio/card'].actions.pop();
    await assert.rejects(verifyPharmacyContent(runtime,`HX${'2'.repeat(32)}`,kind,spec.variables,async()=>Response.json(bad),true),/contract/);
    await assert.rejects(verifyPharmacyContent(runtime,`HX${'2'.repeat(32)}`,kind,spec.variables,async()=>Response.json(spec)),/contract/);
  }
});

test('health separates owner-attested initial capacity from recurring opt-ins and respects both template gates',async t=>{
  const f=fixture(t);partner(f,1);
  f.run('CREATE TABLE d1_migrations(name TEXT)');
  for(const name of readdirSync(new URL('../db/d1/migrations/',import.meta.url)).filter(n=>n.endsWith('.sql'))) f.run('INSERT INTO d1_migrations VALUES (?)',name);
  const health=new OperationalHealthRepository(f.db);
  let snapshot=await health.snapshot();
  assert.equal(snapshot.pharmacies.dispatch_ready,1);
  assert.equal(snapshot.partner_permissions.recurring_opted_in_contacts,0);
  assert.equal(snapshot.partner_permissions.unused,1);
  f.run("UPDATE med250_twilio_content_registry SET approval_status='pending' WHERE definition_key=?",`business:${BUSINESS_CONTENT.image_initial.content.friendly_name}`);
  snapshot=await health.snapshot();
  assert.equal(snapshot.pharmacies.dispatch_ready,0);
});
