import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRwandaBusinessMobile, normalizeRwandaBusinessPhone, normalizeRwandaDirectoryPhone, buildDirectoryPhoneReview, buildBusinessWebsitePhoneReview, buildKigaliDirectoryCandidate } from '../scripts/pharmacy-contact-research.mjs';
test('official website contacts require the exact business family and branch section',()=>{
  const input={pharmacy:{id:'p',registry_entry_key:'retail-2026-05-91',name:'PHARMACIE CONSEIL - KACYIRU'},url:'https://www.pharmacieconseil.org/contact.php',branch_text:'PHARMACIE CONSEIL KACYIRU\nLocation: KG541 Street\nPhone:\n+(250) 788381259',phone:'+250788381259',note:'Official branch contact page matches the exact licensed branch and street; not the downtown phone.'};
  const r=buildBusinessWebsitePhoneReview(input);
  assert.equal(r.source_type,'official_business_website');
  assert.equal(r.database_e164,'250788381259');
  assert.equal(r.whatsapp_verified,false);
  assert.throws(()=>buildBusinessWebsitePhoneReview({...input,url:'https://example.com/contact'}),/source/);
  assert.throws(()=>buildBusinessWebsitePhoneReview({...input,branch_text:input.branch_text.replace('KACYIRU','NYARUTARAMA')}),/heading/);
  assert.throws(()=>buildBusinessWebsitePhoneReview({...input,phone:'+250788380066'}),/same branch/);
  assert.throws(()=>buildBusinessWebsitePhoneReview({...input,branch_text:'PHARMACIE CONSEIL KACYIRU\n+250788\n381259'}),/Complete/);
});
test('normalizes complete local, international and spaced Rwanda mobiles',()=>{
  for(const value of ['0787 206 998','+250787206998','250787206998','00250 787 206 998','(+250) 787-206-998']) assert.deepEqual(normalizeRwandaBusinessMobile(value),{e164:'+250787206998',database_e164:'250787206998'});
});
test('rejects placeholders, partial numbers, landlines, other countries and arbitrary suffixes',()=>{
  for(const value of ['+2507xxxxx','+25078720699','+2507872069980','+254787206998','+250280123001','0787 206 998 ext 2','not a number','+250747123456','787206998']) assert.throws(()=>normalizeRwandaBusinessMobile(value));
});
test('includes the RURA allocated 077 mobile block',()=>assert.equal(normalizeRwandaBusinessMobile('0771 234 567').e164,'+250771234567'));
test('keeps fixed business numbers separate from mobile and WhatsApp',()=>{
  assert.deepEqual(normalizeRwandaBusinessPhone('+250252572297'),{e164:'+250252572297',database_e164:'250252572297',number_type:'fixed_line'});
  assert.equal(normalizeRwandaBusinessPhone('0280 123 000').number_type,'fixed_line');
  assert.equal(normalizeRwandaBusinessPhone('0787 206 998').number_type,'mobile');
  for(const value of ['+250212123456','252572297','+25025257229','+251252572297']) assert.throws(()=>normalizeRwandaBusinessPhone(value));
});

const directoryInput={pharmacy:{id:'test',registry_entry_key:'retail-test',name:'CIVITAS PHARMACY LTD',district:'NYARUGENGE',sector_cell_raw:'KIGALI KIGALI'},url:'https://rwanda.ubipharm.com/en/Spec-annulist,AnnuairePharmacies?pageannu=5',dom:'CIVITAS PHARMACY LTD\nView on the map\nNYARUGENGE\nKIGALI\nTél: 0786899370',phone:'0786899370',decision:'verified_business',note:'Exact registered name and district match the single visible public directory business entry.'};
test('city-only directory candidates cannot become verified and reject ambiguous identities',()=>{
  const input={...directoryInput,register:[directoryInput.pharmacy],dom:'CIVITAS PHARMACY LTD\nView on the map\nKIGALI\nTél: 0786899370',note:'Exact unique business name but city-only address does not establish the registered branch. Keep inactive pending branch verification.'};
  const r=buildKigaliDirectoryCandidate(input);
  assert.equal(r.decision,'candidate');
  assert.equal(r.whatsapp_verified,false);
  assert.equal(r.e164,'+250786899370');
  assert.throws(()=>buildKigaliDirectoryCandidate({...input,register:[...input.register,{...directoryInput.pharmacy,id:'other'}]}),/Unique/);
  assert.throws(()=>buildKigaliDirectoryCandidate({...input,dom:input.dom.replace('CIVITAS','OTHER')}),/Exact/);
  assert.throws(()=>buildKigaliDirectoryCandidate({...input,pharmacy:{...input.pharmacy,district:'HUYE'}}),/Kigali/);
  assert.throws(()=>buildKigaliDirectoryCandidate({...input,dom:input.dom.replace('0786899370','078689\n9370')}),/Complete/);
  assert.throws(()=>buildKigaliDirectoryCandidate({...input,url:'https://example.com'}),/source/);
});
test('directory source remains phone-only with source-specific evidence',()=>{
  const r=buildDirectoryPhoneReview(directoryInput);
  assert.equal(r.e164,'+250786899370');
  assert.equal(r.source_type,'ubipharm_directory');
  assert.equal(r.whatsapp_verified,false);
  assert.equal(r.dom,directoryInput.dom);
  assert.equal(r.evidence_sha256.length,64);
});
test('directory contact rejects name, branch, locality and domain mismatches',()=>{
  for(const change of [
    {dom:directoryInput.dom.replace('CIVITAS','VINE')},
    {dom:directoryInput.dom.replace('PHARMACY LTD','PHARMACY BRANCH LTD')},
    {dom:directoryInput.dom.replace('NYARUGENGE','GASABO')},
    {url:'https://rwanda.ubipharm.com.evil.test/en/Spec-annulist,AnnuairePharmacies'},
    {url:'https://rwanda.ubipharm.com/en/Contact'},
    {phone:'0786899371'},
    {dom:directoryInput.dom.replace('Tél: 0786899370','Tél: 078689937')},
    {dom:directoryInput.dom+'\nPermanently closed'}
  ]) assert.throws(()=>buildDirectoryPhoneReview({...directoryInput,...change}));
});
test('directory contact never joins digits across fields into a phone',()=>{
  assert.throws(()=>buildDirectoryPhoneReview({...directoryInput,dom:directoryInput.dom.replace('Tél: 0786899370','Tél: 078689\n9370')}));
});
test('Rwanda-specific directory accepts complete national numbers without weakening general normalization',()=>{
  assert.equal(normalizeRwandaDirectoryPhone('786899370').e164,'+250786899370');
  assert.equal(normalizeRwandaDirectoryPhone('252572297').number_type,'fixed_line');
  const r=buildDirectoryPhoneReview({...directoryInput,dom:directoryInput.dom.replace('0786899370','786899370'),phone:'786899370'});
  assert.equal(r.e164,'+250786899370');
  assert.equal(r.whatsapp_verified,false);
  assert.throws(()=>normalizeRwandaBusinessMobile('786899370'));
  for(const p of ['78689937','7868993700','78689/9370','747123456','+254786899370']) assert.throws(()=>normalizeRwandaDirectoryPhone(p));
});
