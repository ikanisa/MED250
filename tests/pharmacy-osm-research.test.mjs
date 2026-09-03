import test from 'node:test';
import assert from 'node:assert/strict';
import { osmPoint, osmName, osmAttribution, nearbyOsmConflicts } from '../scripts/pharmacy-osm-research.mjs';
import { buildUpdate, pointFromObservation } from '../scripts/pharmacy-coordinate-research.mjs';
import { buildOsmPhoneReview } from '../scripts/pharmacy-contact-research.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const node={type:'node',id:12958807532,lat:-1.9962455,lon:30.0500741,timestamp:'2026-04-10T14:01:17Z',tags:{amenity:'pharmacy',name:'Horizon Pharmacy'}};
const p={id:'retail-2026-05-90',registry_entry_key:'retail-2026-05-90',latitude:null,longitude:null,geocode_status:'pending',dispatch_enabled:0,updated_at:'2026-08-01T00:00:00Z',marketplace_approved:1,licence_status:'current',licence_expires_on:'2030-01-01',google_maps_url:null};
const o={pharmacy_id:p.id,registry_entry_key:p.registry_entry_key,source_type:'openstreetmap',source_attribution:osmAttribution,osm_element:node,url:'https://www.openstreetmap.org/node/12958807532',coordinates:{latitude:node.lat,longitude:node.lon},decision:'verified',checked_at:'2026-09-02T17:00:00Z',registered_locality:'NYARUGENGE / NYAMIRAMBO RUGARAMA',note:'Exact branch identity reviewed against official administrative boundaries and current register.',dom_sha256:'a'.repeat(64)};
test('OSM uses a named point feature, never a centroid or out-of-country point',()=>{
  assert.deepEqual(osmPoint(node),o.coordinates);
  for(const change of [{type:'way',center:{lat:node.lat,lon:node.lon}},{lat:0},{lon:31},{lat:'-1.9'},{id:-1},{tags:{name:'A',amenity:'restaurant'}},{tags:{...node.tags,'disused:amenity':'pharmacy'}},{tags:{...node.tags,access:'no'}}]) assert.throws(()=>osmPoint({...node,...change}));
});
test('source identity and attribution are mandatory and do not mislabel OSM as Google',()=>{
  assert.deepEqual(pointFromObservation(o),o.coordinates);
  for(const change of [{url:'https://www.openstreetmap.org/node/1'},{url:'https://evil.test/node/12958807532'},{source_attribution:''},{osm_element:{...node,type:'way'}}]) assert.throws(()=>pointFromObservation({...o,...change}));
  const result=buildUpdate(p,{...o,contact_identity_verified:true});
  assert.equal(result.details.after.geocode_provider,'governed_registry_import');
  assert.equal(result.details.after.geocode_reference,o.url);
  assert.equal(result.details.after.google_maps_url,null);
  assert.equal(result.details.after.dispatch_enabled,0);
  assert.match(result.details.after.geocode_review_note,/OpenStreetMap.*ODbL/);
  assert.throws(()=>buildUpdate(p,{...o,coordinates:{latitude:-1.9,longitude:30.1}}));
});
test('name normalization removes legal and pharmacy labels, never branch identifiers',()=>{
  assert.equal(osmName('PHARMACIE LA VANILLE Ltd'),osmName('La Vanille Pharmacy'));
  assert.equal(osmName('CARE FIRST PHARMACY'),osmName('Carefirst Pharmacy Ltd'));
  assert.notEqual(osmName('Vine Pharmacy Gacuriro'),osmName('Vine Pharmacy Remera'));
  assert.notEqual(osmName('ST ODA PHARMACY -BASE'),osmName('ST ODA Pharmacy'));
});
test('identical-point businesses are not silently accepted as separate premises',()=>{
  assert.equal(nearbyOsmConflicts(node,[node,{...node,id:2,tags:{name:'Another Pharmacy'}}]).length,1);
  assert.equal(nearbyOsmConflicts(node,[node,{...node,id:2,lat:node.lat+.01,tags:{name:'Another Pharmacy'}}]).length,0);
});
test('OSM contact requires an exact complete contact tag, with no WhatsApp inference',()=>{
  const input={observation:{...o,osm_element:{...node,tags:{...node.tags,phone:'+250 783 783 471; +250 785 561 787'}}},phone:'+250783783471',note:'Reviewed exact current register identity, specific point and official district-sector match.'};
  const r=buildOsmPhoneReview(input);
  assert.equal(r.e164,'+250783783471');assert.equal(r.whatsapp_verified,false);assert.equal(r.source_type,'openstreetmap');
  for(const change of [{phone:'+250783783472'},{observation:{...input.observation,decision:'review'}},{phone:'783783471'}]) assert.throws(()=>buildOsmPhoneReview({...input,...change}));
});
test('OSM update obeys existing strict D1 schema and keeps dispatch disabled',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(readFileSync(new URL('../db/d1/migrations/0001_initial.sql',import.meta.url),'utf8'));
    db.prepare('INSERT INTO med250_pharmacies(id,name,registry_entry_key,created_at,updated_at) VALUES(?,?,?,?,?)').run(p.id,'Horizon',p.registry_entry_key,p.updated_at,p.updated_at);
    const u=buildUpdate(p,o);db.exec(u.update+u.audit);
    const result=db.prepare('SELECT * FROM med250_pharmacies').get();
    assert.equal(result.geocode_reference,o.url);assert.equal(result.geocode_provider,'governed_registry_import');assert.equal(result.dispatch_enabled,0);assert.equal(result.google_maps_url,null);
    assert.equal(db.prepare('SELECT count(*) n FROM med250_audit_events').get().n,1);
  }finally{db.close();}
});
