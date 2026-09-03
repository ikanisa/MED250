import assert from 'node:assert/strict';
import test from 'node:test';
import {memoryD1} from './helpers/d1-memory.mjs';
import {enqueuePartnerLocationOutreach,partnerLocationEligibility,capturePartnerLocation,PARTNER_LOCATION_REGISTRY_KEY} from '../worker/backend/partner-location-outreach.ts';
import {WhatsAppRepository} from '../worker/backend/whatsapp-repository.ts';
import {WhatsAppConversation} from '../worker/backend/whatsapp-conversation.ts';
import {BUSINESS_CONTENT} from '../worker/backend/whatsapp-content.ts';
import {verifyBusinessDefinition} from '../worker/backend/twilio-content-runtime.ts';
import {buildLocationPlan,locationPermissionSql} from '../scripts/partner-location-permission-plan.mjs';

const phone='250788123456', at=()=>new Date().toISOString();
function fixture(t,{approved=true}={}) {
  const f=memoryD1();t.after(f.close);
  f.run(`INSERT INTO med250_pharmacies(id,name,licence_status,licence_expires_on,created_at,updated_at)
    VALUES ('partner-1','Synthetic Partner','current','2099-01-01',?,?)`,at(),at());
  f.run(`INSERT INTO med250_pharmacy_contacts(id,pharmacy_id,channel,e164,verified_at,source,dispatch_enabled,created_at,updated_at)
    VALUES ('contact-1','partner-1','whatsapp',?,?,'synthetic',1,?,?)`,phone,at(),at(),at());
  f.run(`INSERT INTO med250_known_pharmacy_numbers(e164,resolution_status,pharmacy_id,source,source_evidence,created_at,updated_at)
    VALUES (?,'resolved','partner-1','synthetic','{}',?,?)`,phone,at(),at());
  f.run(`INSERT INTO med250_partner_location_permissions
    (id,campaign_id,contact_id,pharmacy_id,e164,source,owner_statement,evidence_reference,recorded_at,expires_at)
    VALUES ('permission-1','test','contact-1','partner-1',?,'owner_attested_in_person','Synthetic permission','local-test',?,?)`,
    phone,new Date(Date.now()-60_000).toISOString(),new Date(Date.now()+86400_000).toISOString());
  f.run(`INSERT INTO med250_twilio_content_registry(definition_key,content_sid,state,approval_status,updated_at)
    VALUES (?,?,'ready',?,?)`,PARTNER_LOCATION_REGISTRY_KEY,'HX'+'a'.repeat(32),approved?'approved':'pending',at());
  return {...f,repo:new WhatsAppRepository(f.db),conversation:new WhatsAppConversation(f.db)};
}
async function inbound(f,sequence=1) {
  return f.repo.beginInbound({accountSid:'AC'+'b'.repeat(32),messageSid:'SM'+sequence.toString(16).padStart(32,'0'),fromE164:phone,
    profileName:null,mediaCount:0,locationProvided:true,buttonPayload:null});
}
async function enqueue(f) {
  await enqueuePartnerLocationOutreach(f.db);
  return f.one("SELECT * FROM med250_dispatch_outbox WHERE dedupe_key='partner-location:permission-1'");
}
test('approved invitation queues once without GPS, orders, login or recurring opt-in',async t=>{
  const f=fixture(t);
  await Promise.all([enqueuePartnerLocationOutreach(f.db),enqueuePartnerLocationOutreach(f.db)]);
  assert.equal(await enqueuePartnerLocationOutreach(f.db),0);
  assert.equal(f.one('SELECT count(*) n FROM med250_dispatch_outbox').n,1);
  const o=f.one('SELECT * FROM med250_dispatch_outbox');
  assert.equal(o.request_id,null);assert.equal(o.max_provider_attempts,1);
  assert.equal(f.one('SELECT outbox_id FROM med250_partner_location_permissions').outbox_id,o.id);
  assert.equal(f.one('SELECT messaging_opt_in_at FROM med250_pharmacy_contacts').messaging_opt_in_at,null);
  assert.equal(f.one('SELECT count(*) n FROM med250_whatsapp_permissions').n,0);
  assert.equal(f.one('SELECT count(*) n FROM med250_actors').n,0);
  assert.equal(f.one('SELECT count(*) n FROM med250_client_requests').n,0);
});
test('unapproved content and ungranted contacts cannot queue',async t=>{
  const f=fixture(t,{approved:false});assert.equal(await enqueuePartnerLocationOutreach(f.db),0);
  f.run("UPDATE med250_twilio_content_registry SET approval_status='approved'");
  f.run('DELETE FROM med250_partner_location_permissions');
  assert.equal(await enqueuePartnerLocationOutreach(f.db),0);
});
test('one-time permission allows only its exact outbox outside the session window',async t=>{
  const f=fixture(t),o=await enqueue(f);
  f.run("UPDATE med250_dispatch_outbox SET status='enqueued' WHERE id=?",o.id);
  assert.equal(await partnerLocationEligibility(f.db,o.id),true);
  f.run("UPDATE med250_dispatch_outbox SET payload=json_object('guidance','partner_location_outreach','permission_id','forged') WHERE id=?",o.id);
  assert.equal(await partnerLocationEligibility(f.db,o.id),false);
  assert.equal(f.one('SELECT last_error_code FROM med250_dispatch_outbox').last_error_code,'partner_location_permission_unavailable');
});
test('ordinary service messages cannot use the new session exception',async t=>{
  const f=fixture(t);await f.conversation.queue(phone,'help','test');
  const o=f.one('SELECT id FROM med250_dispatch_outbox');f.run("UPDATE med250_dispatch_outbox SET status='enqueued'");
  assert.equal(await partnerLocationEligibility(f.db,o.id),null);
  assert.equal(await f.repo.checkOutboundEligibility(o.id),false);
});
for(const reason of ['remapped','inactive','known_ambiguous','gps_resolved','expired']) test(`${reason} blocks an already queued invitation`,async t=>{
  const f=fixture(t),o=await enqueue(f);f.run("UPDATE med250_dispatch_outbox SET status='enqueued'");
  if(reason==='remapped') f.run("UPDATE med250_pharmacy_contacts SET e164='250788123457'");
  if(reason==='inactive') f.run('UPDATE med250_pharmacy_contacts SET dispatch_enabled=0,active=0');
  if(reason==='known_ambiguous') f.run("UPDATE med250_known_pharmacy_numbers SET resolution_status='ambiguous',pharmacy_id=NULL");
  if(reason==='gps_resolved') f.run("UPDATE med250_pharmacies SET geocode_status='verified'");
  if(reason==='expired') f.run("UPDATE med250_pharmacies SET licence_expires_on='2020-01-01'");
  assert.equal(await partnerLocationEligibility(f.db,o.id),false);
});
test('STOP permanently revokes location permission; START cannot restore or resend it',async t=>{
  const f=fixture(t),o=await enqueue(f);
  await f.conversation.service(await inbound(f),phone,'stop');
  assert.ok(f.one('SELECT revoked_at FROM med250_partner_location_permissions').revoked_at);
  await f.conversation.service(await inbound(f,2),phone,'start');
  f.run("UPDATE med250_dispatch_outbox SET status='enqueued' WHERE id=?",o.id);
  assert.equal(await partnerLocationEligibility(f.db,o.id),false);
  assert.equal(await enqueuePartnerLocationOutreach(f.db),0);
  assert.throws(()=>f.run('UPDATE med250_partner_location_permissions SET revoked_at=NULL'),/immutable/);
});
test('native partner reply is recorded once as review evidence, not GPS promotion or opt-in',async t=>{
  const f=fixture(t),o=await enqueue(f);
  f.run("UPDATE med250_dispatch_outbox SET status='sent',send_started_at=? WHERE id=?",at(),o.id);
  const event=await inbound(f),location={e164:phone,latitude:-1.95,longitude:30.06,address:'Synthetic address',label:'Business'};
  assert.equal(await capturePartnerLocation(f.db,event,location),true);
  assert.equal(await capturePartnerLocation(f.db,event,location),true);
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_location_submissions').n,1);
  assert.equal(f.one("SELECT count(*) n FROM med250_dispatch_outbox WHERE dedupe_key LIKE 'partner-location-reply:%'").n,1);
  assert.equal(f.one('SELECT review_status FROM med250_partner_location_submissions').review_status,'pending');
  assert.equal(f.one('SELECT latitude FROM med250_pharmacies').latitude,null);
  assert.equal(f.one('SELECT messaging_opt_in_at FROM med250_pharmacy_contacts').messaging_opt_in_at,null);
  assert.throws(()=>f.run('UPDATE med250_partner_location_submissions SET latitude=-2'),/immutable/);
});
test('unsent invitation, wrong actor, wrong phone and outside-Rwanda points do not become business GPS',async t=>{
  const f=fixture(t),o=await enqueue(f),event=await inbound(f);
  const location={e164:phone,latitude:-1.95,longitude:30.06,address:null,label:null};
  assert.equal(await capturePartnerLocation(f.db,event,location),false);
  f.run("UPDATE med250_dispatch_outbox SET status='sent',send_started_at=? WHERE id=?",at(),o.id);
  const afterSend=await inbound(f,2);
  assert.equal(await capturePartnerLocation(f.db,{...event,actorType:'client'},location),false);
  assert.equal(await capturePartnerLocation(f.db,event,{...location,e164:'250788111111'}),false);
  assert.equal(await capturePartnerLocation(f.db,afterSend,{...location,latitude:0}),true);
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_location_submissions').n,0);
});

