// Exact-roster owner attestation. Never synthesizes a recipient reply or rewrites
// messaging_opt_in_at. Default is a private, checksum-bound read-only plan.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const database = 'med250-production';
const root = new URL('../',import.meta.url).pathname;
export const ownerStatement = 'Yes pharmacies are already our partners and they are ok to receive these messages';
const evidenceReference = 'codex-task:01a02b07-b050-7ab1-bbf0-b53638fabee7:user-confirmation-2026-09-02';
export const rosterSql = `SELECT id,pharmacy_id,e164,verified_at,source FROM med250_pharmacy_contacts c
  WHERE channel='whatsapp' AND active=1 AND dispatch_enabled=1 AND verified_at IS NOT NULL
    AND messaging_opt_in_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM med250_actors a WHERE a.e164=c.e164 AND a.whatsapp_opted_out_at IS NOT NULL)
  ORDER BY id`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => `'${String(value).replaceAll("'","''")}'`;

export function buildAttestationPlan(contacts,recordedAt=new Date().toISOString(),id=randomUUID()) {
  if(!contacts.length || contacts.length>2000 || new Set(contacts.map(c=>c.e164)).size!==contacts.length) throw new Error('Invalid exact contact scope.');
  if(contacts.some(c=>!c.id || !c.pharmacy_id || !/^[1-9][0-9]{7,14}$/.test(c.e164) || !c.verified_at)) throw new Error('Invalid verified contact.');
  const specification={version:1,database,id,source:'owner_confirmation',statement:ownerStatement,evidence_reference:evidenceReference,
    recorded_at:recordedAt,contact_count:contacts.length,scope_sha256:hash(contacts),contacts};
  return {...specification,plan_sha256:hash(specification)};
}

export function attestationSql(plan) {
  const {plan_sha256:planHash,...specification}=plan;
  if(hash(specification)!==planHash || plan.database!==database || plan.version!==1 || plan.source!=='owner_confirmation' || plan.statement!==ownerStatement
    || plan.evidence_reference!==evidenceReference || hash(plan.contacts)!==plan.scope_sha256 || plan.contact_count!==plan.contacts.length
    || !Number.isFinite(Date.parse(plan.recorded_at)) || !/^[0-9a-f-]{36}$/.test(plan.id)) throw new Error('Invalid reviewed attestation plan.');
  const targets=JSON.stringify(plan.contacts.map(c=>({id:c.id,pharmacy_id:c.pharmacy_id,e164:c.e164,verified_at:c.verified_at,source:c.source})));
  return `INSERT OR IGNORE INTO med250_partner_permission_attestations
    (id,source,statement,evidence_reference,recorded_at,scope_sha256,contact_count)
    VALUES (${quote(plan.id)},'owner_confirmation',${quote(plan.statement)},${quote(plan.evidence_reference)},${quote(plan.recorded_at)},${quote(plan.scope_sha256)},${plan.contact_count});
  INSERT OR IGNORE INTO med250_partner_initial_permissions(contact_id,attestation_id,pharmacy_id,e164,recorded_at)
    SELECT c.id,a.id,c.pharmacy_id,c.e164,a.recorded_at FROM json_each(${quote(targets)}) target
    JOIN med250_pharmacy_contacts c ON c.id=json_extract(target.value,'$.id')
      AND c.pharmacy_id=json_extract(target.value,'$.pharmacy_id') AND c.e164=json_extract(target.value,'$.e164')
      AND c.verified_at=json_extract(target.value,'$.verified_at') AND c.source=json_extract(target.value,'$.source')
    JOIN med250_partner_permission_attestations a ON a.id=${quote(plan.id)} AND a.scope_sha256=${quote(plan.scope_sha256)}
    WHERE c.channel='whatsapp' AND c.active=1 AND c.dispatch_enabled=1 AND c.verified_at IS NOT NULL
      AND c.messaging_opt_in_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM med250_actors actor WHERE actor.e164=c.e164 AND actor.whatsapp_opted_out_at IS NOT NULL);
  SELECT a.id,a.recorded_at,a.scope_sha256,a.contact_count,count(p.contact_id) AS initial_permissions_recorded
    FROM med250_partner_permission_attestations a LEFT JOIN med250_partner_initial_permissions p ON p.attestation_id=a.id
    WHERE a.id=${quote(plan.id)} GROUP BY a.id;`;
}

async function query(extra) {
  const {stdout}=await exec(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute',database,
    '--remote','--env','production','--config','wrangler.jsonc','--json',...extra],{cwd:root,maxBuffer:8*1024*1024});
  // File-import progress is emitted before JSON even with --json. A successful
  // process exit is followed by a separate SELECT; never replay an import just
  // because its progress output could not be parsed.
  if(extra.includes('--file')) return [];
  const results=JSON.parse(stdout);
  if(!Array.isArray(results) || results.some(r=>r.success!==true)) throw new Error('D1 operation not confirmed.');
  return results;
}

async function main() {
  const args=process.argv.slice(2),mode=args[0]??'plan';
  if(!['plan','apply'].includes(mode)) throw new Error('Use plan or apply.');
  const path=resolve(root,args[1]??'private-outputs/whatsapp-activation-2026-09-02/partner-attestation-plan.json');
  if(mode==='plan') {
    const contacts=(await query(['--command',rosterSql]))[0].results;
    const plan=buildAttestationPlan(contacts);
    await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});
    await writeFile(path,`${JSON.stringify(plan,null,2)}\n`,{flag:'wx',mode:0o600});
    process.stdout.write(`${JSON.stringify({mode,path,contact_count:plan.contact_count,scope_sha256:plan.scope_sha256,plan_sha256:plan.plan_sha256,recorded_at:plan.recorded_at})}\n`);
    return;
  }
  const plan=JSON.parse(await readFile(path,'utf8'));
  if(args[2]!=='MED250_OWNER_ATTESTED_INITIAL_REQUEST' || args[3]!==plan.plan_sha256) throw new Error('Exact attestation confirmation and checksum required.');
  const sql=attestationSql(plan);
  const readbackSql=`SELECT a.id,a.recorded_at,a.scope_sha256,a.contact_count,count(p.contact_id) AS initial_permissions_recorded
    FROM med250_partner_permission_attestations a LEFT JOIN med250_partner_initial_permissions p ON p.attestation_id=a.id
    WHERE a.id=${quote(plan.id)} GROUP BY a.id`;
  const prior=(await query(['--command',readbackSql])).flatMap(r=>r.results??[])[0];
  if(prior) {
    if(prior.scope_sha256!==plan.scope_sha256 || prior.recorded_at!==plan.recorded_at || prior.initial_permissions_recorded!==plan.contact_count) {
      throw new Error('An existing attestation needs reconciliation; no repeat import was issued.');
    }
    process.stdout.write(`${JSON.stringify({mode:'already_recorded',...prior})}\n`);
    return;
  }
  const current=(await query(['--command',rosterSql]))[0].results;
  if(hash(current)!==plan.scope_sha256) throw new Error('Contact scope changed: re-review before recording.');
  const sqlPath=`${path}.sql`;
  await writeFile(sqlPath,sql,{flag:'wx',mode:0o600});
  await query(['--file',sqlPath]);
  const result=await query(['--command',readbackSql]);
  const rows=result.flatMap(r=>r.results??[]);
  const confirmation=rows.find(r=>r.id===plan.id);
  if(!confirmation || confirmation.initial_permissions_recorded!==plan.contact_count) throw new Error('Read back attestation counts before claiming completion.');
  process.stdout.write(`${JSON.stringify({mode,...confirmation})}\n`);
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) await main();
