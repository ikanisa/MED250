import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = resolve(import.meta.dirname, '..');
export const evidenceDir = resolve(root, 'outputs/pharmacy-coordinates-2026-09-02');
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const sqlString = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
export const coordinateColumns = ['latitude', 'longitude', 'google_maps_url', 'dispatch_enabled', 'geocode_status', 'geocode_provider', 'geocode_reference', 'geocode_formatted_address', 'geocode_confidence', 'geocode_checked_at', 'geocode_reviewed_by', 'geocode_reviewed_at', 'geocode_review_note', 'updated_at'];

export function query(sql) {
  const raw = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'med250-production', '--remote', '--env', 'production', '--config', resolve(root, 'wrangler.jsonc'), '--command', sql, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const response = JSON.parse(raw);
  if (response.some(item => !item.success)) throw new Error('D1 query failed');
  return response.flatMap(item => item.results);
}

export function snapshot(label = 'before') {
  if(!/^[a-z][a-z0-9-]{0,60}$/.test(label)) throw new Error('Invalid snapshot label');
  mkdirSync(evidenceDir, { recursive: true });
  const path = resolve(evidenceDir, `${label}.json`);
  if (existsSync(path)) throw new Error(`Snapshot already exists: ${path}`);
  const pharmacies = query(`SELECT p.*, (SELECT json_group_array(json_object('e164',c.e164,'channel',c.channel,'source_url',c.source_url,'active',c.active,'verified_at',c.verified_at,'dispatch_enabled',c.dispatch_enabled)) FROM med250_pharmacy_contacts c WHERE c.pharmacy_id=p.id AND c.channel IN ('whatsapp','phone')) AS contacts_json FROM med250_pharmacies p ORDER BY p.registry_type DESC, p.fda_source_serial;`);
  const result = { captured_at: new Date().toISOString(), database: 'med250-production', pharmacies };
  const bytes = JSON.stringify(result, null, 2) + '\n';
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  writeFileSync(`${path}.sha256`, createHash('sha256').update(bytes).digest('hex') + '\n', { flag: 'wx' });
  return { path, count: pharmacies.length, verified: pharmacies.filter(p => p.geocode_status === 'verified').length, activeWhatsapp: pharmacies.filter(p => JSON.parse(p.contacts_json).some(c => c.channel === 'whatsapp' && c.active && c.dispatch_enabled)).length };
}

export function queue() {
  const { pharmacies } = JSON.parse(readFileSync(resolve(evidenceDir, 'before.json'), 'utf8'));
  return pharmacies.filter(p => p.geocode_status !== 'verified').sort((a,b) => Number(hasWhatsapp(b)) - Number(hasWhatsapp(a)) || a.fda_source_serial-b.fda_source_serial);
}
export function hasWhatsapp(p) { return JSON.parse(p.contacts_json).some(c => c.channel === 'whatsapp' && c.active && c.dispatch_enabled); }
export function pointFromMapsUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'www.google.com' || !parsed.pathname.startsWith('/maps/place/')) throw new Error('Not a Google Maps place URL');
  const points = [...decodeURIComponent(url).matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  if (points.length !== 1) throw new Error('Exactly one place pin required; viewport coordinates are not accepted');
  const [latitude, longitude] = points[0].slice(1).map(Number);
  if (latitude < -3 || latitude > -0.8 || longitude < 28.7 || longitude > 30.9) throw new Error('Point outside Rwanda bounds');
  return { latitude, longitude };
}

