#!/usr/bin/env python3
"""Free, resumable pharmacy phone and Google Maps URL collector.

Pipeline:
1. Extract every pharmacy row directly from the Rwanda FDA PDF with pdfplumber.
2. Match phone numbers from supplied/local public-evidence CSV files.
3. Use a real Chrome browser (Selenium) to search Google Maps, select the best
   name/locality match, capture its public phone, and save its canonical URL.

No paid API, API key, or proprietary scraping service is used. Google Maps web
markup changes over time, so selectors are deliberately redundant and every
result is checkpointed and audited. The main CSV always contains every source
row plus exactly ``phone_number`` and ``google_maps_url``.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import os
import random
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import unicodedata
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable, Sequence
from urllib.parse import quote, urlencode, urlsplit, urlunsplit


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_COLUMNS = [
    "source_serial",
    "name",
    "category",
    "technician",
    "council_registration_number",
    "province",
    "district",
    "sector",
    "cell",
    "license_expiration_date",
]
OUTPUT_COLUMNS = [*SOURCE_COLUMNS, "phone_number", "google_maps_url"]
AUDIT_COLUMNS = [
    *OUTPUT_COLUMNS,
    "match_status",
    "match_confidence",
    "match_margin",
    "matched_name",
    "matched_address",
    "public_phone_numbers",
    "google_maps_phone_numbers",
    "phone_source",
    "phone_evidence_url",
    "phone_evidence_reference",
    "maps_url_source",
    "search_mode",
    "query_used",
    "checked_at",
    "error",
]

# Stable left edges of the printed columns in all 41 landscape PDF pages.
PDF_COLUMN_STARTS = [90.624, 207.62, 274.97, 371.33, 435.55, 504.67, 581.86, 657.46, 738.48]
PDF_DATA_FIELDS = [
    "name",
    "category",
    "technician",
    "council_registration_number",
    "province",
    "district",
    "sector",
    "cell",
    "license_expiration_date",
]

LOCALITY_ALIASES = {
    "RUBAVU": {"RUBAVU", "GISENYI"},
    "HUYE": {"HUYE", "BUTARE"},
    "MUSANZE": {"MUSANZE", "RUHENGERI"},
    "KARONGI": {"KARONGI", "KIBUYE"},
    "NYARUGENGE": {"NYARUGENGE", "KIGALI"},
    "GASABO": {"GASABO", "KIGALI"},
    "KICUKIRO": {"KICUKIRO", "KIGALI"},
}
NAME_STOPWORDS = {
    "PHARMACY",
    "PHARMACIE",
    "PHARMA",
    "DRUGSTORE",
    "RETAIL",
    "LTD",
    "LIMITED",
    "SARL",
    "RWANDA",
    "BRANCH",
    "COMPANY",
    "CO",
    "THE",
}
PHARMACY_IDENTITY_TERMS = {
    "APOTHECARY",
    "CHEMIST",
    "DRUG",
    "DRUGSTORE",
    "PHARMACIE",
    "PHARMACY",
}
DEFAULT_CONTACT_SOURCES = [
    REPO_ROOT / "data/imports/rwanda-fda-pharmacy-contacts-jul-sep-2026.csv",
    REPO_ROOT / "data/imports/rwanda-fda-pharmacy-contacts-exact-review.csv",
    REPO_ROOT / "data/imports/mmi-pharmacy-directory-promoted.csv",
    REPO_ROOT / "data/imports/mmi-pharmacy-directory-matched.csv",
]


class ScraperError(RuntimeError):
    """A concise user-facing pipeline error."""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def compact_spaces(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def ascii_upper(value: Any) -> str:
    text = unicodedata.normalize("NFKD", compact_spaces(value))
    return "".join(char for char in text if not unicodedata.combining(char)).upper()


def normalized_text(value: Any) -> str:
    return compact_spaces(re.sub(r"[^A-Z0-9]+", " ", ascii_upper(value)))


def normalized_name(value: Any) -> str:
    return " ".join(
        token for token in normalized_text(value).split() if token and token not in NAME_STOPWORDS
    )


def name_similarity(source: str, candidate: str) -> float:
    left, right = normalized_name(source), normalized_name(candidate)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    sequence = SequenceMatcher(None, left, right).ratio()
    left_tokens, right_tokens = set(left.split()), set(right.split())
    overlap = len(left_tokens & right_tokens)
    dice = (2 * overlap / (len(left_tokens) + len(right_tokens))) if overlap else 0.0
    containment = 0.93 if left in right or right in left else 0.0
    return min(1.0, max(sequence, dice, containment))


def locality_present(needle: str, haystack: str) -> bool:
    needle = normalized_text(needle)
    haystack = normalized_text(haystack)
    if not needle:
        return False
    return any(alias in haystack for alias in LOCALITY_ALIASES.get(needle, {needle}))


def candidate_score(
    source_name: str,
    source_district: str,
    source_sector: str,
    source_cell: str,
    candidate_name: str,
    candidate_address: str,
) -> tuple[float, dict[str, bool]]:
    name_score = name_similarity(source_name, candidate_name)
    district = locality_present(source_district, candidate_address)
    sector = locality_present(source_sector, candidate_address)
    cell = locality_present(source_cell, candidate_address)
    exact_name = normalized_name(source_name) == normalized_name(candidate_name)
    score = (0.78 * name_score) + (0.13 if district else 0.0)
    score += (0.06 if sector else 0.0) + (0.03 if cell else 0.0)
    return min(1.0, score), {
        "exact_name": exact_name,
        "district": district,
        "sector": sector,
        "cell": cell,
    }


def has_pharmacy_identity_evidence(
    source_name: str,
    candidate_name: str,
    candidate_context: str,
    evidence: dict[str, bool],
) -> bool:
    candidate_tokens = set(normalized_text(f"{candidate_name} {candidate_context}").split())
    explicit_pharmacy_identity = bool(candidate_tokens & PHARMACY_IDENTITY_TERMS)
    exact_name_with_precise_locality = (
        evidence.get("exact_name", False)
        and evidence.get("district", False)
        and (evidence.get("sector", False) or evidence.get("cell", False))
    )
    return explicit_pharmacy_identity or exact_name_with_precise_locality


def maps_search_url(row: dict[str, str]) -> str:
    query = ", ".join(
        part for part in [row["name"], row["sector"], row["district"], row["province"], "Rwanda"] if part
    )
    return "https://www.google.com/maps/search/?" + urlencode({"api": "1", "query": query})


def browser_maps_search_url(row: dict[str, str]) -> str:
    query = ", ".join(part for part in [row["name"], row["sector"], row["district"], "Rwanda"] if part)
    return "https://www.google.com/maps/search/" + quote(query, safe="") + "?hl=en"


def browser_maps_search_urls(row: dict[str, str], deep: bool = False) -> list[str]:
    queries = [
        [row.get("name", ""), row.get("cell", ""), row.get("sector", ""), row.get("district", ""), "Rwanda"],
    ]
    if deep:
        queries.extend(
            [
                [row.get("name", ""), row.get("district", ""), "Rwanda"],
                [
                    normalized_name(row.get("name", "")),
                    row.get("sector", ""),
                    row.get("district", ""),
                    "Rwanda",
                ],
                [row.get("name", ""), row.get("province", ""), "Rwanda"],
            ]
        )
    output: list[str] = []
    seen: set[str] = set()
    for parts in queries:
        query = ", ".join(compact_spaces(part) for part in parts if compact_spaces(part))
        url = "https://www.google.com/maps/search/" + quote(query, safe="") + "?hl=en"
        if url not in seen:
            output.append(url)
            seen.add(url)
    return output


def clean_maps_url(value: Any) -> str:
    url = compact_spaces(value)
    if not url:
        return ""
    url = url.replace("/maps/preview/place/", "/maps/place/")
    parts = urlsplit(url)
    if "google." not in parts.netloc or "/maps/" not in parts.path:
        return ""
    # Remove tracking/query noise while keeping the stable place path and map coordinates.
    return urlunsplit(("https", parts.netloc, parts.path.rstrip("/"), "", ""))


def normalize_rwanda_phone(value: Any) -> str:
    raw = compact_spaces(value)
    if not raw:
        return ""
    # aria labels can be "Phone: +250 788 ..." or "Call +250 ...".
    raw = re.sub(r"^(?:PHONE|CALL|TEL(?:EPHONE)?)[\s:.-]*", "", raw, flags=re.I)
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00250"):
        digits = digits[2:]
    if digits.startswith("250") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("0") and len(digits) == 10:
        return "+250" + digits[1:]
    if len(digits) == 9 and digits.startswith(("7", "2")):
        return "+250" + digits
    return ""


def extract_rwanda_phones(value: Any) -> list[str]:
    text = compact_spaces(value)
    candidates = re.findall(
        r"(?<!\d)(?:(?:\+|00)?250[\s().-]*|0)(?:(?:7[2389])|(?:2\d))(?:[\s().-]*\d){7}(?!\d)",
        text,
    )
    if not candidates:
        candidates = re.split(r"\||/|;|,", text)
    output: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        phone = normalize_rwanda_phone(candidate)
        if phone and phone not in seen:
            output.append(phone)
            seen.add(phone)
    return output


def unique_join(values: Iterable[str]) -> str:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        value = compact_spaces(value)
        if value and value not in seen:
            output.append(value)
            seen.add(value)
    return "; ".join(output)


def parse_source_date(value: str) -> str:
    # Preserve the regulator's printed value even when it is not a valid
    # Gregorian date (the source contains 29/02/2030). Calendar validation is
    # not allowed to delete an otherwise valid pharmacy row.
    match = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", compact_spaces(value))
    if not match:
        raise ScraperError(f"Invalid source license-date format: {value!r}")
    day, month, year = match.groups()
    if not (1 <= int(day) <= 31 and 1 <= int(month) <= 12):
        raise ScraperError(f"Invalid source license-date fields: {value!r}")
    return f"{year}-{month}-{day}"


def words_to_cell(words: Sequence[dict[str, Any]]) -> str:
    ordered = sorted(words, key=lambda word: (round(float(word["top"]), 1), float(word["x0"])))
    return compact_spaces(" ".join(str(word["text"]) for word in ordered))


def extract_pdf_rows(pdf_path: Path, expected_rows: int = 725) -> list[dict[str, str]]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as exc:
        raise ScraperError("Install pdfplumber: python3 -m pip install pdfplumber") from exc

    records: list[dict[str, str]] = []
    serial_pattern = re.compile(r"^(\d+)\.$")
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            words = page.extract_words(x_tolerance=1, y_tolerance=2, keep_blank_chars=False) or []
            starts: list[tuple[int, float]] = []
            for word in words:
                match = serial_pattern.fullmatch(str(word["text"]))
                if match and 60 <= float(word["x0"]) <= 90 and 90 <= float(word["top"]) < 525:
                    starts.append((int(match.group(1)), float(word["top"])))
            starts.sort(key=lambda item: item[1])
            for index, (serial, top) in enumerate(starts):
                # The tallest source row is about 42 points. Capping the last
                # row prevents signatures below the final table (page 41) from
                # being appended to the pharmacy name.
                bottom = starts[index + 1][1] - 0.5 if index + 1 < len(starts) else min(525.0, top + 43.0)
                buckets: list[list[dict[str, Any]]] = [[] for _ in PDF_DATA_FIELDS]
                for word in words:
                    x0 = float(word["x0"])
                    if not (top - 0.8 <= float(word["top"]) < bottom and x0 >= PDF_COLUMN_STARTS[0] - 1):
                        continue
                    bucket = sum(x0 >= boundary - 1 for boundary in PDF_COLUMN_STARTS[1:])
                    buckets[min(bucket, len(buckets) - 1)].append(word)
                record = {"source_serial": str(serial)}
                record.update(dict(zip(PDF_DATA_FIELDS, [words_to_cell(bucket) for bucket in buckets])))
                record["license_expiration_date"] = parse_source_date(record["license_expiration_date"])
                if not record["name"] or not record["district"]:
                    raise ScraperError(
                        f"Incomplete PDF extraction on page {page_number}, serial {serial}: {record}"
                    )
                records.append(record)

    records.sort(key=lambda row: int(row["source_serial"]))
    serials = [int(row["source_serial"]) for row in records]
    if len(serials) != len(set(serials)):
        raise ScraperError("Duplicate serial numbers were extracted")
    if serials and serials != list(range(serials[0], serials[-1] + 1)):
        missing = sorted(set(range(serials[0], serials[-1] + 1)) - set(serials))
        raise ScraperError(f"Extraction skipped serials: {missing[:20]}")
    if expected_rows and len(records) != expected_rows:
        raise ScraperError(f"Expected {expected_rows} rows but extracted {len(records)}")
    return records


def row_hash(row: dict[str, str]) -> str:
    payload = json.dumps({key: row.get(key, "") for key in SOURCE_COLUMNS}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def blank_result(row: dict[str, str], status: str = "pending") -> dict[str, Any]:
    return {
        "phone_number": "",
        "google_maps_url": maps_search_url(row),
        "match_status": status,
        "match_confidence": "",
        "match_margin": "",
        "matched_name": "",
        "matched_address": "",
        "public_phone_numbers": "",
        "google_maps_phone_numbers": "",
        "phone_source": "",
        "phone_evidence_url": "",
        "phone_evidence_reference": "",
        "maps_url_source": "generated_google_maps_search",
        "search_mode": "",
        "query_used": "",
        "checked_at": "",
        "error": "",
    }


class CheckpointStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS results (
              source_fingerprint TEXT NOT NULL,
              source_serial INTEGER NOT NULL,
              input_hash TEXT NOT NULL,
              result_json TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(source_fingerprint, source_serial)
            )
            """
        )
        self.connection.commit()

    def get(self, fingerprint: str, row: dict[str, str]) -> dict[str, Any] | None:
        found = self.connection.execute(
            "SELECT input_hash,result_json FROM results WHERE source_fingerprint=? AND source_serial=?",
            (fingerprint, int(row["source_serial"])),
        ).fetchone()
        if not found or found[0] != row_hash(row):
            return None
        result = json.loads(found[1])
        if result.get("match_status") in {"browser_error", "blocked"}:
            return None
        return result

    def put(self, fingerprint: str, row: dict[str, str], result: dict[str, Any]) -> None:
        self.connection.execute(
            "INSERT OR REPLACE INTO results VALUES(?,?,?,?,?)",
            (fingerprint, int(row["source_serial"]), row_hash(row), json.dumps(result), utc_now()),
        )
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()