test('pre-send native location cannot satisfy a later invitation',async t=>{
  const f=fixture(t),o=await enqueue(f),event=await inbound(f);
  f.run("UPDATE med250_inbound_events SET received_at=? WHERE id=?",new Date(Date.now()-30_000).toISOString(),event.eventId);
  f.run("UPDATE med250_dispatch_outbox SET status='sent',send_started_at=? WHERE id=?",at(),o.id);
  assert.equal(await capturePartnerLocation(f.db,event,{e164:phone,latitude:-1.95,longitude:30.06,address:null,label:null}),false);
});

for(const changed of [false,true]) test(`exact permission import preserves recipient consent and ${changed?'rejects a changed roster':'is repeat-safe'}`,t=>{
  const f=memoryD1();t.after(f.close);
  const contacts=[1,2].map(n=>({id:'whatsapp-'+String(n).repeat(32),pharmacy_id:`p-${n}`,e164:`25078812345${n}`,verified_at:at(),source:'synthetic',name:`Synthetic ${n}`,resolution_status:'resolved'}));
  f.run(`INSERT INTO med250_partner_permission_attestations(id,source,statement,evidence_reference,recorded_at,scope_sha256,contact_count)
    VALUES ('old','owner_confirmation','Synthetic prior permission','test',?,?,2)`,at(),'a'.repeat(64));
  for(const c of contacts) {
    f.run(`INSERT INTO med250_pharmacies(id,name,licence_status,licence_expires_on,created_at,updated_at) VALUES (?,?,'current','2099-01-01',?,?)`,c.pharmacy_id,c.name,at(),at());
    f.run(`INSERT INTO med250_pharmacy_contacts(id,pharmacy_id,channel,e164,verified_at,source,dispatch_enabled,created_at,updated_at)
      VALUES (?,?,'whatsapp',?,?,'synthetic',1,?,?)`,c.id,c.pharmacy_id,c.e164,c.verified_at,at(),at());
    f.run(`INSERT INTO med250_known_pharmacy_numbers(e164,resolution_status,pharmacy_id,source,source_evidence,created_at,updated_at)
      VALUES (?,'resolved',?,'synthetic','{}',?,?)`,c.e164,c.pharmacy_id,at(),at());
    f.run(`INSERT INTO med250_partner_initial_permissions(contact_id,attestation_id,pharmacy_id,e164,recorded_at) VALUES (?,'old',?,?,?)`,c.id,c.pharmacy_id,c.e164,at());
  }
  const snapshot={database:'med250-production',observed_at:at(),contacts};
  const plan=buildLocationPlan(snapshot,[],new Date(Date.now()-1000).toISOString());
  assert.equal(buildLocationPlan(snapshot,[contacts[0].id]).contact_count,1);
  assert.throws(()=>locationPermissionSql({...plan,contact_count:9}),/Invalid reviewed plan/);
  if(changed) f.run('UPDATE med250_pharmacy_contacts SET active=0,dispatch_enabled=0 WHERE id=?',contacts[0].id);
  f.sqlite.exec(locationPermissionSql(plan));f.sqlite.exec(locationPermissionSql(plan));
  assert.equal(f.one('SELECT count(*) n FROM med250_partner_location_permissions').n,changed?0:2);
  assert.equal(f.one('SELECT count(*) n FROM med250_dispatch_outbox').n,0);
  assert.equal(f.one('SELECT count(*) n FROM med250_pharmacy_contacts WHERE messaging_opt_in_at IS NOT NULL').n,0);
});
test('exact two-line quick replies opt into future alerts and provide STOP',async()=>{
  const definition=BUSINESS_CONTENT.location_initial.content,card=definition.types['twilio/quick-reply'];
  assert.equal(card.body.split('\n').length,2);
  assert.match(card.body,/future customer request alerts/);
  assert.deepEqual(card.actions.map(a=>a.id),['med250:service:start','med250:service:stop']);
  const runtime={accountSid:'AC'+'b'.repeat(32),authToken:'synthetic'};
  await verifyBusinessDefinition(runtime,'HX'+'a'.repeat(32),'location_initial',async()=>Response.json(definition));
  await assert.rejects(()=>verifyBusinessDefinition(runtime,'HX'+'a'.repeat(32),'location_initial',async()=>Response.json({...definition,types:{}})),/differs/);
});
