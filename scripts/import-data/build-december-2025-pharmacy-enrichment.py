#!/usr/bin/env python3
"""Match December 2025 pharmacy evidence to the current registry and emit SQL.

The current MED+250 database is based on the newer Rwanda FDA May 2026 register.
This tool therefore never imports the older 725-row register as replacement
rows. It links old evidence to current rows by pharmacy name and locality,
keeps ambiguous records in a review CSV, and emits an idempotent migration for:

* phone-only contacts (never WhatsApp/login identities), and
* Google Maps page URLs only when the browser match was accepted.

Verified geocodes and existing Maps URLs are never overwritten.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any, NamedTuple, Sequence


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRAPER_PATH = REPO_ROOT / "scripts/scrape_pharmacy_contacts.py"
SPEC = importlib.util.spec_from_file_location("pharmacy_scraper_helpers", SCRAPER_PATH)
if not SPEC or not SPEC.loader:
    raise RuntimeError(f"Cannot load scraper helpers from {SCRAPER_PATH}")
HELPERS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPERS)

MATCHED_COLUMNS = [
    "december_source_serial",
    "december_name",
    "december_district",
    "december_sector",
    "december_cell",
    "current_registry_entry_key",
    "current_source_serial",
    "current_name",
    "current_district",
    "current_sector_cell_raw",
    "registry_match_score",
    "registry_match_margin",
    "name_score",
    "district_match",
    "sector_match",
    "cell_match",
    "professional_registration_match",
    "phone_number",
    "public_phone_numbers",
    "google_maps_phone_numbers",
    "phone_source",
    "phone_evidence_url",
    "phone_evidence_reference",
    "google_maps_url",
    "maps_url_source",
    "browser_match_status",
]
REVIEW_COLUMNS = [
    "issue",
    *MATCHED_COLUMNS,
    "runner_up_registry_entry_key",
    "runner_up_name",
    "runner_up_score",
]


class ImportBuildError(RuntimeError):
    pass


class Candidate(NamedTuple):
    row: dict[str, str]
    score: float
    name_score: float
    district_match: bool
    sector_match: bool
    cell_match: bool
    registration_match: bool


def compact(value: Any) -> str:
    return HELPERS.compact_spaces(value)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise ImportBuildError(f"CSV not found: {path}")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def atomic_csv(path: Path, rows: Sequence[dict[str, Any]], columns: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(columns), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def registry_entry_key(current: dict[str, str]) -> str:
    return f"retail-2026-05-{int(current['source_serial'])}"


def rank_candidates(old: dict[str, str], current_rows: Sequence[dict[str, str]]) -> list[Candidate]:
    ranked: list[Candidate] = []
    old_registration = HELPERS.normalized_text(old["council_registration_number"])
    for current in current_rows:
        name_score = HELPERS.name_similarity(old["name"], current["name"])
        district_match = HELPERS.locality_present(old["district"], current["district"])
        sector_match = HELPERS.locality_present(old["sector"], current["sector_cell_raw"])
        cell_match = HELPERS.locality_present(old["cell"], current["sector_cell_raw"])
        registration_match = old_registration == HELPERS.normalized_text(
            current["council_registration_number"]
        )
        score = 0.76 * name_score
        score += 0.14 if district_match else 0.0
        score += 0.06 if sector_match else 0.0
        score += 0.02 if cell_match else 0.0
        score += 0.02 if registration_match else 0.0
        ranked.append(
            Candidate(
                row=current,
                score=min(1.0, score),
                name_score=name_score,
                district_match=district_match,
                sector_match=sector_match,
                cell_match=cell_match,
                registration_match=registration_match,
            )
        )
    return sorted(ranked, key=lambda candidate: candidate.score, reverse=True)


def accepted(best: Candidate, runner_up_score: float) -> bool:
    exact_with_precise_locality = (
        best.name_score >= 0.99
        and best.district_match
        and (best.sector_match or best.cell_match)
    )
    return (
        best.score >= 0.86
        and best.district_match
        and (best.score - runner_up_score >= 0.06 or exact_with_precise_locality)
    )


def browser_evidence_accepted(old: dict[str, str]) -> bool:
    status = compact(old.get("match_status"))
    maps_url = compact(old.get("google_maps_url"))
    matched_name = compact(old.get("matched_name"))
    try:
        confidence = float(old.get("match_confidence") or 0)
    except ValueError:
        confidence = 0.0
    pharmacy_named = bool(
        re.search(r"\b(?:PHARMACY|PHARMACIE|PHARMA|APOTHECARY|DRUGSTORE)\b", matched_name, re.I)
    )
    listing_name_score = HELPERS.name_similarity(old.get("name", ""), matched_name)
    return (
        status.startswith("matched")
        and confidence >= 0.88
        and listing_name_score >= 0.85
        and pharmacy_named
        and "/maps/place/" in maps_url
    )


def matched_row(
    old: dict[str, str],
    best: Candidate,
    runner_up_score: float,
) -> dict[str, Any]:
    current = best.row
    browser_accepted = browser_evidence_accepted(old)
    browser_maps_url = compact(old.get("google_maps_url")) if browser_accepted else ""
    public_phone_numbers = compact(old.get("public_phone_numbers"))
    google_maps_phone_numbers = (
        compact(old.get("google_maps_phone_numbers")) if browser_accepted else ""
    )
    legacy_phone_number = compact(old.get("phone_number"))
    legacy_phone_source = compact(old.get("phone_source"))
    if not public_phone_numbers and legacy_phone_source in {
        "public_evidence_csv",
        "public_evidence_csv+google_maps_browser",
    }:
        public_phone_numbers = legacy_phone_number
    if not google_maps_phone_numbers and legacy_phone_source == "google_maps_browser" and browser_accepted:
        google_maps_phone_numbers = legacy_phone_number
    phone_number = HELPERS.unique_join(
        [
            *HELPERS.extract_rwanda_phones(public_phone_numbers),
            *HELPERS.extract_rwanda_phones(google_maps_phone_numbers),
        ]
    )
    if public_phone_numbers and google_maps_phone_numbers:
        phone_source = "public_evidence_csv+google_maps_browser"
    elif public_phone_numbers:
        phone_source = "public_evidence_csv"
    elif google_maps_phone_numbers:
        phone_source = "google_maps_browser"
    else:
        phone_source = ""
    return {
        "december_source_serial": old["source_serial"],
        "december_name": old["name"],
        "december_district": old["district"],
        "december_sector": old["sector"],
        "december_cell": old["cell"],
        "current_registry_entry_key": registry_entry_key(current),
        "current_source_serial": current["source_serial"],
        "current_name": current["name"],
        "current_district": current["district"],
        "current_sector_cell_raw": current["sector_cell_raw"],
        "registry_match_score": f"{best.score:.3f}",
        "registry_match_margin": f"{best.score - runner_up_score:.3f}",
        "name_score": f"{best.name_score:.3f}",
        "district_match": str(best.district_match).lower(),
        "sector_match": str(best.sector_match).lower(),
        "cell_match": str(best.cell_match).lower(),
        "professional_registration_match": str(best.registration_match).lower(),
        "phone_number": phone_number,
        "public_phone_numbers": public_phone_numbers,
        "google_maps_phone_numbers": google_maps_phone_numbers,
        "phone_source": phone_source,
        "phone_evidence_url": compact(old.get("phone_evidence_url")) if phone_number else "",
        "phone_evidence_reference": compact(old.get("phone_evidence_reference")) if phone_number else "",
        "google_maps_url": browser_maps_url,
        "maps_url_source": compact(old.get("maps_url_source")) if browser_maps_url else "",
        "browser_match_status": compact(old.get("match_status")),
    }


def phone_metadata(row: dict[str, Any]) -> dict[str, Any]:
    phone = compact(row.get("phone_number")).lstrip("+")
    evidence_url = compact(row.get("phone_evidence_url"))
    source = compact(row.get("phone_source"))
    if not phone:
        return {}
    if not re.fullmatch(r"2507[2389][0-9]{7}", phone):
        raise ImportBuildError(
            f"Invalid Rwanda mobile phone on December row {row['december_source_serial']}: {phone}"
        )
    if source == "google_maps_browser":
        return {
            "e164": phone,
            "verification_status": "candidate",
            "source_type": "google_places",
            "source_name": "Google Maps public business listing",
            "source_url": evidence_url or row.get("google_maps_url", ""),
            "source_reference": "Free Selenium browser observation; requires operator verification",
            "verified": False,
        }
    if "rwandafda.gov.rw" in evidence_url.lower():
        return {
            "e164": phone,
            "verification_status": "source_verified",
            "source_type": "rwanda_fda",
            "source_name": "Rwanda FDA public pharmacy duty roster",
            "source_url": evidence_url,
            "source_reference": compact(row.get("phone_evidence_reference")),
            "verified": True,
        }
    return {
        "e164": phone,
        "verification_status": "source_verified",
        "source_type": "admin",
        "source_name": "MMI public pharmacy partner directory",
        "source_url": evidence_url,
        "source_reference": compact(row.get("phone_evidence_reference")),
        "verified": True,
    }


def phone_metadata_rows(row: dict[str, Any]) -> list[dict[str, Any]]:
    public_phones = HELPERS.extract_rwanda_phones(row.get("public_phone_numbers"))
    google_phones = HELPERS.extract_rwanda_phones(row.get("google_maps_phone_numbers"))
    if not public_phones and not google_phones:
        source = compact(row.get("phone_source"))
        if source == "google_maps_browser":
            google_phones = HELPERS.extract_rwanda_phones(row.get("phone_number"))
        else:
            public_phones = HELPERS.extract_rwanda_phones(row.get("phone_number"))

    evidence_urls = [
        compact(value)
        for value in re.split(r"\s*;\s*", compact(row.get("phone_evidence_url")))
        if compact(value)
    ]
    public_url = next(
        (url for url in evidence_urls if "google.com/maps" not in url.lower()),
        evidence_urls[0] if evidence_urls else "",
    )
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for phone in public_phones:
        metadata = phone_metadata(
            {
                **row,
                "phone_number": phone,
                "phone_source": "public_evidence_csv",
                "phone_evidence_url": public_url,
            }
        )
        output.append(metadata)
        seen.add(metadata["e164"])
    for phone in google_phones:
        e164 = phone.lstrip("+")
        if e164 in seen:
            continue
        output.append(
            phone_metadata(
                {
                    **row,
                    "phone_number": phone,
                    "phone_source": "google_maps_browser",
                    "phone_evidence_url": compact(row.get("google_maps_url")),
                }
            )
        )
        seen.add(e164)
    return output


def migration_source_rows(matched: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen_phones: set[tuple[str, str]] = set()
    maps_by_registry: dict[str, set[str]] = {}
    for row in matched:
        maps_url = compact(row.get("google_maps_url"))
        if maps_url:
            maps_by_registry.setdefault(row["current_registry_entry_key"], set()).add(maps_url)
    for row in matched:
        for phone in phone_metadata_rows(row):
            key = (row["current_registry_entry_key"], phone["e164"])
            if key in seen_phones:
                continue
            seen_phones.add(key)
            output.append(
                {
                    "registry_entry_key": row["current_registry_entry_key"],
                    "phone_e164": phone["e164"],
                    "phone_verification_status": phone["verification_status"],
                    "phone_source_type": phone["source_type"],
                    "phone_source_name": phone["source_name"],
                    "phone_source_url": phone["source_url"],
                    "phone_source_reference": phone["source_reference"],
                    "phone_verified": bool(phone["verified"]),
                    "google_maps_url": "",
                }
            )
    for registry_key, maps_urls in sorted(maps_by_registry.items()):
        if len(maps_urls) != 1:
            continue
        output.append(
            {
                "registry_entry_key": registry_key,
                "phone_e164": "",
                "phone_verification_status": "",
                "phone_source_type": "",
                "phone_source_name": "",
                "phone_source_url": "",
                "phone_source_reference": "",
                "phone_verified": False,
                "google_maps_url": next(iter(maps_urls)),
            }
        )
    return output


def sql_literal_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("'", "''")


def build_sql(
    source_rows: Sequence[dict[str, Any]],
    audit_sha: str,
    registry_sha: str,
    matched_sha: str,
) -> str:
    payload = sql_literal_json(source_rows)
    return f"""begin;