def first_value(row: dict[str, str], names: Sequence[str]) -> str:
    for name in names:
        value = compact_spaces(row.get(name, ""))
        if value:
            return value
    return ""


class ContactEvidenceIndex:
    """High-confidence, free phone evidence from official/public local CSVs."""

    def __init__(self, paths: Sequence[Path]) -> None:
        self.records: list[dict[str, str]] = []
        seen: set[tuple[str, str, str]] = set()
        for path in paths:
            if not path.is_file():
                continue
            with path.open(encoding="utf-8-sig", newline="") as handle:
                for source in csv.DictReader(handle):
                    phone = normalize_rwanda_phone(first_value(source, ["e164", "phone_number", "phone", "google_phone"]))
                    name = first_value(
                        source,
                        ["registry_pharmacy_name", "pharmacy_name", "name", "roster_pharmacy_name", "directory_pharmacy_name"],
                    )
                    district = first_value(source, ["registry_district", "district", "roster_district"])
                    if not phone or not name:
                        continue
                    key = (normalized_name(name), normalized_text(district), phone)
                    if key in seen:
                        continue
                    seen.add(key)
                    self.records.append(
                        {
                            "name": name,
                            "district": district,
                            "area": first_value(source, ["registry_area", "location", "directory_area"]),
                            "phone": phone,
                            "source_url": first_value(source, ["source_url", "url"]),
                            "source_reference": first_value(source, ["source_reference", "reference"]),
                            "source_file": str(path),
                        }
                    )

    def match(self, row: dict[str, str], threshold: float = 0.90, margin: float = 0.08) -> dict[str, Any] | None:
        ranked: list[tuple[float, dict[str, str]]] = []
        for record in self.records:
            name_score = name_similarity(row["name"], record["name"])
            district_match = locality_present(row["district"], record["district"] + " " + record["area"])
            score = min(1.0, 0.86 * name_score + (0.14 if district_match else 0.0))
            if score >= 0.60:
                ranked.append((score, record))
        ranked.sort(key=lambda item: item[0], reverse=True)
        if not ranked:
            return None
        best_score, best = ranked[0]
        runner_up = ranked[1][0] if len(ranked) > 1 else 0.0
        exact = normalized_name(row["name"]) == normalized_name(best["name"])
        same_district = locality_present(row["district"], best["district"] + " " + best["area"])
        if best_score < threshold or (best_score - runner_up < margin and not (exact and same_district)):
            return None
        return {
            "phone": best["phone"],
            "score": best_score,
            "margin": best_score - runner_up,
            "matched_name": best["name"],
            "address": best["area"],
            "source_url": best["source_url"],
            "source_reference": best["source_reference"] or best["source_file"],
        }


