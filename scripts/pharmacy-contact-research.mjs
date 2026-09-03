import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evidenceDir, query, root, pointFromObservation } from './pharmacy-coordinate-research.mjs';

function canonicalDigits(value) {
  if(typeof value!=='string' || !/^[+\d\s()-]+$/.test(value)) throw new Error('Invalid phone characters');
  let digits=value.replace(/\D/g,'');
  if(digits.startsWith('00250')) digits=digits.slice(2);
  if(/^0[27]\d{8}$/.test(digits)) digits='250'+digits.slice(1);
  return digits;
}

// RURA current allocated blocks: 072/073/077/078/079 mobile;
// 022/023/025/028 fixed. Format is not proof of an active subscription.
// https://www.rura.rw/sectors/ict/sub-sectors-and-services/ict-spectrum-administration
export function normalizeRwandaBusinessMobile(value) {
  const digits=canonicalDigits(value);
  if(!/^2507[23789]\d{7}$/.test(digits)) throw new Error('A complete Rwanda mobile number is required');
  return { e164: '+'+digits, database_e164: digits };
}

export function normalizeRwandaBusinessPhone(value) {
  const digits=canonicalDigits(value);
  if(!/^250(?:7[23789]|2[2358])\d{7}$/.test(digits)) throw new Error('A complete allocated Rwanda business phone number is required');
  return {e164:'+'+digits,database_e164:digits,number_type:digits.startsWith('2507')?'mobile':'fixed_line'};
}

export function recordPhoneReview({key,phone,decision,note}) {
  if(!['verified_business','candidate'].includes(decision)) throw new Error('Explicit phone review required');
  if(decision==='verified_business'&&existsSync(resolve(evidenceDir,'supplemental-reconsiderations',`${key}.json`)))throw new Error('Reconsidered branch identity requires separate contact resolution');
  const revision=resolve(evidenceDir,'supplemental-resolutions',`${key}.json`);
  const observation=JSON.parse(readFileSync(existsSync(revision)?revision:resolve(evidenceDir,'observations',`${key}.json`),'utf8'));
  if(decision==='verified_business'&&/(permanently|temporarily) closed/i.test(observation.dom)) throw new Error('Closed business contact requires review');
  if(!observation.url.startsWith('https://www.google.com/maps/place/')) throw new Error('A specific business page is required');
  if(note.length<30) throw new Error('Identity review note required');
  const normalized=normalizeRwandaBusinessPhone(phone);
  if(!observation.dom.replace(/\D/g,'').includes(normalized.database_e164.slice(3))) throw new Error('Phone is absent from observed business information');
  const review={key,pharmacy_id:observation.pharmacy_id,pharmacy_name:observation.pharmacy_name,...normalized,decision,note,source_url:observation.url,source_observed_at:observation.checked_at,reviewed_at:new Date().toISOString(),evidence_sha256:observation.dom_sha256,whatsapp_verified:false};
  const directory=resolve(evidenceDir,'phone-observations');
  mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,`${key}-${normalized.database_e164}.json`),JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,e164:normalized.e164,decision,whatsapp_verified:false};
}

const identityText=value=>String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\b(?:LTD|LIMITED)\b/g,'').replace(/[^A-Z0-9]+/g,' ').trim();

// This directory is explicitly Rwanda-scoped. It often omits the local trunk 0.
// Do not accept these national-only numbers in the general/WhatsApp normalizer.
export function normalizeRwandaDirectoryPhone(value) {
  if(typeof value==='string'&&/^[\d\s()-]+$/.test(value)) {
    const national=value.replace(/\D/g,'');
    if(/^(?:7[23789]|2[2358])\d{7}$/.test(national)) return normalizeRwandaBusinessPhone('+250'+national);
  }
  return normalizeRwandaBusinessPhone(value);
}

