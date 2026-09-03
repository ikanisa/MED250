import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDashboardCsv } from './dashboard-recovery.mjs';
import { evidenceDir, root, query } from './pharmacy-coordinate-research.mjs';
import { normalizeRwandaBusinessMobile } from './pharmacy-contact-research.mjs';

const norm=value=>String(value??'').normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g,'');
const quote=value=>value==null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const phones=value=>String(value??'').split(/[;|,\n]/).map(v=>v.trim()).filter(Boolean).map(v=>normalizeRwandaBusinessMobile(v).database_e164);
export function exactRegisterLink(raw,link,pharmacy) {
  return Boolean(link&&pharmacy&&String(raw.source_serial)===String(link.december_source_serial)
    &&norm(raw.name)===norm(link.december_name)&&norm(raw.district)===norm(link.december_district)
    &&norm(raw.sector)===norm(link.december_sector)&&norm(raw.cell)===norm(link.december_cell)
    &&pharmacy.registry_entry_key===link.current_registry_entry_key&&norm(pharmacy.name)===norm(link.current_name)
    &&norm(pharmacy.district)===norm(link.current_district)&&norm(pharmacy.sector_cell_raw)===norm(link.current_sector_cell_raw)
    &&Number(link.registry_match_score)>=0.98&&Number(link.name_score)>=0.98
    &&['district_match','sector_match','cell_match'].every(k=>String(link[k])==='true')
    &&(Number(link.registry_match_margin)>=0.05||String(link.professional_registration_match)==='true'));
}