class GoogleMapsBrowser:
    """Selenium Chrome wrapper with redundant selectors and restart support."""

    def __init__(
        self,
        headed: bool,
        profile_dir: Path | None,
        timeout: float,
        deep_search: bool = False,
        max_candidates: int = 3,
    ) -> None:
        if importlib.util.find_spec("selenium") is None:
            raise ScraperError("Install Selenium: python3 -m pip install selenium")
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options

        self.runtime_profile_dir: Path | None = None
        options = Options()
        if not headed:
            options.add_argument("--headless=new")
        options.add_argument("--lang=en")
        options.add_argument("--window-size=1440,1200")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-notifications")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--disable-background-networking")
        options.add_argument("--disable-sync")
        options.add_argument("--no-default-browser-check")
        options.add_argument("--no-first-run")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        if profile_dir:
            profile_dir.mkdir(parents=True, exist_ok=True)
            # A unique runtime profile prevents an orphaned Chrome process from
            # locking every future resume. Checkpoint data lives in SQLite, not
            # in the disposable browser profile.
            self.runtime_profile_dir = profile_dir / f"session-{os.getpid()}-{uuid.uuid4().hex[:8]}"
            self.runtime_profile_dir.mkdir(parents=True, exist_ok=False)
            options.add_argument(f"--user-data-dir={self.runtime_profile_dir.resolve()}")
        try:
            self.driver = webdriver.Chrome(options=options)
        except Exception:
            if self.runtime_profile_dir:
                shutil.rmtree(self.runtime_profile_dir, ignore_errors=True)
            raise
        self.driver.set_page_load_timeout(timeout)
        self.driver.set_script_timeout(timeout)
        self.timeout = timeout
        self.deep_search = deep_search
        self.max_candidates = max(1, max_candidates)

    def close(self) -> None:
        try:
            self.driver.quit()
        except Exception:
            pass
        try:
            service = getattr(self.driver, "service", None)
            if service:
                service.stop()
        except Exception:
            pass
        if self.runtime_profile_dir:
            for _ in range(5):
                shutil.rmtree(self.runtime_profile_dir, ignore_errors=True)
                if not self.runtime_profile_dir.exists():
                    break
                time.sleep(0.2)

    def _wait(self, seconds: float = 0.0) -> None:
        from selenium.webdriver.support.ui import WebDriverWait

        WebDriverWait(self.driver, seconds or self.timeout).until(
            lambda browser: browser.execute_script("return document.readyState") in {"interactive", "complete"}
        )

    def _dismiss_consent(self) -> None:
        script = """
        const labels = ['Accept all','I agree','Accept','Agree'];
        const elements = [...document.querySelectorAll('button, [role="button"]')];
        const hit = elements.find(el => labels.includes((el.innerText || el.getAttribute('aria-label') || '').trim()));
        if (hit) { hit.click(); return true; }
        return false;
        """
        try:
            if self.driver.execute_script(script):
                time.sleep(1.0)
        except Exception:
            pass

    def _blocked(self) -> bool:
        text = normalized_text((self.driver.title or "") + " " + (self.driver.page_source or "")[:15000])
        signals = ["UNUSUAL TRAFFIC", "AUTOMATED QUERIES", "NOT A ROBOT", "VERIFY YOU ARE HUMAN", "OUR SYSTEMS HAVE DETECTED"]
        return any(signal in text for signal in signals)

    def _listing_candidates(self) -> list[dict[str, str]]:
        script = """
        const result = [];
        const seen = new Set();
        for (const a of document.querySelectorAll('a[href*="/maps/place/"]')) {
          const href = a.href || '';
          if (!href || seen.has(href)) continue;
          seen.add(href);
          const card = a.closest('[role="article"]') || a.parentElement;
          const name = (a.getAttribute('aria-label') || a.innerText || card?.querySelector('.fontHeadlineSmall')?.innerText || '').trim();
          const text = (card?.innerText || '').trim();
          result.push({href, name, text});
        }
        return result;
        """
        return list(self.driver.execute_script(script) or [])

    def _place_details(self) -> dict[str, str]:
        script = """
        const text = el => (el?.getAttribute('aria-label') || el?.innerText || '').trim();
        const first = selectors => {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && text(el)) return text(el);
          }
          return '';
        };
        const phoneElements = [
          ...document.querySelectorAll(
            '[data-item-id^="phone:tel:"], [data-item-id*="phone"], ' +
            'button[aria-label^="Phone:"], button[aria-label^="Call"], ' +
            'a[href^="tel:"], [data-tooltip*="phone" i]'
          )
        ];
        return {
          name: first(['h1.DUwDvf','h1','[role="main"] h1']),
          address: first(['button[data-item-id="address"]','[data-item-id="address"]','button[aria-label^="Address:"]']),
          phone: [...phoneElements.map(text), ...phoneElements.map(el => el.getAttribute('href') || '')].join(' | ')
        };
        """
        return dict(self.driver.execute_script(script) or {})

    def scrape(self, row: dict[str, str]) -> dict[str, Any]:
        query_urls = browser_maps_search_urls(row, self.deep_search)
        candidates_by_url: dict[str, dict[str, str]] = {}
        direct_details: list[dict[str, str]] = []
        for query_url in query_urls:
            self.driver.get(query_url)
            self._wait()
            self._dismiss_consent()
            time.sleep(1.0)
            if self._blocked():
                raise ScraperError("Google Maps blocked automated browsing; rerun headed after a cooldown")
            details = self._place_details()
            current_url = clean_maps_url(self.driver.current_url)
            if details.get("name") and "/maps/place/" in current_url:
                direct_details.append({**details, "href": current_url})
                direct_score, direct_evidence = candidate_score(
                    row["name"],
                    row["district"],
                    row["sector"],
                    row["cell"],
                    details["name"],
                    details["address"],
                )
                if (
                    direct_score >= 0.97
                    and direct_evidence["exact_name"]
                    and has_pharmacy_identity_evidence(
                        row["name"],
                        details["name"],
                        details["address"],
                        direct_evidence,
                    )
                    and extract_rwanda_phones(details.get("phone"))
                ):
                    break
            for candidate in self._listing_candidates():
                href = clean_maps_url(candidate.get("href"))
                if href:
                    candidates_by_url.setdefault(href, {**candidate, "href": href})

        ranked: list[tuple[float, dict[str, str], dict[str, bool]]] = []
        for candidate in candidates_by_url.values():
            score, evidence = candidate_score(
                row["name"], row["district"], row["sector"], row["cell"], candidate["name"], candidate["text"]
            )
            ranked.append((score, candidate, evidence))
        for details in direct_details:
            score, evidence = candidate_score(
                row["name"], row["district"], row["sector"], row["cell"], details["name"], details["address"]
            )
            ranked.append((score, details, evidence))
        ranked.sort(key=lambda item: item[0], reverse=True)
        if not ranked:
            return {
                "status": "unmatched",
                "score": 0.0,
                "margin": 0.0,
                "name": "",
                "address": "",
                "phone": "",
                "url": "",
                "query": " | ".join(query_urls),
                "search_mode": "deep" if self.deep_search else "standard",
            }

        inspected: list[tuple[float, dict[str, str], dict[str, bool]]] = []
        seen_urls: set[str] = set()
        for preliminary_score, candidate, _ in ranked:
            url = clean_maps_url(candidate.get("href"))
            if not url or url in seen_urls or len(inspected) >= self.max_candidates:
                continue
            seen_urls.add(url)
            if candidate.get("phone") and candidate.get("address"):
                details = candidate
            else:
                self.driver.get(url)
                self._wait()
                time.sleep(0.9)
                details = {**self._place_details(), "href": clean_maps_url(self.driver.current_url) or url}
            name = compact_spaces(details.get("name")) or compact_spaces(candidate.get("name"))
            address = compact_spaces(details.get("address")) or compact_spaces(candidate.get("text"))
            score, evidence = candidate_score(
                row["name"], row["district"], row["sector"], row["cell"], name, address
            )
            inspected.append(
                (
                    score,
                    {
                        "name": name,
                        "address": address,
                        "phone": details.get("phone", ""),
                        "href": clean_maps_url(details.get("href")) or url,
                    },
                    evidence,
                )
            )
            if preliminary_score < 0.45 and score < 0.45:
                break
        inspected.sort(key=lambda item: item[0], reverse=True)
        if not inspected:
            inspected = ranked[:1]
        score, details, evidence = inspected[0]
        name = compact_spaces(details.get("name"))
        address = compact_spaces(details.get("address") or details.get("text"))
        runner_up = inspected[1][0] if len(inspected) > 1 else (ranked[1][0] if len(ranked) > 1 else 0.0)
        margin = max(0.0, score - runner_up)
        phone = unique_join(extract_rwanda_phones(details.get("phone")))
        url = clean_maps_url(details.get("href"))
        exact_local = evidence["exact_name"] and evidence["district"]
        pharmacy_identity = has_pharmacy_identity_evidence(
            row["name"],
            name,
            address,
            evidence,
        )
        accepted = score >= 0.84 and (margin >= 0.08 or exact_local) and pharmacy_identity
        status = "matched" if accepted else ("needs_review" if score >= 0.58 else "unmatched")
        return {
            "status": status,
            "score": score,
            "margin": margin,
            "name": name,
            "address": address,
            "phone": phone if accepted else "",
            "url": url if accepted else "",
            "query": " | ".join(query_urls),
            "search_mode": "deep" if self.deep_search else "standard",
        }


