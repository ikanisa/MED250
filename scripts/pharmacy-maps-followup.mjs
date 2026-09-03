import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {evidenceDir,pointFromMapsUrl,loadObservations,query} from './pharmacy-coordinate-research.mjs';

const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z]/g,'');
const read=f=>JSON.parse(readFileSync(resolve(evidenceDir,f),'utf8'));

export function retainCaptureBatch(label,captures){
  if(!/^maps-pass-\d{3}$/.test(label)||!Array.isArray(captures)||!captures.length)throw new Error('Named nonempty capture batch required');
  const keys=new Set(read('before.json').pharmacies.map(p=>p.registry_entry_key));
  for(const r of captures){if(!keys.has(r.key)||!r.dom||!r.query||new URL(r.url).hostname!=='www.google.com')throw new Error('Incomplete Google UI capture');}
  const bytes=JSON.stringify({captured_at:new Date().toISOString(),source:'visible Google Maps UI',captures},null,2)+'\n';
  writeFileSync(resolve(evidenceDir,label+'-captures.json'),bytes,{flag:'wx',mode:0o600});
  return {label,count:captures.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}

export function recordSupplementalMap({key,url,dom,note}){
  const p=read('before.json').pharmacies.find(p=>p.registry_entry_key===key);
  if(!p||p.geocode_status==='verified'||typeof dom!=='string'||dom.length<30||typeof note!=='string'||note.length<50)throw new Error('Pending register entry and explicit UI identity review required');
  const point=pointFromMapsUrl(url),checked_at=new Date().toISOString();
  const sha=createHash('sha256').update(JSON.stringify({key,url,dom})).digest('hex');
  const folder=resolve(evidenceDir,'supplemental-maps');mkdirSync(folder,{recursive:true});
  const file=resolve(folder,key+'-'+sha+'.json');
  const o={registry_entry_key:key,pharmacy_id:p.id,pharmacy_name:p.name,registered_locality:p.district+' / '+p.sector_cell_raw,url,dom,dom_sha256:createHash('sha256').update(dom).digest('hex'),evidence_id:sha,checked_at,decision:'review',coordinates:point,note,source_type:'google_maps_supplemental',contact_identity_verified:false};
  if(!existsSync(file))writeFileSync(file,JSON.stringify(o,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,evidence_id:sha,point,production_updated:false};
}

export function validateSupplementalBoundary(p,o,data){
  const point=pointFromMapsUrl(o.url),a=data.features?.length===1?data.features[0].attributes:null;
  if(o.pharmacy_id!==p.id||o.registry_entry_key!==p.registry_entry_key||o.decision!=='review'||o.coordinates.latitude!==point.latitude||o.coordinates.longitude!==point.longitude)throw new Error('Identity or exact source point mismatch');
  if(/(permanently|temporarily) closed/i.test(o.dom))throw new Error('Closed listing requires separate review');
  if(!a||data.error||data.exceededTransferLimit||norm(a.district)!==norm(p.district)||norm(a.sector)!==norm(p.sector_cell_raw.split(/\s+/)[0]))throw new Error('Official district and sector mismatch');
  return point;
}

export function recordSupplementalHold(key,sha,note){
  if(!/^(?:retail|online)-2026-05-\d+$/.test(key)||! /^[a-f0-9]{64}$/.test(sha)||typeof note!=='string'||note.length<80)throw new Error('Exact source and substantive hold rationale required');
  const o=read('supplemental-maps/'+key+'-'+sha+'.json');
  if(o.registry_entry_key!==key||o.decision!=='review'||loadObservations().some(r=>r.registry_entry_key===key&&r.decision==='verified'))throw new Error('Cannot replace a verified source with a hold');
  const folder=resolve(evidenceDir,'supplemental-holds');mkdirSync(folder,{recursive:true});
  writeFileSync(resolve(folder,key+'.json'),JSON.stringify({...o,checked_at:new Date().toISOString(),note:o.note+' Held: '+note},null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,decision:'review',production_updated:false};
}

export function reconsiderSupplementalMap(key,sha,note){
  if(!/^(?:retail|online)-2026-05-\d+$/.test(key)||!/^[a-f0-9]{64}$/.test(sha)||typeof note!=='string'||note.length<100)throw new Error('Exact retained source and reconsideration rationale required');
  const o=read('supplemental-resolutions/'+key+'.json');
  if(o.evidence_id!==sha||o.decision!=='verified')throw new Error('Matching prior supplemental decision required');
  const live=query(`SELECT geocode_status,latitude,longitude FROM med250_pharmacies WHERE registry_entry_key='${key}'`);
  if(live.length!==1||live[0].geocode_status!=='pending'||live[0].latitude!==null||live[0].longitude!==null)throw new Error('Only unapplied supplemental evidence can be reconsidered here');
  const folder=resolve(evidenceDir,'supplemental-reconsiderations');mkdirSync(folder,{recursive:true});
  writeFileSync(resolve(folder,key+'.json'),JSON.stringify({...o,decision:'review',checked_at:new Date().toISOString(),note:o.note+' Superseding review: '+note,prior_verified_decision_retained:true,production_updated:false},null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,decision:'review',production_updated:false};
}

export async function reviewSupplementalMap(key,sha,note){
  if(!/^(?:retail|online)-2026-05-\d+$/.test(key)||! /^[a-f0-9]{64}$/.test(sha)||typeof note!=='string'||note.length<80)throw new Error('Exact source and substantive branch rationale required');
  const p=read('before.json').pharmacies.find(p=>p.registry_entry_key===key);
  const o=read('supplemental-maps/'+key+'-'+sha+'.json');
  if(loadObservations().some(r=>r.registry_entry_key===key&&r.decision==='verified'))throw new Error('Verified source cannot be replaced');
  const point=pointFromMapsUrl(o.url);
  const source=new URL('https://moegis.environment.gov.rw/server/rest/services/Hosted/Administrative_boundaries/FeatureServer/1/query');
  source.search=new URLSearchParams({f:'json',geometry:point.longitude+','+point.latitude,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'province,district,sector',returnGeometry:'false'});
  const response=await fetch(source,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Official boundary HTTP '+response.status);
  const data=await response.json(),checked_at=new Date().toISOString();
  const raw={registry_entry_key:key,point,source_url:source.href,query_result:data,checked_at,evidence_id:sha};
  const folder=resolve(evidenceDir,'supplemental-boundary-evidence');mkdirSync(folder,{recursive:true});
  const file=resolve(folder,key+'-'+sha+'.json');if(!existsSync(file))writeFileSync(file,JSON.stringify(raw,null,2)+'\n',{flag:'wx',mode:0o600});
  validateSupplementalBoundary(p,o,data);
  const paths=['supplemental-boundary-checks','supplemental-resolutions'].map(f=>{mkdirSync(resolve(evidenceDir,f),{recursive:true});return resolve(evidenceDir,f,key+'.json');});
  if(paths.some(existsSync))throw new Error('Supplemental review already exists');
  writeFileSync(paths[0],JSON.stringify({...raw,exact_district_and_sector_match:true},null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(paths[1],JSON.stringify({...o,decision:'verified',checked_at,note:o.note+' Resolution: '+note+' Prior search/observation retained. Official boundary evidence: '+source.href},null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,point,decision:'verified',production_updated:false};
}
