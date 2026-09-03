import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrectionPlan, correctionSql, exactRegisterLink } from '../scripts/pharmacy-contact-association-repair.mjs';

const raw={source_serial:'4',name:'VAN PHARMACY LTD',district:'KAYONZA',sector:'MUKARANGE',cell:'NYAGATOVU',public_phone_numbers:'+250788853031',phone_evidence_url:'https://monitoring.rwandafda.gov.rw/roster.pdf'};
const target={id:'retail-2026-05-5',registry_entry_key:'retail-2026-05-5',name:raw.name,district:raw.district,sector_cell_raw:'MUKARANGE NYAGATOVU'};
const link={december_source_serial:'4',december_name:raw.name,december_district:raw.district,december_sector:raw.sector,december_cell:raw.cell,current_registry_entry_key:target.id,current_name:target.name,current_district:target.district,current_sector_cell_raw:target.sector_cell_raw,registry_match_score:'1.000',name_score:'1.000',registry_match_margin:'0.293',district_match:'true',sector_match:'true',cell_match:'true',professional_registration_match:'true'};
const contact={id:'contact1',pharmacy_id:'retail-2026-05-4',channel:'whatsapp',e164:'250788853031',source:'MED250 governed registry recovery:source_verified_public_mobile',active:1,login_enabled:0,updated_at:'2026-08-23T00:00:00Z'};
const before={contacts:[contact],known_numbers:[{e164:contact.e164,pharmacy_id:contact.pharmacy_id,source_evidence:'{"governing_tier":200}',updated_at:contact.updated_at}],permissions:[{contact_id:contact.id,claimed_at:null}],actors:[]};
const run=(snap=before,rows=[raw],links=[link],pharmacies=[target])=>buildCorrectionPlan(snap,pharmacies,rows,links,'2026-09-02T00:00:00Z');
test('links by reviewed pharmacy name and locality, never by coincident row number',()=>{
  assert.equal(exactRegisterLink(raw,link,target),true);
  const plan=run();assert.equal(plan.corrections.length,1);assert.equal(plan.corrections[0].correct_pharmacy_id,target.id);
});
test('rejects wrong locality, weak matches, duplicate links and multiple target branches',()=>{
  assert.equal(exactRegisterLink(raw,{...link,current_district:'GASABO'},target),false);
  assert.equal(exactRegisterLink(raw,{...link,registry_match_score:'0.90'},target),false);
  assert.equal(run(before,[raw],[link,link]).corrections.length,0);
  assert.equal(run(before,[{...raw,name:'OTHER'}]).corrections.length,0);
});
test('does not rebind a login identity, existing actor, higher-authority mapping or used grant',()=>{
  for(const changed of [{...before,contacts:[{...contact,login_enabled:1}]},{...before,actors:[{e164:contact.e164}]},{...before,permissions:[{contact_id:contact.id,claimed_at:'2026-09-01'}]},{...before,known_numbers:[{...before.known_numbers[0],source_evidence:'{"governing_tier":300}'}]}]) assert.equal(run(changed).corrections.length,0);
});
test('corrected associations cannot silently inherit wrongly scoped dispatch permission',()=>{
  const sql=correctionSql(run());
  assert.match(sql,/login_enabled=0,dispatch_enabled=0,is_primary=0/);
  assert.match(sql,/UPDATE med250_partner_initial_permissions SET revoked_at=/);
  assert.doesNotMatch(sql,/DELETE|DROP|INSERT INTO med250_partner_initial_permissions/);
  assert.match(sql,/NOT EXISTS\(SELECT 1 FROM med250_dispatch_outbox/);
  assert.match(sql,/pharmacy_contact_association_corrected/);
});