def enrich_row(
    row: dict[str, str],
    evidence: ContactEvidenceIndex,
    browser: GoogleMapsBrowser | None,
) -> dict[str, Any]:
    result = blank_result(row, "local_evidence_only" if browser is None else "unmatched")
    local = evidence.match(row)
    if local:
        result.update(
            {
                "phone_number": local["phone"],
                "public_phone_numbers": local["phone"],
                "match_status": "phone_from_public_evidence",
                "match_confidence": f"{local['score']:.3f}",
                "match_margin": f"{local['margin']:.3f}",
                "matched_name": local["matched_name"],
                "matched_address": local["address"],
                "phone_source": "public_evidence_csv",
                "phone_evidence_url": local["source_url"],
                "phone_evidence_reference": local["source_reference"],
            }
        )
    if browser is None:
        result["checked_at"] = utc_now()
        return result

    maps = browser.scrape(row)
    result.update(
        {
            "match_status": maps["status"] if not local else f"{maps['status']}+public_phone",
            "match_confidence": f"{maps['score']:.3f}",
            "match_margin": f"{maps['margin']:.3f}",
            "matched_name": maps["name"] or result["matched_name"],
            "matched_address": maps["address"] or result["matched_address"],
            "search_mode": maps.get("search_mode", ""),
            "query_used": maps["query"],
            "checked_at": utc_now(),
        }
    )
    if maps["url"]:
        result["google_maps_url"] = maps["url"]
        result["maps_url_source"] = "google_maps_browser"
    maps_phones = extract_rwanda_phones(maps["phone"])
    if maps_phones:
        result["google_maps_phone_numbers"] = unique_join(maps_phones)
        existing_phones = extract_rwanda_phones(result["phone_number"])
        result["phone_number"] = unique_join([*existing_phones, *maps_phones])
        if existing_phones:
            result["phone_source"] = "public_evidence_csv+google_maps_browser"
            result["phone_evidence_url"] = unique_join(
                [result["phone_evidence_url"], maps["url"]]
            )
            result["phone_evidence_reference"] = unique_join(
                [
                    result["phone_evidence_reference"],
                    "Google Maps public business listing",
                ]
            )
        else:
            result["phone_source"] = "google_maps_browser"
            result["phone_evidence_url"] = maps["url"]
            result["phone_evidence_reference"] = "Google Maps public business listing"
    return result


