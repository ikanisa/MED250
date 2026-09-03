import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildUpdate, pointFromMapsUrl, reportRow } from '../scripts/pharmacy-coordinate-research.mjs';

const url = 'https://www.google.com/maps/place/Precious+Pharmacy/@-1.94,30.12,17z/data=!3m1!4b1!4m6!3m5!1splaceid!8m2!3d-1.9465014!4d30.1283324';
const pharmacy = {id:'retail-2026-05-1',registry_entry_key:'retail-2026-05-1',latitude:null,longitude:null,geocode_status:'pending',dispatch_enabled:0,updated_at:'2026-08-01T00:00:00Z',marketplace_approved:1,licence_status:'current',licence_expires_on:'2030-01-01'};
const observation = {pharmacy_id:pharmacy.id,registry_entry_key:pharmacy.registry_entry_key,decision:'verified',url,coordinates:pointFromMapsUrl(url),checked_at:'2026-09-02T14:00:00Z',registered_locality:'Kimironko Bibare',note:'Exact pharmacy name, current business phone and locality reviewed in Google Maps.',dom_sha256:'a'.repeat(64)};

test('uses exact business pin, never viewport centre',()=>assert.deepEqual(pointFromMapsUrl(url),{latitude:-1.9465014,longitude:30.1283324}));
test('rejects search links, viewport-only, foreign and multiple pins',()=>{
  for(const invalid of ['https://www.google.com/maps/search/Precious/@-1.94,30.12,17z','https://www.google.com/maps/place/Precious/@-1.94,30.12,17z',url+'!3d-1.94!4d30.12',url.replace('!3d-1.9465014','!3d51.5'),url.replace('www.google.com','evil.example')]) assert.throws(()=>pointFromMapsUrl(invalid));
});
test('does not overwrite a verified or already populated location',()=>{
  for(const change of [{latitude:-1.9},{longitude:30.1},{geocode_status:'verified'},{dispatch_enabled:1}]) assert.throws(()=>buildUpdate({...pharmacy,...change},observation));
});
test('rejects identity or coordinate mismatches',()=>{
  for(const change of [{pharmacy_id:'another'},{registry_entry_key:'another'},{decision:'review'},{coordinates:{latitude:-1.9,longitude:30.1}}]) assert.throws(()=>buildUpdate(pharmacy,{...observation,...change}));
});
test('holds permanently or temporarily closed business listings',()=>{
  for(const dom of ['Permanently closed','Temporarily closed']) assert.throws(()=>buildUpdate(pharmacy,{...observation,dom}));
});
test('coordinate verification alone cannot enable dispatch with an unverified contact association',()=>assert.equal(buildUpdate(pharmacy,observation).details.after.dispatch_enabled,0));
test('dispatch requires reviewed contact identity, marketplace and current licence',()=>{
  const approved={...observation,contact_identity_verified:true};
  assert.equal(buildUpdate(pharmacy,approved).details.after.dispatch_enabled,1);
  for(const change of [{marketplace_approved:0},{licence_status:'expired'},{licence_expires_on:'2026-01-01'}]) assert.equal(buildUpdate({...pharmacy,...change},approved).details.after.dispatch_enabled,0);
});
test('updates are optimistic, scoped and append-only audited',()=>{
  const result=buildUpdate(pharmacy,observation);
  assert.match(result.update,/updated_at='2026-08-01T00:00:00Z'/);
  assert.match(result.update,/latitude IS NULL AND longitude IS NULL/);
  assert.doesNotMatch(result.update,/SET.*(?:licence_status|marketplace_approved)=/);
  assert.match(result.audit,/WHERE changes\(\)=1/);
});
test('generated update executes on the real strict D1 schema with one audit and no stale overwrite',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../db/d1/migrations/0001_initial.sql',import.meta.url),'utf8'));
    db.prepare('INSERT INTO med250_pharmacies(id,name,registry_entry_key,marketplace_approved,licence_status,licence_expires_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(pharmacy.id,'Precious Pharmacy',pharmacy.registry_entry_key,1,'current','2030-01-01',pharmacy.updated_at,pharmacy.updated_at);
    const generated=buildUpdate(pharmacy,observation);
    db.exec(generated.update+generated.audit);
    const stored=db.prepare('SELECT * FROM med250_pharmacies').get();
    assert.equal(stored.latitude,observation.coordinates.latitude);
    assert.equal(stored.dispatch_enabled,0);
    assert.equal(stored.name,'Precious Pharmacy');
    assert.equal(db.prepare('SELECT count(*) AS n FROM med250_audit_events').get().n,1);
    db.exec(generated.update+generated.audit);
    assert.equal(db.prepare('SELECT count(*) AS n FROM med250_audit_events').get().n,1);
    assert.throws(()=>db.exec("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('STALE_LOCATION_REVIEW') END"));
  } finally { db.close(); }
});
test('export preserves full plus-prefixed numbers and separates candidate pins from routing',()=>{
  const p={...pharmacy,contacts_json:JSON.stringify([
    {channel:'whatsapp',e164:'250787206998',active:1,verified_at:'2026-01-01'},
    {channel:'phone',e164:'250788123456',active:1,verified_at:'2026-01-01'},
    {channel:'phone',e164:'250252572297',active:0,verified_at:null}
  ])};
  const r=reportRow(p,{...observation,decision:'review'});
  assert.equal(r.recorded_whatsapp_numbers_e164,'+250787206998');
  assert.equal(r.verified_business_mobile_numbers_e164,'+250788123456');
  assert.equal(r.unverified_candidate_numbers_e164,'+250252572297');
  assert.equal(r.latitude,null);
  assert.equal(r.candidate_latitude_not_for_routing,-1.9465014);
  assert.equal(reportRow(p,{...observation,decision:'not_found'}).candidate_latitude_not_for_routing,null);
});
test('retained searches are tracked without promoting a business or coordinate',()=>{
  const p={...pharmacy,contacts_json:'[]'};
  const attempts=[{method:'exact_name',url:'https://www.google.com/maps/search/example'}];
  const r=reportRow(p,null,attempts);
  assert.equal(r.review_this_run,'searched_pending_review');
  assert.equal(r.retained_search_attempts,1);
  assert.equal(r.search_methods,'exact_name');
  assert.equal(r.latitude,null);
  assert.equal(r.candidate_latitude_not_for_routing,null);
  assert.equal(reportRow(p,null).review_this_run,'not_yet_reviewed');
  assert.equal(reportRow({...p,geocode_status:'verified'},null,attempts).review_this_run,'previously_verified');
  assert.equal(reportRow(p,{...observation,decision:'review'},attempts).review_this_run,'review');
});
