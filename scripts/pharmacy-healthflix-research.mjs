import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {evidenceDir} from './pharmacy-coordinate-research.mjs';
import {normalizeRwandaDirectoryPhone} from './pharmacy-contact-research.mjs';
import {osmName} from './pharmacy-osm-research.mjs';

export function retainHealthflix({url,name,phone_text,location}){
  const source=new URL(url);
  if(source.origin!=='https://healthflix.rw'||!/^\/listing\/[a-z0-9-]+\/$/.test(source.pathname)||!name||typeof phone_text!=='string'||typeof location!=='string')throw new Error('Exact visible business page fields required');
  const evidence={url,name,phone_text,location,checked_at:new Date().toISOString(),source_type:'healthflix_directory',whatsapp_verified:false};
  const bytes=JSON.stringify(evidence,null,2)+'\n',sha=createHash('sha256').update(bytes).digest('hex');
  const folder=resolve(evidenceDir,'healthflix');mkdirSync(folder,{recursive:true});
  const file=resolve(folder,sha+'.json');writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  return {...evidence,evidence_id:sha};
}

export function buildHealthflixPhone({pharmacy,register,evidence,phone,decision,note}){
  if(!['candidate','verified_business'].includes(decision)||typeof note!=='string'||note.length<80)throw new Error('Explicit identity and locality review required');
  const source=new URL(evidence.url);
  if(source.origin!=='https://healthflix.rw'||!source.pathname.startsWith('/listing/'))throw new Error('Reviewed directory source required');
  const matches=register.filter(p=>osmName(p.name)===osmName(evidence.name));
  if(matches.length!==1||matches[0].id!==pharmacy.id)throw new Error('Unique exact named register business required');
  const number=normalizeRwandaDirectoryPhone(phone);
  const explicitInternational=[...evidence.phone_text.matchAll(/(?:^|\s)(\+250[27]\d{8})(?=$|\s)/g)].map(m=>m[1]);
  const listed=[...evidence.phone_text.split(/[;\/\n]/),...explicitInternational].flatMap(v=>{try{return[normalizeRwandaDirectoryPhone(v.trim()).database_e164]}catch{return[]}});
  if(!listed.includes(number.database_e164))throw new Error('Complete number must appear in the same Phone Number field');
  const locationWords=' '+String(evidence.location).toUpperCase().replace(/[^A-Z0-9]+/g,' ')+' ';
  const locations=[pharmacy.district,pharmacy.sector_cell_raw?.split(/\s+/)[0]].filter(Boolean).map(x=>String(x).toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim());
  if(decision==='verified_business'&&!locations.some(x=>locationWords.includes(' '+x+' ')))throw new Error('Registered district or sector required for this verified phone path');
  const now=new Date().toISOString();
  return {key:pharmacy.registry_entry_key,pharmacy_id:pharmacy.id,pharmacy_name:pharmacy.name,...number,decision,note:note+' Published telephone only; the directory verification badge does not establish WhatsApp ownership, capability or opt-in.',source_type:'healthflix_directory',source_label:'Healthflix Rwanda public business directory',source_url:evidence.url,source_observed_at:evidence.checked_at,reviewed_at:now,evidence_sha256:evidence.evidence_id,dom:JSON.stringify(evidence),whatsapp_verified:false};
}

export function recordHealthflixPhone({key,sha,...input}){
  if(!/^[a-f0-9]{64}$/.test(sha))throw new Error('Retained source SHA required');
  const register=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies,pharmacy=register.find(p=>p.registry_entry_key===key);
  if(!pharmacy)throw new Error('Unknown register business');
  const bytes=readFileSync(resolve(evidenceDir,'healthflix',sha+'.json'),'utf8');if(createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('Source hash mismatch');
  const evidence={...JSON.parse(bytes),evidence_id:sha};
  const r=buildHealthflixPhone({pharmacy,register,evidence,...input});
  const folder=resolve(evidenceDir,'phone-observations');mkdirSync(folder,{recursive:true});
  const path=resolve(folder,key+'-'+r.database_e164+'.json');if(existsSync(path))return{key,already_reviewed:true};
  writeFileSync(path,JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o600});return{key,phone:r.e164,decision:r.decision,whatsapp_verified:false};
}
