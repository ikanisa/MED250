import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryD1 } from './helpers/d1-memory.mjs';
import { WhatsAppRepository } from '../worker/backend/whatsapp-repository.ts';
import { WhatsAppConversation } from '../worker/backend/whatsapp-conversation.ts';
import { privateMediaResponse } from '../worker/backend/private-media-response.ts';
import { sha256Hex } from '../worker/backend/secure-token.ts';
import { ensureServiceContent,ensureBusinessContent,readApproval,verifyPharmacyContent } from '../worker/backend/twilio-content-runtime.ts';
import { BUSINESS_CONTENT,SERVICE_CONTENT,serviceDefinition } from '../worker/backend/whatsapp-content.ts';

let sequence=0;
const sid=()=>`MM${(++sequence).toString(16).padStart(32,'0')}`;
const now=()=>new Date().toISOString();
const phone='250788900001';
function fixture(t) {const f=memoryD1();t.after(f.close);return {...f,repo:new WhatsAppRepository(f.db),conversation:new WhatsAppConversation(f.db)};}
async function inbound(f,e164=phone,mediaCount=0,messageSid=sid()) {
  return f.repo.beginInbound({accountSid:`AC${'1'.repeat(32)}`,messageSid,fromE164:e164,profileName:null,mediaCount,locationProvided:false,buttonPayload:null});
}
async function photo(f,e164=phone) {
  const event=await inbound(f,e164,1);
  const receipt=await f.conversation.beginImage(event.eventId,'image/jpeg');
  await f.conversation.finishImage({eventId:event.eventId,requestId:receipt.requestId,mediaId:receipt.mediaId,
    r2Key:`requests/${receipt.mediaId}.jpg`,byteSize:123,sha256:'a'.repeat(64),succeeded:true,errorCode:null});
  return {...receipt,event};
}
function pharmacy(f,n,optIn=true) {
  const id=`pharmacy-${String(n).padStart(2,'0')}`,e164=`250788${String(n).padStart(6,'0')}`,at=now();
  f.run(`INSERT INTO med250_pharmacies(id,name,latitude,longitude,licence_status,licence_expires_on,marketplace_approved,dispatch_enabled,geocode_status,created_at,updated_at)
    VALUES (?,?,?,30.06,'current','2099-01-01',1,1,'verified',?,?)`,id,`Test pharmacy ${n}`,-1.95+n*0.001,at,at);
  f.run(`INSERT INTO med250_pharmacy_contacts(id,pharmacy_id,channel,e164,verified_at,source,login_enabled,dispatch_enabled,active,created_at,updated_at,messaging_opt_in_at,messaging_opt_in_source)
    VALUES (?,?,'whatsapp',?,?,'synthetic_fixture',1,1,1,?,?,?,?)`,crypto.randomUUID(),id,e164,at,at,at,optIn?at:null,optIn?'synthetic_fixture':null);
  return {id,e164};
}
async function readyWithLocation(f,receipt) {
  const ready=await inbound(f);
  await f.conversation.ready(receipt.actorId,receipt.requestId,ready.eventId);
  const location=await inbound(f);
  await f.conversation.location({actorId:receipt.actorId,requestId:receipt.requestId,latitude:-1.95,longitude:30.06,accuracyM:null,address:null,label:null,
    source:'whatsapp_native',captureKeyHex:await sha256Hex(location.eventId),eventId:location.eventId});
}

test('registered pharmacies are classified separately; every unknown number is a client',async t=>{
  const f=fixture(t),p=pharmacy(f,1,false);
  assert.equal((await inbound(f,p.e164)).actorType,'pharmacy');
  assert.equal((await inbound(f)).actorType,'client');
  assert.equal(f.one('SELECT messaging_opt_in_at FROM med250_pharmacy_contacts').messaging_opt_in_at,null);
});