// A separate provenance path: never describe a distributor's directory as Maps.
// Exact registered name and district are required; branch names remain significant.
export function buildDirectoryPhoneReview({pharmacy,url,dom,phone,decision,note}) {
  const source=new URL(url);
  if(source.origin!=='https://rwanda.ubipharm.com'||source.pathname!=='/en/Spec-annulist,AnnuairePharmacies') throw new Error('Unsupported directory source');
  if(!['verified_business','candidate'].includes(decision)||typeof note!=='string'||note.length<50) throw new Error('Explicit identity and locality review required');
  const lines=dom.split('\n').map(s=>s.trim()).filter(Boolean);
  if(identityText(lines[0])!==identityText(pharmacy.name)) throw new Error('Exact directory business name required');
  const district=identityText(pharmacy.district);
  if(!district||!lines.slice(1).some(line=>identityText(line).split(' ').includes(district))) throw new Error('Registered district missing from business entry');
  if(decision==='verified_business'&&/(permanently|temporarily) closed/i.test(dom)) throw new Error('Closed business contact requires review');
  const normalized=normalizeRwandaDirectoryPhone(phone);
  const listedNumbers=lines.filter(line=>/^T[ée]l\s*:/i.test(line)).flatMap(line=>line.replace(/^T[ée]l\s*:\s*/i,'').split('/')).flatMap(value=>{
    try { return [normalizeRwandaDirectoryPhone(value.trim()).database_e164]; } catch { return []; }
  });
  if(!listedNumbers.includes(normalized.database_e164)) throw new Error('Complete phone absent from the observed business entry');
  const now=new Date().toISOString();
  return {key:pharmacy.registry_entry_key,pharmacy_id:pharmacy.id,pharmacy_name:pharmacy.name,...normalized,decision,note,source_type:'ubipharm_directory',source_label:'Ubipharm Rwanda public directory business contact review',source_url:url,source_observed_at:now,reviewed_at:now,evidence_sha256:createHash('sha256').update(dom).digest('hex'),dom,registered_locality:[pharmacy.district,pharmacy.sector_cell_raw].join(' / '),whatsapp_verified:false};
}

// A Kigali-only directory lead may be retained without pretending city-level
// geography proves the current branch. This path can never verify or activate it.
export function buildKigaliDirectoryCandidate({pharmacy,register,url,dom,phone,note}) {
  const source=new URL(url),lines=dom.split('\n').map(s=>s.trim()).filter(Boolean);
  const unique=register.filter(p=>identityText(p.name)===identityText(pharmacy.name));
  if(source.origin!=='https://rwanda.ubipharm.com'||source.pathname!=='/en/Spec-annulist,AnnuairePharmacies'||unique.length!==1||unique[0].id!==pharmacy.id)throw new Error('Unique exact register identity and retained directory source required');
  if(identityText(lines[0])!==identityText(pharmacy.name)||!lines.includes('KIGALI')||!['GASABO','KICUKIRO','NYARUGENGE'].includes(identityText(pharmacy.district)))throw new Error('Exact named Kigali lead required');
  if(typeof note!=='string'||note.length<80)throw new Error('Explicit unresolved-locality rationale required');
  const number=normalizeRwandaDirectoryPhone(phone);
  const listed=lines.filter(line=>/^T[ée]l\s*:/i.test(line)).flatMap(line=>line.replace(/^T[ée]l\s*:\s*/i,'').split('/')).flatMap(v=>{try{return[normalizeRwandaDirectoryPhone(v).database_e164]}catch{return[]}});
  if(!listed.includes(number.database_e164))throw new Error('Complete phone absent from same directory entry');
  const now=new Date().toISOString();
  return {key:pharmacy.registry_entry_key,pharmacy_id:pharmacy.id,pharmacy_name:pharmacy.name,...number,decision:'candidate',note:note+' City-only or conflicting branch locality is not verified; candidate must remain inactive, with no WhatsApp, login or dispatch permission.',source_type:'ubipharm_directory',source_label:'Ubipharm Rwanda unresolved Kigali public-contact lead',source_url:url,source_observed_at:now,reviewed_at:now,evidence_sha256:createHash('sha256').update(dom).digest('hex'),dom,registered_locality:pharmacy.district+' / '+pharmacy.sector_cell_raw,whatsapp_verified:false};
}

