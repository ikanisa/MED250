import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { evidenceDir, loadObservations, queue } from './pharmacy-coordinate-research.mjs';

export const osmDir=resolve(evidenceDir,'openstreetmap');
export const osmEndpoint='https://overpass.private.coffee/api/interpreter';
export const osmQuery='[out:json][timeout:40];area["ISO3166-1"="RW"]["admin_level"="2"]->.rw;(nwr(area.rw)["amenity"="pharmacy"];nwr(area.rw)["healthcare"="pharmacy"];);out meta center;';
export const osmAttribution='© OpenStreetMap contributors; Open Database License (ODbL) 1.0; https://www.openstreetmap.org/copyright';

// One country-scoped public-data request, not browser scraping or a runtime dependency.
// No client, pharmacy phone, credential or private database content is sent.
export async function fetchOsm(endpoint=osmEndpoint,query=osmQuery) {
  if(![osmEndpoint,'https://maps.mail.ru/osm/tools/overpass/api/interpreter'].includes(endpoint)) throw new Error('Unsupported public OSM source');
  mkdirSync(osmDir,{recursive:true});
  const file=resolve(osmDir,'rwanda-pharmacies.json');
  if(existsSync(file)) throw new Error('Snapshot already exists; do not silently refetch or overwrite');
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'MED250-public-location-research/1.0 (+https://med-250.com)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(55000)});
  if(!response.ok) throw new Error(`Public OSM endpoint HTTP ${response.status}; no automatic retry`);
  const bytes=await response.text();
  if(bytes.length>10*1024*1024) throw new Error('Unexpectedly large country result');
  const data=JSON.parse(bytes);
  if(data.remark||!Array.isArray(data.elements)||!data.elements.length||!data.osm3s?.timestamp_osm_base) throw new Error('Incomplete OSM country result');
  writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  const manifest={checked_at:new Date().toISOString(),endpoint,query,sha256:createHash('sha256').update(bytes).digest('hex'),elements:data.elements.length,osm_base:data.osm3s.timestamp_osm_base,attribution:osmAttribution,whatsapp_verified:false,production_updated:false};
  writeFileSync(resolve(osmDir,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}

// Spacing/punctuation may differ across registers; retain all branch words and numbers.
export const osmName=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\b(?:LTD|LIMITED|PHARMACY|PHARMACIE|PHARMACIES)\b/g,' ').replace(/[^A-Z0-9]+/g,'');
export function nearbyOsmConflicts(element,elements) {
  return elements.filter(e=>e.id!==element.id&&osmName(e.tags?.name)!==osmName(element.tags?.name)&&Number.isFinite(e.lat)&&Number.isFinite(e.lon)&&Math.hypot((e.lat-element.lat)*111195,(e.lon-element.lon)*111195*Math.cos(element.lat*Math.PI/180))<10).map(e=>({node_id:e.id,name:e.tags?.name}));
}
export function osmPoint(element) {
  if(element?.type!=='node'||!Number.isSafeInteger(element.id)||element.id<1) throw new Error('Exact OSM node required; no way or relation centroids');
  const {lat:latitude,lon:longitude}=element;
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude< -3||latitude>-.8||longitude<28.7||longitude>30.9) throw new Error('OSM node outside Rwanda bounds');
  const tags=element.tags;
  if(!tags?.name||(tags.amenity!=='pharmacy'&&tags.healthcare!=='pharmacy')||Object.keys(tags).some(k=>/^(disused|abandoned|demolished|was):/.test(k))||tags.access==='no') throw new Error('Current named pharmacy feature required');
  return {latitude,longitude};
}

export function osmLeads(checkpoint='checkpoint-004') {
  if(!/^checkpoint-\d{3}$/.test(checkpoint)) throw new Error('Explicit checkpoint required');
  const pharmacies=JSON.parse(readFileSync(resolve(evidenceDir,checkpoint+'.json'),'utf8')).pharmacies;
  const elements=JSON.parse(readFileSync(resolve(osmDir,'rwanda-pharmacies.json'),'utf8')).elements;
  const verified=new Set(loadObservations().filter(o=>o.decision==='verified').map(o=>o.registry_entry_key));
  return pharmacies.filter(p=>p.geocode_status!=='verified'&&!verified.has(p.registry_entry_key)).flatMap(p=>{
    const candidates=elements.filter(e=>{try{osmPoint(e);return osmName(p.name)===osmName(e.tags.name);}catch{return false;}});
    return candidates.map(e=>({key:p.registry_entry_key,name:p.name,district:p.district,locality:p.sector_cell_raw,node_id:e.id,osm_name:e.tags.name,point:osmPoint(e),phone:e.tags.phone||e.tags['contact:phone']||null,check_date:e.tags.check_date||null,source_timestamp:e.timestamp,source_url:'https://www.openstreetmap.org/node/'+e.id,name_candidates:candidates.length,verified:false}));
  });
}

