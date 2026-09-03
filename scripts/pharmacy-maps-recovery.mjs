import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { evidenceDir, root } from './pharmacy-coordinate-research.mjs';

// Read-only source discovery. A historic place reference is a lead, not verification.
export function csvRecords(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}
    else if(c==='"') quoted=!quoted;
    else if(!quoted&&(c===','||c==='\n')) {row.push(cell);cell='';if(c==='\n'){rows.push(row);row=[];}}
    else if(c!=='\r') cell+=c;
  }
  if(quoted) throw new Error('Unterminated CSV field');
  if(cell||row.length){row.push(cell);rows.push(row);}
  const headers=rows.shift();
  return rows.filter(r=>r.some(Boolean)).map(r=>{
    if(r.length!==headers.length) throw new Error('CSV column count mismatch');
    return Object.fromEntries(headers.map((k,i)=>[k,r[i]]));
  });
}

export function knownPlaceLeads(checkpoint='checkpoint-004') {
  if(!/^checkpoint-\d{3}$/.test(checkpoint)) throw new Error('Explicit checkpoint required');
  const current=JSON.parse(readFileSync(resolve(evidenceDir,checkpoint+'.json'),'utf8')).pharmacies;
  return csvRecords(readFileSync(resolve(root,'outputs/pharmacies-december-2025-deep-v2-registry-matched.csv'),'utf8')).filter(r=>{
    return r.google_maps_url&&current.some(p=>p.registry_entry_key===r.current_registry_entry_key&&p.geocode_status!=='verified')&&!existsSync(resolve(evidenceDir,'observations',r.current_registry_entry_key+'.json'));
  }).map(r=>({key:r.current_registry_entry_key,name:r.current_name,locality:r.current_district+'/'+r.current_sector_cell_raw,url:r.google_maps_url}));
}

export function recordSearchAttempt({key,query,url,dom,method}) {
  if(!/^(?:retail|online)-2026-05-\d+$/.test(key)||!['exact_name','phone','locality','indexed_web','place_reference','district_scan'].includes(method)) throw new Error('Invalid research identity or method');
  const pharmacies=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
  const pharmacy=pharmacies.find(p=>p.registry_entry_key===key);
  if(!pharmacy||typeof query!=='string'||!query.trim()||typeof dom!=='string'||dom.length<20) throw new Error('Visible search evidence required');
  const source=new URL(url);
  if(source.hostname!=='www.google.com'||!/^\/(maps|search)(\/|$)/.test(source.pathname)) throw new Error('Google Maps or indexed Google search required');
  const digest=createHash('sha256').update(JSON.stringify({key,query,url,dom,method})).digest('hex');
  const directory=resolve(evidenceDir,'search-attempts');mkdirSync(directory,{recursive:true});
  const file=resolve(directory,`${key}-${digest.slice(0,20)}.json`);
  if(existsSync(file)) return {key,already_retained:true};
  writeFileSync(file,JSON.stringify({key,name:pharmacy.name,registered_locality:[pharmacy.district,pharmacy.sector_cell_raw].join('/'),query,url,dom,method,checked_at:new Date().toISOString(),sha256:digest,verified:false},null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,method,verified:false,file};
}

export function attemptInventory() {
  const directory=resolve(evidenceDir,'search-attempts');
  return existsSync(directory)?readdirSync(directory).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(resolve(directory,f),'utf8'))):[];
}
