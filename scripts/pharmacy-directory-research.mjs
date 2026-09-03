import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidenceDir } from './pharmacy-coordinate-research.mjs';
import { buildDirectoryPhoneReview } from './pharmacy-contact-research.mjs';

// Only accepts visible entries captured through the controlled browser.
// No network scraping, Maps coordinates, messaging or database mutation here.
export function recordDirectoryPage({url,entries}) {
  const parsed=new URL(url);
  if(parsed.origin!=='https://rwanda.ubipharm.com'||parsed.pathname!=='/en/Spec-annulist,AnnuairePharmacies') throw new Error('Unsupported source');
  const page=Number(parsed.searchParams.get('pageannu')||1);
  if(!Number.isInteger(page)||page<1||page>34||!Array.isArray(entries)||entries.length<1||entries.length>20||entries.some(e=>typeof e!=='string'||!e.trim())) throw new Error('Invalid visible directory page');
  const directory=resolve(evidenceDir,'directory-pages');
  mkdirSync(directory,{recursive:true});
  const payload={url,page,checked_at:new Date().toISOString(),entries};
  const bytes=JSON.stringify(payload,null,2)+'\n';
  writeFileSync(resolve(directory,`ubipharm-${String(page).padStart(2,'0')}.json`),bytes,{flag:'wx',mode:0o600});
  writeFileSync(resolve(directory,`ubipharm-${String(page).padStart(2,'0')}.sha256`),createHash('sha256').update(bytes).digest('hex')+'\n',{flag:'wx',mode:0o600});
  return {page,entries:entries.length};
}

export function directoryMatches() {
  const directory=resolve(evidenceDir,'directory-pages');
  const pharmacies=JSON.parse(readFileSync(resolve(evidenceDir,'before.json'),'utf8')).pharmacies;
  const current=JSON.parse(readFileSync(resolve(evidenceDir,'checkpoint-003.json'),'utf8')).pharmacies;
  const matches=[];
  for(const file of readdirSync(directory).filter(f=>f.endsWith('.json'))) {
    const source=JSON.parse(readFileSync(resolve(directory,file),'utf8'));
    for(const dom of source.entries) {
      const phones=dom.split('\n').filter(l=>/^T[ée]l\s*:/i.test(l.trim())).flatMap(l=>l.replace(/^\s*T[ée]l\s*:\s*/i,'').split('/')).map(p=>p.trim());
      for(const phone of phones) {
        const candidates=pharmacies.flatMap(pharmacy=>{
          try { return [buildDirectoryPhoneReview({pharmacy,url:source.url,dom,phone,decision:'candidate',note:'Candidate exact-name and district cross-match only; individual identity review still required before saving a contact.'})]; } catch { return []; }
        });
        if(candidates.length!==1) continue;
        const r=candidates[0];
        const existing=JSON.parse(current.find(p=>p.id===r.pharmacy_id).contacts_json).some(c=>c.e164===r.database_e164);
        const reviewed=existsSync(resolve(evidenceDir,'phone-observations',`${r.key}-${r.database_e164}.json`));
        matches.push({page:source.page,key:r.key,name:r.pharmacy_name,locality:r.registered_locality,phone:r.e164,already_in_checkpoint:existing,already_reviewed:reviewed,dom,source_url:source.url});
      }
    }
  }
  return matches;
}