export async function checkOsmBoundaries(checkpoint='checkpoint-004') {
  const dir=resolve(osmDir,'boundary-candidates');mkdirSync(dir,{recursive:true});
  const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z]/g,'');
  const results=[];
  for(const lead of osmLeads(checkpoint)) {
    const file=resolve(dir,`${lead.key}-${lead.node_id}.json`);
    if(existsSync(file)){results.push(JSON.parse(readFileSync(file,'utf8')));continue;}
    const url=new URL('https://moegis.environment.gov.rw/server/rest/services/Hosted/Administrative_boundaries/FeatureServer/1/query');
    url.search=new URLSearchParams({f:'json',geometry:`${lead.point.longitude},${lead.point.latitude}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'province,district,sector',returnGeometry:'false'});
    const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error(`Boundary HTTP ${response.status}; stop, retaining completed checks`);
    const data=await response.json();
    if(data.error||data.exceededTransferLimit||!Array.isArray(data.features)) throw new Error('Incomplete official boundary response');
    const actual=data.features.length===1?data.features[0].attributes:null;
    const result={...lead,checked_at:new Date().toISOString(),source_url:url.href,osm_source_url:lead.source_url,query_result:data,exact_district_and_sector_match:Boolean(actual&&norm(actual.district)===norm(lead.district)&&norm(actual.sector)===norm(lead.locality.split(/\s+/)[0]))};
    writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});results.push(result);
  }
  return results.map(r=>({key:r.key,name:r.name,node:r.node_id,registered:r.district+'/'+r.locality,actual:r.query_result.features.map(f=>f.attributes.district+'/'+f.attributes.sector).join(';'),matches:r.exact_district_and_sector_match,phone:r.phone,check_date:r.check_date}));
}

// Human-reviewed exact-name, exact-sector alternative. No D1 call occurs here.
export function reviewOsm(key,nodeId,note) {
  if(!/^retail-2026-05-\d+$/.test(key)||!Number.isSafeInteger(nodeId)||typeof note!=='string'||note.length<80) throw new Error('Explicit identity and detailed source review required');
  const candidates=osmLeads().filter(r=>r.key===key);
  const boundaries=candidates.map(r=>JSON.parse(readFileSync(resolve(osmDir,'boundary-candidates',`${key}-${r.node_id}.json`),'utf8')));
  const exact=boundaries.filter(b=>b.exact_district_and_sector_match);
  if(exact.length!==1||exact[0].node_id!==nodeId) throw new Error('An unambiguous official-sector-matched node is required');
  const elements=JSON.parse(readFileSync(resolve(osmDir,'rwanda-pharmacies.json'),'utf8')).elements;
  const element=elements.find(e=>e.type==='node'&&e.id===nodeId);
  const pharmacy=queue().find(p=>p.registry_entry_key===key);
  const point=osmPoint(element);
  if(!pharmacy||osmName(pharmacy.name)!==osmName(element.tags.name)) throw new Error('Current register identity mismatch');
  if(nearbyOsmConflicts(element,elements).length) throw new Error('Shared or near-identical namesake pins require premises-level review');
  const all=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
  const live=JSON.parse(readFileSync(resolve(evidenceDir,existsSync(resolve(evidenceDir,'osm-live-after-014.json'))?'osm-live-after-014.json':'osm-live-before.json'),'utf8')).pharmacies;
  const neighbours=live.filter(p=>p.geocode_status==='verified'&&p.id!==pharmacy.id&&osmName(p.name)!==osmName(pharmacy.name)&&Math.hypot((p.latitude-point.latitude)*111195,(p.longitude-point.longitude)*111195*Math.cos(point.latitude*Math.PI/180))<10);
  if(neighbours.length) throw new Error('Point overlaps another verified business; premises-level reconciliation required');
  const locality=s=>String(s).toUpperCase().split(/\s+/)[0];
  if(all.filter(p=>osmName(p.name)===osmName(pharmacy.name)&&p.district===pharmacy.district&&locality(p.sector_cell_raw)===locality(pharmacy.sector_cell_raw)).length!==1) throw new Error('Duplicate current register identity needs separate reconciliation');
  if(loadObservations().some(o=>o.registry_entry_key===key&&/(permanently|temporarily) closed/i.test(o.dom))) throw new Error('Existing closure concern requires separate resolution');
  const boundary=exact[0];
  if(point.latitude!==boundary.point.latitude||point.longitude!==boundary.point.longitude) throw new Error('Stale boundary point');
  const checked_at=new Date().toISOString(),dom=JSON.stringify(element);
  const o={registry_entry_key:key,pharmacy_id:pharmacy.id,pharmacy_name:pharmacy.name,registered_locality:pharmacy.district+' / '+pharmacy.sector_cell_raw,checked_at,url:'https://www.openstreetmap.org/node/'+nodeId,coordinates:point,decision:'verified',source_type:'openstreetmap',source_attribution:osmAttribution,osm_element:element,contact_identity_verified:false,note:'OpenStreetMap alternative source, explicitly authorized by user on 2026-09-02. '+note,dom,dom_sha256:createHash('sha256').update(dom).digest('hex')};
  for(const directory of ['osm-observations','osm-boundary-checks']) mkdirSync(resolve(evidenceDir,directory),{recursive:true});
  // Boundary first: a partial local write cannot enter the D1 plan without evidence.
  writeFileSync(resolve(evidenceDir,'osm-boundary-checks',key+'.json'),JSON.stringify(boundary,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(resolve(evidenceDir,'osm-observations',key+'.json'),JSON.stringify(o,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,nodeId,point,source:'OpenStreetMap',production_updated:false};
}

// Contact-only corroboration for an already verified premises; never changes its coordinates.
export async function reviewOsmPhoneForVerifiedBranch(key,nodeId,phone,note){
  if(!/^retail-2026-05-\d+$/.test(key)||!Number.isSafeInteger(nodeId)||typeof note!=='string'||note.length<80) throw new Error('Explicit branch, node, phone and review required');
  const live=JSON.parse(readFileSync(resolve(evidenceDir,'osm-live-after-014.json'),'utf8')).pharmacies;
  const p=live.find(p=>p.registry_entry_key===key);
  const elements=JSON.parse(readFileSync(resolve(osmDir,'rwanda-pharmacies.json'),'utf8')).elements;
  const e=elements.find(e=>e.id===nodeId),point=osmPoint(e);
  if(!p||p.geocode_status!=='verified'||osmName(p.name)!==osmName(e.tags.name)||nearbyOsmConflicts(e,elements).length) throw new Error('Exact established branch and unshared OSM point required');
  const metres=Math.hypot((p.latitude-e.lat)*111195,(p.longitude-e.lon)*111195*Math.cos(e.lat*Math.PI/180));
  if(metres>75) throw new Error('OSM contact too far from verified premises');
  const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z]/g,'');
  const url=new URL('https://moegis.environment.gov.rw/server/rest/services/Hosted/Administrative_boundaries/FeatureServer/1/query');
  url.search=new URLSearchParams({f:'json',geometry:point.longitude+','+point.latitude,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'province,district,sector',returnGeometry:'false'});
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Official boundary HTTP '+response.status);
  const data=await response.json(),b=data.features?.length===1?data.features[0].attributes:null;
  if(data.error||data.exceededTransferLimit||!b||norm(b.district)!==norm(p.district)||norm(b.sector)!==norm(p.sector_cell_raw.split(/\s+/)[0]))throw new Error('OSM contact point has a different official district or sector');
  const dom=JSON.stringify(e),checked_at=new Date().toISOString();
  const observation={registry_entry_key:key,pharmacy_id:p.id,pharmacy_name:p.name,checked_at,source_type:'openstreetmap',source_attribution:osmAttribution,osm_element:e,url:'https://www.openstreetmap.org/node/'+nodeId,coordinates:point,decision:'verified',contact_identity_verified:false,dom,dom_sha256:createHash('sha256').update(dom).digest('hex')};
  const {buildOsmPhoneReview}=await import('./pharmacy-contact-research.mjs');
  const review=buildOsmPhoneReview({observation,phone,note:note+' Contact-only corroboration '+Math.round(metres)+'m from the previously verified premises; official boundary '+url.href});
  const evidence={observation,boundary:data,boundary_url:url.href,verified_premises_reference:p.geocode_reference,distance_metres:metres,coordinates_changed:false};
  for(const folder of ['osm-phone-evidence','phone-observations'])mkdirSync(resolve(evidenceDir,folder),{recursive:true});
  const filename=key+'-'+review.database_e164+'.json';
  if(existsSync(resolve(evidenceDir,'phone-observations',filename)))return {key,already_reviewed:true};
  writeFileSync(resolve(evidenceDir,'osm-phone-evidence',filename),JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(resolve(evidenceDir,'phone-observations',filename),JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,phone:review.e164,whatsapp_verified:false,production_updated:false};
}

if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]==='fetch') console.log(JSON.stringify(await fetchOsm(),null,2));
  else if(process.argv[2]==='leads') console.log(JSON.stringify(osmLeads(process.argv[3]),null,2));
  else if(process.argv[2]==='boundaries') console.log(JSON.stringify(await checkOsmBoundaries(process.argv[3]),null,2));
  else throw new Error('Use fetch or leads; no database writes');
}