export function recordKigaliDirectoryCandidate({key,...input}) {
  const register=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
  const pharmacy=register.find(p=>p.registry_entry_key===key);if(!pharmacy)throw new Error('Unknown register identity');
  const r=buildKigaliDirectoryCandidate({pharmacy,register,...input});
  const folder=resolve(evidenceDir,'phone-observations');mkdirSync(folder,{recursive:true});
  const path=resolve(folder,key+'-'+r.database_e164+'.json');
  if(existsSync(path))return {key,already_reviewed:true};
  writeFileSync(path,JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,e164:r.e164,decision:r.decision,whatsapp_verified:false};
}

export function recordDirectoryPhoneReview({key,...input}) {
  const pharmacies=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
  const pharmacy=pharmacies.find(p=>p.registry_entry_key===key);
  if(!pharmacy) throw new Error('Unknown register entry');
  if(pharmacies.filter(p=>identityText(p.name)===identityText(pharmacy.name)&&identityText(p.district)===identityText(pharmacy.district)).length!==1) throw new Error('Ambiguous branch identity requires separate evidence');
  const review=buildDirectoryPhoneReview({pharmacy,...input});
  const directory=resolve(evidenceDir,'phone-observations');
  mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,`${key}-${review.database_e164}.json`),JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,e164:review.e164,decision:review.decision,source_type:review.source_type,whatsapp_verified:false};
}

export function buildBusinessWebsitePhoneReview({pharmacy:p,url,branch_text,phone,note}) {
  const key=p?.registry_entry_key;
  const source=new URL(url),host=source.hostname.replace(/^www\./,'');
  const families={'pharmacieconseil.org':'CONSEIL','ritehealth.org':'RITE','mediasolpharma.com':'MEDIASOL','goodlife.rw':'GOODLIFE'};
  if(!p||!families[host]||!identityText(p.name).replaceAll(' ','').includes(families[host])||!['http:','https:'].includes(source.protocol))throw new Error('Reviewed official business family and source required');
  const lines=String(branch_text).split('\n').map(s=>s.trim()).filter(Boolean);
  if(identityText(lines[0])!==identityText(p.name)||typeof note!=='string'||note.length<60)throw new Error('Exact website branch heading and substantive review required');
  const number=normalizeRwandaBusinessPhone(phone);
  const listed=lines.flatMap(line=>{try{return [normalizeRwandaBusinessPhone(line.replace(/^Phone:\s*/i,'')).database_e164];}catch{return [];}});
  if(!listed.includes(number.database_e164))throw new Error('Complete phone must be present in the same branch section');
  const now=new Date().toISOString();
  const r={key,pharmacy_id:p.id,pharmacy_name:p.name,...number,decision:'verified_business',note:note+' Public business phone only; no WhatsApp capability, ownership or consent verification.',source_type:'official_business_website',source_label:'Official business branch website public contact review',source_url:url,source_observed_at:now,reviewed_at:now,evidence_sha256:createHash('sha256').update(branch_text).digest('hex'),dom:branch_text,whatsapp_verified:false};
  return r;
}

export function recordBusinessWebsitePhone({key,...input}) {
  const p=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies.find(p=>p.registry_entry_key===key);
  const r=buildBusinessWebsitePhoneReview({pharmacy:p,...input});
  const folder=resolve(evidenceDir,'phone-observations');mkdirSync(folder,{recursive:true});
  const file=resolve(folder,key+'-'+r.database_e164+'.json');
  if(existsSync(file))return {key,already_reviewed:true};
  writeFileSync(file,JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,phone:r.e164,production_updated:false};
}

