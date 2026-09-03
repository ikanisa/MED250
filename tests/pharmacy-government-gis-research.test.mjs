import test from 'node:test';
import assert from 'node:assert/strict';
import {pointFromObservation,buildUpdate} from '../scripts/pharmacy-coordinate-research.mjs';
const feature={attributes:{objectid:258,shop_name:'SALVIA Pharmacy',shop_category:'Chemists / Pharmacy',accuracy:3.9},geometry:{x:30.0889866,y:-2.1423553}};
const o={source_type:'rwanda_government_gis',gis_feature:feature,url:'https://gh.space.gov.rw/server/rest/services/Health_Facilities/FeatureServer/3/258',pharmacy_id:'test',registry_entry_key:'retail-2026-05-304',decision:'verified',checked_at:'2026-09-02T17:00:00Z',coordinates:{longitude:feature.geometry.x,latitude:feature.geometry.y},registered_locality:'BUGESERA / NYAMATA NYAMATA TOWN',note:'Historical surveyed government source matched to current register; no WhatsApp capability inferred.',dom_sha256:'a'.repeat(64)};
test('government geometry must belong to exact source record with measured positive accuracy',()=>{
  assert.deepEqual(pointFromObservation(o),o.coordinates);
  for(const patch of [{objectid:1},{objectid:'258'},{accuracy:0},{accuracy:null},{accuracy:26},{shop_category:'Institutions'}])assert.throws(()=>pointFromObservation({...o,gis_feature:{...feature,attributes:{...feature.attributes,...patch}}}));
  for(const geometry of [{x:31,y:-2},{x:'30.1',y:-2},{x:30,y:1}])assert.throws(()=>pointFromObservation({...o,gis_feature:{...feature,geometry}}));
  assert.throws(()=>pointFromObservation({...o,url:'https://example.test/258'}));
});
test('government provenance is retained and never activates dispatch or invents a Google URL',()=>{
  const p={id:'test',registry_entry_key:o.registry_entry_key,geocode_status:'pending',latitude:null,longitude:null,dispatch_enabled:0,updated_at:'2026-08-01T00:00:00Z',marketplace_approved:1,licence_status:'current',licence_expires_on:'2030-01-01'};
  const a=buildUpdate(p,{...o,contact_identity_verified:true}).details.after;
  assert.equal(a.geocode_reference,o.url);assert.equal(a.geocode_provider,'governed_registry_import');assert.equal(a.google_maps_url,null);assert.equal(a.dispatch_enabled,0);
  assert.throws(()=>buildUpdate(p,{...o,coordinates:{longitude:30,latitude:-2}}));
});
