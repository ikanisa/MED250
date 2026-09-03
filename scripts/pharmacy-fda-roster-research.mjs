import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {evidenceDir,root,pointFromMapsUrl} from './pharmacy-coordinate-research.mjs';
import {osmName} from './pharmacy-osm-research.mjs';
import {normalizeRwandaDirectoryPhone} from './pharmacy-contact-research.mjs';

export const rosterNumbers=cell=>[...new Set(String(cell).split(/[;&,\/]|\s+(?=\+?\d{9,12}\b)/).flatMap(v=>{try{return [normalizeRwandaDirectoryPhone(v.trim()).database_e164];}catch{return [];}}))];
const norm=s=>String(s??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function matchRosterBranch(row,pharmacies){
  const fields=row.location.split(',').map(s=>s.trim());
  return pharmacies.filter(p=>{
    if(osmName(row.name)!==osmName(p.name))return false;
    const i=fields.findIndex(f=>norm(f)===norm(p.district));
    if(i<0)return false;
    const sector=norm(p.sector_cell_raw.split(/\s+/)[0]);
    const observed=String(fields[i+1]||'').toUpperCase().split(/[\s/]+/)[0];
    return norm(observed)===sector;
  });
}
export function rosterEvidence(){
  const data=JSON.parse(readFileSync(resolve(evidenceDir,'fda-roster-tables-v2.json'),'utf8'));
  const manifest=JSON.parse(readFileSync(resolve(root,'data/imports/rwanda-fda-pharmacy-contacts-manifest.json'),'utf8'));
  for(const source of data.sources){
    if(source.sha256!==manifest.roster_sources[source.document]?.sha256||source.recognized_table_pages!==source.pages)throw new Error('Incomplete or changed source PDF');
    const url=new URL(manifest.roster_sources[source.document].url);
    if(url.hostname!=='monitoring.rwandafda.gov.rw'||!url.pathname.endsWith('.pdf'))throw new Error('Unexpected roster authority');
  }
  return {data,manifest};
}
export async function verifyRosterSourcesLive(){
  const {manifest}=rosterEvidence(),results=[];
  const file=resolve(evidenceDir,'fda-roster-live-source-check.json');
  if(existsSync(file))throw new Error('Live source verification already retained');
  for(const [document,s] of Object.entries(manifest.roster_sources)){
    const response=await fetch(s.url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('FDA source HTTP '+response.status+' '+document);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length>20*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('Invalid source PDF');
    const sha256=createHash('sha256').update(bytes).digest('hex');
    results.push({document,url:s.url,sha256,expected_sha256:s.sha256,matches:sha256===s.sha256});
  }
  const result={checked_at:new Date().toISOString(),results,all_match:results.every(r=>r.matches)};
  writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}
export function rosterPhoneLeads(){
  const {data,manifest}=rosterEvidence();
  const pharmacies=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
  const seen=new Set(),leads=[],held=[];
  for(const row of data.rows){
    const phones=rosterNumbers(row.phone_cell),matches=matchRosterBranch(row,pharmacies);
    if(matches.length!==1){held.push({row,reason:matches.length?'duplicate_current_branch':'no_exact_current_name_district_sector',candidate_keys:matches.map(p=>p.registry_entry_key)});continue;}
    const p=matches[0],source=manifest.roster_sources[row.document];
    for(const phone of phones){const k=p.registry_entry_key+'-'+phone;if(seen.has(k))continue;seen.add(k);leads.push({key:p.registry_entry_key,pharmacy_id:p.id,pharmacy_name:p.name,phone,registered:p.district+' / '+p.sector_cell_raw,row,source_url:source.url,source_sha256:source.sha256});}
  }
  return {leads,held};
}
export function recordRosterPhone(lead,{decision='verified_business',note='Exact source row and current branch identity reviewed.'}={}){
  if(!['verified_business','candidate'].includes(decision)||typeof note!=='string'||note.length<40)throw new Error('Explicit business or candidate review required');
  const live=JSON.parse(readFileSync(resolve(evidenceDir,'fda-roster-live-source-check.json'),'utf8'));
  if(!live.all_match)throw new Error('Source PDF changed; re-extract and review before any contact import');
  // Resolve again from checked source tables rather than trusting caller-supplied identity fields.
  const r=rosterPhoneLeads().leads.find(r=>r.key===lead.key&&r.phone===lead.phone);
  if(!r)throw new Error('Exact roster branch evidence missing');
  const number=normalizeRwandaDirectoryPhone(r.phone),checked_at=new Date().toISOString();
  const file=resolve(evidenceDir,'phone-observations',r.key+'-'+number.database_e164+'.json');
  if(existsSync(file))return {key:r.key,already_reviewed:true};
  const dom=JSON.stringify({row:r.row,source_pdf_sha256:r.source_sha256});
  const review={key:r.key,pharmacy_id:r.pharmacy_id,pharmacy_name:r.pharmacy_name,...number,decision,note:'Exact current licensed pharmacy name, district and sector matched to the same table row in the July-September 2026 Rwanda FDA retail duty roster. Original page(s): '+r.row.pages.join(', ')+'. '+note+' Public business phone only; current ownership and WhatsApp capability, consent and reachability are not established.',source_type:'rwanda_fda_roster',source_label:'Rwanda FDA July-September 2026 public business contact review',source_url:r.source_url,source_observed_at:checked_at,reviewed_at:checked_at,evidence_sha256:createHash('sha256').update(dom).digest('hex'),dom,registered_locality:r.registered,whatsapp_verified:false};
  mkdirSync(resolve(evidenceDir,'phone-observations'),{recursive:true});
  writeFileSync(file,JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key:r.key,phone:review.e164,whatsapp_verified:false,production_updated:false};
}

export function validateRosterBoundaryResolution(p,o,b,row){
  const point=pointFromMapsUrl(o.url),actual=b.query_result?.features?.length===1?b.query_result.features[0].attributes:null;
  if(!actual||o.decision!=='review'||/(permanently|temporarily) closed/i.test(o.dom)||b.point.latitude!==point.latitude||b.point.longitude!==point.longitude||norm(actual.district)!==norm(p.district))throw new Error('Unchanged open-business point and district required');
  const parts=row.location.split(',').map(s=>s.trim()),i=parts.findIndex(s=>norm(s)===norm(p.district));
  const expected=parts[i+1],original=p.sector_cell_raw.split(/\s+/)[0];
  if(i<0||norm(expected)!==norm(actual.sector)||norm(original).length!==norm(expected).length||[...norm(original)].filter((c,i)=>c!==norm(expected)[i]).length!==1)throw new Error('Only a single-letter sector spelling discrepancy can be reconciled');
  if(norm(parts[i+2])!==norm(p.sector_cell_raw.split(/\s+/).slice(1).join(' ')))throw new Error('Exact cell corroboration required');
  const correctedName=p.name.toUpperCase().replace(original.toUpperCase(),expected.toUpperCase());
  if(osmName(correctedName)!==osmName(row.name))throw new Error('Current source pharmacy and branch identity mismatch');
  return {point,original_sector:original,corroborated_sector:actual.sector};
}
export function resolveRosterBoundaryReview(key,document,rosterName,note){
  if(!/^retail-2026-05-\d+$/.test(key)||typeof note!=='string'||note.length<80)throw new Error('Explicit branch and source rationale required');
  const {data,manifest}=rosterEvidence();
  const live=JSON.parse(readFileSync(resolve(evidenceDir,'fda-roster-live-source-check.json'),'utf8'));if(!live.all_match)throw new Error('Live source hash mismatch');
  const rows=data.rows.filter(r=>r.document===document&&r.name===rosterName);
  if(rows.length!==1)throw new Error('One explicitly identified source table row required');
  const p=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies.find(p=>p.registry_entry_key===key);
  const o=JSON.parse(readFileSync(resolve(evidenceDir,'observations',key+'.json'),'utf8'));
  const b=JSON.parse(readFileSync(resolve(evidenceDir,'boundary-checks',key+'.json'),'utf8'));
  if(o.pharmacy_id!==p.id)throw new Error('Register identity mismatch');
  const result=validateRosterBoundaryResolution(p,o,b,rows[0]),source=manifest.roster_sources[document];
  const checked_at=new Date().toISOString();
  const resolved={...b,source_roster:source,roster_row:rows[0],...result,verified_against_current_roster:true,match_basis:'Single-letter register sector spelling reconciled by identical FDA roster cell and Ministry boundary; original source retained',checked_at};
  const observation={...o,decision:'verified',coordinates:result.point,previous_decision:o.decision,checked_at,contact_identity_verified:false,note:o.note+' Resolution: '+note+' Original sector '+result.original_sector+'; corroborated sector '+result.corroborated_sector+'. Current FDA roster '+source.url+' pages '+rows[0].pages.join(', ')+'. Original register fields and failed literal boundary check are retained.'};
  for(const folder of ['roster-boundary-resolutions','boundary-resolutions'])mkdirSync(resolve(evidenceDir,folder),{recursive:true});
  writeFileSync(resolve(evidenceDir,'roster-boundary-resolutions',key+'.json'),JSON.stringify(resolved,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(resolve(evidenceDir,'boundary-resolutions',key+'.json'),JSON.stringify(observation,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,...result,production_updated:false};
}