export function buildOsmPhoneReview({observation,phone,note}) {
  if(observation?.source_type!=='openstreetmap'||observation.decision!=='verified'||typeof note!=='string'||note.length<50) throw new Error('Verified OSM branch evidence and review required');
  pointFromObservation(observation);
  const normalized=normalizeRwandaBusinessPhone(phone),tags=observation.osm_element.tags;
  const listed=['phone','contact:phone','contact:mobile'].flatMap(k=>String(tags[k]||'').split(/[;/]/)).flatMap(v=>{try{return [normalizeRwandaBusinessPhone(v.trim()).database_e164];}catch{return [];}});
  if(!listed.includes(normalized.database_e164)) throw new Error('Complete phone absent from exact OSM node contact tags');
  return {key:observation.registry_entry_key,pharmacy_id:observation.pharmacy_id,pharmacy_name:observation.pharmacy_name,...normalized,decision:'verified_business',note:note+' Source: '+observation.source_attribution,source_type:'openstreetmap',source_label:'OpenStreetMap public pharmacy contact review',source_url:observation.url,source_observed_at:observation.checked_at,reviewed_at:new Date().toISOString(),evidence_sha256:observation.dom_sha256,whatsapp_verified:false};
}

export function recordOsmPhoneReview({key,phone,note}) {
  if(!/^retail-2026-05-\d+$/.test(key)) throw new Error('Exact register key required');
  const observation=JSON.parse(readFileSync(resolve(evidenceDir,'osm-observations',key+'.json'),'utf8'));
  const review=buildOsmPhoneReview({observation,phone,note});
  const directory=resolve(evidenceDir,'phone-observations');mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,`${key}-${review.database_e164}.json`),JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,e164:review.e164,source:'OpenStreetMap',whatsapp_verified:false};
}

const quote=value=>value==null?'NULL':`'${String(value).replaceAll("'","''")}'`;
export function phonePlan(label) {
  if(!/^phones-[0-9]{3}$/.test(label)) throw new Error('Use phones-NNN');
  const reviews=readdirSync(resolve(evidenceDir,'phone-observations')).map(f=>JSON.parse(readFileSync(resolve(evidenceDir,'phone-observations',f),'utf8')));
  const live=query("SELECT id,pharmacy_id,channel,e164,active FROM med250_pharmacy_contacts WHERE channel IN ('phone','whatsapp')");
  const additions=reviews.filter(r=>!live.some(c=>c.pharmacy_id===r.pharmacy_id&&c.e164===r.database_e164));
  const statements=[];
  for(const r of additions){
    const conflicts=[...live.filter(c=>c.e164===r.database_e164&&c.pharmacy_id!==r.pharmacy_id&&c.active),...additions.filter(c=>c.database_e164===r.database_e164&&c.pharmacy_id!==r.pharmacy_id).map(c=>({id:null,pharmacy_id:c.pharmacy_id}))];
    const verified=r.decision==='verified_business'&&conflicts.length===0;
    const id=(r.source_type==='healthflix_directory'?'healthflix-phone-':r.source_type==='official_business_website'?'website-phone-':r.source_type==='rwanda_fda_roster'?'fda-phone-':r.source_type==='ubipharm_directory'?'directory-phone-':r.source_type==='openstreetmap'?'osm-phone-':'maps-phone-')+createHash('sha256').update(r.pharmacy_id+'\0'+r.database_e164).digest('hex').slice(0,32);
    r.inserted_id=id;r.verified_business=verified;r.conflicts=conflicts.map(c=>({id:c.id,pharmacy_id:c.pharmacy_id}));
    statements.push(`INSERT INTO med250_pharmacy_contacts(id,pharmacy_id,channel,e164,verified_at,source,source_url,source_reference,source_observed_at,login_enabled,dispatch_enabled,is_primary,active,created_at,updated_at,verified_by_label,verification_note) VALUES(${quote(id)},${quote(r.pharmacy_id)},'phone',${quote(r.database_e164)},${verified?quote(r.reviewed_at):'NULL'},${quote(r.source_label||'Google Maps one-by-one business contact review')},${quote(r.source_url)},${quote(r.evidence_sha256)},${quote(r.source_observed_at)},0,0,0,${verified?1:0},${quote(r.reviewed_at)},${quote(r.reviewed_at)},${verified?quote('Codex public business listing identity review'):'NULL'},${quote(r.note+' WhatsApp capability, recipient opt-in and login ownership have not been verified.')});`);
    statements.push(`INSERT INTO med250_audit_events(event_type,details,created_at) VALUES('pharmacy_public_phone_recorded',${quote(JSON.stringify(r))},${quote(r.reviewed_at)});`);
  }
  const sql=statements.join('\n')+'\n';
  const sha256=createHash('sha256').update(sql).digest('hex');
  writeFileSync(resolve(evidenceDir,`${label}.sql`),sql,{flag:'wx',mode:0o600});
  writeFileSync(resolve(evidenceDir,`${label}.json`),JSON.stringify({label,sha256,additions,reviews},null,2)+'\n',{flag:'wx',mode:0o600});
  return {label,sha256,new_phone_contacts:additions.length,verified_business:additions.filter(r=>r.verified_business).length,candidates:additions.filter(r=>!r.verified_business).length,already_saved:reviews.length-additions.length,whatsapp_identities_added:0};
}

