#!/usr/bin/env python3
"""Verify Google Maps pharmacy phones against independent public evidence.

This is deliberately a no-key, no-search-API workflow. It uses the public
Brave Search HTML page through curl, caches every response, opens promising
result pages, extracts Rwanda phone numbers, and writes an audit CSV.

Google Maps observations are treated as candidates only. A phone is marked
``independent_exact_match`` only when the same normalized number and a strong
pharmacy-name match occur on a non-Google page. Automated database promotion
must apply a stricter source-owner/authority review on top of this report.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import io
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence
from urllib.parse import quote_plus, urlsplit

from bs4 import BeautifulSoup
from pypdf import PdfReader


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRAPER_PATH = REPO_ROOT / "scripts/scrape_pharmacy_contacts.py"
SPEC = importlib.util.spec_from_file_location("pharmacy_scraper_helpers", SCRAPER_PATH)
if not SPEC or not SPEC.loader:
    raise RuntimeError(f"Cannot load scraper helpers from {SCRAPER_PATH}")
HELPERS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPERS)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36"
)
SEARCH_URL = "https://search.brave.com/search?q={query}"
GOOGLE_DOMAINS = {
    "google.com",
    "google.rw",
    "maps.google.com",
    "www.google.com",
    "www.google.rw",
}
GENERIC_NAME_TOKENS = {
    "AND",
    "APOTHECARY",
    "BRANCH",
    "CO",
    "COMPANY",
    "ENTERPRISE",
    "ENTERPRISES",
    "LIMITED",
    "LTD",
    "PHARMA",
    "PHARMACIE",
    "PHARMACY",
    "THE",
}
AUTHORITY_SUFFIXES = (
    ".gov.rw",
    ".org.rw",
    ".ac.rw",
)
OUTPUT_COLUMNS = [
    "registry_entry_key",
    "pharmacy_name",
    "district",
    "candidate_phone",
    "public_phone_numbers",
    "decision",
    "exact_evidence_count",
    "contradictory_evidence_count",
    "best_evidence_url",
    "best_evidence_domain",
    "best_evidence_title",
    "best_evidence_phones",
    "best_evidence_name_score",
    "best_evidence_source_class",
    "search_result_count",
    "searched_queries",
    "evidence_json",
]


class VerificationError(RuntimeError):
    pass


@dataclass(frozen=True)
class SearchResult:
    url: str
    title: str
    snippet: str
    query: str


def compact(value: Any) -> str:
    return HELPERS.compact_spaces(value)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise VerificationError(f"CSV not found: {path}")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def atomic_csv(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def unique(values: Iterable[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        value = compact(value)
        if value and value not in seen:
            output.append(value)
            seen.add(value)
    return output


def candidates_from_rows(rows: Sequence[dict[str, str]]) -> list[dict[str, str]]:
    output: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        public = set(HELPERS.extract_rwanda_phones(row.get("public_phone_numbers")))
        google = HELPERS.extract_rwanda_phones(row.get("google_maps_phone_numbers"))
        for phone in google:
            key = (compact(row.get("current_registry_entry_key")), phone)
            if phone in public or not key[0] or key in seen:
                continue
            output.append(
                {
                    "registry_entry_key": key[0],
                    "pharmacy_name": compact(row.get("current_name")),
                    "district": compact(row.get("current_district")),
                    "candidate_phone": phone,
                    "public_phone_numbers": "; ".join(sorted(public)),
                }
            )
            seen.add(key)
    return output


def curl_bytes(url: str, *, timeout: int = 35) -> bytes:
    process = subprocess.run(
        [
            "curl",
            "-L",
            "--compressed",
            "--fail-with-body",
            "--max-time",
            str(timeout),
            "-A",
            USER_AGENT,
            "-sS",
            url,
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.returncode:
        message = process.stderr.decode("utf-8", errors="replace").strip()
        raise VerificationError(f"curl failed for {url}: {message}")
    return process.stdout


def cached_bytes(
    url: str,
    cache_dir: Path,
    *,
    suffix: str,
    refresh: bool,
    delay: float,
) -> bytes:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{sha256_text(url)}{suffix}"
    if path.is_file() and not refresh:
        return path.read_bytes()
    if delay:
        time.sleep(delay)
    payload = curl_bytes(url)
    path.write_bytes(payload)
    return payload


def parse_search_results(html: str, query: str, limit: int) -> list[SearchResult]:
    soup = BeautifulSoup(html, "html.parser")
    output: list[SearchResult] = []
    seen: set[str] = set()
    for card in soup.select("div.snippet"):
        anchor = card.select_one("a.l1")
        if not anchor:
            continue
        url = compact(anchor.get("href"))
        if not url.startswith(("http://", "https://")) or url in seen:
            continue
        title_node = card.select_one(".search-snippet-title")
        snippet_node = card.select_one(".generic-snippet")
        title = compact(title_node.get_text(" ", strip=True) if title_node else "")
        snippet = compact(snippet_node.get_text(" ", strip=True) if snippet_node else "")
        output.append(SearchResult(url=url, title=title, snippet=snippet, query=query))
        seen.add(url)
        if len(output) >= limit:
            break
    return output


def search(
    query: str,
    cache_dir: Path,
    *,
    refresh: bool,
    delay: float,
    limit: int,
) -> list[SearchResult]:
    url = SEARCH_URL.format(query=quote_plus(query))
    payload = cached_bytes(
        url,
        cache_dir / "search",
        suffix=".html",
        refresh=refresh,
        delay=delay,
    )
    return parse_search_results(payload.decode("utf-8", errors="replace"), query, limit)


def domain_for(url: str) -> str:
    return urlsplit(url).netloc.lower().split(":", 1)[0]


def is_google(url: str) -> bool:
    domain = domain_for(url)
    return domain in GOOGLE_DOMAINS or domain.endswith(".google.com")


def distinctive_name_tokens(name: str) -> list[str]:
    normalized = HELPERS.normalized_text(name)
    return [
        token
        for token in normalized.split()
        if token not in GENERIC_NAME_TOKENS and len(token) >= 3
    ]


def name_evidence_score(name: str, text: str) -> float:
    haystack = HELPERS.normalized_text(text)
    tokens = distinctive_name_tokens(name)
    if not haystack or not tokens:
        return 0.0
    present = sum(1 for token in tokens if token in haystack.split())
    token_score = present / len(tokens)
    pharmacy_word = bool(
        re.search(r"\b(?:PHARMACY|PHARMACIE|PHARMA|APOTHECARY)\b", haystack)
    )
    return min(1.0, token_score * 0.9 + (0.1 if pharmacy_word else 0.0))


def source_class(url: str, name: str) -> str:
    domain = domain_for(url)
    if domain.endswith(AUTHORITY_SUFFIXES) or domain in {"gov.rw", "org.rw", "ac.rw"}:
        return "rwanda_authority_or_association"
    domain_text = HELPERS.normalized_text(domain.replace(".", " "))
    tokens = distinctive_name_tokens(name)
    if tokens and any(token in domain_text.split() for token in tokens):
        return "possible_first_party"
    return "independent_directory_or_media"


def visible_html_text(payload: bytes) -> str:
    soup = BeautifulSoup(payload.decode("utf-8", errors="replace"), "html.parser")
    for node in soup(["script", "style", "noscript", "svg"]):
        node.decompose()
    return compact(soup.get_text(" ", strip=True))


def anchored_context(name: str, text: str, *, radius: int = 420) -> str:
    """Keep evidence close to the pharmacy name, avoiding document-wide phones."""
    text = compact(text)
    if not text:
        return ""
    normalized = HELPERS.normalized_text(text)
    tokens = distinctive_name_tokens(name)
    if not tokens:
        return text[: radius * 2]
    anchors: list[int] = []
    for token in tokens:
        start = 0
        while len(anchors) < 12:
            index = normalized.find(token, start)
            if index < 0:
                break
            anchors.append(index)
            start = index + len(token)
    if not anchors:
        return ""
    chunks = [
        text[max(0, index - radius) : min(len(text), index + radius)]
        for index in sorted(set(anchors))
    ]
    return compact(" ".join(chunks))


def pdf_text(payload: bytes) -> str:
    reader = PdfReader(io.BytesIO(payload))
    return compact(" ".join(page.extract_text() or "" for page in reader.pages))


def fetch_text(
    url: str,
    cache_dir: Path,
    *,
    refresh: bool,
    delay: float,
) -> str:
    lower_path = urlsplit(url).path.lower()
    suffix = ".pdf" if lower_path.endswith(".pdf") else ".html"
    payload = cached_bytes(
        url,
        cache_dir / "pages",
        suffix=suffix,
        refresh=refresh,
        delay=delay,
    )
    if payload[:4] == b"%PDF" or suffix == ".pdf":
        return pdf_text(payload)
    return visible_html_text(payload)


def local_phone_variants(phone: str) -> list[str]:
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("250") and len(digits) == 12:
        local = "0" + digits[3:]
        return unique(
            [
                phone,
                digits,
                local,
                f"{local[:4]} {local[4:7]} {local[7:]}",
                f"{digits[:3]} {digits[3:6]} {digits[6:9]} {digits[9:]}",
            ]
        )
    return [phone]


def comparable_phones(candidate_phone: str, phones: Iterable[str]) -> list[str]:
    """Compare mobile candidates with mobile evidence, excluding PDF date artifacts."""
    phones = unique(phones)
    if candidate_phone.startswith("+2507"):
        return [phone for phone in phones if phone.startswith("+2507")]
    return phones


def result_evidence(
    candidate: dict[str, str],
    result: SearchResult,
    cache_dir: Path,
    *,
    refresh: bool,
    delay: float,
) -> dict[str, Any]:
    combined = compact(f"{result.title} {result.snippet}")
    snippet_context = anchored_context(
        candidate["pharmacy_name"],
        combined,
        radius=180,
    )
    snippet_phones = HELPERS.extract_rwanda_phones(snippet_context)
    candidate_phone = candidate["candidate_phone"]
    candidate_in_snippet = candidate_phone in snippet_phones
    score = name_evidence_score(candidate["pharmacy_name"], snippet_context)
    page_text = ""
    page_error = ""
    should_fetch = score >= 0.75 or candidate_in_snippet
    if should_fetch and not is_google(result.url):
        try:
            page_text = fetch_text(
                result.url,
                cache_dir,
                refresh=refresh,
                delay=delay,
            )
        except Exception as exc:  # preserve the failure in the audit report
            page_error = compact(str(exc))[:500]
    page_context = anchored_context(candidate["pharmacy_name"], page_text, radius=220)
    page_phones = HELPERS.extract_rwanda_phones(page_context)
    page_score = name_evidence_score(candidate["pharmacy_name"], page_context)
    all_phones = comparable_phones(
        candidate_phone,
        [*snippet_phones, *page_phones],
    )
    exact = candidate_phone in all_phones and max(score, page_score) >= 0.75
    contradictory = bool(all_phones) and candidate_phone not in all_phones and max(
        score, page_score
    ) >= 0.85
    return {
        "url": result.url,
        "domain": domain_for(result.url),
        "title": result.title,
        "snippet": result.snippet,
        "query": result.query,
        "phones": all_phones,
        "candidate_exact": exact,
        "contradictory": contradictory,
        "name_score": round(max(score, page_score), 3),
        "source_class": source_class(result.url, candidate["pharmacy_name"]),
        "page_fetched": bool(page_text),
        "page_error": page_error,
    }


def verify_candidate(
    candidate: dict[str, str],
    cache_dir: Path,
    *,
    refresh: bool,
    delay: float,
    limit: int,
) -> dict[str, Any]:
    local = local_phone_variants(candidate["candidate_phone"])[2]
    queries = [
        f'"{candidate["pharmacy_name"]}" Rwanda contact phone',
        f'"{local}" Rwanda pharmacy',
    ]
    results: list[SearchResult] = []
    seen_urls: set[str] = set()
    for query in queries:
        try:
            found = search(
                query,
                cache_dir,
                refresh=refresh,
                delay=delay,
                limit=limit,
            )
        except Exception as exc:
            print(f"warning: search failed for {query!r}: {exc}", file=sys.stderr)
            continue
        for result in found:
            if not is_google(result.url) and result.url not in seen_urls:
                results.append(result)
                seen_urls.add(result.url)

    evidence = [
        result_evidence(
            candidate,
            result,
            cache_dir,
            refresh=refresh,
            delay=delay,
        )
        for result in results
    ]
    exact = [item for item in evidence if item["candidate_exact"]]
    contradictory = [item for item in evidence if item["contradictory"]]
    ranked = sorted(
        evidence,
        key=lambda item: (
            bool(item["candidate_exact"]),
            item["source_class"] == "rwanda_authority_or_association",
            item["name_score"],
            len(item["phones"]),
        ),
        reverse=True,
    )
    best = ranked[0] if ranked else {}
    if exact:
        decision = "independent_exact_match"
    elif contradictory:
        decision = "contradicted_by_independent_source"
    else:
        decision = "no_independent_exact_evidence"
    return {
        **candidate,
        "decision": decision,
        "exact_evidence_count": len(exact),
        "contradictory_evidence_count": len(contradictory),
        "best_evidence_url": best.get("url", ""),
        "best_evidence_domain": best.get("domain", ""),
        "best_evidence_title": best.get("title", ""),
        "best_evidence_phones": "; ".join(best.get("phones", [])),
        "best_evidence_name_score": best.get("name_score", ""),
        "best_evidence_source_class": best.get("source_class", ""),
        "search_result_count": len(results),
        "searched_queries": " | ".join(queries),
        "evidence_json": json.dumps(evidence, ensure_ascii=False, sort_keys=True),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--matched-csv",
        type=Path,
        default=REPO_ROOT
        / "data/imports/rwanda-fda-december-2025-enrichment-matched.csv",
    )
    parser.add_argument(
        "--output-csv",
        type=Path,
        default=REPO_ROOT
        / "data/imports/google-pharmacy-contact-independent-verification.csv",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=REPO_ROOT / "work/pharmacy-phone-web-evidence",
    )
    parser.add_argument("--delay", type=float, default=1.25)
    parser.add_argument("--max-results", type=int, default=6)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Verify only the first N candidates (0 means every candidate).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    candidates = candidates_from_rows(read_csv(args.matched_csv))
    if args.limit:
        candidates = candidates[: args.limit]
    print(f"Verifying {len(candidates)} Google phone candidates")
    rows: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        print(
            f"[{index}/{len(candidates)}] "
            f"{candidate['pharmacy_name']} {candidate['candidate_phone']}",
            flush=True,
        )
        rows.append(
            verify_candidate(
                candidate,
                args.cache_dir,
                refresh=args.refresh,
                delay=max(0.0, args.delay),
                limit=max(1, args.max_results),
            )
        )
        atomic_csv(args.output_csv, rows)
    print(f"Wrote {len(rows)} rows to {args.output_csv}")
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["decision"]] = counts.get(row["decision"], 0) + 1
    print(json.dumps(counts, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
