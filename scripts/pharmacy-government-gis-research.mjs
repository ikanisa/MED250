import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {evidenceDir,loadObservations,pointFromObservation} from './pharmacy-coordinate-research.mjs';
import {osmName} from './pharmacy-osm-research.mjs';

export const gisSource='https://gh.space.gov.rw/server/rest/services/Health_Facilities/FeatureServer/3';
export const gisDir=resolve(evidenceDir,'government-gis');
// Fetch only public establishment fields: no owner names, owner phones or staff details.
export async function fetchGovernmentGis(){
  mkdirSync(gisDir,{recursive:true});
  const file=resolve(gisDir,'pharmacies.json');
  if(existsSync(file)) throw new Error('Immutable source already captured');
  const url=new URL(gisSource+'/query');
  url.search=new URLSearchParams({f:'json',where:'1=1',outFields:'objectid,globalid,shop_name,phone_number,shop_category,shop_sub_category,province,district,sector,cell,village,street_number,accuracy,data_collection_date,editdate,refused_to_provide_info',returnGeometry:'true',outSR:'4326',orderByFields:'objectid',resultRecordCount:'2000'});
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error('Government GIS HTTP '+response.status);
  const bytes=await response.text(),data=JSON.parse(bytes);
  if(data.error||data.exceededTransferLimit||!Array.isArray(data.features)||!data.features.length||data.geometryType!=='esriGeometryPoint') throw new Error('Incomplete GIS point result');
  writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  const manifest={checked_at:new Date().toISOString(),source_url:url.href,sha256:createHash('sha256').update(bytes).digest('hex'),count:data.features.length,phone_status:'Public historical business field only; not current ownership or WhatsApp proof',production_updated:false};
  writeFileSync(resolve(gisDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}

export function governmentGisLeads(){
  const pharmacies=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
  const verified=new Set(loadObservations().filter(o=>o.decision==='verified').map(o=>o.registry_entry_key));
  const features=JSON.parse(readFileSync(resolve(gisDir,'pharmacies.json'),'utf8')).features;
  const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z]/g,'');
  return features.flatMap(feature=>{
    const a=feature.attributes;
    return pharmacies.filter(p=>osmName(p.name)===osmName(a.shop_name)&&norm(p.district)===norm(a.district)).map(p=>({key:p.registry_entry_key,pharmacy_id:p.id,name:p.name,registered:p.district+' / '+p.sector_cell_raw,source_sector_matches:norm(p.sector_cell_raw.split(/\s+/)[0])===norm(a.sector),already_verified:p.geocode_status==='verified'||verified.has(p.registry_entry_key),feature,verified:false}));
  });
}

export async function reviewGovernmentGis(key,objectid,note){
  if(!/^retail-2026-05-\d+$/.test(key)||!Number.isSafeInteger(objectid)||typeof note!=='string'||note.length<100) throw new Error('Explicit current register identity and evidence review required');
  const leads=governmentGisLeads().filter(r=>r.key===key&&r.source_sector_matches);
  if(leads.length!==1||leads[0].feature.attributes.objectid!==objectid||leads[0].already_verified) throw new Error('Unambiguous pending exact-name and sector match required');
  const lead=leads[0],a=lead.feature.attributes;
  const p=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies.find(p=>p.id===lead.pharmacy_id);
  const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z]/g,'');
  const registeredCell=p.sector_cell_raw.split(/\s+/).slice(1).join(' ');
  const exactCell=norm(registeredCell)===norm(a.cell);
  const nyamataTownAlias=p.district==='BUGESERA'&&/^NYAMATA (NYAMATA|NYAMATA TOWN)$/.test(p.sector_cell_raw)&&a.sector==='Nyamata'&&a.cell==="Nyamata y' umujyi";
  if(!exactCell&&!nyamataTownAlias) throw new Error('Exact cell or explicitly scoped Nyamata town alias required');
  if(loadObservations().some(o=>o.registry_entry_key===key&&/(permanently|temporarily) closed/i.test(o.dom))) throw new Error('Closure concern needs separate reconciliation');
  const checked_at=new Date().toISOString(),dom=JSON.stringify(lead.feature);
  const observation={registry_entry_key:key,pharmacy_id:p.id,pharmacy_name:p.name,registered_locality:p.district+' / '+p.sector_cell_raw,source_type:'rwanda_government_gis',url:gisSource+'/'+objectid,gis_feature:lead.feature,checked_at,decision:'verified',contact_identity_verified:false,note:'Official Rwanda GIS alternative authorized by user. Survey date '+new Date(a.data_collection_date).toISOString()+', source edit date '+new Date(a.editdate).toISOString()+'. '+note,dom,dom_sha256:createHash('sha256').update(dom).digest('hex')};
  const point=pointFromObservation(observation);observation.coordinates=point;
  const live=JSON.parse(readFileSync(resolve(evidenceDir,'osm-live-after-014.json'),'utf8')).pharmacies;
  if(live.some(r=>r.geocode_status==='verified'&&r.id!==p.id&&Math.hypot((r.latitude-point.latitude)*111195,(r.longitude-point.longitude)*111195*Math.cos(point.latitude*Math.PI/180))<10)) throw new Error('Point overlaps a previously verified premises');
  if(live.filter(r=>osmName(r.name)===osmName(p.name)&&r.district===p.district&&r.sector_cell_raw.split(/\s+/)[0]===p.sector_cell_raw.split(/\s+/)[0]).length!==1) throw new Error('Duplicate licensed branch identity');
  const url=new URL('https://moegis.environment.gov.rw/server/rest/services/Hosted/Administrative_boundaries/FeatureServer/1/query');
  url.search=new URLSearchParams({f:'json',geometry:point.longitude+','+point.latitude,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'province,district,sector',returnGeometry:'false'});
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error('Boundary service HTTP '+response.status);
  const data=await response.json(),b=data.features?.length===1?data.features[0].attributes:null;
  if(data.error||data.exceededTransferLimit||!b||norm(b.district)!==norm(p.district)||norm(b.sector)!==norm(p.sector_cell_raw.split(/\s+/)[0])) throw new Error('Official point boundary conflict');
  const boundary={registry_entry_key:key,point,source_url:url.href,checked_at,query_result:data,exact_district_and_sector_match:true};
  for(const folder of ['gis-observations','gis-boundary-checks'])mkdirSync(resolve(evidenceDir,folder),{recursive:true});
  writeFileSync(resolve(evidenceDir,'gis-boundary-checks',key+'.json'),JSON.stringify(boundary,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(resolve(evidenceDir,'gis-observations',key+'.json'),JSON.stringify(observation,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,objectid,point,production_updated:false};
}