export function pointFromObservation(o) {
  if(o.source_type==='rwanda_government_gis') {
    const f=o.gis_feature,a=f?.attributes,g=f?.geometry;
    if(!Number.isSafeInteger(a?.objectid)||a.objectid<1||o.url!==`https://gh.space.gov.rw/server/rest/services/Health_Facilities/FeatureServer/3/${a.objectid}`||a.shop_category!=='Chemists / Pharmacy'||!a.shop_name) throw new Error('Exact government pharmacy point identity required');
    if(!Number.isFinite(a.accuracy)||a.accuracy<=0||a.accuracy>25) throw new Error('Positive surveyed GPS accuracy required');
    if(!Number.isFinite(g?.x)||!Number.isFinite(g?.y)||g.y< -3||g.y>-.8||g.x<28.7||g.x>30.9) throw new Error('Government point outside Rwanda bounds');
    return {latitude:g.y,longitude:g.x};
  }
  if(o.source_type!=='openstreetmap') return pointFromMapsUrl(o.url);
  const e=o.osm_element;
  if(e?.type!=='node'||!Number.isSafeInteger(e.id)||e.id<1||o.url!==`https://www.openstreetmap.org/node/${e.id}`) throw new Error('Exact OSM node source identity required');
  if(!e.tags?.name||(e.tags.amenity!=='pharmacy'&&e.tags.healthcare!=='pharmacy')||Object.keys(e.tags).some(k=>/^(disused|abandoned|demolished|was):/.test(k))||e.tags.access==='no') throw new Error('Current named OSM pharmacy required');
  const point={latitude:e.lat,longitude:e.lon};
  if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||point.latitude< -3||point.latitude>-.8||point.longitude<28.7||point.longitude>30.9) throw new Error('OSM point outside Rwanda bounds');
  if(!o.source_attribution?.includes('OpenStreetMap')||!o.source_attribution.includes('ODbL')) throw new Error('OSM attribution required');
  return point;
}

export function loadObservations() {
  const observations=readdirSync(resolve(evidenceDir,'observations')).filter(f=>f.endsWith('.json')).map(f=>{
    const original=JSON.parse(readFileSync(resolve(evidenceDir,'observations',f),'utf8'));
    const revision=resolve(evidenceDir,'boundary-resolutions',f);
    return existsSync(revision)?JSON.parse(readFileSync(revision,'utf8')):original;
  });
  for(const folder of ['supplemental-holds','osm-observations','gis-observations','supplemental-resolutions']) {
  const external=resolve(evidenceDir,folder);
  if(existsSync(external)) for(const f of readdirSync(external).filter(f=>f.endsWith('.json'))) {
    const o=JSON.parse(readFileSync(resolve(external,f),'utf8'));
    const i=observations.findIndex(r=>r.registry_entry_key===o.registry_entry_key);
    if(i>=0&&observations[i].decision==='verified') throw new Error('Competing verified source must not overwrite prior evidence');
    if(i>=0) observations[i]=o; else observations.push(o);
  }
  }
  const reconsiderations=resolve(evidenceDir,'supplemental-reconsiderations');
  if(existsSync(reconsiderations))for(const f of readdirSync(reconsiderations).filter(f=>f.endsWith('.json'))){
    const o=JSON.parse(readFileSync(resolve(reconsiderations,f),'utf8'));
    const i=observations.findIndex(r=>r.registry_entry_key===o.registry_entry_key);
    if(i<0||o.decision!=='review'||observations[i].evidence_id!==o.evidence_id||!o.prior_verified_decision_retained||o.production_updated!==false)throw new Error('Invalid append-only supplemental reconsideration');
    observations[i]=o;
  }
  return observations;
}

