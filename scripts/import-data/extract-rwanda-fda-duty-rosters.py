#!/usr/bin/env python3
"""Extract current Rwanda FDA duty-roster contacts and match them to MED+250.

This script deliberately accepts only high-confidence, district-consistent
matches. Invalid, ambiguous, and unmatched rows are written to a review CSV;
they are never promoted to pharmacy login contacts automatically.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import pdfplumber


ROSTER_URLS = {
    "bugesera": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Bugesera_District_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "huye": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Huye_District_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "kamonyi": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kamonyi_District_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "kayonza": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kayonza_District_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "kigali": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Kigali_City_for_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "muhanga": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Muhanga_District_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "musanze": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Musanze_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "nyagatare": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Nyagatare_for_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "rubavu": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Rubavu_for_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "ruhango": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Ruhango_for_JULY-AUGUST-SEPTEMBER_2026.pdf",
    "rwamagana": "https://monitoring.rwandafda.gov.rw/monitoring/documents-management/uploads/3/Human-Retail-Pharmacy-Duty-rosters/Retail_Pharmacies_Duty_Roster_in_Rwamagana_JULY-AUGUST-SEPTEMBER_2026.pdf",
}

DISTRICTS = {
    "BUGESERA", "HUYE", "KAMONYI", "KAYONZA", "GASABO", "KICUKIRO",
    "NYARUGENGE", "MUHANGA", "MUSANZE", "NYAGATARE", "RUBAVU",
    "RUHANGO", "RWAMAGANA",
}

STOP_WORDS = {
    "PHARMACY", "PHARMACIE", "PHARMA", "FARUMASI", "LTD", "LIMITED",
    "RETAIL", "THE",
}


@dataclass(frozen=True)
class RosterContact:
    roster: str
    pharmacy_name: str
    location: str
    district: str
    e164: str
    source_url: str


def ascii_words(value: str) -> list[str]:
    plain = unicodedata.normalize("NFKD", value or "")
    plain = "".join(char for char in plain if not unicodedata.combining(char))
    return re.findall(r"[A-Z0-9]+", plain.upper())


def name_key(value: str) -> str:
    return " ".join(word for word in ascii_words(value) if word not in STOP_WORDS)


def name_score(left: str, right: str) -> float:
    left_key, right_key = name_key(left), name_key(right)
    if not left_key or not right_key:
        return 0.0
    if left_key == right_key:
        return 1.0
    left_tokens, right_tokens = set(left_key.split()), set(right_key.split())
    token_score = (2 * len(left_tokens & right_tokens)) / (len(left_tokens) + len(right_tokens))
    sequence_score = SequenceMatcher(None, left_key, right_key).ratio()
    return (token_score * 0.65) + (sequence_score * 0.35)


def normalize_phone(value: str) -> str | None:
    digits = re.sub(r"\D", "", value)
    if len(digits) == 10 and digits.startswith("0"):
        digits = "250" + digits[1:]
    elif len(digits) == 9 and digits.startswith("7"):
        digits = "250" + digits
    if re.fullmatch(r"2507[2389][0-9]{7}", digits):
        return digits
    return None


def contact_numbers(value: str) -> tuple[list[str], list[str]]:
    compact = re.sub(r"[\s-]+", "", value or "")
    candidates = re.findall(r"(?:\+?250|0)?7[0-9]{7,8}", compact)
    valid, invalid = [], []
    for candidate in candidates:
        normalized = normalize_phone(candidate)
        if normalized:
            valid.append(normalized)
        else:
            invalid.append(candidate)
    return sorted(set(valid)), sorted(set(invalid))


def district_from_location(location: str, roster: str) -> str:
    words = set(ascii_words(location))
    for district in DISTRICTS:
        if district in words:
            return district
    if roster == "kigali":
        for district in ("GASABO", "KICUKIRO", "NYARUGENGE"):
            if district in words:
                return district
    return roster.upper()


def extract_roster(pdf_path: Path, roster: str) -> tuple[list[RosterContact], list[dict[str, str]]]:
    extracted: set[RosterContact] = set()
    issues: list[dict[str, str]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables():
                header_index = None
                pharmacy_index = None
                location_index = None
                contact_index = None
                for row_index, row in enumerate(table):
                    cells = [str(cell or "") for cell in row]
                    for column_index, cell in enumerate(cells):
                        upper = cell.upper()
                        if "[PHARMACY]" in upper:
                            pharmacy_index = column_index
                        elif "[LOCATION]" in upper:
                            location_index = column_index
                        elif "[CONTACT]" in upper:
                            contact_index = column_index
                    if pharmacy_index is not None and contact_index is not None:
                        header_index = row_index
                        break
                if header_index is None or pharmacy_index is None or contact_index is None:
                    continue
                for row in table[header_index + 1 :]:
                    cells = [str(cell or "").strip() for cell in row]
                    if max(pharmacy_index, contact_index, location_index or 0) >= len(cells):
                        continue
                    pharmacy_name = re.sub(r"\s+", " ", cells[pharmacy_index]).strip()
                    contact_text = cells[contact_index]
                    location = re.sub(r"\s+", " ", cells[location_index]).strip() if location_index is not None else ""
                    if not pharmacy_name or not contact_text or "[PHARMACY]" in pharmacy_name.upper():
                        continue
                    valid, invalid = contact_numbers(contact_text)
                    for raw in invalid:
                        issues.append({
                            "issue": "invalid_phone",
                            "roster": roster,
                            "page": str(page_number),
                            "roster_pharmacy_name": pharmacy_name,
                            "location": location,
                            "raw_contact": raw,
                        })
                    for e164 in valid:
                        extracted.add(RosterContact(
                            roster=roster,
                            pharmacy_name=pharmacy_name,
                            location=location,
                            district=district_from_location(location, roster),
                            e164=e164,
                            source_url=ROSTER_URLS[roster],
                        ))
    return sorted(extracted, key=lambda item: (item.pharmacy_name, item.e164)), issues


def load_retail_registry(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        row["registry_entry_key"] = f"retail-2026-05-{int(row['source_serial'])}"
        row["district_key"] = " ".join(ascii_words(row.get("district", "")))
    return rows


def match_contact(contact: RosterContact, registry: list[dict[str, str]]) -> tuple[dict[str, str] | None, float, float]:
    district_candidates = [row for row in registry if contact.district in row["district_key"].split()]
    candidates = district_candidates or registry
    ranked = sorted(
        ((name_score(contact.pharmacy_name, row["name"]), row) for row in candidates),
        key=lambda pair: pair[0],
        reverse=True,
    )
    best_score, best = ranked[0] if ranked else (0.0, None)
    second_score = ranked[1][0] if len(ranked) > 1 else 0.0
    if best is None:
        return None, best_score, second_score
    exact = name_key(contact.pharmacy_name) == name_key(best["name"])
    district_consistent = best["district_key"] == contact.district
    if district_consistent and (exact or (best_score >= 0.92 and best_score - second_score >= 0.08)):
        return best, best_score, second_score
    return None, best_score, second_score


def write_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=fields,
            quoting=csv.QUOTE_ALL,
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-dir", type=Path, required=True)
    parser.add_argument("--retail-csv", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    registry = load_retail_registry(args.retail_csv)
    contacts: list[RosterContact] = []
    issues: list[dict[str, str]] = []
    for roster in ROSTER_URLS:
        pdf_path = args.pdf_dir / f"{roster}.pdf"
        if not pdf_path.exists():
            issues.append({"issue": "missing_pdf", "roster": roster, "page": "", "roster_pharmacy_name": "", "location": "", "raw_contact": ""})
            continue
        extracted, roster_issues = extract_roster(pdf_path, roster)
        contacts.extend(extracted)
        issues.extend(roster_issues)

    matched_by_key: dict[tuple[str, str], dict[str, str]] = {}
    reviews: list[dict[str, str]] = []
    for contact in contacts:
        match, score, runner_up = match_contact(contact, registry)
        base = {
            "roster_pharmacy_name": contact.pharmacy_name,
            "roster_district": contact.district,
            "location": contact.location,
            "e164": contact.e164,
            "source_url": contact.source_url,
            "source_reference": f"{contact.roster} July-September 2026 duty roster",
            "match_score": f"{score:.3f}",
            "runner_up_score": f"{runner_up:.3f}",
        }
        if match:
            row = {
                "registry_entry_key": match["registry_entry_key"],
                "registry_pharmacy_name": match["name"],
                "registry_district": match["district"],
                **base,
            }
            matched_by_key[(row["registry_entry_key"], row["e164"])] = row
        else:
            reviews.append({
                "issue": "ambiguous_or_unmatched",
                "best_registry_name": "",
                **base,
            })

    for issue in issues:
        reviews.append({
            "issue": issue["issue"],
            "best_registry_name": "",
            "roster_pharmacy_name": issue["roster_pharmacy_name"],
            "roster_district": issue["roster"].upper(),
            "location": issue["location"],
            "e164": issue["raw_contact"],
            "source_url": ROSTER_URLS.get(issue["roster"], ""),
            "source_reference": f"{issue['roster']} page {issue['page']}",
            "match_score": "",
            "runner_up_score": "",
        })

    matched = sorted(matched_by_key.values(), key=lambda row: (row["registry_entry_key"], row["e164"]))
    matched_fields = [
        "registry_entry_key", "registry_pharmacy_name", "registry_district",
        "roster_pharmacy_name", "roster_district", "location", "e164",
        "source_url", "source_reference", "match_score", "runner_up_score",
    ]
    review_fields = [
        "issue", "best_registry_name", "roster_pharmacy_name", "roster_district",
        "location", "e164", "source_url", "source_reference", "match_score",
        "runner_up_score",
    ]
    write_csv(args.output_dir / "rwanda-fda-pharmacy-contacts-jul-sep-2026.csv", matched, matched_fields)
    write_csv(args.output_dir / "rwanda-fda-pharmacy-contacts-review.csv", reviews, review_fields)

    matched_pharmacies = len({row["registry_entry_key"] for row in matched})
    matched_path = args.output_dir / "rwanda-fda-pharmacy-contacts-jul-sep-2026.csv"
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_page": "https://rwandafda.gov.rw/human-retail-pharmacy-duty-rosters-2/",
        "roster_period": "July-September 2026",
        "roster_pdfs_processed": sum((args.pdf_dir / f"{name}.pdf").exists() for name in ROSTER_URLS),
        "unique_valid_roster_contacts": len(contacts),
        "matched_contact_rows": len(matched),
        "matched_pharmacies": matched_pharmacies,
        "review_rows": len(reviews),
        "authentication_rule": "Only rows in the matched CSV may be imported as source-verified phone and default WhatsApp login contacts.",
        "google_places_rule": "Google Places candidates are not imported as authentication contacts without separate pharmacy or admin verification.",
        "retail_registry_sha256": sha256_file(args.retail_csv),
        "matched_contacts_sha256": sha256_file(matched_path),
        "roster_sources": {
            name: {"url": ROSTER_URLS[name], "sha256": sha256_file(args.pdf_dir / f"{name}.pdf")}
            for name in ROSTER_URLS
            if (args.pdf_dir / f"{name}.pdf").exists()
        },
    }
    (args.output_dir / "rwanda-fda-pharmacy-contacts-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