export function buildCorrectionPlan({contacts,known_numbers,permissions,actors},pharmacies,rawRows,links,now) {
  const corrections=[],review=[];
  for(const c of contacts.filter(c=>c.channel==='whatsapp'&&c.active===1)){
    const k=known_numbers.find(k=>k.e164===c.e164);
    if(!k||JSON.parse(k.source_evidence).governing_tier!==200||!c.source.endsWith(':source_verified_public_mobile')) continue;
    const sourceRows=rawRows.filter(r=>phones(r.public_phone_numbers).includes(c.e164));
    const matches=sourceRows.map(raw=>{
      const candidates=links.filter(l=>String(l.december_source_serial)===String(raw.source_serial));
      if(candidates.length!==1) return null;
      const link=candidates[0],p=pharmacies.find(p=>p.registry_entry_key===link.current_registry_entry_key);
      return exactRegisterLink(raw,link,p)?{raw,link,pharmacy_id:p.id}:null;
    });
    const ids=[...new Set(matches.filter(Boolean).map(m=>m.pharmacy_id))];
    if(matches.length&&matches.every(Boolean)&&ids.length===1&&ids[0]===c.pharmacy_id) continue;
    if(!matches.length||matches.some(m=>!m)||ids.length!==1){review.push({contact_id:c.id,e164:'+'+c.e164,reason:'No unambiguous exact name/locality crosswalk',candidate_ids:ids});continue;}
    const grant=permissions.find(p=>p.contact_id===c.id);
    if(c.login_enabled||actors.some(a=>a.e164===c.e164)||grant?.claimed_at||k.pharmacy_id!==c.pharmacy_id){review.push({contact_id:c.id,e164:'+'+c.e164,reason:'Identity, login or consumed-permission state requires separate review',candidate_ids:ids});continue;}
    const sourceUrls=[...new Set(matches.flatMap(m=>String(m.raw.phone_evidence_url??'').split(/;\s*/)).filter(url=>/^https:\/\/(monitoring\.rwandafda\.gov\.rw|www\.mmi\.gov\.rw)\//.test(url)))];
    if(!sourceUrls.length){review.push({contact_id:c.id,e164:'+'+c.e164,reason:'No authoritative public phone source URL',candidate_ids:ids});continue;}
    corrections.push({contact:c,known_number:k,permission:grant??null,correct_pharmacy_id:ids[0],correct_pharmacy_name:pharmacies.find(p=>p.id===ids[0]).name,source_urls:sourceUrls,matches:matches.map(m=>({december_serial:m.raw.source_serial,december_name:m.raw.name,december_locality:[m.raw.district,m.raw.sector,m.raw.cell].join(' / '),current_registry_key:m.link.current_registry_entry_key,current_name:m.link.current_name,current_locality:[m.link.current_district,m.link.current_sector_cell_raw].join(' / '),match_score:m.link.registry_match_score,match_margin:m.link.registry_match_margin})),reviewed_at:now});
  }
  return {schema:'med250-exact-contact-rebinding-v1',created_at:now,corrections,review,policy:'Correct exact name and locality associations only; disable dispatch and login, revoke unclaimed misbound permissions, preserve historical messages and attestations. No new permission or WhatsApp verification is created.'};
}

export function correctionSql(plan) {
  const sql=[];
  for(const r of plan.corrections){
    const c=r.contact,at=quote(r.reviewed_at),cid=quote(c.id),phone=quote(c.e164),old=quote(c.pharmacy_id),next=quote(r.correct_pharmacy_id);
    sql.push(`SELECT CASE WHEN EXISTS(SELECT 1 FROM med250_pharmacy_contacts WHERE id=${cid} AND pharmacy_id=${old} AND e164=${phone} AND updated_at=${quote(c.updated_at)} AND active=1 AND login_enabled=0) AND EXISTS(SELECT 1 FROM med250_known_pharmacy_numbers WHERE e164=${phone} AND pharmacy_id=${old} AND updated_at=${quote(r.known_number.updated_at)}) AND NOT EXISTS(SELECT 1 FROM med250_actors WHERE e164=${phone}) AND NOT EXISTS(SELECT 1 FROM med250_partner_initial_permissions WHERE contact_id=${cid} AND claimed_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM med250_dispatch_outbox WHERE recipient_e164=${phone} AND status IN ('pending','claimed','enqueued','sending','retry','provider_send_unknown')) THEN 1 ELSE json('STALE_CONTACT_IDENTITY') END;`);
    sql.push(`UPDATE med250_partner_initial_permissions SET revoked_at=${at} WHERE contact_id=${cid} AND revoked_at IS NULL AND claimed_at IS NULL;`);
    sql.push(`UPDATE med250_pharmacy_contacts SET pharmacy_id=${next},login_enabled=0,dispatch_enabled=0,is_primary=0,source_url=${quote(r.source_urls.join('; '))},source_reference=${quote('Exact December-to-May register crosswalk: '+r.matches.map(m=>m.december_serial+' -> '+m.current_registry_key).join('; '))},verified_by_label='MED250 exact name and locality association correction',verification_note='Original public mobile evidence retained. Incorrect register-row association corrected. Dispatch and login disabled; misbound initial permission revoked pending a correctly scoped permission.',updated_at=${at} WHERE id=${cid};`);
    const evidence={policy:'exact_name_district_sector_cell_crosswalk',governing_tier:200,candidate_pharmacy_ids:[r.correct_pharmacy_id],matches:r.matches,authoritative_source_urls:r.source_urls,original_evidence_sha256:createHash('sha256').update(r.known_number.source_evidence).digest('hex'),whatsapp_verification_created:false,dispatch_permission_created:false};
    sql.push(`UPDATE med250_known_pharmacy_numbers SET pharmacy_id=${next},source='governed_registry_crosswalk_correction',source_evidence=${quote(JSON.stringify(evidence))},reviewed_at=${at},updated_at=${at} WHERE e164=${phone};`);
    sql.push(`INSERT INTO med250_audit_events(event_type,details,created_at) VALUES('pharmacy_contact_association_corrected',${quote(JSON.stringify(r))},${at});`);
  }
  return sql.join('\n')+'\n';
}

export function makePlan() {
  const csv=path=>parseDashboardCsv(readFileSync(resolve(root,path),'utf8')).rows.map(r=>r.payload);
  const snapshot=JSON.parse(readFileSync(resolve(evidenceDir,'contact-repair-before.json'),'utf8'));
  const pharmacies=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
  const plan=buildCorrectionPlan(snapshot,pharmacies,csv('work/pharmacy-contact-candidates-merged.csv'),csv('work/pharmacy-contact-registry-matches.csv'),new Date().toISOString());
  const sql=correctionSql(plan);plan.sql_sha256=createHash('sha256').update(sql).digest('hex');
  writeFileSync(resolve(evidenceDir,'contact-association-repair-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(resolve(evidenceDir,'contact-association-repair.sql'),sql,{flag:'wx',mode:0o600});
  return {exact_corrections:plan.corrections.length,manual_review:plan.review.length,currently_mapped_destinations_affected:plan.corrections.filter(c=>pharmacies.find(p=>p.id===c.contact.pharmacy_id).dispatch_enabled===1).length,sha256:plan.sql_sha256};
}

export function verifyCorrections() {
  const plan=JSON.parse(readFileSync(resolve(evidenceDir,'contact-association-repair-plan.json'),'utf8'));
  const contacts=query('SELECT * FROM med250_pharmacy_contacts'),numbers=query('SELECT * FROM med250_known_pharmacy_numbers'),permissions=query('SELECT * FROM med250_partner_initial_permissions');
  const audits=query("SELECT id,details FROM med250_audit_events WHERE event_type='pharmacy_contact_association_corrected'");
  for(const r of plan.corrections){
    const c=contacts.find(c=>c.id===r.contact.id),k=numbers.find(k=>k.e164===r.contact.e164),g=permissions.find(p=>p.contact_id===r.contact.id);
    if(c?.pharmacy_id!==r.correct_pharmacy_id||c.e164!==r.contact.e164||c.dispatch_enabled||c.login_enabled||k?.pharmacy_id!==r.correct_pharmacy_id||(r.permission&&!g?.revoked_at)||!audits.some(a=>JSON.parse(a.details).contact.id===r.contact.id)) throw new Error(`Correction readback mismatch: ${r.contact.id}; inspect before retrying`);
  }
  const result={checked_at:new Date().toISOString(),corrected:plan.corrections.length,remaining_manual_review:plan.review.length,misbound_permissions_revoked:plan.corrections.filter(r=>r.permission).length,contacts,known_numbers:numbers,permissions,audit_ids:audits.map(a=>a.id)};
  writeFileSync(resolve(evidenceDir,'contact-association-repair-readback.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return {corrected:result.corrected,misbound_permissions_revoked:result.misbound_permissions_revoked,remaining_manual_review:result.remaining_manual_review,readback_verified:true};
}

export function applyCorrections(expectedHash){
  const file=resolve(evidenceDir,'contact-association-repair.sql'),sql=readFileSync(file,'utf8'),plan=JSON.parse(readFileSync(resolve(evidenceDir,'contact-association-repair-plan.json'),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==expectedHash||plan.sql_sha256!==expectedHash) throw new Error('Exact reviewed SQL hash required');
  const run=args=>execFileSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--env','production','--config',resolve(root,'wrangler.jsonc'),'--json'],{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024});
  writeFileSync(resolve(evidenceDir,'contact-association-repair-bookmark.json'),run(['d1','time-travel','info','med250-production']),{flag:'wx',mode:0o600});
  const output=run(['d1','execute','med250-production','--remote','--file',file]);
  writeFileSync(resolve(evidenceDir,'contact-association-repair-apply.txt'),output,{flag:'wx',mode:0o600});
  return verifyCorrections();
}
if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  console.log(JSON.stringify(process.argv[2]==='apply'?applyCorrections(process.argv[3]):process.argv[2]==='verify'?verifyCorrections():makePlan(),null,2));
}
