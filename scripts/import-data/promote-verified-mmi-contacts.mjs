import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [matchedPath, outputPath, manifestPath, migrationPath] = process.argv.slice(2);
if (!migrationPath) {
  throw new Error("Usage: node promote-verified-mmi-contacts.mjs <matched.csv> <output.csv> <manifest.json> <migration.sql>");
}

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
  const headers = rows.shift();
  return rows.filter((values) => values.length === headers.length)
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

function csv(rows, columns) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${[columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n")}\n`;
}

const matchedBytes = await readFile(matchedPath);
const matchedRows = parseCsv(matchedBytes.toString("utf8"));
const quarantinedConflicts = new Map([
  ["retail-2026-05-224", "MMI mobile is already verified for unrelated HAMA MUTUAL PHARMACY in another district."],
  ["retail-2026-05-231", "MMI mobile is already verified for unrelated EXTREME PHARMACY in another district."],
  ["retail-2026-05-662", "MMI mobile is already verified for unrelated PHARMA BEST in the same district."],
]);

const promoted = matchedRows.filter((row) =>
  row.review_reason === "exact_or_high_name_and_locality"
  && row.name_score === "1.000"
  && row.district_match === "true"
  && row.sector_match === "true"
  && !quarantinedConflicts.has(row.registry_entry_key),
);

if (promoted.length !== 77 || new Set(promoted.map((row) => row.registry_entry_key)).size !== 77) {
  throw new Error(`Expected 77 unique MMI pharmacy contacts after conflict quarantine, received ${promoted.length}`);
}
if (new Set(promoted.map((row) => row.e164)).size !== promoted.length) {
  throw new Error("Promoted MMI mobile numbers must be unique within this evidence set");
}
for (const row of promoted) {
  if (!/^2507[2389][0-9]{7}$/.test(row.e164)) throw new Error("Invalid Rwanda mobile in promoted MMI data");
  if (!row.source_url.startsWith("https://www.mmi.gov.rw/partners/pharmacies")) throw new Error("Unexpected MMI source URL");
}

const columns = [
  "registry_entry_key", "registry_pharmacy_name", "registry_district", "registry_area",
  "directory_pharmacy_name", "directory_area", "e164", "source_url", "source_reference",
  "name_score", "match_confidence", "runner_up_confidence", "district_match", "sector_match",
  "review_reason",
];
const outputBytes = Buffer.from(csv(promoted, columns));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = {
  generated_at: new Date().toISOString(),
  source: "https://www.mmi.gov.rw/partners/pharmacies",
  source_owner: "Rwanda Military Medical Insurance",
  decision: "Promote only exact official-name matches confirmed by both FDA district and sector evidence.",
  authentication_rule: "Every promoted government-directory mobile is a phone contact and a login-enabled WhatsApp contact; account ownership is established only after OTP verification.",
  promoted_contacts: promoted.length,
  promoted_pharmacies: new Set(promoted.map((row) => row.registry_entry_key)).size,
  accepted_shared_branch_numbers: [
    "retail-2026-05-193",
    "retail-2026-05-664",
  ],
  quarantined_cross_pharmacy_conflicts: Object.fromEntries(quarantinedConflicts),
  matched_source_sha256: digest(matchedBytes),
  promoted_contacts_sha256: digest(outputBytes),
};

const json = JSON.stringify(promoted.map((row) => ({
  registry_entry_key: row.registry_entry_key,
  e164: row.e164,
  source_url: row.source_url,
  source_reference: row.source_reference,
}))).replaceAll("'", "''");
const sql = `begin;
-- Generated from exact name, district and sector matches between the current
-- Rwanda FDA retail register and the Rwanda MMI government partner directory.
-- Matched source SHA-256: ${manifest.matched_source_sha256}
-- Promoted contacts SHA-256: ${manifest.promoted_contacts_sha256}
with source_rows as (
  select * from jsonb_to_recordset('${json}'::jsonb) as source_row(
    registry_entry_key text, e164 text, source_url text, source_reference text
  )
), ranked as (
  select source_row.*, row_number() over (partition by registry_entry_key order by e164) = 1 as first_for_pharmacy
  from source_rows as source_row
), expanded as (
  select pharmacy.id as pharmacy_id, contact_kind.contact_type, ranked.*,
    not exists (
      select 1 from public.dawanear_pharmacy_contacts as current_primary
      where current_primary.pharmacy_id = pharmacy.id
        and current_primary.contact_type = contact_kind.contact_type
        and current_primary.is_primary
        and current_primary.verification_status not in ('rejected', 'stale')
    ) as needs_primary
  from ranked
  join public.dawanear_pharmacies as pharmacy on pharmacy.registry_entry_key = ranked.registry_entry_key
  cross join (values ('phone'), ('whatsapp')) as contact_kind(contact_type)
)
insert into public.dawanear_pharmacy_contacts (
  pharmacy_id, contact_type, e164, display_number, is_primary, is_login_enabled,
  verification_status, source_type, source_name, source_url, source_reference,
  source_observed_at, verified_at, verified_by_label, verification_note
)
select pharmacy_id, contact_type, e164, '+' || e164, first_for_pharmacy and needs_primary,
       contact_type = 'whatsapp', 'admin_verified', 'admin',
       'Rwanda Military Medical Insurance pharmacy partner directory', source_url,
       source_reference, '2026-07-16T00:00:00+02:00'::timestamptz, now(),
       'MED+250 government-directory evidence review',
       'Exact current FDA licensed name, district and sector matched to the Rwanda MMI government partner pharmacy directory.'
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
    verified_at = excluded.verified_at,
    verified_by_label = excluded.verified_by_label,
    verification_note = excluded.verification_note
where public.dawanear_pharmacy_contacts.verification_status = 'candidate';
commit;
`;

await Promise.all([
  writeFile(outputPath, outputBytes),
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(migrationPath, sql),
]);
console.log(JSON.stringify({ contacts: promoted.length, pharmacies: manifest.promoted_pharmacies }));