-- Generated from the December 2025 Rwanda FDA register and free public evidence.
-- The current May 2026 register remains authoritative; no pharmacy rows are replaced.
-- Enrichment audit SHA-256: {audit_sha}
-- Current registry SHA-256: {registry_sha}
-- Accepted-match CSV SHA-256: {matched_sha}
-- Phone contacts are phone-only. This migration creates no WhatsApp/login identities.

create temporary table med250_december_2025_enrichment on commit drop as
select *
from jsonb_to_recordset('{payload}'::jsonb) as source_row(
  registry_entry_key text,
  phone_e164 text,
  phone_verification_status text,
  phone_source_type text,
  phone_source_name text,
  phone_source_url text,
  phone_source_reference text,
  phone_verified boolean,
  google_maps_url text
);

do $$
begin
  if exists (
    select 1
    from med250_december_2025_enrichment as source
    left join public.dawanear_pharmacies as pharmacy
      on pharmacy.registry_entry_key = source.registry_entry_key
    where pharmacy.id is null
  ) then
    raise exception 'December 2025 enrichment contains a registry key absent from the current database';
  end if;
end;
$$;

insert into public.dawanear_pharmacy_contacts (
  pharmacy_id, contact_type, e164, display_number, is_primary,
  is_login_enabled, verification_status, source_type, source_name,
  source_url, source_reference, source_observed_at, verified_at
)
select
  pharmacy.id,
  'phone',
  source.phone_e164,
  '+' || source.phone_e164,
  false,
  false,
  source.phone_verification_status,
  source.phone_source_type,
  source.phone_source_name,
  nullif(source.phone_source_url, ''),
  nullif(source.phone_source_reference, ''),
  now(),
  case when source.phone_verified then now() else null end