test('multiple photos and simultaneous duplicate receipts remain one draft, sealed before location',async t=>{
  const f=fixture(t);
  const event=await inbound(f,phone,1);
  const receipts=await Promise.all([f.conversation.beginImage(event.eventId,'image/jpeg'),f.conversation.beginImage(event.eventId,'image/jpeg')]);
  assert.equal(receipts[0].mediaId,receipts[1].mediaId);
  await f.conversation.finishImage({eventId:event.eventId,requestId:receipts[0].requestId,mediaId:receipts[0].mediaId,r2Key:'first.jpg',byteSize:123,sha256:'a'.repeat(64),succeeded:true,errorCode:null});
  const second=await photo(f);
  assert.equal(second.requestId,receipts[0].requestId);
  assert.equal(f.one('SELECT count(*) n FROM med250_client_requests').n,1);
  assert.equal(f.one('SELECT media_count FROM med250_client_requests').media_count,2);
  await readyWithLocation(f,second);
  assert.equal(f.one('SELECT count(*) n FROM med250_request_recipients').n,0);
  assert.equal(f.one('SELECT sum(is_current) n FROM med250_client_locations').n,0);
  const late=await inbound(f,phone,1);
  await assert.rejects(f.conversation.beginImage(late.eventId,'image/jpeg'),/request_locked/);
});

test('explicit consent dispatches the full two-photo bundle to the nearest ten opted-in pharmacies exactly once',async t=>{
  const f=fixture(t);
  for(let n=1;n<=12;n++)pharmacy(f,n);
  const receipt=await photo(f);await photo(f);await readyWithLocation(f,receipt);
  const event=await inbound(f);
  await Promise.all([f.conversation.send(receipt.actorId,receipt.requestId,event.eventId,true),f.conversation.send(receipt.actorId,receipt.requestId,event.eventId,true)]);
  const recipients=f.all('SELECT pharmacy_id FROM med250_request_recipients ORDER BY distance_m');
  assert.deepEqual(recipients.map(r=>r.pharmacy_id),Array.from({length:10},(_,i)=>`pharmacy-${String(i+1).padStart(2,'0')}`));
  const deliveries=f.all("SELECT payload FROM med250_dispatch_outbox WHERE kind='client_media_request'");
  assert.equal(deliveries.length,20);
  assert.ok(deliveries.every(row=>JSON.parse(row.payload).image_count===2));
  assert.equal(f.one('SELECT sum(is_current) n FROM med250_client_locations').n,1);
  assert.equal(f.one('SELECT count(*) n FROM med250_whatsapp_permissions').n,2);
  f.run("UPDATE med250_dispatch_outbox SET status='delivered' WHERE kind='client_media_request' AND json_extract(payload,'$.image_index')=0");
  assert.deepEqual(await f.conversation.deliveryCounts(receipt.requestId),{total:10,delivered:0,unfinished:10});
  f.run("UPDATE med250_dispatch_outbox SET status='delivered' WHERE kind='client_media_request' AND pharmacy_id='pharmacy-01'");
  assert.deepEqual(await f.conversation.deliveryCounts(receipt.requestId),{total:10,delivered:1,unfinished:9});
});

test('send once never saves the location; no eligible pharmacy yields a truthful failure',async t=>{
  const f=fixture(t);pharmacy(f,1,false);
  const receipt=await photo(f);await readyWithLocation(f,receipt);
  const event=await inbound(f);
  await f.conversation.send(receipt.actorId,receipt.requestId,event.eventId,false);
  assert.equal(f.one('SELECT count(*) n FROM med250_request_recipients').n,0);
  assert.equal(f.one('SELECT sum(is_current) n FROM med250_client_locations').n,0);
  assert.equal(f.one("SELECT count(*) n FROM med250_dispatch_outbox WHERE json_extract(payload,'$.guidance')='no_pharmacy'").n,1);
});

test('START supplies pharmacy opt-in; STOP suppresses queued requests and can be reversed',async t=>{
  const f=fixture(t),p=pharmacy(f,1,false);
  const start=await inbound(f,p.e164);await f.conversation.service(start,p.e164,'start');
  assert.ok(f.one('SELECT messaging_opt_in_at FROM med250_pharmacy_contacts').messaging_opt_in_at);
  const receipt=await photo(f);await readyWithLocation(f,receipt);const consent=await inbound(f);
  await f.conversation.send(receipt.actorId,receipt.requestId,consent.eventId,false);
  const stop=await inbound(f,p.e164);await f.conversation.service(stop,p.e164,'stop');
  assert.equal(f.one("SELECT status FROM med250_dispatch_outbox WHERE kind='client_media_request'").status,'failed');
  assert.equal(f.one('SELECT messaging_opt_in_at FROM med250_pharmacy_contacts').messaging_opt_in_at,null);
  await f.conversation.service(await inbound(f,p.e164),p.e164,'start');
  assert.ok(f.one('SELECT messaging_opt_in_at FROM med250_pharmacy_contacts').messaging_opt_in_at);
});

