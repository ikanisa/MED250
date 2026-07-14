import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") { row.push(cell); cell = ""; }
    else if (!quoted && character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (character !== "\r") cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  if (!headers?.length) throw new Error("Contact CSV is empty");
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

const inputPath = process.argv[2];
const manifestPath = process.argv[3];
if (!inputPath || !manifestPath) throw new Error("Usage: node emit-rwanda-fda-pharmacy-contact-sql.mjs <matched-contacts.csv> <source-manifest.json>");
const inputBytes = await readFile(inputPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const inputSha256 = createHash("sha256").update(inputBytes).digest("hex");
if (!/^[0-9a-f]{64}$/.test(manifest.matched_contacts_sha256 ?? "") || manifest.matched_contacts_sha256 !== inputSha256) {
  throw new Error("Contact CSV digest does not match the reviewed source manifest");
}
if (!manifest.roster_sources || Object.keys(manifest.roster_sources).length < 1) {
  throw new Error("Source manifest does not contain reviewed roster origins and digests");
}
for (const [name, source] of Object.entries(manifest.roster_sources)) {
  if (!source?.url?.startsWith("https://") || !/^[0-9a-f]{64}$/.test(source?.sha256 ?? "")) {
    throw new Error(`Roster source ${name} is missing a reviewed HTTPS origin or SHA-256 digest`);
  }
}
const rows = parseCsv(inputBytes.toString("utf8")).map((row) => ({
  registry_entry_key: row.registry_entry_key,
  e164: row.e164,
  source_url: row.source_url,
  source_reference: row.source_reference,
}));
if (!rows.length) throw new Error("No matched contacts to import");
for (const row of rows) {
  if (!/^retail-2026-05-[0-9]+$/.test(row.registry_entry_key)) throw new Error(`Invalid registry key: ${row.registry_entry_key}`);
  if (!/^2507[2389][0-9]{7}$/.test(row.e164)) throw new Error(`Invalid contact: ${row.e164}`);
  if (!row.source_url.startsWith("https://monitoring.rwandafda.gov.rw/")) throw new Error(`Unexpected source URL: ${row.source_url}`);
}

const json = JSON.stringify(rows).replaceAll("'", "''");
process.stdout.write(`begin;
with source_rows as (
  select *
  from jsonb_to_recordset('${json}'::jsonb) as source_row(
    registry_entry_key text,
    e164 text,
    source_url text,
    source_reference text
  )
), ranked as (
  select source_row.*,
         row_number() over (partition by registry_entry_key order by e164) = 1 as first_for_pharmacy
  from source_rows as source_row
), expanded as (
  select pharmacy.id as pharmacy_id,
         contact_kind.contact_type,
         ranked.e164,
         ranked.source_url,
         ranked.source_reference,
         ranked.first_for_pharmacy
  from ranked
  join public.dawanear_pharmacies as pharmacy
    on pharmacy.registry_entry_key = ranked.registry_entry_key
  cross join (values ('phone'), ('whatsapp')) as contact_kind(contact_type)
)
insert into public.dawanear_pharmacy_contacts (
  pharmacy_id, contact_type, e164, display_number, is_primary,
  is_login_enabled, verification_status, source_type, source_name,
  source_url, source_reference, source_observed_at, verified_at
)
select expanded.pharmacy_id,
       expanded.contact_type,
       expanded.e164,
       '+' || expanded.e164,
       expanded.first_for_pharmacy and not exists (
         select 1 from public.dawanear_pharmacy_contacts as existing_primary
         where existing_primary.pharmacy_id = expanded.pharmacy_id
           and existing_primary.contact_type = expanded.contact_type
           and existing_primary.is_primary
           and existing_primary.verification_status not in ('rejected', 'stale')
       ),
       expanded.contact_type = 'whatsapp',
       'source_verified',
       'rwanda_fda',
       'Rwanda FDA retail pharmacy duty roster July-September 2026',
       expanded.source_url,
       expanded.source_reference,
       '2026-07-01T00:00:00+02:00'::timestamptz,
       now()
from expanded
on conflict (pharmacy_id, contact_type, e164) do update
set display_number = excluded.display_number,
    is_login_enabled = excluded.is_login_enabled,
    verification_status = excluded.verification_status,
    source_type = excluded.source_type,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    source_reference = excluded.source_reference,
    source_observed_at = excluded.source_observed_at,
    verified_at = excluded.verified_at
where public.dawanear_pharmacy_contacts.verification_status not in ('rejected', 'stale');
commit;
`);
