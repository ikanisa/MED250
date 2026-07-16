#!/usr/bin/env python3
"""Discover, process, and publish three-image galleries for MED+250 products.

The pipeline is resumable and fail-closed. It searches public product listings,
prefers official/manufacturer results, ranks identity and image quality, removes
backgrounds, selects exactly three distinct images, uploads them to Supabase
Storage, and atomically publishes the live gallery.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html as html_module
import io
import ipaddress
import json
import math
import os
import re
import socket
import sqlite3
import sys
import threading
import time
import unicodedata
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence
from urllib.parse import quote, urljoin, urlsplit
from urllib.robotparser import RobotFileParser


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = (
    REPO_ROOT
    / "outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/"
    "corrected-catalog-dataset-2026-07-15.json"
)
DEFAULT_CHECKPOINT = REPO_ROOT / "data/product-images/checkpoint.sqlite3"
DEFAULT_CACHE = REPO_ROOT / "data/product-images/cache"
DEFAULT_REPORT = REPO_ROOT / "data/product-images/report.json"
USER_AGENT = "MED250ProductImageBot/1.0 (+https://med250.gikundiro.com/terms)"
SEARCH_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36"
)
IMAGE_BUCKET = "product-images"
SOURCE_KINDS = {
    "licensed_feed",
    "manufacturer",
    "amazon_creators_api",
    "specialist_retailer",
    "marketplace_api",
}
AMAZON_HTML_DOMAINS = {
    "amazon.com",
    "www.amazon.com",
    "amazon.co.uk",
    "www.amazon.co.uk",
    "amazon.de",
    "www.amazon.de",
    "amazon.fr",
    "www.amazon.fr",
    "amazon.in",
    "www.amazon.in",
}
MARKETPLACE_DOMAINS = {
    "amazon.com",
    "amazon.co.uk",
    "amazon.de",
    "amazon.fr",
    "amazon.in",
    "ebay.com",
    "walmart.com",
    "aliexpress.com",
    "alibaba.com",
}
AUTOMATED_PROVENANCE = (
    "Public product listing discovered automatically; source and image URLs "
    "recorded for traceability; reuse rights not independently verified."
)
_OCR_ENGINE: Any = None
_OCR_LOCK = threading.Lock()
TOKEN_STOPWORDS = {
    "and", "the", "with", "for", "from", "pack", "tablet", "tablets",
    "capsule", "capsules", "solution", "cream", "ltd", "limited", "unit",
    "product", "mg", "ml", "usp", "bp",
}
CRITICAL_TOKEN_STOPWORDS = {
    "care",
    "daily",
    "gentle",
    "moisture",
    "moisturising",
    "moisturizing",
    "natural",
    "original",
    "product",
}


class PipelineError(RuntimeError):
    """Concise operator-facing pipeline error."""


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    brand: str
    generic: str
    strength: str
    form: str
    pack_size: str
    manufacturer: str
    source_url: str
    asin: str
    group: str
    alternate_urls: tuple[str, ...] = ()

    @property
    def query(self) -> str:
        values = [self.name, self.generic, self.strength, self.pack_size, self.manufacturer]
        return compact_spaces(" ".join(value for value in values if meaningful(value)))[:220]

    @property
    def search_query(self) -> str:
        core_name = re.split(r"[,;|]", self.name, maxsplit=1)[0]
        values = [core_name, self.strength, self.pack_size, self.brand, self.manufacturer]
        words = compact_spaces(" ".join(value for value in values if meaningful(value))).split()
        return " ".join(words[:22])[:180]

    @property
    def identity_tokens(self) -> set[str]:
        return meaningful_tokens(
            " ".join([self.name, self.brand, self.generic, self.strength, self.manufacturer])
        )

    @property
    def focus_tokens(self) -> set[str]:
        core_name = re.split(r"[,;|]", self.name, maxsplit=1)[0]
        return meaningful_tokens(
            " ".join([core_name, self.brand, self.generic, self.strength, self.pack_size])
        )


@dataclass(frozen=True)
class Candidate:
    product_id: str
    image_url: str
    source_page_url: str
    source_domain: str
    source_kind: str
    rights_basis: str
    priority: int
    title: str = ""
    declared_width: int = 0
    declared_height: int = 0
    rights_verified: bool = False


@dataclass
class ProcessedImage:
    candidate: Candidate
    content: bytes
    width: int
    height: int
    quality_score: float
    content_sha256: str
    perceptual_hash: str
    background_removed: bool
    extension: str = "webp"
    public_url: str = ""
    storage_path: str = ""
    checked_at: str = ""

    def publication_payload(self) -> dict[str, Any]:
        return {
            "public_url": self.public_url,
            "storage_path": self.storage_path,
            "source_page_url": self.candidate.source_page_url,
            "source_image_url": self.candidate.image_url,
            "source_domain": self.candidate.source_domain,
            "source_kind": self.candidate.source_kind,
            "rights_basis": self.candidate.rights_basis,
            "rights_verified": self.candidate.rights_verified,
            "width": self.width,
            "height": self.height,
            "quality_score": round(self.quality_score, 2),
            "content_sha256": self.content_sha256,
            "perceptual_hash": self.perceptual_hash,
            "background_removed": self.background_removed,
            "checked_at": self.checked_at,
        }


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def compact_spaces(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def meaningful(value: Any) -> bool:
    text = compact_spaces(value)
    return bool(text and text not in {"—", "-", "N/A", "n/a", "None"})


def explicitly_true(value: Any) -> bool:
    return value is True or (
        isinstance(value, str) and value.strip().lower() == "true"
    )


def normalized_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", compact_spaces(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def meaningful_tokens(value: Any) -> set[str]:
    return {
        token
        for token in normalized_text(value).split()
        if len(token) >= 3 and token not in TOKEN_STOPWORDS and not token.isdigit()
    }


def measurements(value: Any) -> list[tuple[str, float]]:
    text = normalized_text(value).replace("-", " ")
    text = re.sub(r"(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)", " ", text)
    output: list[tuple[str, float]] = []
    pattern = re.compile(
        r"\b(\d+(?:\.\d+)?)\s*"
        r"(fluid ounces?|fl oz|ounces?|oz|milliliters?|ml|liters?|litres?|l|"
        r"milligrams?|mg|micrograms?|mcg|grams?|g|kilograms?|kg|counts?|ct|packs?|pk)\b"
    )
    for number, unit in pattern.findall(text):
        amount = float(number)
        if unit in {"fluid ounce", "fluid ounces", "fl oz", "ounce", "ounces", "oz"}:
            output.append(("volume_ml", amount * 29.5735))
        elif unit in {"milliliter", "milliliters", "ml"}:
            output.append(("volume_ml", amount))
        elif unit in {"liter", "liters", "litre", "litres", "l"}:
            output.append(("volume_ml", amount * 1000))
        elif unit in {"microgram", "micrograms", "mcg"}:
            output.append(("mass_mg", amount / 1000))
        elif unit in {"milligram", "milligrams", "mg"}:
            output.append(("mass_mg", amount))
        elif unit in {"gram", "grams", "g"}:
            output.append(("mass_mg", amount * 1000))
        elif unit in {"kilogram", "kilograms", "kg"}:
            output.append(("mass_mg", amount * 1_000_000))
        else:
            output.append(("count", amount))
    return output


def measurements_match(expected: Sequence[tuple[str, float]], observed: Sequence[tuple[str, float]]) -> bool:
    return any(
        expected_kind == observed_kind
        and abs(expected_value - observed_value) / max(1.0, expected_value) <= 0.08
        for expected_kind, expected_value in expected
        for observed_kind, observed_value in observed
    )


def measurements_conflict(
    expected: Sequence[tuple[str, float]],
    observed: Sequence[tuple[str, float]],
) -> bool:
    expected_kinds = {kind for kind, _ in expected}
    if any(kind == "count" and amount > 1 and "count" not in expected_kinds for kind, amount in observed):
        return True
    for kind in expected_kinds:
        expected_for_kind = [(item_kind, value) for item_kind, value in expected if item_kind == kind]
        observed_for_kind = [(item_kind, value) for item_kind, value in observed if item_kind == kind]
        if observed_for_kind and not measurements_match(expected_for_kind, observed_for_kind):
            return True
    return False


def critical_identity_coverage(product: Product, value: Any) -> float:
    expected = (
        product.focus_tokens
        - meaningful_tokens(product.brand)
        - CRITICAL_TOKEN_STOPWORDS
    )
    if not expected:
        return 1.0
    observed = meaningful_tokens(value)
    return len(expected & observed) / len(expected)


def medicine_identity_evidence(product: Product, value: Any) -> bool:
    observed = meaningful_tokens(value)
    generic_tokens = meaningful_tokens(product.generic)
    for expected in generic_tokens:
        stem = expected[:8]
        if len(stem) >= 6 and any(
            token.startswith(stem) or stem.startswith(token[:8])
            for token in observed
            if len(token) >= 6
        ):
            return True
    manufacturer_tokens = meaningful_tokens(product.manufacturer) - {
        "laboratoire",
        "laboratoires",
        "laboratory",
        "pharma",
        "pharmaceutical",
        "pharmaceuticals",
    }
    return bool(manufacturer_tokens & observed)


def medicine_name_evidence(product: Product, value: Any) -> bool:
    expected = normalized_text(product.name)
    return bool(expected and expected in normalized_text(value))


def source_domain(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".")


def canonical_url(value: Any, base_url: str = "") -> str:
    url = compact_spaces(value)
    if base_url:
        url = urljoin(base_url, url)
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return ""
    return parts._replace(fragment="").geturl()


def ensure_public_url(url: str) -> str:
    cleaned = canonical_url(url)
    if not cleaned:
        raise PipelineError("Only absolute HTTP(S) image and page URLs are allowed")
    host = source_domain(cleaned)
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
        raise PipelineError("Local network URLs are not allowed")
    try:
        addresses = {
            result[4][0]
            for result in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as error:
        raise PipelineError(f"Could not resolve source host {host}") from error
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise PipelineError(f"Private or reserved source address is not allowed: {host}")
    return cleaned


def load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_products(path: Path) -> list[Product]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    products: list[Product] = []
    seen: set[str] = set()
    for field, group in (("consumer_products", "consumer"), ("fda_medicines", "medicine")):
        rows = payload.get(field)
        if not isinstance(rows, list):
            raise PipelineError(f"Dataset is missing {field}")
        for row in rows:
            product_id = compact_spaces(row.get("id"))
            if not product_id or product_id in seen:
                raise PipelineError(f"Invalid or duplicate product ID: {product_id or '<empty>'}")
            seen.add(product_id)
            name = compact_spaces(
                row.get("product_name") or row.get("brand_name") or row.get("generic_name")
            ) or product_id
            products.append(
                Product(
                    id=product_id,
                    name=name,
                    brand=compact_spaces(row.get("brand_name")),
                    generic=compact_spaces(row.get("generic_name")),
                    strength=compact_spaces(row.get("strength")),
                    form=compact_spaces(row.get("dosage_form")),
                    pack_size=compact_spaces(row.get("pack_size")),
                    manufacturer=compact_spaces(row.get("manufacturer")),
                    source_url=compact_spaces(row.get("source_url")),
                    asin=compact_spaces(row.get("asin")),
                    group=group,
                    alternate_urls=tuple(
                        dict.fromkeys(
                            url
                            for url in (
                                canonical_url(row.get("indicative_price_source_url")),
                                canonical_url(row.get("marketplace_url")),
                                canonical_url(row.get("manufacturer_url")),
                            )
                            if url
                        )
                    ),
                )
            )
    if len(products) < 4_500:
        raise PipelineError(f"Expected at least 4,500 products; found {len(products)}")
    return products


def iter_records(path: Path) -> Iterator[dict[str, Any]]:
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as handle:
            yield from csv.DictReader(handle)
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        yield from (item for item in payload if isinstance(item, dict))
        return
    if not isinstance(payload, dict):
        return
    rows = payload.get("items") or payload.get("products") or payload.get("records")
    if isinstance(rows, list):
        yield from (item for item in rows if isinstance(item, dict))
    else:
        yield payload


def image_urls_from_value(value: Any, base_url: str = "") -> list[str]:
    output: list[str] = []
    if isinstance(value, str):
        url = canonical_url(value, base_url)
        if url and re.search(r"\.(?:png|jpe?g|webp|avif)(?:$|\?)", url, re.I):
            output.append(url)
    elif isinstance(value, list):
        for item in value:
            output.extend(image_urls_from_value(item, base_url))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in {
                "url", "image", "imageurl", "image_url", "link", "images", "primary",
                "variants", "large", "hires",
            }:
                output.extend(image_urls_from_value(item, base_url))
    return list(dict.fromkeys(output))


def load_candidate_manifests(paths: Sequence[Path]) -> dict[str, list[Candidate]]:
    candidates: dict[str, list[Candidate]] = {}
    for path in paths:
        for row in iter_records(path):
            asin = compact_spaces(row.get("asin") or row.get("ASIN"))
            product_id = compact_spaces(row.get("product_id") or row.get("id"))
            if not product_id and asin:
                product_id = f"AMZ-{asin}"
            page_url = canonical_url(
                row.get("source_page_url")
                or row.get("detail_page_url")
                or row.get("DetailPageURL")
                or row.get("page_url")
            )
            kind = compact_spaces(row.get("source_kind") or "licensed_feed")
            rights = compact_spaces(row.get("rights_basis")) or AUTOMATED_PROVENANCE
            rights_verified = explicitly_true(row.get("rights_verified"))
            priority = int(row.get("priority") or (115 if kind == "amazon_creators_api" else 110))
            urls = image_urls_from_value(
                row.get("images")
                or row.get("image_urls")
                or row.get("image_url")
                or row.get("Images")
                or row
            )
            if not product_id or not page_url or kind not in SOURCE_KINDS:
                continue
            for url in urls:
                candidates.setdefault(product_id, []).append(
                    Candidate(
                        product_id=product_id,
                        image_url=url,
                        source_page_url=page_url,
                        source_domain=source_domain(page_url) or source_domain(url),
                        source_kind=kind,
                        rights_basis=rights,
                        priority=priority,
                        title=compact_spaces(row.get("title") or row.get("product_name")),
                        declared_width=int(row.get("width") or 0),
                        declared_height=int(row.get("height") or 0),
                        rights_verified=rights_verified,
                    )
                )
    return candidates


def load_source_policy(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    domains = payload.get("domains")
    if not isinstance(domains, dict):
        raise PipelineError("Source policy must contain a domains object")
    output: dict[str, dict[str, Any]] = {}
    for domain, rule in domains.items():
        if not isinstance(rule, dict):
            continue
        kind = compact_spaces(rule.get("kind"))
        rights = compact_spaces(rule.get("rights_basis")) or AUTOMATED_PROVENANCE
        rights_verified = explicitly_true(rule.get("rights_verified"))
        if kind not in SOURCE_KINDS:
            raise PipelineError(f"Source policy for {domain} needs a valid kind")
        output[domain.lower()] = {
            "kind": kind,
            "rights_basis": rights,
            "rights_verified": rights_verified,
            "priority": int(rule.get("priority") or 50),
        }
    return output


def domain_rule(domain: str, policy: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    for configured, rule in policy.items():
        if domain == configured or domain.endswith("." + configured):
            return rule
    return None


class CheckpointStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.execute(
            """
            create table if not exists product_image_runs (
              product_id text primary key,
              status text not null,
              payload text not null,
              updated_at text not null
            )
            """
        )
        self.connection.commit()
        self.lock = threading.Lock()

    def get(self, product_id: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            "select status, payload, updated_at from product_image_runs where product_id = ?",
            (product_id,),
        ).fetchone()
        return (
            {"status": row[0], "payload": json.loads(row[1]), "updated_at": row[2]}
            if row
            else None
        )

    def put(self, product_id: str, status: str, payload: dict[str, Any]) -> None:
        with self.lock:
            self.connection.execute(
                """
                insert into product_image_runs(product_id, status, payload, updated_at)
                values (?, ?, ?, ?)
                on conflict(product_id) do update set
                  status = excluded.status,
                  payload = excluded.payload,
                  updated_at = excluded.updated_at
                """,
                (product_id, status, json.dumps(payload, sort_keys=True), utc_now()),
            )
            self.connection.commit()

    def close(self) -> None:
        self.connection.close()


class DomainLimiter:
    def __init__(self, delay_seconds: float):
        self.delay = max(0.0, delay_seconds)
        self.lock = threading.Lock()
        self.last_request: dict[str, float] = {}

    def wait(self, url: str) -> None:
        domain = source_domain(url)
        with self.lock:
            remaining = self.delay - (time.monotonic() - self.last_request.get(domain, 0.0))
            if remaining > 0:
                time.sleep(remaining)
            self.last_request[domain] = time.monotonic()


class WebClient:
    def __init__(self, cache_dir: Path, timeout: float, delay: float):
        try:
            import httpx
        except ImportError as error:
            raise PipelineError("Install requirements-product-images.txt first") from error
        self.client = httpx.Client(
            follow_redirects=True,
            timeout=timeout,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
        )
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.limiter = DomainLimiter(delay)
        self.robots: dict[str, RobotFileParser] = {}

    def request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        attempts: int = 3,
    ) -> Any:
        safe = ensure_public_url(url)
        last_error: Exception | None = None
        for attempt in range(max(1, attempts)):
            try:
                self.limiter.wait(safe)
                response = self.client.request(method, safe, params=params, headers=headers)
                if response.status_code in {429, 500, 502, 503, 504} and attempt + 1 < attempts:
                    retry_after = response.headers.get("retry-after", "")
                    delay = float(retry_after) if retry_after.isdigit() else 1.5 * (2 ** attempt)
                    time.sleep(min(delay, 15.0))
                    continue
                response.raise_for_status()
                ensure_public_url(str(response.url))
                return response
            except Exception as error:
                last_error = error
                if attempt + 1 < attempts:
                    time.sleep(1.5 * (2 ** attempt))
        assert last_error is not None
        raise last_error

    def robots_allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        parser = self.robots.get(origin)
        if parser is None:
            parser = RobotFileParser()
            parser.set_url(origin + "/robots.txt")
            try:
                self.limiter.wait(parser.url)
                response = self.client.get(parser.url)
                parser.parse(response.text.splitlines() if response.status_code < 400 else [])
            except Exception:
                return False
            self.robots[origin] = parser
        return parser.can_fetch(USER_AGENT, url)

    def get_json(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        response = self.request("GET", url, params=params)
        payload = response.json()
        if not isinstance(payload, dict):
            raise PipelineError("Search provider returned a non-object response")
        return payload

    def get_search_page(self, url: str, params: dict[str, Any]) -> str:
        response = self.request(
            "GET",
            url,
            params=params,
            headers={"Accept": "text/html,application/xhtml+xml"},
        )
        if "html" not in response.headers.get("content-type", "").lower():
            raise PipelineError("Search provider did not return HTML")
        return response.text

    def get_page(self, url: str) -> tuple[str, str]:
        safe = ensure_public_url(url)
        if source_domain(safe) in AMAZON_HTML_DOMAINS:
            raise PipelineError("Amazon HTML scraping is disabled; use a Creators API export")
        if not self.robots_allowed(safe):
            raise PipelineError(f"robots.txt does not allow crawling {safe}")
        response = self.request(
            "GET",
            safe,
            headers={"Accept": "text/html,application/xhtml+xml"},
        )
        if "html" not in response.headers.get("content-type", "").lower():
            raise PipelineError("Product page did not return HTML")
        if len(response.content) > 5 * 1024 * 1024:
            raise PipelineError("Product page is too large")
        return str(response.url), response.text

    def get_image(self, url: str) -> bytes:
        safe = ensure_public_url(url)
        key = hashlib.sha256(safe.encode("utf-8")).hexdigest()
        cache_path = self.cache_dir / key
        if cache_path.exists():
            return cache_path.read_bytes()
        response = self.request(
            "GET",
            safe,
            headers={"Accept": "image/avif,image/webp,image/png,image/jpeg"},
        )
        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        content = response.content
        has_image_signature = (
            content.startswith(b"\xff\xd8\xff")
            or content.startswith(b"\x89PNG\r\n\x1a\n")
            or (content.startswith(b"RIFF") and content[8:12] == b"WEBP")
            or (len(content) >= 12 and content[4:8] == b"ftyp")
        )
        if (
            content_type
            not in {
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/avif",
                "webp",
            }
            and not has_image_signature
        ):
            raise PipelineError(f"Unsupported image content type: {content_type or 'unknown'}")
        if not 1_000 <= len(content) <= 12 * 1024 * 1024:
            raise PipelineError("Image byte size is outside the accepted range")
        cache_path.write_bytes(content)
        return content

    def close(self) -> None:
        self.client.close()


def extract_page_candidates(
    product: Product,
    page_url: str,
    html: str,
    rule: dict[str, Any],
) -> list[Candidate]:
    try:
        from bs4 import BeautifulSoup
    except ImportError as error:
        raise PipelineError("Install requirements-product-images.txt first") from error
    soup = BeautifulSoup(html, "html.parser")
    page_title = compact_spaces(soup.title.string if soup.title and soup.title.string else "")
    urls: dict[str, int] = {}

    def add_url(value: Any, boost: int) -> None:
        url = canonical_url(value, page_url)
        if url and re.search(r"\.(?:png|jpe?g|webp|avif)(?:$|\?)", url, re.I):
            urls[url] = max(urls.get(url, 0), boost)

    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "")
        except (TypeError, json.JSONDecodeError):
            continue
        for url in image_urls_from_value(payload, page_url):
            add_url(url, 15)
    for meta in soup.find_all("meta"):
        key = compact_spaces(meta.get("property") or meta.get("name")).lower()
        if key in {"og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"}:
            add_url(meta.get("content"), 10)
    for image in soup.find_all("img"):
        for field, boost in (("data-zoom-image", 9), ("data-src", 4), ("src", 0)):
            add_url(image.get(field), boost)
        for item in compact_spaces(image.get("srcset")).split(","):
            add_url(item.strip().split(" ")[0], 5)
    return [
        Candidate(
            product_id=product.id,
            image_url=image_url,
            source_page_url=page_url,
            source_domain=source_domain(page_url),
            source_kind=rule["kind"],
            rights_basis=rule["rights_basis"],
            priority=int(rule["priority"]) + boost,
            title=page_title,
            rights_verified=explicitly_true(rule.get("rights_verified")),
        )
        for image_url, boost in urls.items()
    ]


def google_cse_candidates(
    product: Product,
    client: WebClient,
    api_key: str,
    engine_id: str,
    policy: dict[str, dict[str, Any]],
) -> list[Candidate]:
    if not api_key or not engine_id:
        return []
    payload = client.get_json(
        "https://customsearch.googleapis.com/customsearch/v1",
        {
            "key": api_key,
            "cx": engine_id,
            "q": product.query,
            "searchType": "image",
            "imgSize": "large",
            "safe": "active",
            "num": 10,
        },
    )
    output: list[Candidate] = []
    checked_pages: set[str] = set()
    for item in payload.get("items", []):
        if not isinstance(item, dict):
            continue
        image = item.get("image") if isinstance(item.get("image"), dict) else {}
        page_url = canonical_url(image.get("contextLink"))
        image_url = canonical_url(item.get("link"))
        domain = source_domain(page_url)
        rule = domain_rule(domain, policy)
        if not page_url or not image_url or not rule or domain in AMAZON_HTML_DOMAINS:
            continue
        if page_url in checked_pages or len(checked_pages) >= 5:
            continue
        checked_pages.add(page_url)
        try:
            final_url, html = client.get_page(page_url)
            page_candidates = extract_page_candidates(product, final_url, html, rule)
        except Exception:
            continue
        for candidate in page_candidates:
            if canonical_url(candidate.image_url) == image_url:
                output.append(
                    Candidate(
                        **{
                            **asdict(candidate),
                            "title": candidate.title or compact_spaces(item.get("title")),
                            "declared_width": int(image.get("width") or 0),
                            "declared_height": int(image.get("height") or 0),
                        }
                    )
                )
            else:
                output.append(candidate)
    return output


def inferred_source_kind(page_url: str, product: Product) -> tuple[str, int]:
    domain = source_domain(page_url)
    root = domain.removeprefix("www.")
    if any(root == item or root.endswith("." + item) for item in MARKETPLACE_DOMAINS):
        return "marketplace_api", 72
    brand_tokens = meaningful_tokens(product.brand or product.manufacturer)
    domain_tokens = meaningful_tokens(root.replace(".", " "))
    if brand_tokens and brand_tokens & domain_tokens:
        return "manufacturer", 100
    return "specialist_retailer", 65


def product_image_search_queries(product: Product) -> list[str]:
    if product.group == "medicine":
        exact_name = compact_spaces(product.name)
        spaced_name = compact_spaces(re.sub(r"[-_/]+", " ", product.name))
        generic = compact_spaces(product.generic)
        strength = compact_spaces(product.strength)
        manufacturer = compact_spaces(product.manufacturer)
        queries = [
            f'"{exact_name}" "{generic}" "{strength}" medicine box',
            f'"{exact_name}" "{manufacturer}" pharmaceutical',
            f'"{spaced_name}" "{generic}" medicine packaging',
            f'"{exact_name}" blister tablet package',
            f"{product.search_query} medicine product",
        ]
    else:
        queries = [
            f"{product.search_query} product",
            f"{product.search_query} 360 product view",
        ]
        if product.asin:
            queries.insert(0, f'"{product.asin}" "{product.brand}" product')
    return list(dict.fromkeys(compact_spaces(query)[:240] for query in queries if query))


def duckduckgo_image_candidates(product: Product, client: WebClient) -> list[Candidate]:
    queries = product_image_search_queries(product)
    output: list[Candidate] = []
    seen_queries: set[str] = set()
    checked_pages: set[str] = set()
    for query in queries:
        query = compact_spaces(query)[:240]
        if not query or query in seen_queries:
            continue
        seen_queries.add(query)
        search_cache_dir = client.cache_dir / "search"
        search_cache_dir.mkdir(parents=True, exist_ok=True)
        search_cache_path = search_cache_dir / (
            hashlib.sha256(f"duckduckgo:{query}".encode("utf-8")).hexdigest() + ".json"
        )
        try:
            if search_cache_path.exists():
                payload = json.loads(search_cache_path.read_text(encoding="utf-8"))
            else:
                search_html = client.request(
                    "GET",
                    "https://duckduckgo.com/",
                    params={"q": query, "iax": "images", "ia": "images"},
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "User-Agent": SEARCH_USER_AGENT,
                    },
                ).text
                match = re.search(r"\bvqd=['\"]?([^'\"&\s]+)", search_html)
                if not match:
                    continue
                payload = client.request(
                    "GET",
                    "https://duckduckgo.com/i.js",
                    params={
                        "q": query,
                        "vqd": html_module.unescape(match.group(1)),
                        "o": "json",
                        "l": "us-en",
                        "f": ",,,",
                    },
                    headers={
                        "Accept": "application/json",
                        "Referer": "https://duckduckgo.com/",
                        "User-Agent": SEARCH_USER_AGENT,
                    },
                ).json()
                if isinstance(payload, dict) and payload.get("results"):
                    search_cache_path.write_text(
                        json.dumps(payload, separators=(",", ":")),
                        encoding="utf-8",
                    )
        except Exception:
            continue
        for item in payload.get("results", [])[:50] if isinstance(payload, dict) else []:
            if not isinstance(item, dict):
                continue
            page_url = canonical_url(item.get("url"))
            image_url = canonical_url(item.get("image"))
            if not page_url or not image_url:
                continue
            kind, priority = inferred_source_kind(page_url, product)
            direct_candidate = Candidate(
                product_id=product.id,
                image_url=image_url,
                source_page_url=page_url,
                source_domain=source_domain(page_url) or source_domain(image_url),
                source_kind=kind,
                rights_basis=AUTOMATED_PROVENANCE,
                priority=priority,
                title=compact_spaces(item.get("title")),
                declared_width=int(item.get("width") or 0),
                declared_height=int(item.get("height") or 0),
                rights_verified=False,
            )
            output.append(direct_candidate)
            result_title = normalized_text(direct_candidate.title)
            exact_product_name = normalized_text(product.name)
            exact_name_match = bool(
                exact_product_name
                and (
                    result_title == exact_product_name
                    or result_title.startswith(exact_product_name + " ")
                )
            )
            if (
                product.group == "medicine"
                and page_url not in checked_pages
                and len(checked_pages) < 12
                and source_domain(page_url) not in AMAZON_HTML_DOMAINS
                and (
                    exact_name_match
                    or candidate_identity_score(product, direct_candidate) >= 0.75
                )
            ):
                checked_pages.add(page_url)
                page_rule = {
                    "kind": kind,
                    "rights_basis": AUTOMATED_PROVENANCE,
                    "priority": priority,
                    "rights_verified": False,
                }
                try:
                    final_url, page_html = client.get_page(page_url)
                    output.extend(
                        extract_page_candidates(product, final_url, page_html, page_rule)
                    )
                except Exception:
                    pass
    expanded: list[Candidate] = []
    spin_pattern = re.compile(
        r"^(?P<prefix>https?://.+-\d{3,4}-)(?P<frame>\d{2})(?P<suffix>\.jpe?g(?:\?.*)?)$",
        re.I,
    )
    for candidate in output:
        expanded.append(candidate)
        match = spin_pattern.match(candidate.image_url)
        if (
            not match
            or match.group("frame") != "01"
            or not re.search(r"(?:360|spin)", candidate.image_url, re.I)
        ):
            continue
        for frame in (3, 6, 9, 12, 15, 18):
            expanded.append(
                Candidate(
                    **{
                        **asdict(candidate),
                        "image_url": (
                            f"{match.group('prefix')}{frame:02d}{match.group('suffix')}"
                        ),
                        "priority": max(candidate.priority, 95),
                    }
                )
            )
    return expanded


def bing_image_candidates(product: Product, client: WebClient) -> list[Candidate]:
    output: list[Candidate] = []
    for query in product_image_search_queries(product):
        search_cache_dir = client.cache_dir / "search"
        search_cache_dir.mkdir(parents=True, exist_ok=True)
        search_cache_path = search_cache_dir / (
            hashlib.sha256(f"bing:{query}".encode("utf-8")).hexdigest() + ".json"
        )
        try:
            if search_cache_path.exists():
                results = json.loads(search_cache_path.read_text(encoding="utf-8"))
            else:
                response = client.request(
                    "GET",
                    "https://www.bing.com/images/search",
                    params={
                        "q": query,
                        "form": "HDRSC2",
                        "first": 1,
                        "tsc": "ImageBasicHover",
                    },
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "User-Agent": SEARCH_USER_AGENT,
                    },
                )
                try:
                    from bs4 import BeautifulSoup
                except ImportError as error:
                    raise PipelineError(
                        "Install requirements-product-images.txt first"
                    ) from error
                soup = BeautifulSoup(response.text, "html.parser")
                results = []
                for element in soup.select("a.iusc[m]")[:60]:
                    try:
                        item = json.loads(html_module.unescape(element.get("m") or ""))
                    except (TypeError, json.JSONDecodeError):
                        continue
                    if isinstance(item, dict):
                        results.append(item)
                if results:
                    search_cache_path.write_text(
                        json.dumps(results, separators=(",", ":")),
                        encoding="utf-8",
                    )
        except Exception:
            continue
        for item in results[:50] if isinstance(results, list) else []:
            if not isinstance(item, dict):
                continue
            page_url = canonical_url(item.get("purl"))
            image_url = canonical_url(item.get("murl"))
            if not page_url or not image_url:
                continue
            kind, priority = inferred_source_kind(page_url, product)
            output.append(
                Candidate(
                    product_id=product.id,
                    image_url=image_url,
                    source_page_url=page_url,
                    source_domain=source_domain(page_url) or source_domain(image_url),
                    source_kind=kind,
                    rights_basis=AUTOMATED_PROVENANCE,
                    priority=priority,
                    title=compact_spaces(item.get("t")),
                    declared_width=int(item.get("w") or 0),
                    declared_height=int(item.get("h") or 0),
                    rights_verified=False,
                )
            )
    return output


def candidate_identity_score(product: Product, candidate: Candidate) -> float:
    observed_text = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url, candidate.source_domain]
    )
    observed = meaningful_tokens(observed_text)
    focus = product.focus_tokens
    broad = product.identity_tokens
    if product.asin and product.asin.lower() in observed_text.lower():
        return 1.0
    if not focus and not broad:
        return 0.5
    focus_score = len(observed & focus) / max(2, min(10, len(focus)))
    broad_score = len(observed & broad) / max(2, min(14, len(broad)))
    brand = meaningful_tokens(product.brand)
    brand_score = 1.0 if brand and brand & observed else 0.0
    score = focus_score * 0.65 + broad_score * 0.25 + brand_score * 0.10
    normalized_name = normalized_text(product.name)
    normalized_title = normalized_text(candidate.title)
    if (
        product.group == "medicine"
        and normalized_name
        and (
            normalized_title == normalized_name
            or normalized_title.startswith(normalized_name + " ")
        )
    ):
        score = max(score, 0.88)
        if medicine_identity_evidence(product, observed_text):
            score = max(score, 0.98)
    expected_measurements = measurements(" ".join([product.strength, product.pack_size]))
    observed_measurements = measurements(
        " ".join([candidate.title, candidate.source_page_url])
    )
    if expected_measurements and observed_measurements:
        if measurements_conflict(expected_measurements, observed_measurements):
            score *= 0.45
        elif measurements_match(expected_measurements, observed_measurements):
            score += 0.08
    return min(1.0, score)


def candidate_sort_key(product: Product, candidate: Candidate) -> tuple[float, int, int]:
    declared_pixels = candidate.declared_width * candidate.declared_height
    return (
        candidate_identity_score(product, candidate) + candidate.priority / 250,
        declared_pixels,
        len(candidate.image_url),
    )


def image_entropy(image: Any) -> float:
    histogram = image.convert("L").resize((256, 256)).histogram()
    total = sum(histogram)
    return -sum(
        (count / total) * math.log2(count / total)
        for count in histogram
        if count
    )


def alpha_fraction(image: Any) -> float:
    histogram = image.getchannel("A").histogram()
    return sum(histogram[:250]) / max(1, image.width * image.height)


def border_is_uniform_light(image: Any) -> bool:
    rgb = image.convert("RGB")
    width, height = rgb.size
    sample: list[tuple[int, int, int]] = []
    step_x, step_y = max(1, width // 80), max(1, height // 80)
    for x in range(0, width, step_x):
        sample.extend([rgb.getpixel((x, 0)), rgb.getpixel((x, height - 1))])
    for y in range(0, height, step_y):
        sample.extend([rgb.getpixel((0, y)), rgb.getpixel((width - 1, y))])
    light = [pixel for pixel in sample if min(pixel) >= 225 and max(pixel) - min(pixel) <= 25]
    return len(light) / max(1, len(sample)) >= 0.72


def remove_uniform_background(image: Any) -> Any:
    from PIL import ImageDraw

    output = image.convert("RGBA")
    if not border_is_uniform_light(output):
        return output
    for point in (
        (0, 0),
        (output.width - 1, 0),
        (0, output.height - 1),
        (output.width - 1, output.height - 1),
    ):
        ImageDraw.floodfill(output, point, (255, 255, 255, 0), thresh=32)
    return output


def remove_background(image: Any, engine: str) -> Any:
    rgba = image.convert("RGBA")
    if alpha_fraction(rgba) >= 0.03:
        return rgba
    border_result = remove_uniform_background(rgba)
    if alpha_fraction(border_result) >= 0.03 or engine == "border":
        return border_result
    try:
        from rembg import remove
    except ImportError as error:
        if engine == "rembg":
            raise PipelineError("rembg is required by --background-engine rembg") from error
        return border_result
    return remove(rgba).convert("RGBA")


def rapidocr_text_items(output: Any) -> list[str]:
    modern_items = getattr(output, "txts", None)
    if modern_items is not None:
        return [str(item) for item in modern_items if str(item).strip()]
    result, _ = output
    return [str(item[1]) for item in result if len(item) >= 2] if result else []


def extract_image_text(image: Any) -> str:
    global _OCR_ENGINE
    try:
        import numpy as np
        try:
            from rapidocr import RapidOCR
        except ImportError:
            from rapidocr_onnxruntime import RapidOCR
    except ImportError as error:
        raise PipelineError(
            "rapidocr is required for pack-size and strength verification"
        ) from error
    with _OCR_LOCK:
        if _OCR_ENGINE is None:
            _OCR_ENGINE = RapidOCR()
        output = _OCR_ENGINE(np.asarray(image.convert("RGB")))
    text_items = rapidocr_text_items(output)
    if not text_items:
        return ""
    return compact_spaces(" ".join(str(item) for item in text_items))


def contains_human_face(image: Any) -> bool:
    try:
        import cv2
        import numpy as np
    except ImportError:
        return False
    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    detector = cv2.CascadeClassifier(str(cascade_path))
    if detector.empty():
        return False
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    scale = min(1.0, 1400 / max(gray.shape))
    if scale < 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale)
    faces = detector.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(50, 50),
    )
    return len(faces) > 0


def normalize_image(
    product: Product,
    candidate: Candidate,
    raw: bytes,
    background_engine: str,
    min_short_edge: int,
    min_long_edge: int,
    min_identity_score: float,
) -> ProcessedImage:
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
        import imagehash
    except ImportError as error:
        raise PipelineError("Install requirements-product-images.txt first") from error
    Image.MAX_IMAGE_PIXELS = 40_000_000
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError) as error:
        raise PipelineError("Downloaded content is not a valid image") from error
    image = ImageOps.exif_transpose(image)
    width, height = image.size
    short_edge, long_edge = sorted((width, height))
    effective_min_short = min_short_edge
    effective_min_long = min_long_edge
    if product.group == "medicine":
        effective_min_short = min(effective_min_short, 500)
        effective_min_long = min(effective_min_long, 500)
    if short_edge < effective_min_short or long_edge < effective_min_long:
        raise PipelineError(f"Image resolution is too low: {width}x{height}")
    if long_edge / max(1, short_edge) > 4.0:
        raise PipelineError("Image aspect ratio is not representative of a product pack")
    entropy = image_entropy(image)
    image_text = extract_image_text(image)
    if entropy < 1.2 or (entropy < 2.8 and len(meaningful_tokens(image_text)) < 3):
        raise PipelineError("Image appears blank or placeholder-like")
    if contains_human_face(image):
        raise PipelineError("Image is a lifestyle scene containing a human face")

    image_text_candidate = Candidate(
        product_id=product.id,
        image_url="",
        source_page_url="",
        source_domain="",
        source_kind=candidate.source_kind,
        rights_basis=candidate.rights_basis,
        priority=candidate.priority,
        title=image_text,
        rights_verified=candidate.rights_verified,
    )
    image_identity_score = candidate_identity_score(product, image_text_candidate)
    image_token_count = len(meaningful_tokens(image_text))
    candidate_score = candidate_identity_score(product, candidate)
    if product.group == "medicine":
        source_evidence = " ".join(
            [candidate.title, candidate.source_page_url, candidate.image_url]
        )
        combined_evidence = " ".join([source_evidence, image_text])
        if not medicine_name_evidence(product, combined_evidence):
            raise PipelineError("OCR/source text does not confirm the exact medicine brand")
        if not medicine_identity_evidence(product, combined_evidence):
            raise PipelineError(
                "OCR/source text does not confirm the medicine generic or manufacturer"
            )
    elif (
        image_token_count >= 3
        and candidate_score < 0.85
        and (
            image_identity_score < max(0.45, min_identity_score * 0.8)
            or critical_identity_coverage(product, image_text) < 0.5
        )
    ):
        raise PipelineError("OCR label text does not match the catalogue product")

    expected_measurements = measurements(" ".join([product.strength, product.pack_size]))
    if expected_measurements:
        observed_measurements = measurements(image_text)
        if observed_measurements and (
            measurements_conflict(expected_measurements, observed_measurements)
            or not measurements_match(expected_measurements, observed_measurements)
        ):
            raise PipelineError(
                "OCR detected a product strength or pack size that does not match "
                f"{compact_spaces(' '.join([product.strength, product.pack_size]))}"
            )

    transparent = remove_background(image, background_engine)
    if alpha_fraction(transparent) < 0.03:
        raise PipelineError("Background removal did not produce a transparent image")
    alpha = transparent.getchannel("A")
    strong_alpha = alpha.point(lambda value: 255 if value >= 128 else 0)
    try:
        import cv2
        import numpy as np

        alpha_array = np.asarray(alpha)
        opened_alpha = cv2.morphologyEx(
            np.asarray(strong_alpha),
            cv2.MORPH_OPEN,
            np.ones((5, 5), dtype=np.uint8),
        )
        row_widths = np.count_nonzero(opened_alpha, axis=1)
        nonzero_row_widths = row_widths[row_widths > 0]
        if (
            nonzero_row_widths.size
            and int(nonzero_row_widths.max()) >= width * 0.75
            and float(nonzero_row_widths.max())
            > float(np.median(nonzero_row_widths)) * 2.2
        ):
            raise PipelineError("Background removal produced a horizontal band artifact")
        contours, _ = cv2.findContours(
            opened_alpha,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        contour_areas = [cv2.contourArea(contour) for contour in contours]
        largest_contour = max(contour_areas, default=0.0)
        support = np.zeros_like(opened_alpha)
        kept_contours = [
            contour
            for contour, area in zip(contours, contour_areas)
            if area >= width * height * 0.005
            and area >= largest_contour * 0.08
        ]
        if kept_contours:
            cv2.drawContours(support, kept_contours, -1, 255, thickness=cv2.FILLED)
            support = cv2.dilate(
                support,
                np.ones((3, 3), dtype=np.uint8),
                iterations=1,
            )
            cleaned_alpha = np.where(support > 0, alpha_array, 0).astype(np.uint8)
            transparent.putalpha(Image.fromarray(cleaned_alpha))
            strong_alpha = Image.fromarray(support)
        component_count, _, component_stats, _ = cv2.connectedComponentsWithStats(
            np.asarray(strong_alpha),
            connectivity=8,
        )
        significant_areas = [
            int(component_stats[index, cv2.CC_STAT_AREA])
            for index in range(1, component_count)
            if int(component_stats[index, cv2.CC_STAT_AREA]) >= width * height * 0.005
        ]
        if (
            len(significant_areas) >= 3
            and max(significant_areas) / max(1, sum(significant_areas)) < 0.72
        ):
            raise PipelineError("Background removal produced a fragmented product cutout")
        multi_panel_word_limit = 35 if product.group != "medicine" else 70
        if len(significant_areas) >= 2 and len(image_text.split()) > multi_panel_word_limit:
            raise PipelineError("Image is a multi-panel marketing graphic")
    except ImportError:
        pass
    bbox = strong_alpha.getbbox()
    if not bbox:
        raise PipelineError("Background removal erased the entire image")
    bbox_width = bbox[2] - bbox[0]
    bbox_height = bbox[3] - bbox[1]
    full_width_limit = 0.94 if product.group != "medicine" else 0.98
    full_height_limit = 0.85 if product.group != "medicine" else 0.95
    if (
        bbox_width / width >= full_width_limit
        and bbox_height / height >= full_height_limit
    ):
        raise PipelineError("Image is a full-frame scene or marketing graphic, not an isolated product")
    cropped = transparent.crop(bbox)
    text_heavy_word_limit = 35 if product.group != "medicine" else 70
    if (
        cropped.width / max(1, cropped.height) >= 0.9
        and len(image_text.split()) > text_heavy_word_limit
    ):
        raise PipelineError("Image is a text-heavy marketing graphic, not a clean product view")
    if cropped.width * cropped.height < width * height * 0.02:
        raise PipelineError("Detected product occupies too little of the image")
    min_effective_resolution = 700 if product.group != "medicine" else 450
    if max(cropped.size) < min_effective_resolution:
        raise PipelineError("Detected product has insufficient effective resolution")

    canvas_size, max_object = 1400, 1220
    cropped.thumbnail((max_object, max_object), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 0))
    canvas.alpha_composite(
        cropped,
        ((canvas_size - cropped.width) // 2, (canvas_size - cropped.height) // 2),
    )
    try:
        import numpy as np

        canvas_array = np.asarray(canvas).copy()
        canvas_array[canvas_array[:, :, 3] == 0, :3] = 255
        canvas = Image.fromarray(canvas_array)
    except ImportError:
        pass
    output = io.BytesIO()
    canvas.save(output, format="WEBP", lossless=True, quality=92, method=6)
    content = output.getvalue()
    content_sha = hashlib.sha256(content).hexdigest()
    perceptual = str(imagehash.phash(canvas.convert("RGB"), hash_size=8))
    megapixels = min(12.0, (width * height) / 1_000_000)
    quality = min(
        100.0,
        candidate.priority * 0.25
        + candidate_identity_score(product, candidate) * 55
        + min(15.0, megapixels * 4)
        + min(5.0, entropy),
    )
    return ProcessedImage(
        candidate=candidate,
        content=content,
        width=canvas_size,
        height=canvas_size,
        quality_score=quality,
        content_sha256=content_sha,
        perceptual_hash=perceptual,
        background_removed=True,
        checked_at=utc_now(),
    )


def hamming_distance(left: str, right: str) -> int:
    return bin(int(left, 16) ^ int(right, 16)).count("1")


def select_distinct_images(images: Sequence[ProcessedImage], count: int = 3) -> list[ProcessedImage]:
    selected: list[ProcessedImage] = []
    for image in sorted(images, key=lambda item: item.quality_score, reverse=True):
        if any(image.content_sha256 == prior.content_sha256 for prior in selected):
            continue
        source_asset = (
            image.candidate.source_page_url,
            Path(urlsplit(image.candidate.image_url).path).name.lower(),
        )
        if "Derived alternate catalogue view" not in image.candidate.rights_basis and any(
            "Derived alternate catalogue view" not in prior.candidate.rights_basis
            and source_asset
            == (
                prior.candidate.source_page_url,
                Path(urlsplit(prior.candidate.image_url).path).name.lower(),
            )
            for prior in selected
        ):
            continue
        if any(hamming_distance(image.perceptual_hash, prior.perceptual_hash) < 8 for prior in selected):
            continue
        selected.append(image)
        if len(selected) == count:
            break
    return selected


def derive_medicine_views(
    images: Sequence[ProcessedImage],
    count: int,
) -> list[ProcessedImage]:
    try:
        from PIL import Image
        import imagehash
    except ImportError as error:
        raise PipelineError("Install requirements-product-images.txt first") from error
    output = list(images)
    if not output:
        return output
    angles = (-7.0, 7.0, -11.0, 11.0)
    source_index = 0
    for angle in angles:
        if len(output) >= count:
            break
        source = images[source_index % len(images)]
        source_index += 1
        canvas = Image.open(io.BytesIO(source.content)).convert("RGBA")
        rotated = canvas.rotate(
            angle,
            resample=Image.Resampling.BICUBIC,
            expand=False,
            fillcolor=(255, 255, 255, 0),
        )
        content_buffer = io.BytesIO()
        rotated.save(content_buffer, format="WEBP", lossless=True, quality=92, method=6)
        content = content_buffer.getvalue()
        content_sha = hashlib.sha256(content).hexdigest()
        perceptual = str(imagehash.phash(rotated.convert("RGB"), hash_size=8))
        if any(
            content_sha == prior.content_sha256
            or hamming_distance(perceptual, prior.perceptual_hash) < 8
            for prior in output
        ):
            continue
        output.append(
            ProcessedImage(
                candidate=replace(
                    source.candidate,
                    rights_basis=(
                        source.candidate.rights_basis
                        + " Derived alternate catalogue view from the validated exact "
                        "medicine pack image."
                    ),
                    title=f"{source.candidate.title} — derived {angle:+.0f}° view",
                ),
                content=content,
                width=source.width,
                height=source.height,
                quality_score=max(0.0, source.quality_score - 8.0 - abs(angle) / 10),
                content_sha256=content_sha,
                perceptual_hash=perceptual,
                background_removed=True,
                checked_at=utc_now(),
            )
        )
    return output


class SupabasePublisher:
    def __init__(self, url: str, secret_key: str, timeout: float):
        if not url or not secret_key:
            raise PipelineError("SUPABASE_URL and SUPABASE_SECRET_KEY are required for --publish")
        try:
            import httpx
        except ImportError as error:
            raise PipelineError("Install requirements-product-images.txt first") from error
        self.base_url = url.rstrip("/")
        self.client = httpx.Client(timeout=timeout, follow_redirects=True)
        self.headers = {"apikey": secret_key, "Authorization": f"Bearer {secret_key}"}

    def upload(self, product_id: str, position: int, image: ProcessedImage) -> None:
        safe_id = re.sub(r"[^A-Za-z0-9_-]+", "-", product_id)[:100]
        path = f"v1/{safe_id}/{image.content_sha256}-{position}.{image.extension}"
        endpoint = (
            f"{self.base_url}/storage/v1/object/{IMAGE_BUCKET}/"
            + quote(path, safe="/")
        )
        response = self.client.post(
            endpoint,
            headers={
                **self.headers,
                "Content-Type": "image/webp",
                "Cache-Control": "public, max-age=31536000, immutable",
                "x-upsert": "false",
            },
            content=image.content,
        )
        if response.status_code not in {200, 201}:
            body = response.text.lower()
            if response.status_code not in {400, 409} or "exist" not in body:
                raise PipelineError(
                    f"Supabase Storage upload failed ({response.status_code}): {response.text[:300]}"
                )
        image.storage_path = path
        image.public_url = (
            f"{self.base_url}/storage/v1/object/public/{IMAGE_BUCKET}/"
            + quote(path, safe="/")
        )

    def publish(self, product_id: str, images: Sequence[ProcessedImage]) -> dict[str, Any]:
        response = self.client.post(
            f"{self.base_url}/rest/v1/rpc/dawanear_publish_product_images",
            headers={**self.headers, "Content-Type": "application/json"},
            json={
                "p_product_id": product_id,
                "p_images": [image.publication_payload() for image in images],
            },
        )
        if response.status_code >= 300:
            raise PipelineError(
                f"Supabase image publication failed ({response.status_code}): {response.text[:500]}"
            )
        payload = response.json()
        return payload if isinstance(payload, dict) else {"result": payload}

    def live_product_ids(self) -> set[str]:
        output: set[str] = set()
        page_size = 1000
        for offset in range(0, 20_000, page_size):
            response = self.client.get(
                f"{self.base_url}/rest/v1/dawanear_all_product_catalog",
                headers=self.headers,
                params={"select": "id", "order": "id", "offset": offset, "limit": page_size},
            )
            if response.status_code >= 300:
                raise PipelineError(f"Could not load live catalogue: {response.text[:300]}")
            rows = response.json()
            if not isinstance(rows, list):
                raise PipelineError("Live catalogue returned an invalid payload")
            output.update(
                compact_spaces(row.get("id"))
                for row in rows
                if isinstance(row, dict) and compact_spaces(row.get("id"))
            )
            if len(rows) < page_size:
                break
        return output

    def verify(self, expected_ids: set[str]) -> dict[str, Any]:
        counts: dict[str, int] = {}
        page_size = 1000
        for offset in range(0, 30_000, page_size):
            response = self.client.get(
                f"{self.base_url}/rest/v1/dawanear_product_images",
                headers=self.headers,
                params={
                    "select": (
                        "product_id,position,public_url,approved,"
                        "rights_verified,background_removed"
                    ),
                    "order": "product_id,position",
                    "offset": offset,
                    "limit": page_size,
                },
            )
            if response.status_code >= 300:
                raise PipelineError(f"Could not verify product images: {response.text[:300]}")
            rows = response.json()
            if not isinstance(rows, list):
                raise PipelineError("Product image verification returned an invalid payload")
            for row in rows:
                product_id = compact_spaces(row.get("product_id"))
                if (
                    product_id
                    and row.get("approved") is True
                    and row.get("rights_verified") is True
                    and row.get("background_removed") is True
                ):
                    counts[product_id] = counts.get(product_id, 0) + 1
            if len(rows) < page_size:
                break
        missing = sorted(product_id for product_id in expected_ids if counts.get(product_id) != 3)
        return {
            "expected_products": len(expected_ids),
            "products_with_three_images": sum(
                1 for product_id in expected_ids if counts.get(product_id) == 3
            ),
            "missing_or_incomplete_count": len(missing),
            "missing_or_incomplete_product_ids": missing[:500],
            "complete": not missing,
        }

    def close(self) -> None:
        self.client.close()


def discover_candidates(
    product: Product,
    manifest: dict[str, list[Candidate]],
    policy: dict[str, dict[str, Any]],
    web: WebClient,
    google_key: str,
    google_engine: str,
    public_search: bool,
) -> list[Candidate]:
    output = list(manifest.get(product.id, []))
    for direct_url in (canonical_url(product.source_url), *product.alternate_urls):
        if not direct_url or source_domain(direct_url) in AMAZON_HTML_DOMAINS:
            continue
        if "/monitoring_preview_register" in direct_url:
            continue
        direct_rule = domain_rule(source_domain(direct_url), policy)
        if direct_rule is None:
            kind, priority = inferred_source_kind(direct_url, product)
            direct_rule = {
                "kind": kind,
                "priority": priority,
                "rights_basis": AUTOMATED_PROVENANCE,
                "rights_verified": False,
            }
        try:
            final_url, html = web.get_page(direct_url)
            output.extend(extract_page_candidates(product, final_url, html, direct_rule))
        except Exception:
            pass
    if public_search:
        try:
            public_candidates = duckduckgo_image_candidates(product, web)
        except Exception:
            public_candidates = []
        if len(public_candidates) < 30:
            try:
                public_candidates.extend(bing_image_candidates(product, web))
            except Exception:
                pass
        output.extend(public_candidates)
    try:
        output.extend(google_cse_candidates(product, web, google_key, google_engine, policy))
    except Exception:
        pass
    unique: dict[str, Candidate] = {}
    for candidate in output:
        key = canonical_url(candidate.image_url)
        if (
            candidate.product_id != product.id
            or candidate.source_kind not in SOURCE_KINDS
            or not key
        ):
            continue
        prior = unique.get(key)
        if prior is None or candidate_sort_key(product, candidate) > candidate_sort_key(
            product, prior
        ):
            unique[key] = candidate
    return sorted(
        unique.values(),
        key=lambda item: candidate_sort_key(product, item),
        reverse=True,
    )


def process_product(
    product: Product,
    candidates: Sequence[Candidate],
    web: WebClient,
    background_engine: str,
    min_short_edge: int,
    min_long_edge: int,
    max_candidates: int,
    min_identity_score: float,
) -> tuple[list[ProcessedImage], list[str]]:
    processed: list[ProcessedImage] = []
    errors: list[str] = []
    eligible = [
        candidate
        for candidate in candidates
        if candidate.source_kind == "licensed_feed"
        or (
            candidate_identity_score(product, candidate) >= min_identity_score
            and (
                candidate_identity_score(product, candidate) >= 0.85
                or critical_identity_coverage(
                    product,
                    " ".join(
                        [
                            candidate.title,
                            candidate.source_page_url,
                            candidate.image_url,
                        ]
                    ),
                ) >= 0.5
            )
        )
    ]
    for candidate in eligible[:max_candidates]:
        try:
            raw = web.get_image(candidate.image_url)
            processed.append(
                normalize_image(
                    product,
                    candidate,
                    raw,
                    background_engine,
                    min_short_edge,
                    min_long_edge,
                    min_identity_score,
                )
            )
            selected = select_distinct_images(processed, 3)
            if len(selected) == 3:
                return selected, errors
        except Exception as error:
            errors.append(f"{candidate.image_url}: {error}")
    selected = select_distinct_images(processed, 3)
    if product.group == "medicine" and 0 < len(selected) < 3:
        selected = derive_medicine_views(selected, 3)
    return select_distinct_images(selected, 3), errors


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def checkpoint_candidates(
    product: Product,
    checkpoint_record: dict[str, Any] | None,
) -> list[Candidate]:
    if not checkpoint_record or checkpoint_record.get("status") != "ready":
        return []
    payload = checkpoint_record.get("payload")
    rows = payload.get("images") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    keys = {
        "product_id",
        "image_url",
        "source_page_url",
        "source_domain",
        "source_kind",
        "rights_basis",
        "priority",
        "title",
        "declared_width",
        "declared_height",
        "rights_verified",
    }
    output: list[Candidate] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        values = {key: row[key] for key in keys if key in row}
        values["product_id"] = product.id
        try:
            output.append(Candidate(**values))
        except TypeError:
            continue
    return output


def checkpoint_is_rights_verified_publication(
    checkpoint_record: dict[str, Any] | None,
) -> bool:
    if not checkpoint_record or checkpoint_record.get("status") != "published":
        return False
    payload = checkpoint_record.get("payload")
    rows = payload.get("images") if isinstance(payload, dict) else None
    return bool(
        isinstance(rows, list)
        and len(rows) == 3
        and all(
            isinstance(row, dict) and row.get("rights_verified") is True
            for row in rows
        )
    )


def images_have_verified_rights(images: Sequence[ProcessedImage]) -> bool:
    return len(images) == 3 and all(
        image.candidate.rights_verified is True for image in images
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--source-manifest", type=Path, action="append", default=[])
    parser.add_argument("--source-policy", type=Path)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--product-id", action="append", default=[])
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-candidates", type=int, default=60)
    parser.add_argument("--min-identity-score", type=float, default=0.4)
    parser.add_argument("--min-short-edge", type=int, default=600)
    parser.add_argument("--min-long-edge", type=int, default=900)
    parser.add_argument("--background-engine", choices=("auto", "rembg", "border"), default="auto")
    parser.add_argument("--request-delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--include-non-live", action="store_true")
    parser.add_argument(
        "--no-public-search",
        action="store_true",
        help="Disable built-in public product-image discovery.",
    )
    parser.add_argument("--force", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    env = {**load_dotenv(REPO_ROOT / ".env.local"), **os.environ}
    supabase_url = compact_spaces(env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL"))
    supabase_secret = compact_spaces(
        env.get("SUPABASE_SECRET_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    google_key = compact_spaces(env.get("GOOGLE_CSE_API_KEY"))
    google_engine = compact_spaces(env.get("GOOGLE_CSE_ID"))

    if args.verify_only and not args.publish:
        raise PipelineError("--verify-only requires --publish")
    products = load_products(args.dataset)
    selected_ids = {compact_spaces(item) for item in args.product_id if compact_spaces(item)}
    if selected_ids:
        products = [product for product in products if product.id in selected_ids]
        missing_ids = selected_ids - {product.id for product in products}
        if missing_ids:
            raise PipelineError(f"Unknown product IDs: {', '.join(sorted(missing_ids))}")

    publisher = (
        SupabasePublisher(supabase_url, supabase_secret, args.timeout)
        if args.publish
        else None
    )
    if publisher and not args.include_non_live:
        live_ids = publisher.live_product_ids()
        products = [product for product in products if product.id in live_ids]
    products = products[max(0, args.offset):]
    if args.limit > 0:
        products = products[:args.limit]
    expected_ids = {product.id for product in products}

    if args.verify_only:
        assert publisher is not None
        verification = publisher.verify(expected_ids)
        write_report(args.report, verification)
        print(json.dumps(verification, indent=2))
        publisher.close()
        return 0 if verification["complete"] else 2

    manifest = load_candidate_manifests(args.source_manifest)
    policy = load_source_policy(args.source_policy)
    checkpoint = CheckpointStore(args.checkpoint)
    web = WebClient(args.cache_dir, args.timeout, args.request_delay)
    summary: dict[str, Any] = {
        "started_at": utc_now(),
        "dataset": str(args.dataset),
        "selected_products": len(products),
        "published": 0,
        "ready": 0,
        "incomplete": 0,
        "rights_unverified": 0,
        "skipped": 0,
        "failures": [],
    }
    try:
        for index, product in enumerate(products, 1):
            prior = checkpoint.get(product.id)
            if (
                checkpoint_is_rights_verified_publication(prior)
                and not args.force
            ):
                summary["skipped"] += 1
                continue
            candidates = checkpoint_candidates(product, prior)
            candidates.extend(
                discover_candidates(
                    product,
                    manifest,
                    policy,
                    web,
                    google_key,
                    google_engine,
                    not args.no_public_search,
                )
            )
            images, errors = process_product(
                product,
                candidates,
                web,
                args.background_engine,
                args.min_short_edge,
                args.min_long_edge,
                args.max_candidates,
                args.min_identity_score,
            )
            if len(images) != 3:
                payload = {
                    "product_id": product.id,
                    "name": product.name,
                    "candidate_count": len(candidates),
                    "validated_image_count": len(images),
                    "errors": errors[:20],
                }
                checkpoint.put(product.id, "incomplete", payload)
                summary["incomplete"] += 1
                summary["failures"].append(payload)
                print(
                    f"[{index}/{len(products)}] incomplete {product.id}: {len(images)}/3 images",
                    flush=True,
                )
                continue

            if not images_have_verified_rights(images):
                payload = {
                    "product_id": product.id,
                    "name": product.name,
                    "candidate_count": len(candidates),
                    "validated_image_count": len(images),
                    "rights_verified_image_count": sum(
                        image.candidate.rights_verified is True for image in images
                    ),
                    "errors": errors[:20],
                }
                checkpoint.put(product.id, "rights_unverified", payload)
                summary["rights_unverified"] += 1
                summary["failures"].append(payload)
                print(
                    f"[{index}/{len(products)}] rights-unverified {product.id}: "
                    "gallery retained for review and not uploaded",
                    flush=True,
                )
                continue

            payload = {
                "product_id": product.id,
                "name": product.name,
                "images": [
                    {
                        **asdict(image.candidate),
                        "quality_score": image.quality_score,
                        "content_sha256": image.content_sha256,
                        "perceptual_hash": image.perceptual_hash,
                    }
                    for image in images
                ],
            }
            if publisher:
                for position, image in enumerate(images, 1):
                    publisher.upload(product.id, position, image)
                payload["publication"] = publisher.publish(product.id, images)
                checkpoint.put(product.id, "published", payload)
                summary["published"] += 1
                status = "published"
            else:
                checkpoint.put(product.id, "ready", payload)
                summary["ready"] += 1
                status = "ready"
            print(f"[{index}/{len(products)}] {status} {product.id}", flush=True)
    finally:
        summary["finished_at"] = utc_now()
        if publisher:
            summary["verification"] = publisher.verify(expected_ids)
            publisher.close()
        web.close()
        checkpoint.close()
        write_report(args.report, summary)

    print(json.dumps(summary, indent=2))
    verification = summary.get("verification")
    if publisher and isinstance(verification, dict) and not verification.get("complete"):
        return 2
    return (
        0
        if summary["incomplete"] == 0 and summary["rights_unverified"] == 0
        else 2
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PipelineError as error:
        print(json.dumps({"status": "failed", "error": str(error)}, indent=2), file=sys.stderr)
        raise SystemExit(1)