export function resolveBoundaryReview(key,note) {
  if(!/^retail-2026-05-\d+$/.test(key)||note.length<50) throw new Error('Exact key and review rationale required');
  const o=JSON.parse(readFileSync(resolve(evidenceDir,'observations',`${key}.json`),'utf8'));
  const b=JSON.parse(readFileSync(resolve(evidenceDir,'boundary-checks',`${key}.json`),'utf8'));
  if(o.decision!=='review'||!b.exact_district_and_sector_match||/(permanently|temporarily) closed/i.test(o.dom)) throw new Error('Not an exact boundary-resolved open-business review');
  const point=pointFromMapsUrl(o.url);
  if(point.latitude!==b.point.latitude||point.longitude!==b.point.longitude) throw new Error('Boundary point mismatch');
  const result={...o,previous_decision:o.decision,decision:'verified',coordinates:point,contact_identity_verified:false,note:o.note+' Resolution: '+note+' Official boundary evidence: '+b.source_url,boundary_evidence:b.source_url,checked_at:new Date().toISOString()};
  mkdirSync(resolve(evidenceDir,'boundary-resolutions'),{recursive:true});
  writeFileSync(resolve(evidenceDir,'boundary-resolutions',`${key}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return {key,decision:result.decision,coordinates:result.coordinates};
}

// This only records observed evidence; it does not promote a location or write D1.
export function recordObservation({ registry_entry_key, url, dom, decision, note, contact_identity_verified = false }) {
  const pharmacy = queue().find(p => p.registry_entry_key === registry_entry_key);
  if (!pharmacy) throw new Error('Unknown or already verified register entry');
  if (!['verified', 'review', 'not_found'].includes(decision)) throw new Error('Explicit review decision required');
  if(decision==='verified'&&/(permanently|temporarily) closed/i.test(dom)) throw new Error('Closed listing requires review, not automatic promotion');
  if (typeof note !== 'string' || note.length < 30) throw new Error('Detailed identity review note required');
  const checked_at = new Date().toISOString();
  const coordinates = decision === 'verified' ? pointFromMapsUrl(url) : null;
  const observation = { registry_entry_key, pharmacy_id: pharmacy.id, pharmacy_name: pharmacy.name, registered_locality: [pharmacy.district, pharmacy.sector_cell_raw].join(' / '), checked_at, url, coordinates, decision, contact_identity_verified: contact_identity_verified === true, note, dom, dom_sha256: createHash('sha256').update(dom).digest('hex') };
  mkdirSync(resolve(evidenceDir, 'observations'), { recursive: true });
  const path = resolve(evidenceDir, 'observations', `${registry_entry_key}.json`);
  writeFileSync(path, JSON.stringify(observation, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { registry_entry_key, decision, coordinates, path };
}

export function buildUpdate(pharmacy, observation) {
  if(/(permanently|temporarily) closed/i.test(observation.dom??'')) throw new Error('Closed listing cannot be promoted');
  if (pharmacy.id !== observation.pharmacy_id || pharmacy.registry_entry_key !== observation.registry_entry_key || observation.decision !== 'verified') throw new Error('Identity or approval mismatch');
  if (pharmacy.latitude !== null || pharmacy.longitude !== null || pharmacy.geocode_status !== 'pending' || pharmacy.dispatch_enabled !== 0) throw new Error('Only pending, empty locations may be promoted');
  const point = pointFromObservation(observation);
  if (point.latitude !== observation.coordinates.latitude || point.longitude !== observation.coordinates.longitude) throw new Error('Coordinate evidence mismatch');
  const reviewedAt = observation.checked_at;
  const osm=observation.source_type==='openstreetmap',gis=observation.source_type==='rwanda_government_gis',external=osm||gis;
  const next = { ...point, google_maps_url: external?pharmacy.google_maps_url??null:observation.url, dispatch_enabled: Number(!external && observation.contact_identity_verified === true && pharmacy.marketplace_approved === 1 && pharmacy.licence_status === 'current' && pharmacy.licence_expires_on >= reviewedAt.slice(0,10)), geocode_status: 'verified', geocode_provider: external?'governed_registry_import':'google_places', geocode_reference: observation.url, geocode_formatted_address: observation.registered_locality, geocode_confidence: external?0.9:0.95, geocode_checked_at: reviewedAt, geocode_reviewed_by: gis?'Codex Rwanda government surveyed pharmacy and current register review':osm?'Codex OpenStreetMap node and official boundary identity review':'Codex one-by-one public Google Maps identity review', geocode_reviewed_at: reviewedAt, geocode_review_note: observation.note+(osm?' Source: '+observation.source_attribution:''), updated_at: reviewedAt };
  const guard = `id=${sqlString(pharmacy.id)} AND registry_entry_key=${sqlString(pharmacy.registry_entry_key)} AND updated_at=${sqlString(pharmacy.updated_at)} AND latitude IS NULL AND longitude IS NULL AND geocode_status='pending' AND dispatch_enabled=0`;
  const details = { research_batch: 'pharmacy-coordinates-2026-09-02', pharmacy_id: pharmacy.id, registry_entry_key: pharmacy.registry_entry_key, before: Object.fromEntries(coordinateColumns.map(k => [k,pharmacy[k]])), after: next, evidence_sha256: observation.dom_sha256, source_url: observation.url, review_note: observation.note };
  const update = `UPDATE med250_pharmacies SET ${coordinateColumns.map(k => `${k}=${typeof next[k] === 'number' ? next[k] : sqlString(next[k])}`).join(',')} WHERE ${guard};`;
  const audit = `INSERT INTO med250_audit_events(event_type,details,created_at) SELECT 'pharmacy_coordinates_verified',${sqlString(JSON.stringify(details))},${sqlString(reviewedAt)} WHERE changes()=1;`;
  return { update, audit, details };
}

export function plan(batch) {
  if (!/^batch-[0-9]{3}$/.test(batch)) throw new Error('Use batch-NNN');
  const { pharmacies } = JSON.parse(readFileSync(resolve(evidenceDir, 'before.json'), 'utf8'));
  const observations = loadObservations().filter(o=>o.decision==='verified');
  const live = query(`SELECT id,geocode_status,latitude,longitude,updated_at FROM med250_pharmacies WHERE id IN (${observations.map(o=>sqlString(o.pharmacy_id)).join(',') || "''"});`);
  const pending = observations.filter(o => live.find(p=>p.id===o.pharmacy_id)?.geocode_status==='pending');
  if (!pending.length) throw new Error('No new verified points to apply');
  const updates = pending.map(o=>{
    const p=pharmacies.find(p=>p.id===o.pharmacy_id);
    if(live.find(r=>r.id===p.id)?.updated_at!==p.updated_at) throw new Error(`Stale source snapshot for ${p.id}`);
    let boundary=JSON.parse(readFileSync(resolve(evidenceDir,o.source_type==='openstreetmap'?'osm-boundary-checks':o.source_type==='rwanda_government_gis'?'gis-boundary-checks':o.source_type==='google_maps_supplemental'?'supplemental-boundary-checks':'boundary-checks',`${o.registry_entry_key}.json`),'utf8'));
    const reconciliation=resolve(evidenceDir,'roster-boundary-resolutions',o.registry_entry_key+'.json');
    if(!boundary.exact_district_and_sector_match&&existsSync(reconciliation))boundary=JSON.parse(readFileSync(reconciliation,'utf8'));
    if(!(boundary.exact_district_and_sector_match||boundary.verified_against_current_roster===true)||boundary.point.latitude!==o.coordinates.latitude||boundary.point.longitude!==o.coordinates.longitude) throw new Error(`Official district/sector check missing or conflicting for ${o.registry_entry_key}`);
    o={...o,note:o.note+' Official district and sector point check: '+boundary.source_url};
    return buildUpdate(p,o);
  });
  const sql = updates.map(u=>`${u.update}\nSELECT CASE WHEN changes()=1 THEN 1 ELSE json('STALE_LOCATION_REVIEW') END;\n${u.audit}`).join('\n')+'\n';
  const sqlPath = resolve(evidenceDir, `${batch}.sql`);
  const sha256 = createHash('sha256').update(sql).digest('hex');
  const manifest={batch,created_at:new Date().toISOString(),sql_sha256:sha256,updates:updates.map(u=>u.details)};
  writeFileSync(sqlPath,sql,{flag:'wx',mode:0o600});
  writeFileSync(resolve(evidenceDir,`${batch}.json`),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {batch,count:updates.length,sha256,sqlPath,dispatchEnabled:updates.filter(u=>u.details.after.dispatch_enabled).length};
}

export function apply(batch, expectedHash) {
  if (!/^batch-[0-9]{3}$/.test(batch) || !/^[a-f0-9]{64}$/.test(expectedHash||'')) throw new Error('Explicit batch and SHA-256 required');
  const sqlPath=resolve(evidenceDir,`${batch}.sql`);
  const sql=readFileSync(sqlPath,'utf8');
  const manifest=JSON.parse(readFileSync(resolve(evidenceDir,`${batch}.json`),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==expectedHash || manifest.sql_sha256!==expectedHash) throw new Error('Reviewed SQL hash mismatch');
  const bookmark=execFileSync(process.execPath,[wrangler,'d1','time-travel','info','med250-production','--env','production','--config',resolve(root,'wrangler.jsonc'),'--json'],{cwd:root,encoding:'utf8'});
  writeFileSync(resolve(evidenceDir,`${batch}-bookmark.json`),bookmark,{flag:'wx',mode:0o600});
  // Never automatically retry this mutation after uncertain output.
  const output=execFileSync(process.execPath,[wrangler,'d1','execute','med250-production','--remote','--env','production','--config',resolve(root,'wrangler.jsonc'),'--file',sqlPath,'--json'],{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024});
  writeFileSync(resolve(evidenceDir,`${batch}-apply.txt`),output,{flag:'wx',mode:0o600});
  return verify(batch);
}

export function verify(batch) {
  if (!/^batch-[0-9]{3}$/.test(batch)) throw new Error('Use batch-NNN');
  const manifest=JSON.parse(readFileSync(resolve(evidenceDir,`${batch}.json`),'utf8'));
  const rows=query(`SELECT * FROM med250_pharmacies WHERE id IN (${manifest.updates.map(u=>sqlString(u.pharmacy_id)).join(',')});`);
  const audits=query(`SELECT details FROM med250_audit_events WHERE event_type='pharmacy_coordinates_verified' AND json_extract(details,'$.research_batch')='pharmacy-coordinates-2026-09-02';`);
  for(const u of manifest.updates){
    const row=rows.find(r=>r.id===u.pharmacy_id);
    for(const k of coordinateColumns) if(row?.[k]!==u.after[k]) throw new Error(`Readback mismatch ${u.pharmacy_id}.${k}`);
    if(!audits.some(a=>{const d=JSON.parse(a.details);return d.pharmacy_id===u.pharmacy_id&&d.evidence_sha256===u.evidence_sha256;})) throw new Error('Missing audit event');
  }
  writeFileSync(resolve(evidenceDir,`${batch}-readback.json`),JSON.stringify({checked_at:new Date().toISOString(),rows},null,2)+'\n',{flag:'wx',mode:0o600});
  return {batch,updated:rows.length,readbackVerified:true};
}

export function reportRow(p,o,attempts=[]) {
  const contacts=JSON.parse(p.contacts_json);
  const phones=predicate=>[...new Set(contacts.filter(predicate).map(c=>'+'+c.e164.replace(/^\+/,'')))].join('; ');
  let candidate=null;
  if(o?.decision==='review') {try{candidate=pointFromMapsUrl(o.url);}catch{ /* Search or ambiguous multiple pins have no candidate point. */ }}
  return {...p,
    verified_business_mobile_numbers_e164:phones(c=>c.channel==='phone'&&c.active&&c.verified_at&&c.e164.replace(/^\+/,'').startsWith('2507')),
    verified_business_fixed_numbers_e164:phones(c=>c.channel==='phone'&&c.active&&c.verified_at&&c.e164.replace(/^\+/,'').startsWith('2502')),
    unverified_candidate_numbers_e164:phones(c=>!c.active||!c.verified_at),
    recorded_whatsapp_numbers_e164:phones(c=>c.channel==='whatsapp'&&c.active),
    review_this_run:o?.decision || (p.geocode_status==='verified'?'previously_verified':attempts.length?'searched_pending_review':'not_yet_reviewed'),
    retained_search_attempts:attempts.length,
    search_methods:[...new Set(attempts.map(a=>a.method))].join('; '),
    last_search_url:attempts.at(-1)?.url||'',
    candidate_latitude_not_for_routing:candidate?.latitude??null,
    candidate_longitude_not_for_routing:candidate?.longitude??null,
    evidence_url:o?.url||p.geocode_reference||p.source_url,
    review_note:o?.note||p.geocode_review_note||''};
}

export function report(label) {
  if (!/^checkpoint-[0-9]{3}$/.test(label)) throw new Error('Use checkpoint-NNN');
  snapshot(label);
  const { pharmacies }=JSON.parse(readFileSync(resolve(evidenceDir,`${label}.json`),'utf8'));
  const observations=loadObservations();
  const attemptDir=resolve(evidenceDir,'search-attempts');
  const attempts=existsSync(attemptDir)?readdirSync(attemptDir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(resolve(attemptDir,f),'utf8'))).sort((a,b)=>a.checked_at.localeCompare(b.checked_at)):[];
  const headers=['registry_entry_key','name','province','district','sector_cell_raw','latitude','longitude','geocode_status','geocode_provider','geocode_reference','dispatch_enabled','verified_business_mobile_numbers_e164','verified_business_fixed_numbers_e164','unverified_candidate_numbers_e164','recorded_whatsapp_numbers_e164','review_this_run','retained_search_attempts','search_methods','last_search_url','candidate_latitude_not_for_routing','candidate_longitude_not_for_routing','evidence_url','review_note'];
  const rows=pharmacies.map(p=>reportRow(p,observations.find(o=>o.pharmacy_id===p.id),attempts.filter(a=>a.key===p.registry_entry_key)));
  const csv=data=>headers.join(',')+'\n'+data.map(r=>headers.map(k=>`"${String(r[k]??'').replaceAll('"','""')}"`).join(',')).join('\n')+'\n';
  writeFileSync(resolve(evidenceDir,`${label}-all-pharmacies.csv`),csv(rows),{flag:'wx',mode:0o600});
  writeFileSync(resolve(evidenceDir,`${label}-unresolved.csv`),csv(rows.filter(r=>r.geocode_status!=='verified')),{flag:'wx',mode:0o600});
  const contacts=pharmacies.flatMap(p=>JSON.parse(p.contacts_json));
  const summary={checkpoint:label,captured_at:new Date().toISOString(),pharmacies:pharmacies.length,verified_locations:pharmacies.filter(p=>p.geocode_status==='verified').length,reviewed_this_run:observations.length,new_verified_locations_saved:observations.filter(o=>o.decision==='verified'&&pharmacies.find(p=>p.id===o.pharmacy_id)?.geocode_status==='verified').length,verified_observations_not_saved:observations.filter(o=>o.decision==='verified'&&pharmacies.find(p=>p.id===o.pharmacy_id)?.geocode_status!=='verified').length,ambiguous:observations.filter(o=>o.decision==='review').length,no_exact_maps_match:observations.filter(o=>o.decision==='not_found').length,not_yet_reviewed:rows.filter(r=>r.review_this_run==='not_yet_reviewed').length,contact_records:contacts.length,public_phone_only_records:contacts.filter(c=>c.channel==='phone').length,recorded_active_whatsapp_contacts:contacts.filter(c=>c.channel==='whatsapp'&&c.active).length,invalid_mobile_whatsapp_format:contacts.filter(c=>c.channel==='whatsapp'&&!/^2507[23789]\d{7}$/.test(c.e164)).length,invalid_business_phone_format:contacts.filter(c=>c.channel==='phone'&&!/^250(?:7[23789]|2[2358])\d{7}$/.test(c.e164)).length,configured_dispatch_destinations_not_delivery_verified:pharmacies.filter(p=>p.dispatch_enabled===1&&p.geocode_status==='verified').flatMap(p=>JSON.parse(p.contacts_json).filter(c=>c.channel==='whatsapp'&&c.active&&c.dispatch_enabled)).length};
  summary.retained_google_search_attempts=attempts.length;
  summary.entries_with_google_search_attempts=new Set(attempts.map(a=>a.key)).size;
  summary.searched_awaiting_identity_review=rows.filter(r=>r.review_this_run==='searched_pending_review').length;
  summary.entries_without_verified_gps=rows.filter(r=>r.geocode_status!=='verified').length;
  summary.entries_with_verified_business_mobile=rows.filter(r=>r.verified_business_mobile_numbers_e164).length;
  summary.entries_with_recorded_active_whatsapp=rows.filter(r=>r.recorded_whatsapp_numbers_e164).length;
  summary.entries_without_any_recorded_contact=pharmacies.filter(p=>JSON.parse(p.contacts_json).length===0).length;
  writeFileSync(resolve(evidenceDir,`${label}-summary.json`),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
  return summary;
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (command === 'snapshot') console.log(JSON.stringify(snapshot(process.argv[3]),null,2));
  else if (command === 'plan') console.log(JSON.stringify(plan(process.argv[3]),null,2));
  else if (command === 'apply') console.log(JSON.stringify(apply(process.argv[3],process.argv[4]),null,2));
  else if (command === 'verify') console.log(JSON.stringify(verify(process.argv[3]),null,2));
  else if (command === 'report') console.log(JSON.stringify(report(process.argv[3]),null,2));
  else if (command === 'resolve-boundary') console.log(JSON.stringify(resolveBoundaryReview(process.argv[3],process.argv[4]),null,2));
  else if (command === 'queue') console.log(JSON.stringify(queue().slice(Number(process.argv[3]||0),Number(process.argv[3]||0)+Number(process.argv[4]||10)).map(p => ({key:p.registry_entry_key,name:p.name,district:p.district,locality:p.sector_cell_raw,contacts:JSON.parse(p.contacts_json),maps:p.google_maps_url})),null,2));
  else throw new Error('Use snapshot, queue, plan or apply');
}
