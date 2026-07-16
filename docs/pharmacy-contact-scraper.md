# Free pharmacy phone and Google Maps enrichment

[`scripts/scrape_pharmacy_contacts.py`](../scripts/scrape_pharmacy_contacts.py) extracts all 725 rows from the Rwanda FDA December 2025 PDF and appends `phone_number` and `google_maps_url` to every row.

It does not use a paid API or require an API key. It combines:

1. Direct PDF extraction with strict row-count and sequential-serial validation.
2. High-confidence matching against public contact-evidence CSVs.
3. Optional Selenium/Chrome browsing of public Google Maps listings for resolved Maps page URLs and publicly displayed business phones.

The browser workflow is slower and less stable than an official API. The script compensates with throttling, redundant page selectors, a persistent SQLite checkpoint, browser restarts, exact name/locality scoring, pharmacy-identity checks, and a separate audit CSV. A shared brand token is not enough: a Maps result must explicitly identify a pharmacy/chemist/drugstore, or have an exact normalized brand plus precise district and sector/cell evidence. If Google presents a verification page, the script stops safely and can resume later.

## Install free dependencies

Google Chrome is required for browser enrichment.

```bash
python3 -m pip install -r requirements-pharmacy-scraper.txt
```

Modern Selenium finds the compatible Chrome driver automatically. No API key is used.
The dependencies are exactly pinned for reproducibility.
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
  --chrome-profile work/pharmacy-google-profile
```

The default delay is randomly selected between four and eight seconds per record. For 725 records, expect a long-running job. Do not run parallel browser workers: aggressive traffic increases the chance of Google verification/block pages.

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
- Audit CSV: confidence, matched listing, address, evidence, status, and error columns.
- SQLite checkpoint: completed rows, enabling safe restart without redoing them.

A high-confidence resolved listing/page URL replaces the generated search URL when Google exposes one. Ambiguous and unmatched rows retain a pharmacy-specific Google Maps search URL, so all 725 rows have a useful Maps link without falsely attaching another pharmacy's listing. Phones remain blank where no sufficiently reliable public phone can be found; the audit file makes those gaps explicit.

These outputs are evidence candidates, not production approval. A public phone or Maps phone must never be inferred to be an authorized pharmacy WhatsApp identity. Production contact promotion still requires the governed single-record review workflow, exact source evidence, and an accountable reviewer.