test('request-bound actions reject another actor, expired drafts and more than ten photos',async t=>{
  const f=fixture(t),receipt=await photo(f),other=await inbound(f,'250788900002');
  await assert.rejects(f.conversation.ready(other.actorId,receipt.requestId,other.eventId),/expired/);
  for(let i=1;i<10;i++)await photo(f);
  const extra=await inbound(f,phone,1);
  await assert.rejects(f.conversation.beginImage(extra.eventId,'image/jpeg'),/limit/);
  f.run("UPDATE med250_client_requests SET expires_at='2000-01-01T00:00:00.000Z'");
  await assert.rejects(f.conversation.ready(receipt.actorId,receipt.requestId,extra.eventId),/expired/);
});

test('an early callback is durably replayed and concurrent late statuses cannot regress read/delivered',async t=>{
  const f=fixture(t);pharmacy(f,1);
  const receipt=await photo(f);await readyWithLocation(f,receipt);
  await f.conversation.send(receipt.actorId,receipt.requestId,(await inbound(f)).eventId,false);
  const outbox=f.one("SELECT id FROM med250_dispatch_outbox WHERE kind='client_media_request'");
  f.run("UPDATE med250_dispatch_outbox SET status='sending' WHERE id=?",outbox.id);
  const messageSid=sid();
  await f.repo.recordDeliveryEvent({eventKey:'early',messageSid,providerStatus:'delivered',errorCode:null,occurredAt:new Date()});
  assert.equal(f.one('SELECT count(*) n FROM med250_pending_delivery_callbacks').n,1);
  assert.equal(await f.repo.recordProviderAcceptance(outbox.id,messageSid),true);
  assert.equal(f.one('SELECT count(*) n FROM med250_pending_delivery_callbacks').n,0);
  assert.equal(f.one('SELECT status FROM med250_dispatch_outbox WHERE id=?',outbox.id).status,'delivered');
  await Promise.all(['read','failed','sent','delivered'].map(providerStatus=>f.repo.recordDeliveryEvent({eventKey:providerStatus,messageSid,providerStatus,errorCode:null,occurredAt:new Date()})));
  assert.equal(f.one('SELECT status FROM med250_dispatch_outbox WHERE id=?',outbox.id).status,'read');
  assert.equal(f.one("SELECT count(*) n FROM med250_dispatch_outbox WHERE kind='client_confirmation'").n,1);
});

test('HEAD checks do not consume a media grant; missing objects and invalid types do not consume it either',async t=>{
  const f=fixture(t);pharmacy(f,1);const receipt=await photo(f);await readyWithLocation(f,receipt);
  await f.conversation.send(receipt.actorId,receipt.requestId,(await inbound(f)).eventId,false);
  const o=f.one("SELECT id,pharmacy_id FROM med250_dispatch_outbox WHERE kind='client_media_request'");
  const token='a'.repeat(43),hash=await sha256Hex(token);
  await f.repo.createMediaGrant({tokenHashHex:hash,outboxId:o.id,pharmacyId:o.pharmacy_id,r2Key:'image.jpg'});
  let missing=false,type='image/jpeg';
  const bucket={put:async()=>{},get:async()=>missing?null:{size:3,httpMetadata:{contentType:type},body:new Blob(['123']).stream()}};
  const env={DB:f.db,PRIVATE_MEDIA:bucket};
  const url=`https://med-250.com/whatsapp-client-media/${token}.png`;
  for(let n=0;n<5;n++)assert.equal((await privateMediaResponse(new Request(url,{method:'HEAD'}),env)).status,200);
  assert.equal(f.one('SELECT fetch_count FROM med250_media_access_grants').fetch_count,0);
  missing=true;assert.equal((await privateMediaResponse(new Request(url),env)).status,404);missing=false;
  type='image/webp';assert.equal((await privateMediaResponse(new Request(url),env)).status,415);type='image/jpeg';
  for(let n=0;n<3;n++)assert.equal((await privateMediaResponse(new Request(url),env)).status,200);
  assert.equal((await privateMediaResponse(new Request(url),env)).status,410);
});

