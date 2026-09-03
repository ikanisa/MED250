import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidenceDir,pointFromMapsUrl} from './pharmacy-coordinate-research.mjs';

// Read-only corroboration. A polygon intersection is not a business identity,
// and a cell discrepancy must never silently change the licensed register.
export async function reviewCell(key,sha){
  if(!/^(?:retail|online)-2026-05-\d+$/.test(key)||!/^[a-f0-9]{64}$/.test(sha))throw new Error('Exact retained source identity required');
  const p=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies.find(p=>p.registry_entry_key===key);
  const o=JSON.parse(readFileSync(resolve(evidenceDir,'supplemental-maps',key+'-'+sha+'.json'),'utf8'));
  if(!p||o.pharmacy_id!==p.id||o.registry_entry_key!==key)throw new Error('Source identity mismatch');
  const point=pointFromMapsUrl(o.url);
  const url=new URL('https://moegis.environment.gov.rw/server/rest/services/Hosted/Administrative_boundaries/FeatureServer/2/query');
  url.search=new URLSearchParams({f:'json',geometry:point.longitude+','+point.latitude,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'province,district,sector,cell',returnGeometry:'false'});
  const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('Official cell HTTP '+r.status);
  const data=await r.json();if(data.error||data.exceededTransferLimit||data.features?.length!==1)throw new Error('Unique untruncated official cell result required');
  const evidence={key,evidence_id:sha,source_url:url.href,point,registered_locality:p.district+' / '+p.sector_cell_raw,query_result:data,checked_at:new Date().toISOString(),production_updated:false};
  const folder=resolve(evidenceDir,'supplemental-cell-evidence');mkdirSync(folder,{recursive:true});
  const file=resolve(folder,key+'-'+sha+'.json');if(!existsSync(file))writeFileSync(file,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,name:p.name,registered:evidence.registered_locality,official:data.features[0].attributes,production_updated:false};
}
