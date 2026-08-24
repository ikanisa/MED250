import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [reviewPath, registryPath, csvOutputPath, manifestOutputPath, migrationOutputPath] = process.argv.slice(2);
if (!migrationOutputPath) {
  throw new Error("Usage: node promote-exact-fda-contact-reviews.mjs <review.csv> <registry.csv> <output.csv> <manifest.json> <migration.sql>");
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

function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function csv(rows, columns) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${[columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n")}\n`;
}

const decisions = [
  { roster: "EL DORADO PHARMACY LTD", serial: 50, district: "KICUKIRO", evidence: ["NYARUGUNGA", "NKOKO"] },
  { roster: "UNIPHARMA BRANCH B2", serial: 282, district: "GASABO", evidence: ["KINYINYA", "KAGUGU"] },
  { roster: "UNIPHARMA, BRANCH B3", serial: 296, district: "KICUKIRO", evidence: ["KANOMBE", "KABEZA"] },
  { roster: "MEDIASOL BRANCH MUSANZE", serial: 329, district: "MUSANZE", evidence: ["MUSANZE", "MUHOZA"] },
  { roster: "PHARMACIE DE LA MISERCORDE", serial: 352, district: "NYARUGENGE", evidence: ["NYARUGENGE", "NYABUGOGO"] },
];

const reviewBytes = await readFile(reviewPath);
const registryBytes = await readFile(registryPath);
const reviewRows = parseCsv(reviewBytes.toString("utf8"));
const registryRows = parseCsv(registryBytes.toString("utf8"));
const output = [];

for (const decision of decisions) {
  const registry = registryRows.find((row) => Number(row.source_serial) === decision.serial);
  if (!registry || normalize(registry.district) !== normalize(decision.district)) {
    throw new Error(`Registry decision drifted for serial ${decision.serial}`);
  }
  const registryEvidence = normalize(`${registry.sector_cell_raw} ${registry.district}`);
  if (!decision.evidence.some((value) => registryEvidence.includes(normalize(value)))) {
    throw new Error(`Registry locality evidence drifted for serial ${decision.serial}`);
  }
  const matched = reviewRows.filter((row) =>
    row.issue === "ambiguous_or_unmatched"
    && normalize(row.roster_pharmacy_name) === normalize(decision.roster)
    && /^2507[2389][0-9]{7}$/.test(row.e164)
    && decision.evidence.some((value) => normalize(row.location).includes(normalize(value))),
  );
  if (!matched.length) throw new Error(`No reviewed duty-roster contact matched serial ${decision.serial}`);
  for (const row of matched) {
    output.push({
      registry_entry_key: `retail-2026-05-${decision.serial}`,
      registry_pharmacy_name: registry.name,
      registry_district: registry.district,
      roster_pharmacy_name: row.roster_pharmacy_name,
      roster_district: row.roster_district,
      location: row.location,
      e164: row.e164,
      source_url: row.source_url,
      source_reference: row.source_reference,
      review_decision: "exact_name_and_locality",
      registry_source_serial: String(decision.serial),
    });
  }
}

if (output.length !== 7 || new Set(output.map((row) => row.registry_entry_key)).size !== 5) {
  throw new Error(`Expected seven contacts across five exact pharmacy matches, received ${output.length}`);
}
for (const row of output) {
  if (!row.source_url.startsWith("https://monitoring.rwandafda.gov.rw/")) throw new Error("Unexpected FDA roster source URL");
}

const columns = [
  "registry_entry_key", "registry_pharmacy_name", "registry_district", "roster_pharmacy_name",
  "roster_district", "location", "e164", "source_url", "source_reference", "review_decision",
  "registry_source_serial",
];
const csvBytes = Buffer.from(csv(output, columns));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = {
  generated_at: new Date().toISOString(),
  decision: "Promote only exact official-name and official-locality matches from the Rwanda FDA July-September 2026 duty-roster review queue.",
  authentication_rule: "Every promoted official mobile is both a phone contact and a login-enabled WhatsApp contact, per marketplace owner instruction.",
  matched_contact_rows: output.length,
  matched_pharmacies: new Set(output.map((row) => row.registry_entry_key)).size,
  review_source_sha256: digest(reviewBytes),
  registry_source_sha256: digest(registryBytes),
  promoted_contacts_sha256: digest(csvBytes),
  decisions: decisions.map(({ roster, serial, district, evidence }) => ({ roster, serial, district, evidence })),
};

const json = JSON.stringify(output.map((row) => ({
  registry_entry_key: row.registry_entry_key,
  e164: row.e164,
  source_url: row.source_url,
  source_reference: row.source_reference,
}))).replaceAll("'", "''");
const sql = `begin;
-- Generated from exact, locality-confirmed Rwanda FDA duty-roster review matches.
-- Review SHA-256: ${manifest.review_source_sha256}
-- Registry SHA-256: ${manifest.registry_source_sha256}
-- Promoted contacts SHA-256: ${manifest.promoted_contacts_sha256}
with source_rows as (
  select * from jsonb_to_recordset('${json}'::jsonb) as source_row(
    registry_entry_key text, e164 text, source_url text, source_reference text
  )
), ranked as (
  select source_row.*, row_number() over (partition by registry_entry_key order by e164) = 1 as first_for_pharmacy
  from source_rows as source_row
), expanded as (
  select pharmacy.id as pharmacy_id, contact_kind.contact_type, ranked.*
  from ranked
  join public.dawanear_pharmacies as pharmacy on pharmacy.registry_entry_key = ranked.registry_entry_key
  cross join (values ('phone'), ('whatsapp')) as contact_kind(contact_type)
)
insert into public.dawanear_pharmacy_contacts (
  pharmacy_id, contact_type, e164, display_number, is_primary, is_login_enabled,
  verification_status, source_type, source_name, source_url, source_reference,
  source_observed_at, verified_at, verified_by_label, verification_note
)
select pharmacy_id, contact_type, e164, '+' || e164, first_for_pharmacy,
       contact_type = 'whatsapp', 'source_verified', 'rwanda_fda',
       'Rwanda FDA retail pharmacy duty roster July-September 2026', source_url,
       source_reference, '2026-07-01T00:00:00+02:00'::timestamptz, now(),
       'MED+250 exact FDA roster review',
       'Exact licensed name and locality match promoted from the governed review queue.'
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
where public.dawanear_pharmacy_contacts.verification_status not in ('rejected', 'stale');
commit;
`;

await Promise.all([
  writeFile(csvOutputPath, csvBytes),
  writeFile(manifestOutputPath, `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(migrationOutputPath, sql),
]);
console.log(JSON.stringify({ contacts: output.length, pharmacies: manifest.matched_pharmacies }));