test('service content uses documented interactive shapes, is created once, and records real approval reasons',async t=>{
  const f=fixture(t),runtime={accountSid:`AC${'1'.repeat(32)}`,authToken:'test-only'};
  for(const [key,spec] of Object.entries(SERVICE_CONTENT)) {
    assert.ok(spec.actions.length>=1&&spec.actions.length<=3,key);
    assert.ok(spec.actions.every(action=>action.title.length<=20&&(spec.kind==='call-to-action'?action.type==='URL'&&action.url.startsWith('https://wa.me/'):action.id.length<=200)),key);
    if(spec.kind==='call-to-action') assert.equal(spec.actions.length,1);
    assert.ok(spec.body.length<=200,key);
    assert.ok(!JSON.stringify(serviceDefinition(key)).includes('QUICK_REPLY'));
  }
  let calls=0;const contentSid=`HX${'2'.repeat(32)}`;
  const fetcher=async(url,init)=>{calls++;assert.equal(init.method,'POST');return Response.json({...JSON.parse(init.body),sid:contentSid,account_sid:runtime.accountSid});};
  assert.equal(await ensureServiceContent(f.db,runtime,'draft',fetcher),contentSid);
  assert.equal(await ensureServiceContent(f.db,runtime,'draft',fetcher),contentSid);assert.equal(calls,1);
  assert.equal(await readApproval(f.db,runtime,contentSid,async()=>Response.json({whatsapp:{status:'rejected',rejection_reason:'Test rejection reason'}})),'rejected');
  assert.equal(f.one("SELECT rejection_reason FROM med250_twilio_content_registry WHERE state='observed'").rejection_reason,'Test rejection reason');
});

test('a queued service message is blocked after the recipient 24-hour window closes',async t=>{
  const f=fixture(t),event=await inbound(f);await f.conversation.service(event,phone,'help');
  const o=f.one('SELECT id FROM med250_dispatch_outbox');f.run("UPDATE med250_dispatch_outbox SET status='enqueued' WHERE id=?",o.id);
  assert.equal(await f.repo.checkOutboundEligibility(o.id),true);
  f.run("UPDATE med250_inbound_events SET received_at='2000-01-01T00:00:00.000Z'");
  assert.equal(await f.repo.checkOutboundEligibility(o.id),false);
  assert.equal(f.one('SELECT last_error_code FROM med250_dispatch_outbox WHERE id=?',o.id).last_error_code,'service_window_closed');
});

test('a failed second image unseals the bundle and does not dispatch the first image silently',async t=>{
  const f=fixture(t);pharmacy(f,1);const receipt=await photo(f),event=await inbound(f,phone,1);
  const second=await f.conversation.beginImage(event.eventId,'image/jpeg');
  await f.conversation.ready(receipt.actorId,receipt.requestId,(await inbound(f)).eventId);
  await f.conversation.finishImage({eventId:event.eventId,requestId:receipt.requestId,mediaId:second.mediaId,r2Key:null,byteSize:null,sha256:null,succeeded:false,errorCode:'test_bad_image'});
  assert.equal(f.one('SELECT sealed_at FROM med250_client_requests').sealed_at,null);
  assert.equal(f.one('SELECT count(*) n FROM med250_request_recipients').n,0);
  assert.equal(f.one("SELECT count(*) n FROM med250_dispatch_outbox WHERE json_extract(payload,'$.guidance')='media_failed'").n,1);
});

test('returning users receive the saved/new choice, without dispatching on the location button',async t=>{
  const f=fixture(t);pharmacy(f,1);const first=await photo(f);await readyWithLocation(f,first);
  await f.conversation.send(first.actorId,first.requestId,(await inbound(f)).eventId,true);
  const second=await photo(f);assert.notEqual(first.requestId,second.requestId);
  await f.conversation.ready(second.actorId,second.requestId,(await inbound(f)).eventId);
  const choice=f.one("SELECT payload FROM med250_dispatch_outbox WHERE kind='location_choice' AND request_id=?",second.requestId);
  assert.ok(choice);
  await f.conversation.useSaved({actorId:second.actorId,requestId:second.requestId,eventId:(await inbound(f)).eventId,locationId:JSON.parse(choice.payload).location_id});
  assert.equal(f.one('SELECT count(*) n FROM med250_request_recipients WHERE request_id=?',second.requestId).n,0);
  assert.equal(f.one('SELECT status FROM med250_client_requests WHERE id=?',second.requestId).status,'ready');
});

