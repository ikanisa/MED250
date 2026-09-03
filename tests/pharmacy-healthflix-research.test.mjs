import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHealthflixPhone} from '../scripts/pharmacy-healthflix-research.mjs';

test('directory phones are tied to one exact business and its own contact field',()=>{
  const pharmacy={id:'retail-2026-05-10',registry_entry_key:'retail-2026-05-10',name:'TREAH PHARMACY LTD',district:'RWAMAGANA'};
  const input={pharmacy,register:[pharmacy],evidence:{url:'https://healthflix.rw/listing/treah-pharmacy-ltd/',name:'TREAH PHARMACY LTD',phone_text:'+250722047557',location:'Between Rwamagana Police Ground and St Theresa Clinic',checked_at:'2026-09-02T17:00:00Z',evidence_id:'a'.repeat(64)},phone:'+250722047557',decision:'verified_business',note:'Exact named current business and Rwamagana locality agree with the register and retained independent directory evidence.'};
  const r=buildHealthflixPhone(input);
  assert.equal(r.whatsapp_verified,false);
  assert.equal(r.source_type,'healthflix_directory');
  assert.equal(r.database_e164,'250722047557');
  assert.equal(buildHealthflixPhone({...input,evidence:{...input.evidence,phone_text:'+250722047557 +250788456665'}}).database_e164,'250722047557');
  assert.throws(()=>buildHealthflixPhone({...input,evidence:{...input.evidence,phone_text:'+2507220475570'}}),/Complete/);
  assert.throws(()=>buildHealthflixPhone({...input,evidence:{...input.evidence,name:'OTHER PHARMACY'}}),/Unique/);
  assert.throws(()=>buildHealthflixPhone({...input,register:[pharmacy,{...pharmacy,id:'another'}]}),/Unique/);
  assert.throws(()=>buildHealthflixPhone({...input,evidence:{...input.evidence,phone_text:'+250722\n047557'}}),/Complete/);
  assert.throws(()=>buildHealthflixPhone({...input,evidence:{...input.evidence,location:'Kigali'}}),/district/);
  assert.equal(buildHealthflixPhone({...input,decision:'candidate',evidence:{...input.evidence,location:'Kigali'}}).decision,'candidate');
});
