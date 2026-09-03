// Local, exact-roster preparation only. Does not connect to a provider or send.
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const statement='no, but, the initial outreach come with an offcial optin button, but they have physically approved';
const database='med250-production';
const evidence='codex-task:01a02b07-b050-7ab1-bbf0-b53638fabee7:user-clarification-2026-09-03';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const quote=x=>`'${String(x).replaceAll("'","''")}'`;

export function buildLocationPlan(snapshot,excludedContactIds,recordedAt=new Date().toISOString(),campaignId=randomUUID()) {
  if(snapshot.database!==database || !Array.isArray(snapshot.contacts) || !Array.isArray(excludedContactIds)) throw Error('Invalid production scope');
  const expiresAt=new Date(Date.parse(recordedAt)+7*86400_000).toISOString();
  const contacts=snapshot.contacts.filter(c=>!excludedContactIds.includes(c.id)&&c.resolution_status==='resolved')
    .map(c=>({id:c.id,pharmacy_id:c.pharmacy_id,e164:c.e164,verified_at:c.verified_at,source:c.source,name:c.name}))
    .sort((a,b)=>a.id.localeCompare(b.id));
  if(!contacts.length || contacts.length>280 || contacts.some(c=>!/^whatsapp-[a-f0-9]{32}$/.test(c.id)||!c.pharmacy_id||!/^2507\d{8}$/.test(c.e164)||!c.verified_at||!c.source)
    ||new Set(contacts.map(c=>c.id)).size!==contacts.length||new Set(contacts.map(c=>c.e164)).size!==contacts.length) throw Error('Invalid exact contact scope');
  const plan={version:1,database,campaign_id:campaignId,source:'owner_attested_in_person',owner_statement:statement,evidence_reference:evidence,
    interpretation:'Reported in-person permission for one initial location-confirmation invitation. Future request alerts require explicit START or Enable alerts. No original agreement date is asserted.',
    recorded_at:recordedAt,expires_at:expiresAt,observed_at:snapshot.observed_at,excluded_contact_ids:[...excludedContactIds].sort(),
    contacts,contact_count:contacts.length,scope_sha256:hash(contacts)};
  return {...plan,plan_sha256:hash(plan)};
}

export function locationPermissionSql(plan) {
  const {plan_sha256,...specification}=plan;
  if(hash(specification)!==plan_sha256||plan.database!==database||plan.version!==1||plan.owner_statement!==statement
    ||plan.source!=='owner_attested_in_person'||plan.evidence_reference!==evidence||hash(plan.contacts)!==plan.scope_sha256
    ||plan.contact_count!==plan.contacts.length||!/^[-a-f0-9]{36}$/.test(plan.campaign_id)
    ||Date.parse(plan.expires_at)-Date.parse(plan.recorded_at)!==7*86400_000) throw Error('Invalid reviewed plan');
  const targets=JSON.stringify(plan.contacts);
  return `-- Exact roster, fail closed if any current contact no longer matches.
-- Installing permissions does not synthesize recurring opt-in or send messages.
WITH eligible AS (
 SELECT c.id,c.pharmacy_id,c.e164 FROM json_each(${quote(targets)}) target
 JOIN med250_pharmacy_contacts c ON c.id=json_extract(target.value,'$.id')
  AND c.pharmacy_id=json_extract(target.value,'$.pharmacy_id') AND c.e164=json_extract(target.value,'$.e164')
  AND c.verified_at=json_extract(target.value,'$.verified_at') AND c.source=json_extract(target.value,'$.source')
 JOIN med250_pharmacies p ON p.id=c.pharmacy_id AND p.name=json_extract(target.value,'$.name')
 JOIN med250_known_pharmacy_numbers k ON k.e164=c.e164 AND k.pharmacy_id=c.pharmacy_id AND k.resolution_status='resolved'
 JOIN med250_partner_initial_permissions initial ON initial.contact_id=c.id AND initial.pharmacy_id=c.pharmacy_id AND initial.e164=c.e164
 WHERE c.channel='whatsapp' AND c.active=1 AND c.dispatch_enabled=1 AND c.verified_at IS NOT NULL
  AND p.geocode_status<>'verified' AND p.licence_status='current' AND p.licence_expires_on>=date('now')
  AND initial.revoked_at IS NULL AND initial.claimed_at IS NULL
  AND ${quote(plan.recorded_at)}<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND ${quote(plan.expires_at)}>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND NOT EXISTS(SELECT 1 FROM med250_actors a WHERE a.e164=c.e164 AND a.whatsapp_opted_out_at IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM med250_partner_location_permissions existing
    WHERE (existing.contact_id=c.id OR existing.e164=c.e164) AND existing.campaign_id<>${quote(plan.campaign_id)})
)
INSERT OR IGNORE INTO med250_partner_location_permissions
 (id,campaign_id,contact_id,pharmacy_id,e164,source,owner_statement,evidence_reference,recorded_at,expires_at)
SELECT ${quote(plan.campaign_id)}||':'||id,${quote(plan.campaign_id)},id,pharmacy_id,e164,
 'owner_attested_in_person',${quote(plan.owner_statement)},${quote(plan.evidence_reference)},${quote(plan.recorded_at)},${quote(plan.expires_at)}
 FROM eligible WHERE (SELECT count(*) FROM eligible)=${plan.contact_count};
SELECT campaign_id,count(*) AS recorded,count(outbox_id) AS claimed,count(revoked_at) AS revoked
 FROM med250_partner_location_permissions WHERE campaign_id=${quote(plan.campaign_id)} GROUP BY campaign_id;`;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const snapshot=JSON.parse(await readFile(process.argv[2],'utf8'));
  const repair=JSON.parse(await readFile(process.argv[3],'utf8'));
  const plan=buildLocationPlan(snapshot,repair.review.map(row=>row.contact_id));
  process.stdout.write(JSON.stringify({plan,sql:locationPermissionSql(plan)}));
}