from med250_december_2025_enrichment as source
join public.dawanear_pharmacies as pharmacy
  on pharmacy.registry_entry_key = source.registry_entry_key
where source.phone_e164 <> ''
on conflict (pharmacy_id, contact_type, e164) do nothing;

-- Maps pages are evidence links, not verified coordinates. Preserve every
-- existing Maps URL and every verified geocode.
update public.dawanear_pharmacies as pharmacy
set google_maps_url = source.google_maps_url,
    updated_at = now()
from med250_december_2025_enrichment as source
where pharmacy.registry_entry_key = source.registry_entry_key
  and source.google_maps_url <> ''
  and (
    pharmacy.google_maps_url is null
    or pharmacy.google_maps_url like 'https://www.google.com/maps/search/%'
  )
  and pharmacy.geocode_status <> 'verified';

do $$
begin
  if exists (
    select 1
    from public.dawanear_pharmacy_contacts
    where source_reference = 'Free Selenium browser observation; requires operator verification'
      and (
        contact_type <> 'phone'
        or is_login_enabled
        or verification_status <> 'candidate'
      )
  ) then
    raise exception 'Browser-discovered contacts were promoted beyond phone-only candidate status';
  end if;
end;
$$;

commit;
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Match December evidence to the May 2026 register and generate an idempotent migration"
    )
    parser.add_argument("--audit", required=True, type=Path)
    parser.add_argument(
        "--registry",
        type=Path,
        default=REPO_ROOT / "data/imports/rwanda-fda-retail-pharmacies-may-2026.csv",
    )
    parser.add_argument("--matched-output", required=True, type=Path)
    parser.add_argument("--review-output", required=True, type=Path)
    parser.add_argument("--migration-output", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        old_rows = read_csv(args.audit)
        current_rows = read_csv(args.registry)
        if len(old_rows) != 725:
            raise ImportBuildError(f"Expected 725 enrichment rows, found {len(old_rows)}")
        if len(current_rows) != 766:
            raise ImportBuildError(f"Expected 766 current retail rows, found {len(current_rows)}")

        matched: list[dict[str, Any]] = []
        review: list[dict[str, Any]] = []
        for old in old_rows:
            ranked = rank_candidates(old, current_rows)
            best, runner_up = ranked[0], ranked[1]
            row = matched_row(old, best, runner_up.score)
            if accepted(best, runner_up.score):
                matched.append(row)
            else:
                row.update(
                    {
                        "issue": "ambiguous_or_absent_in_current_register",
                        "runner_up_registry_entry_key": registry_entry_key(runner_up.row),
                        "runner_up_name": runner_up.row["name"],
                        "runner_up_score": f"{runner_up.score:.3f}",
                    }
                )
                review.append(row)

        atomic_csv(args.matched_output, matched, MATCHED_COLUMNS)
        atomic_csv(args.review_output, review, REVIEW_COLUMNS)
        source_rows = migration_source_rows(matched)
        matched_hash = sha256(args.matched_output)
        sql = build_sql(source_rows, sha256(args.audit), sha256(args.registry), matched_hash)
        args.migration_output.parent.mkdir(parents=True, exist_ok=True)
        args.migration_output.write_text(sql, encoding="utf-8")

        summary = {
            "december_rows": len(old_rows),
            "current_registry_rows": len(current_rows),
            "accepted_registry_matches": len(matched),
            "review_rows": len(review),
            "migration_source_rows": len(source_rows),
            "phone_contact_rows": sum(bool(row["phone_e164"]) for row in source_rows),
            "google_maps_url_rows": sum(bool(row["google_maps_url"]) for row in source_rows),
            "browser_candidate_phone_rows": sum(
                row["phone_verification_status"] == "candidate" for row in source_rows
            ),
            "migration": str(args.migration_output),
        }
        print(json.dumps(summary, indent=2))
        return 0
    except (ImportBuildError, OSError, csv.Error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