test('Available records availability only, without creating a zero-price offer',async t=>{
  const f=fixture(t),p=pharmacy(f,1),receipt=await photo(f);await readyWithLocation(f,receipt);
  await f.conversation.send(receipt.actorId,receipt.requestId,(await inbound(f)).eventId,false);
  const event=await inbound(f,p.e164);
  await f.repo.recordPharmacyResponse({eventId:event.eventId,actorId:event.actorId,requestId:receipt.requestId,pharmacyId:p.id,responseStatus:'can_fulfil',messageSid:sid()});
  assert.equal(f.one('SELECT response_status FROM med250_request_recipients').response_status,'can_fulfil');
  assert.equal(f.one('SELECT count(*) n FROM med250_marketplace_offers').n,0);
  await f.conversation.cancel(receipt.actorId,(await inbound(f)).eventId,receipt.requestId);
  assert.equal(f.one("SELECT status FROM med250_dispatch_outbox WHERE kind='client_media_request'").status,'failed');
});

test('uncertain content creation is reconciled without a duplicate POST',async t=>{
  const f=fixture(t),runtime={accountSid:`AC${'1'.repeat(32)}`,authToken:'test-only'};
  let posts=0;
  await assert.rejects(ensureServiceContent(f.db,runtime,'draft',async()=>{posts++;throw new TypeError('test connection reset');}));
  const definition=serviceDefinition('draft'),contentSid=`HX${'3'.repeat(32)}`;
  const recovered=await ensureServiceContent(f.db,runtime,'draft',async(url,init)=>{
    assert.equal(init.method,'GET');return Response.json({contents:[{...definition,sid:contentSid,account_sid:runtime.accountSid}],meta:{next_page_url:null}});
  });
  assert.equal(recovered,contentSid);assert.equal(posts,1);
});

test('Help URL-action IDs reconcile without accepting destination, label, body or action drift',async t=>{
  const runtime={accountSid:`AC${'1'.repeat(32)}`,authToken:'test-only'},contentSid=`HX${'9'.repeat(32)}`;
  for(const id of [null,'provider-generated-url-id',0]) {
    const f=fixture(t),returned=structuredClone(serviceDefinition('help'));
    returned.types['twilio/call-to-action'].actions[0].id=id;
    let posts=0;
    await assert.rejects(ensureServiceContent(f.db,runtime,'help',async()=>{posts++;throw new TypeError('test lost creation receipt');}));
    const recovered=await ensureServiceContent(f.db,runtime,'help',async(url,init)=>{
      assert.equal(init.method,'GET');
      return Response.json({contents:[{...returned,sid:contentSid,account_sid:runtime.accountSid}],meta:{next_page_url:null}});
    });
    assert.equal(recovered,contentSid);
    assert.equal(posts,1);
    assert.equal(f.one('SELECT state FROM med250_twilio_content_registry').state,'ready');
  }
  for(const change of ['url','title','body','type','extraAction','invalidId']) {
    const f=fixture(t),returned=structuredClone(serviceDefinition('help')),cta=returned.types['twilio/call-to-action'];
    cta.actions[0].id=null;
    if(change==='url') cta.actions[0].url='https://wa.me/250788000000';
    if(change==='title') cta.actions[0].title='Changed support';
    if(change==='body') cta.body='Unreviewed copy';
    if(change==='type') cta.actions[0].type='QUICK_REPLY';
    if(change==='extraAction') cta.actions.push({type:'QUICK_REPLY',title:'Other',id:'unreviewed'});
    if(change==='invalidId') cta.actions[0].id={unexpected:true};
    await assert.rejects(ensureServiceContent(f.db,runtime,'help',async()=>Response.json({...returned,sid:contentSid})),/reviewed definition/);
  }
  const f=fixture(t),quickReply=structuredClone(serviceDefinition('draft'));
  quickReply.types['twilio/quick-reply'].actions[0].id='changed-request-action';
  await assert.rejects(ensureServiceContent(f.db,runtime,'draft',async()=>Response.json({...quickReply,sid:contentSid})),/reviewed definition/);
});

