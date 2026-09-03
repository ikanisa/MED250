import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidenceDir, coordinateColumns, query, report } from './pharmacy-coordinate-research.mjs';
import { normalizeRwandaBusinessMobile, normalizeRwandaBusinessPhone } from './pharmacy-contact-research.mjs';

// Read-only production reconciliation. report() writes local evidence, never D1.
const label=process.argv[2];
if(!/^checkpoint-[0-9]{3}$/.test(label??'')) throw new Error('Use checkpoint-NNN');
const read=name=>JSON.parse(readFileSync(resolve(evidenceDir,name),'utf8'));
const summary=report(label);
const before=read('before.json').pharmacies;
const after=read(`${label}.json`).pharmacies;
assert.equal(after.length,before.length,'Register size changed');
let preserved=0,coordinateUpdates=0;
for(const p of before.filter(p=>p.geocode_status==='verified')) {
  const current=after.find(r=>r.id===p.id);
  for(const key of coordinateColumns) assert.equal(current[key],p[key],`Previously verified location changed: ${p.id}.${key}`);
  preserved++;
}
const manifests=readdirSync(evidenceDir).filter(f=>/^batch-\d{3}\.json$/.test(f)).map(read);
for(const batch of manifests) for(const update of batch.updates) {
  const p=after.find(p=>p.id===update.pharmacy_id);
  for(const key of coordinateColumns) assert.equal(p[key],update.after[key],`Location readback changed: ${p.id}.${key}`);
  assert.equal(p.dispatch_enabled,0,'Research must not activate dispatch');
  coordinateUpdates++;
}
const contacts=query('SELECT * FROM med250_pharmacy_contacts');
const known=query('SELECT e164,pharmacy_id FROM med250_known_pharmacy_numbers');
const permissions=query('SELECT contact_id,pharmacy_id,e164,claimed_at,revoked_at FROM med250_partner_initial_permissions');
const actors=query("SELECT e164 FROM med250_actors WHERE actor_type='pharmacy'");
for(const c of contacts) {
  const n=c.channel==='whatsapp'?normalizeRwandaBusinessMobile(c.e164):normalizeRwandaBusinessPhone(c.e164);
  assert.equal(n.database_e164,c.e164,'Canonical number changed');
}
const repair=read('contact-association-repair-plan.json');
for(const change of repair.corrections) {
  const c=contacts.find(c=>c.id===change.contact.id);
  assert.equal(c.pharmacy_id,change.correct_pharmacy_id);
  assert.equal(c.e164,change.contact.e164);
  assert.equal(c.dispatch_enabled,0);
  assert.equal(c.login_enabled,0);
  assert.equal(known.find(n=>n.e164===c.e164)?.pharmacy_id,change.correct_pharmacy_id);
  assert.equal(actors.some(a=>a.e164===c.e164),false,'Unexpected login actor');
  if(change.permission) assert.ok(permissions.find(p=>p.contact_id===c.id)?.revoked_at,'Misbound permission not revoked');
}
const unresolvedAssociations=repair.review.map(r=>{
  const c=contacts.find(c=>c.id===r.contact_id),p=after.find(p=>p.id===c.pharmacy_id);
  assert.equal(p.dispatch_enabled,0,'Unresolved association has a routable pharmacy');
  return {contact_id:c.id,registry_entry_key:p.registry_entry_key,name:p.name,number:'+'+c.e164,reason:r.reason,pharmacy_dispatch_enabled:p.dispatch_enabled};
});
let phonesSaved=0,phonesVerified=0,phonesCandidates=0;
for(const batch of readdirSync(evidenceDir).filter(f=>/^phones-\d{3}\.json$/.test(f)).map(read)) for(const r of batch.additions) {
  const c=contacts.find(c=>c.id===r.inserted_id);
  assert.equal(c.e164,r.database_e164);
  assert.equal(c.pharmacy_id,r.pharmacy_id);
  assert.equal(c.channel,'phone');
  assert.equal(c.dispatch_enabled,0);
  assert.equal(c.login_enabled,0);
  assert.equal(c.active,Number(r.verified_business));
  phonesSaved++; if(c.active) phonesVerified++; else phonesCandidates++;
}
const operational=query(`SELECT
 (SELECT count(*) FROM med250_dispatch_outbox) AS historical_outbox_rows,
 (SELECT count(*) FROM med250_partner_initial_permissions WHERE revoked_at IS NULL) AS unrevoked_initial_permissions,
 (SELECT count(*) FROM med250_partner_initial_permissions WHERE revoked_at IS NOT NULL) AS revoked_initial_permissions,
 (SELECT count(*) FROM med250_audit_events WHERE event_type='pharmacy_contact_association_corrected') AS association_correction_audits,
 (SELECT count(*) FROM med250_audit_events WHERE event_type='pharmacy_coordinates_verified' AND json_extract(details,'$.research_batch')='pharmacy-coordinates-2026-09-02') AS coordinate_audits,
 (SELECT count(*) FROM med250_audit_events WHERE event_type='pharmacy_public_phone_recorded') AS public_phone_audits;`)[0];
assert.equal(operational.coordinate_audits,coordinateUpdates);
assert.equal(operational.association_correction_audits,repair.corrections.length);
assert.equal(operational.public_phone_audits,phonesSaved);
const result={checked_at:new Date().toISOString(),database:'med250-production',readback_verified:true,...summary,previously_verified_locations_preserved:preserved,new_coordinate_updates_verified:coordinateUpdates,new_phone_records_verified:phonesSaved,new_active_business_phones:phonesVerified,new_inactive_phone_candidates:phonesCandidates,corrected_associations_verified:repair.corrections.length,unresolved_contact_associations:unresolvedAssociations,...operational,whatsapp_messages_sent_by_this_research:0,whatsapp_identities_created:0,dispatch_activations_created:0,first_location_research_pass_complete:summary.not_yet_reviewed===0,complete_coordinate_coverage:summary.entries_without_verified_gps===0,complete_register_research:summary.entries_without_verified_gps===0&&summary.entries_with_verified_business_mobile===after.length,whatsapp_capability_verification_complete:false};
writeFileSync(resolve(evidenceDir,`${label}-verification.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result,null,2));
