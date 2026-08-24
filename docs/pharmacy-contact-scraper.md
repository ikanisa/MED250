# Free pharmacy phone and Google Maps enrichment

[`scripts/scrape_pharmacy_contacts.py`](../scripts/scrape_pharmacy_contacts.py) extracts all 725 rows from the Rwanda FDA December 2025 PDF and appends `phone_number` and `google_maps_url` to every row.

It does not use a paid API or require an API key. It combines:

1. Direct PDF extraction with strict row-count and sequential-serial validation.
2. High-confidence matching against public contact-evidence CSVs.
3. Optional Selenium/Chrome browsing of public Google Maps listings for resolved Maps page URLs and publicly displayed Rwanda mobile phones.

All exported contact numbers use the international mobile form `+2507XXXXXXXX`.
Fixed lines are retained only in the private audit evidence and are not
rewritten into fabricated mobile or WhatsApp numbers.

The browser workflow is slower and less stable than an official API. The script compensates with throttling, state-based SPA hydration waits, result-feed scrolling, result-card and place-panel phone extraction, accessibility-tree fallbacks, public Share-link resolution, multiple name/locality queries, a persistent SQLite checkpoint, browser restarts, pharmacy-identity checks, and a separate audit CSV. A shared brand token is not enough: a Maps result must explicitly identify a pharmacy/chemist/drugstore, or have an exact normalized brand plus precise district and sector/cell evidence. If Google presents a verification page, the script stops safely and can resume later.

## Install free dependencies

Google Chrome is required for browser enrichment.

```bash
python3 -m pip install -r requirements-pharmacy-scraper.txt
```

Modern Selenium finds the compatible Chrome driver automatically. No API key is used.
The dependencies are exactly pinned to versions that install on the supported
local Python runtime and remain compatible with current Chrome.
`npm run security:audit:python` checks both scraper and image-pipeline pins
against OSV.

## Validate the 725 PDF rows only

```bash
python3 scripts/scrape_pharmacy_contacts.py \
  --pdf "/path/to/1. eLIST LICENSED HUMAN RETAIL PHARMACIES-DECEMBER 2025.pdf" \
  --output outputs/pharmacies-december-2025.csv \
  --extract-only
```

Every extracted row receives a Google Maps search URL; phones remain blank in this mode.

## Use free local/public phone evidence without opening Google Maps

```bash
python3 scripts/scrape_pharmacy_contacts.py \
  --pdf "/path/to/1. eLIST LICENSED HUMAN RETAIL PHARMACIES-DECEMBER 2025.pdf" \
  --output outputs/pharmacies-december-2025.csv \
  --no-browser
```

By default the program reads the repository's matched Rwanda FDA duty-roster and MMI public-directory CSVs. Add another compatible source with repeatable `--contact-source path.csv` arguments.

## Test five Google Maps records

```bash
python3 scripts/scrape_pharmacy_contacts.py \
  --pdf "/path/to/1. eLIST LICENSED HUMAN RETAIL PHARMACIES-DECEMBER 2025.pdf" \
  --output outputs/pharmacies-december-2025.csv \
  --limit 5
```

## Full free, resumable run

```bash
python3 scripts/scrape_pharmacy_contacts.py \
  --pdf "/path/to/1. eLIST LICENSED HUMAN RETAIL PHARMACIES-DECEMBER 2025.pdf" \
  --output outputs/pharmacies-december-2025.csv \
  --chrome-profile work/pharmacy-google-profile \
  --deep-search \
  --max-map-candidates 8
```

The default delay is randomly selected between four and eight seconds per record. For 725 records, expect a long-running job. If the registry is partitioned, every worker must use a non-overlapping serial range and distinct output, audit, checkpoint, and browser profile. Stagger worker delays and stop the run if any worker reports `blocked`; excessive parallel traffic increases the chance of Google verification pages.

If Google asks for verification, wait and resume in a visible browser:

```bash
python3 scripts/scrape_pharmacy_contacts.py \
  --pdf "/path/to/1. eLIST LICENSED HUMAN RETAIL PHARMACIES-DECEMBER 2025.pdf" \
  --output outputs/pharmacies-december-2025.csv \
  --chrome-profile work/pharmacy-google-profile \
  --headed
```

## Outputs and safety

- Main CSV: all 725 source rows plus exactly `phone_number` and `google_maps_url`.
- Audit CSV: confidence, matched listing, address, evidence, status, error,
  hydration state, attempted query count, result-card count, inspected-place
  count, feed-scroll count, extraction methods, and one of these coverage
  outcomes:
  - `phone_extracted`: a confident Maps place exposed a phone.
  - `place_fully_scanned_no_phone`: the place panel hydrated and was fully
    scanned, but Google displayed no phone field.
  - `no_confident_place`: candidates existed, but none passed identity rules.
  - `no_place_candidate`: all query variants completed without a place result.
  - `blocked` or `browser_error`: incomplete and safe to resume.
- SQLite checkpoint: completed rows, enabling safe restart without redoing them.

Merge complete partition audits and generate the requested 725-row table with
the two enrichment columns:

```bash
python3 scripts/import-data/merge-pharmacy-contact-audits.py \
  --input outputs/pharmacies-december-2025-part-1-audit.csv \
  --input outputs/pharmacies-december-2025-part-2-audit.csv \
  --output outputs/pharmacies-december-2025-merged-audit.csv \
  --table-output outputs/pharmacies-december-2025-with-contacts.csv \
  --summary-output outputs/pharmacies-december-2025-merged-summary.json
```

Each input audit must contain all 725 source rows; rows outside that worker's
range remain `pending`. The merge reapplies the identity policy and retains the
completed observation from the worker responsible for each range.

A high-confidence resolved listing/page URL replaces the generated search URL when Google exposes one. Ambiguous and unmatched rows retain a pharmacy-specific Google Maps search URL, so all 725 rows have a useful Maps link without falsely attaching another pharmacy's listing. Phones remain blank where no sufficiently reliable public phone can be found; the audit file makes those gaps explicit.

These outputs are evidence candidates, not production approval. A verified
mobile phone may be mirrored as a WhatsApp messaging contact, but that alone
does not authorize WhatsApp OTP login. Login permission still requires
separate ownership verification and an accountable reviewer.

After two complete runs, generate one policy-sanitized private reviewer packet:

```bash
npm run ops:contacts:candidates:packet
```

The command reapplies the current pharmacy-identity guard, removes stale
resolved listings and Maps phones that no longer satisfy it, reconciles the
December evidence against the authoritative May 2026 retail register, and
writes only ignored private files under `work/`. Its generated SQL is an
unapplied review candidate: it can create phone-only contacts and evidence
links, never WhatsApp identities or login permission. Do not apply it until
the registry-review, source-reuse, and accountable operations approvals are
complete.
