import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidenceDir, pointFromMapsUrl } from './pharmacy-coordinate-research.mjs';

const source='https://moegis.environment.gov.rw/server/rest/services/Hosted/Administrative_boundaries/FeatureServer/1/query';
const pharmacies=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
const directory=resolve(evidenceDir,'boundary-checks');mkdirSync(directory,{recursive:true});
const observations=readdirSync(resolve(evidenceDir,'observations')).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(resolve(evidenceDir,'observations',f),'utf8')));
const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z]/g,'');
const results=[];
for(const o of observations){
  let point;try{point=pointFromMapsUrl(o.url);}catch{continue;}
  const path=resolve(directory,`${o.registry_entry_key}.json`);
  let result;
  if(existsSync(path)) result=JSON.parse(readFileSync(path,'utf8'));
  else {
    const url=new URL(source);url.search=new URLSearchParams({f:'json',geometry:`${point.longitude},${point.latitude}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'province,district,sector',returnGeometry:'false'});
    const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error(`Boundary service HTTP ${response.status}`);
    const data=await response.json();if(data.error||data.exceededTransferLimit) throw new Error('Boundary query incomplete or failed');
    const p=pharmacies.find(p=>p.id===o.pharmacy_id),registeredSector=String(p.sector_cell_raw).split(/\s+/)[0];
    const unique=data.features?.length===1?data.features[0].attributes:null;
    result={registry_entry_key:o.registry_entry_key,pharmacy_name:o.pharmacy_name,point,registered_district:p.district,registered_sector:registeredSector,source_url:url.href,checked_at:new Date().toISOString(),boundary_source_description:'Rwanda Ministry of Environment administrative boundaries based on the 2022 census',query_result:data,exact_district_and_sector_match:Boolean(unique&&norm(unique.district)===norm(p.district)&&norm(unique.sector)===norm(registeredSector))};
    writeFileSync(path,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  results.push({key:result.registry_entry_key,name:result.pharmacy_name,registered:result.registered_district+'/'+result.registered_sector,actual:result.query_result.features?.map(f=>f.attributes.district+'/'+f.attributes.sector).join(';'),matches:result.exact_district_and_sector_match});
}
console.log(JSON.stringify(results,null,2));
