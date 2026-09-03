"""Read-only PDF table extraction; emits immutable public business-contact evidence."""
import hashlib
import json
from pathlib import Path
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / 'outputs/controlled-evidence/med250-source-retention-2026-07-16/raw/rwanda-fda/duty-rosters'
DEST = ROOT / 'outputs/pharmacy-coordinates-2026-09-02/fda-roster-tables-v2.json'
if DEST.exists():
    raise RuntimeError('Immutable extracted evidence already exists')
rows = {}
manifests = []
for path in sorted(SOURCES.glob('*.pdf')):
    with pdfplumber.open(path) as pdf:
        valid_pages = 0
        for page_number, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                header = next((r for r in table if sum('PHARMACY' in str(c) for c in r) == 1 and sum('LOCATION' in str(c) for c in r) == 1 and sum('CONTACT' in str(c) for c in r) == 1), None)
                if not header:
                    continue
                columns = [next(i for i, c in enumerate(header) if label in str(c)) for label in ('PHARMACY', 'LOCATION', 'CONTACT')]
                valid_pages += 1
                for r in table[table.index(header)+1:]:
                    if len(r) != len(header) or any(not r[i] for i in columns):
                        continue
                    name, location, phone = (' '.join(str(r[i]).split()) for i in columns)
                    identity = (path.stem, name, location, phone)
                    record = rows.setdefault(identity, {'document': path.stem, 'name': name, 'location': location, 'phone_cell': phone, 'pages': []})
                    if page_number not in record['pages']:
                        record['pages'].append(page_number)
        manifests.append({'document': path.stem, 'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'pages': len(pdf.pages), 'recognized_table_pages': valid_pages})
payload = {'sources': manifests, 'rows': list(rows.values()), 'method': 'PDF table columns explicitly headed PHARMACY / LOCATION / CONTACT; no cross-row concatenation; no database writes'}
with DEST.open('x') as handle:
    json.dump(payload, handle, indent=2, ensure_ascii=False)
    handle.write('\n')
print(json.dumps({'path': str(DEST), 'rows': len(rows), 'sources': manifests}, indent=2))