export function applyPhonePlan(label,expectedHash) {
  if(!/^phones-[0-9]{3}$/.test(label)) throw new Error('Use phones-NNN');
  const file=resolve(evidenceDir,`${label}.sql`), sql=readFileSync(file,'utf8');
  const plan=JSON.parse(readFileSync(resolve(evidenceDir,`${label}.json`),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==expectedHash||plan.sha256!==expectedHash) throw new Error('Reviewed phone plan hash mismatch');
  const run=args=>execFileSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--env','production','--config',resolve(root,'wrangler.jsonc'),'--json'],{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024});
  const bookmark=run(['d1','time-travel','info','med250-production']);
  writeFileSync(resolve(evidenceDir,`${label}-bookmark.json`),bookmark,{flag:'wx',mode:0o600});
  const output=run(['d1','execute','med250-production','--remote','--file',file]);
  writeFileSync(resolve(evidenceDir,`${label}-apply.txt`),output,{flag:'wx',mode:0o600});
  const rows=query(`SELECT id,pharmacy_id,channel,e164,active,verified_at,login_enabled,dispatch_enabled FROM med250_pharmacy_contacts WHERE id IN (${plan.additions.map(r=>quote(r.inserted_id)).join(',')});`);
  for(const r of plan.additions){
    const row=rows.find(c=>c.id===r.inserted_id);
    if(!row||row.pharmacy_id!==r.pharmacy_id||row.e164!==r.database_e164||row.channel!=='phone'||row.login_enabled||row.dispatch_enabled||row.active!==Number(r.verified_business)||Boolean(row.verified_at)!==r.verified_business) throw new Error('Phone readback mismatch; do not repeat import');
  }
  writeFileSync(resolve(evidenceDir,`${label}-readback.json`),JSON.stringify(rows,null,2)+'\n',{flag:'wx',mode:0o600});
  return {saved:rows.length,verified_business:rows.filter(r=>r.active).length,inactive_candidates:rows.filter(r=>!r.active).length,whatsapp_or_login_enabled:0};
}

if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]==='record') console.log(JSON.stringify(recordPhoneReview(JSON.parse(process.argv[3])),null,2));
  else if(process.argv[2]==='plan') console.log(JSON.stringify(phonePlan(process.argv[3]),null,2));
  else if(process.argv[2]==='apply') console.log(JSON.stringify(applyPhonePlan(process.argv[3],process.argv[4]),null,2));
  else throw new Error('Use plan phones-NNN');
}