test('business templates include resolvable media samples and preserve the exact Available action contract',async t=>{
  const f=fixture(t),runtime={accountSid:`AC${'1'.repeat(32)}`,authToken:'test-only'};
  for(const key of ['image','web','otp']) {
    const content=BUSINESS_CONTENT[key].content,contentSid=`HX${key==='image'?'4':key==='web'?'5':'6'}`.padEnd(34,'0');
    const created=await ensureBusinessContent(f.db,runtime,key,async(url,init)=>{
      assert.deepEqual(JSON.parse(init.body),content);return Response.json({...content,sid:contentSid,account_sid:runtime.accountSid});
    });
    assert.equal(created,contentSid);
    if(key==='otp') continue;
    const card=content.types['twilio/card'];
    const resolved=card.media[0].replace(/\{\{(\d+)\}\}/g,(_,n)=>content.variables[n]);
    assert.equal(resolved,`https://med-250.com/whatsapp-${key==='image'?'client':'order'}-media/sample.png`);
    await verifyPharmacyContent(runtime,contentSid,key==='image'?'client_media_request':'web_catalogue_order',content.variables,async()=>Response.json({...content,sid:contentSid}));
    const bad=structuredClone(content);bad.types['twilio/card'].actions[0].title='Can fulfil';
    await assert.rejects(verifyPharmacyContent(runtime,contentSid,key==='image'?'client_media_request':'web_catalogue_order',content.variables,async()=>Response.json(bad)),/action\/media contract/);
  }
});

test('Twilio RCS-only card defaults reconcile without weakening WhatsApp text and action checks',async t=>{
  const f=fixture(t),runtime={accountSid:`AC${'1'.repeat(32)}`,authToken:'test-only'};
  const definition=BUSINESS_CONTENT.image.content,returned=structuredClone(definition),contentSid=`HX${'7'.repeat(32)}`;
  Object.assign(returned.types['twilio/card'],{orientation:'VERTICAL',thumbnailImageAlignment:'LEFT',height:'TALL',body:null,subtitle:null});
  returned.types['twilio/card'].actions.forEach(action=>{action.chip_list=null;action.index=0;});
  assert.equal(await ensureBusinessContent(f.db,runtime,'image',async()=>Response.json({...returned,sid:contentSid})),contentSid);
  await verifyPharmacyContent(runtime,contentSid,'client_media_request',definition.variables,async()=>Response.json(returned));
  returned.types['twilio/card'].actions[0].id='unreviewed';
  await assert.rejects(verifyPharmacyContent(runtime,contentSid,'client_media_request',definition.variables,async()=>Response.json(returned)),/action\/media contract/);
});

test('late consent preparation cannot revive a cancelled or expired request',async t=>{
  const f=fixture(t),receipt=await photo(f);await readyWithLocation(f,receipt);
  await f.conversation.cancel(receipt.actorId,(await inbound(f)).eventId,receipt.requestId);
  const before=f.one('SELECT count(*) n FROM med250_dispatch_outbox').n;
  await f.conversation.consentPrompt(receipt.requestId,(await inbound(f)).eventId);
  assert.equal(f.one('SELECT status FROM med250_client_requests').status,'cancelled');
  assert.equal(f.one('SELECT count(*) n FROM med250_dispatch_outbox').n,before);
});

test('provider-generated authentication body is accepted but expiry controls stay strict',async t=>{
  const f=fixture(t),runtime={accountSid:`AC${'1'.repeat(32)}`,authToken:'test-only'};
  const returned=structuredClone(BUSINESS_CONTENT.otp.content),contentSid=`HX${'8'.repeat(32)}`;
  returned.types['whatsapp/authentication'].body='{{1}} is your verification code. For your security, do not share this code.';
  assert.equal(await ensureBusinessContent(f.db,runtime,'otp',async()=>Response.json({...returned,sid:contentSid})),contentSid);
  const other=fixture(t);returned.types['whatsapp/authentication'].code_expiration_minutes=90;
  await assert.rejects(ensureBusinessContent(other.db,runtime,'otp',async()=>Response.json({...returned,sid:contentSid})),/reviewed definition/);
  assert.match(other.one("SELECT rejection_reason FROM med250_twilio_content_registry WHERE definition_key LIKE 'business:%'").rejection_reason,/code_expiration_minutes/);
});