def browser_result_complete(result: dict[str, Any], require_deep: bool = False) -> bool:
    """True after Maps was actually queried, including a valid no-match result."""
    return (
        bool(result.get("query_used"))
        and (not require_deep or result.get("search_mode") == "deep")
        and result.get("match_status") not in {
        "browser_error",
        "blocked",
        }
    )


def merge_observations(previous: dict[str, Any] | None, current: dict[str, Any]) -> dict[str, Any]:
    if not previous:
        return current
    merged = dict(current)
    previous_public = extract_rwanda_phones(
        previous.get("public_phone_numbers") or (
            previous.get("phone_number")
            if previous.get("phone_source") in {"public_evidence_csv", "public_evidence_csv+google_maps_browser"}
            else ""
        )
    )
    current_public = extract_rwanda_phones(merged.get("public_phone_numbers"))
    previous_url = clean_maps_url(previous.get("google_maps_url"))
    current_url = clean_maps_url(merged.get("google_maps_url"))
    previous_is_place = "/maps/place/" in previous_url
    current_is_place = "/maps/place/" in current_url
    _, previous_evidence = candidate_score(
        merged.get("name", ""),
        merged.get("district", ""),
        merged.get("sector", ""),
        merged.get("cell", ""),
        previous.get("matched_name", ""),
        previous.get("matched_address", ""),
    )
    previous_is_strong_match = (
        previous_is_place and str(previous.get("match_status") or "").startswith("matched")
        and has_pharmacy_identity_evidence(
            merged.get("name", ""),
            previous.get("matched_name", ""),
            previous.get("matched_address", ""),
            previous_evidence,
        )
    )
    previous_google = (
        extract_rwanda_phones(
            previous.get("google_maps_phone_numbers")
            or (previous.get("phone_number") if previous.get("phone_source") == "google_maps_browser" else "")
        )
        if previous_is_strong_match
        else []
    )
    current_google = extract_rwanda_phones(merged.get("google_maps_phone_numbers"))
    public_phones = [*current_public, *previous_public]
    google_phones = [*current_google, *previous_google]
    merged["public_phone_numbers"] = unique_join(public_phones)
    merged["google_maps_phone_numbers"] = unique_join(google_phones)
    merged["phone_number"] = unique_join([*public_phones, *google_phones])
    if public_phones and google_phones:
        merged["phone_source"] = "public_evidence_csv+google_maps_browser"
    elif public_phones:
        merged["phone_source"] = "public_evidence_csv"
    elif google_phones:
        merged["phone_source"] = "google_maps_browser"
    else:
        merged["phone_source"] = ""
    try:
        previous_score = float(previous.get("match_confidence") or 0)
    except (TypeError, ValueError):
        previous_score = 0.0
    try:
        current_score = float(merged.get("match_confidence") or 0)
    except (TypeError, ValueError):
        current_score = 0.0
    if previous_is_strong_match and (not current_is_place or previous_score > current_score):
        for field in (
            "google_maps_url",
            "maps_url_source",
            "match_status",
            "match_confidence",
            "match_margin",
            "matched_name",
            "matched_address",
        ):
            merged[field] = previous.get(field, merged.get(field, ""))

    merged["phone_evidence_url"] = unique_join(
        [current.get("phone_evidence_url", ""), previous.get("phone_evidence_url", "")]
    )
    merged["phone_evidence_reference"] = unique_join(
        [current.get("phone_evidence_reference", ""), previous.get("phone_evidence_reference", "")]
    )
    return merged


def sanitize_observation(
    result: dict[str, Any],
    source_row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Remove stale resolved listings that no longer satisfy identity policy."""
    sanitized = dict(result)
    source = source_row or result
    maps_url = clean_maps_url(sanitized.get("google_maps_url"))
    if "/maps/place/" not in maps_url:
        return sanitized
    score, evidence = candidate_score(
        source.get("name", ""),
        source.get("district", ""),
        source.get("sector", ""),
        source.get("cell", ""),
        sanitized.get("matched_name", ""),
        sanitized.get("matched_address", ""),
    )
    identity_valid = (
        str(sanitized.get("match_status") or "").startswith("matched")
        and has_pharmacy_identity_evidence(
            source.get("name", ""),
            sanitized.get("matched_name", ""),
            sanitized.get("matched_address", ""),
            evidence,
        )
    )
    if identity_valid:
        return sanitized

    public_phones = extract_rwanda_phones(
        sanitized.get("public_phone_numbers")
        or (
            sanitized.get("phone_number")
            if sanitized.get("phone_source")
            in {"public_evidence_csv", "public_evidence_csv+google_maps_browser"}
            else ""
        )
    )
    sanitized["public_phone_numbers"] = unique_join(public_phones)
    sanitized["google_maps_phone_numbers"] = ""
    sanitized["phone_number"] = unique_join(public_phones)
    sanitized["phone_source"] = "public_evidence_csv" if public_phones else ""
    sanitized["google_maps_url"] = maps_search_url(source)
    sanitized["maps_url_source"] = "generated_google_maps_search"
    sanitized["match_status"] = (
        "phone_from_public_evidence"
        if public_phones
        else ("needs_review" if score >= 0.58 else "unmatched")
    )
    return sanitized


def has_trusted_phone(
    result: dict[str, Any] | None,
    source_row: dict[str, Any] | None = None,
) -> bool:
    if not result:
        return False
    if extract_rwanda_phones(result.get("public_phone_numbers")):
        return True
    if result.get("phone_source") in {"public_evidence_csv", "public_evidence_csv+google_maps_browser"}:
        return bool(extract_rwanda_phones(result.get("phone_number")))
    source = source_row or result
    maps_url = clean_maps_url(result.get("google_maps_url"))
    _, evidence = candidate_score(
        source.get("name", ""),
        source.get("district", ""),
        source.get("sector", ""),
        source.get("cell", ""),
        result.get("matched_name", ""),
        result.get("matched_address", ""),
    )
    return (
        str(result.get("match_status") or "").startswith("matched")
        and "/maps/place/" in maps_url
        and has_pharmacy_identity_evidence(
            source.get("name", ""),
            result.get("matched_name", ""),
            result.get("matched_address", ""),
            evidence,
        )
        and bool(
            extract_rwanda_phones(
                result.get("google_maps_phone_numbers") or result.get("phone_number")
            )
        )
    )


def without_google_phone(result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not result:
        return result
    stripped = dict(result)
    public_phones = extract_rwanda_phones(
        stripped.get("public_phone_numbers")
        or (
            stripped.get("phone_number")
            if stripped.get("phone_source")
            in {"public_evidence_csv", "public_evidence_csv+google_maps_browser"}
            else ""
        )
    )
    stripped["public_phone_numbers"] = unique_join(public_phones)
    stripped["google_maps_phone_numbers"] = ""
    stripped["phone_number"] = unique_join(public_phones)
    stripped["phone_source"] = "public_evidence_csv" if public_phones else ""
    return stripped


def atomic_write_csv(path: Path, rows: Sequence[dict[str, Any]], columns: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(columns), extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def combine(source_rows: Sequence[dict[str, str]], results: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            **row,
            **sanitize_observation(
                results.get(int(row["source_serial"])) or blank_result(row),
                row,
            ),
        }
        for row in source_rows
    ]


def write_outputs(
    output: Path,
    audit: Path,
    source_rows: Sequence[dict[str, str]],
    results: dict[int, dict[str, Any]],
) -> None:
    rows = combine(source_rows, results)
    atomic_write_csv(output, rows, OUTPUT_COLUMNS)
    atomic_write_csv(audit, rows, AUDIT_COLUMNS)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Free PDF + public CSV + Google Maps browser pharmacy enricher")
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--audit-output", type=Path)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--contact-source", action="append", type=Path, default=[], help="Repeatable evidence CSV")
    parser.add_argument("--no-default-contact-sources", action="store_true")
    parser.add_argument("--extract-only", action="store_true", help="PDF only; no browser or contact matching")
    parser.add_argument("--no-browser", action="store_true", help="Use PDF and free local evidence CSVs only")
    parser.add_argument("--headed", action="store_true", help="Show Chrome; useful if Google requests verification")
    parser.add_argument("--chrome-profile", type=Path, help="Persistent Chrome profile directory")
    parser.add_argument("--deep-search", action="store_true", help="Try multiple Maps queries and inspect several place pages")
    parser.add_argument("--max-map-candidates", type=int, default=3, help="Maximum place pages inspected per pharmacy")
    parser.add_argument(
        "--missing-phone-first",
        action="store_true",
        help="Search pharmacies without high-confidence local phone evidence before the remaining rows",
    )
    parser.add_argument(
        "--only-missing-phone",
        action="store_true",
        help="Search only rows that still lack a trusted official or canonical Maps phone",
    )
    parser.add_argument(
        "--revalidate-google-phones",
        action="store_true",
        help="Recheck rows with Google phones and replace prior Google phone observations",
    )
    parser.add_argument("--expected-rows", type=int, default=725)
    parser.add_argument("--start-serial", type=int, default=1)
    parser.add_argument("--end-serial", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--timeout", type=float, default=35.0)
    parser.add_argument("--min-delay", type=float, default=4.0)
    parser.add_argument("--max-delay", type=float, default=8.0)
    parser.add_argument("--browser-restart-every", type=int, default=75)
    parser.add_argument("--checkpoint-every", type=int, default=5)
    parser.add_argument("--max-consecutive-blocks", type=int, default=2)
    parser.add_argument("--fail-fast", action="store_true")
    return parser


def validate_args(args: argparse.Namespace) -> None:
    if not args.pdf.is_file():
        raise ScraperError(f"PDF not found: {args.pdf}")
    if args.start_serial < 1 or args.end_serial < 0 or args.limit < 0:
        raise ScraperError("Serials and limit must be non-negative")
    if args.end_serial and args.end_serial < args.start_serial:
        raise ScraperError("--end-serial must be >= --start-serial")
    if args.timeout <= 0 or args.min_delay < 0 or args.max_delay < args.min_delay:
        raise ScraperError("Invalid timeout/delay values")
    if args.browser_restart_every < 0 or args.max_consecutive_blocks < 1 or args.max_map_candidates < 1:
        raise ScraperError("Invalid browser restart/block values")


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    browser: GoogleMapsBrowser | None = None
    store: CheckpointStore | None = None
    try:
        validate_args(args)
        audit = args.audit_output or args.output.with_name(args.output.stem + "-audit.csv")
        checkpoint = args.checkpoint or args.output.with_name(args.output.stem + "-checkpoint.sqlite3")
        rows = extract_pdf_rows(args.pdf, args.expected_rows)
        fingerprint = file_sha256(args.pdf)
        results: dict[int, dict[str, Any]] = {}
        previous_results: dict[int, dict[str, Any]] = {}

        if args.extract_only:
            write_outputs(args.output, audit, rows, results)
            print(json.dumps({"extracted": len(rows), "output": str(args.output), "audit": str(audit)}))
            return 0

        contact_paths = list(args.contact_source)
        if not args.no_default_contact_sources:
            contact_paths = [*DEFAULT_CONTACT_SOURCES, *contact_paths]
        evidence = ContactEvidenceIndex(contact_paths)
        store = CheckpointStore(checkpoint)
        browser_enabled = not args.no_browser
        completed_serials: set[int] = set()
        for row in rows:
            cached = store.get(fingerprint, row)
            if cached is not None:
                serial = int(row["source_serial"])
                cached = sanitize_observation(cached, row)
                previous_results[serial] = cached
                results[serial] = cached
                if not args.refresh and (
                    not browser_enabled or browser_result_complete(cached, require_deep=args.deep_search)
                ):
                    completed_serials.add(serial)

        selected = [
            row
            for row in rows
            if int(row["source_serial"]) >= args.start_serial
            and (not args.end_serial or int(row["source_serial"]) <= args.end_serial)
        ]
        if args.revalidate_google_phones:
            selected = [
                row
                for row in selected
                if extract_rwanda_phones(
                    previous_results.get(int(row["source_serial"]), {}).get(
                        "google_maps_phone_numbers"
                    )
                )
            ]
        if args.only_missing_phone:
            selected = [
                row
                for row in selected
                if evidence.match(row) is None
                and not has_trusted_phone(
                    previous_results.get(int(row["source_serial"])),
                    row,
                )
            ]
        if args.missing_phone_first:
            selected.sort(key=lambda row: (evidence.match(row) is not None, int(row["source_serial"])))
        if args.limit:
            selected = selected[: args.limit]

        processed = 0
        errors = 0
        consecutive_blocks = 0
        for row in selected:
            serial = int(row["source_serial"])
            if serial in completed_serials and not args.refresh:
                continue
            if browser_enabled and browser is None:
                browser = GoogleMapsBrowser(
                    args.headed,
                    args.chrome_profile,
                    args.timeout,
                    deep_search=args.deep_search,
                    max_candidates=args.max_map_candidates,
                )
            try:
                result = enrich_row(row, evidence, browser)
                consecutive_blocks = 0
            except Exception as exc:
                errors += 1
                message = compact_spaces(exc)[:1000]
                blocked = "blocked automated browsing" in message.lower()
                consecutive_blocks = consecutive_blocks + 1 if blocked else 0
                result = enrich_row(row, evidence, None)
                result.update(
                    {
                        "match_status": "blocked" if blocked else "browser_error",
                        "checked_at": utc_now(),
                        "error": message,
                    }
                )
                if browser:
                    browser.close()
                    browser = None
                if args.fail_fast:
                    results[serial] = result
                    store.put(fingerprint, row, result)
                    raise
            previous = previous_results.get(serial)
            if args.revalidate_google_phones:
                previous = without_google_phone(previous)
            result = sanitize_observation(
                merge_observations(previous, result),
                row,
            )
            results[serial] = result
            store.put(fingerprint, row, result)
            processed += 1
            print(
                f"[{processed}/{len(selected)}] serial={serial} status={result['match_status']} "
                f"phone={'yes' if result['phone_number'] else 'no'}",
                flush=True,
            )
            if processed % max(1, args.checkpoint_every) == 0:
                write_outputs(args.output, audit, rows, results)
            if consecutive_blocks >= args.max_consecutive_blocks:
                print("Google verification/block detected repeatedly; stopping safely. Resume later with --headed.", file=sys.stderr)
                break
            if browser_enabled:
                time.sleep(random.uniform(args.min_delay, args.max_delay))
                if args.browser_restart_every and processed % args.browser_restart_every == 0 and browser:
                    browser.close()
                    browser = None

        write_outputs(args.output, audit, rows, results)
        final_rows = combine(rows, results)
        statuses: dict[str, int] = {}
        for row in final_rows:
            status = str(row.get("match_status") or "pending")
            statuses[status] = statuses.get(status, 0) + 1
        summary = {
            "extracted": len(rows),
            "selected": len(selected),
            "processed_this_run": processed,
            "errors_this_run": errors,
            "phone_rows": sum(bool(row.get("phone_number")) for row in final_rows),
            "maps_url_rows": sum(bool(row.get("google_maps_url")) for row in final_rows),
            "statuses": statuses,
            "contact_evidence_records": len(evidence.records),
            "output": str(args.output),
            "audit": str(audit),
            "checkpoint": str(checkpoint),
        }
        print(json.dumps(summary, indent=2))
        return 2 if errors else 0
    except (ScraperError, OSError, sqlite3.Error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        if browser:
            browser.close()
        if store:
            store.close()


if __name__ == "__main__":
    raise SystemExit(main())
