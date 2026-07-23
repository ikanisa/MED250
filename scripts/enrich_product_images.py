#!/usr/bin/env python3
"""Discover, process, and publish MED+250 product-image galleries.

The pipeline is resumable and fail-closed. It searches public product listings,
prefers official/manufacturer results, ranks identity and image quality, removes
backgrounds, selects three to six distinct representative views, uploads them
to Supabase Storage, and atomically publishes each live gallery. The default
allocation publishes exactly 23,977 images across the live catalogue.
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
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlsplit
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
DEFAULT_VERIFICATION_REPORT = (
    REPO_ROOT / "data/product-images/live-url-verification.json"
)
USER_AGENT = "MED250ProductImageBot/1.0 (+https://med-250.com/terms)"
SEARCH_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36"
)
WEB_SEARCH_USER_AGENT = "Mozilla/5.0"
IMAGE_BUCKET = "product-images"
EXPECTED_BACKEND_CONTRACT_VERSION = "2026-07-18.3"
CONTRACT_ATTESTATION_PATH = Path(
    f"/tmp/med250-product-image-contract-{EXPECTED_BACKEND_CONTRACT_VERSION}.ok"
)
CONTRACT_ATTESTATION_MAX_AGE_SECONDS = 600
IMAGE_VALIDATION_POLICY_VERSION = "2026-07-17.57"
TARGET_IMAGE_COUNT = 23_977
MIN_IMAGES_PER_PRODUCT = 3
MAX_IMAGES_PER_PRODUCT = 6
PREFERRED_SOURCE_IMAGES = 3
OCR_REVIEW_IDENTITY_SCORE = 0.80
SOURCE_KINDS = {
    "licensed_feed",
    "manufacturer",
    "amazon_creators_api",
    "specialist_retailer",
    "marketplace_api",
    "generated_catalogue",
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
REPUTABLE_MEDICINE_RETAILER_DOMAINS = {
    "1mg.com",
    "afyadepot.co.tz",
    "apollopharmacy.in",
    "assetpharmacy.com",
    "chemist180.com",
    "goodlife.co.ke",
    "healthokaypharmacy.com",
    "hpa.chebupharma.com",
    "junctionhealthpharmacy.com",
    "kauverymeds.com",
    "medecify.com",
    "medsgo.ph",
    "medplusmart.com",
    "mydawa.com",
    "netmeds.com",
    "pharmeasy.in",
    "platinumrx.in",
    "scabpharmacy.com",
    "trungtamthuoc.com",
    "truemeds.in",
    "tsakhiurtumur.mn",
    "wallspharm.com",
    "yebihealth.co.tz",
}
# Hard residual medicines are disproportionately export brands.  A broad
# exact-name query often finds only regulator documents or unrelated social
# posts even though an exact pack listing exists in one regional pharmacy
# catalogue.  Rotate one reputable catalogue per retry so each bounded
# fast-lane attempt gets a fresh cache key instead of repeating tier four
# forever.  The result is discovery evidence only; linked-page identity, OCR,
# strength/form/pack checks, quality gates, and provenance rules still decide
# whether an image may be published.
MEDICINE_RETRY_SEARCH_DOMAINS = (
    "1mg.com",
    "pharmeasy.in",
    "truemeds.in",
    "apollopharmacy.in",
    "netmeds.com",
    "medplusmart.com",
    "platinumrx.in",
    "kauverymeds.com",
    "mydawa.com",
    "goodlife.co.ke",
    "medecify.com",
    "trungtamthuoc.com",
    "afyadepot.co.tz",
    "junctionhealthpharmacy.com",
    "wallspharm.com",
    "yebihealth.co.tz",
    "hpa.chebupharma.com",
    "tsakhiurtumur.mn",
)
NON_PRODUCT_LISTING_DOMAINS = {
    "alamy.com",
    "dreamstime.com",
    "fity.club",
    "freepik.com",
    "gettyimages.com",
    "inspiredpencil.com",
    "istockphoto.com",
    "pinterest.com",
    "reddit.com",
    "shutterstock.com",
    "scribd.com",
    "vecteezy.com",
    "youtube.com",
}
AUTOMATED_PROVENANCE = (
    "Public product listing discovered automatically; source and image URLs "
    "recorded for traceability; reuse rights not independently verified."
)
OFFICIAL_MEDICINE_CATALOGUES = (
    {
        "manufacturer_markers": ("rene industries",),
        "product_url_template": "https://www.rene.co.ug/products/{slug}/",
        "allowed_domains": {"rene.co.ug", "www.rene.co.ug"},
    },
)
OFFICIAL_MEDICINE_INDEXES = (
    {
        "manufacturer_markers": (
            "laboratory allied",
            "laboratory & allied",
        ),
        "page_url": "https://www.laballied.com/products",
        "allowed_domains": {"laballied.com", "www.laballied.com"},
    },
)
OFFICIAL_MEDICINE_IMAGE_SITEMAPS = (
    {
        "manufacturer_markers": (
            "dawa limited",
            "dawa life sciences",
        ),
        "sitemap_url": "https://dawalifesciences.com/product-sitemap.xml",
        "allowed_domains": {
            "dawalifesciences.com",
            "www.dawalifesciences.com",
        },
    },
)
_OCR_ENGINE: Any = None
_OCR_LOCK = threading.Lock()
_REMBG_SESSION: Any = None
_REMBG_LOCK = threading.Lock()
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
UNBRANDED_GENERIC_STOPWORDS = {
    "acid",
    "anhydrous",
    "complex",
    "dihydrate",
    "diluted",
    "elemental",
    "equivalent",
    "hydrochloride",
    "hydroxide",
    "monohydrate",
    "potassium",
    "sodium",
    "trihydrate",
}
CONSUMER_COLOR_TOKENS = {
    "beige",
    "black",
    "blue",
    "brown",
    "cream",
    "gold",
    "gray",
    "green",
    "grey",
    "ivory",
    "navy",
    "orange",
    "pink",
    "purple",
    "red",
    "silver",
    "tan",
    "teal",
    "white",
    "yellow",
}
CONSUMER_MODEL_GENERIC_TOKENS = {
    "adult",
    "adults",
    "babies",
    "baby",
    "bag",
    "bags",
    "changing",
    "diaper",
    "essential",
    "essentials",
    "extra",
    "kids",
    "large",
    "mat",
    "newborn",
    "newborns",
    "pockets",
    "pad",
    "portable",
    "resistant",
    "small",
    "station",
    "travel",
    "washable",
    "waterproof",
    "wipeable",
}
CONSUMER_MARKETING_DESCRIPTOR_TOKENS = {
    "adult",
    "adults",
    "babies",
    "baby",
    "essential",
    "essentials",
    "extra",
    "kids",
    "large",
    "newborn",
    "newborns",
    "portable",
    "resistant",
    "small",
    "travel",
    "washable",
    "waterproof",
    "wipeable",
}
MEDICINE_FORM_WORDS = {
    "ampoule",
    "ampoules",
    "capsule",
    "capsules",
    "cream",
    "drops",
    "gel",
    "inhaler",
    "injection",
    "ointment",
    "powder",
    "sachet",
    "sachets",
    "solution",
    "suspension",
    "syrup",
    "tablet",
    "tablets",
    "vial",
    "vials",
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
    page_primary_image: bool = False


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


def effective_consumer_brand_tokens(product: Product) -> set[str]:
    """Recover a useful brand token from short marketplace title prefixes.

    Some marketplace titles yielded ``The``, ``Dr.``, or initials such as
    ``J.L.`` as the stored brand. Treating those as complete brands made every
    image impossible to verify. Compact punctuation brands such as ``e.l.f.``
    remain usable; otherwise a short-prefix brand may use the first meaningful
    continuation token from the product name. Numeric and generic labels do not
    receive this fallback.
    """
    brand_value = normalized_text(product.brand)
    tokens = meaningful_tokens(product.brand)
    if tokens:
        return tokens
    compact_brand = re.sub(r"[^a-z0-9]+", "", product.brand.lower())
    brand_parts = brand_value.split()
    if (
        len(compact_brand) >= 3
        and not compact_brand.isdigit()
        and brand_parts
        and all(len(part) <= 2 for part in brand_parts)
    ):
        return {compact_brand}
    permits_continuation = brand_value in {
        "a",
        "an",
        "dr",
        "mr",
        "mrs",
        "ms",
        "the",
    } or bool(brand_parts and all(len(part) <= 2 for part in brand_parts))
    if not permits_continuation:
        return set()
    name_tokens = normalized_text(product.name).split()
    start = len(brand_parts) if name_tokens[: len(brand_parts)] == brand_parts else 0
    for token in name_tokens[start:]:
        if len(token) >= 3 and token not in TOKEN_STOPWORDS and not token.isdigit():
            return {token}
    return set()


def measurements(value: Any) -> list[tuple[str, float]]:
    # Preserve decimal points before punctuation normalization. Generic
    # letter/digit splitting made OCR fragments such as ``E8L8R`` look like
    # an 8-litre measurement and turned ``7.15 kg`` into ``15 kg``.
    text = unicodedata.normalize("NFKD", compact_spaces(value)).lower()
    text = "".join(char for char in text if not unicodedata.combining(char))
    # Keep support for compact compound packs such as ``2-pk18-fl-oz`` by
    # separating only a known count unit from the following quantity.
    text = re.sub(
        r"\b(packs?|pk|counts?|ct)(?=\d)",
        r"\1 ",
        text,
    )
    # Preserve multiplicative medicine presentations before punctuation
    # normalization: ``10x10 tablets`` and ``6*1 blisters`` are total counts,
    # not the first number printed on the carton.
    text = re.sub(r"(?<=\d)\s*[x×*]\s*(?=\d)", "x", text)
    text = re.sub(r"[^a-z0-9.]+", " ", text).strip()
    output: list[tuple[str, float]] = []
    pattern = re.compile(
        r"\b(\d+(?:\.\d+)?)\s*"
        r"(fluid ounces?|fl oz|ounces?|oz|milliliters?|ml|liters?|litres?|l|"
        r"milligrams?|mg|micrograms?|mcg|grams?|grm|g|kilograms?|kg|counts?|ct|packs?|pk)\b"
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
        elif unit in {"gram", "grams", "grm", "g"}:
            output.append(("mass_mg", amount * 1000))
        elif unit in {"kilogram", "kilograms", "kg"}:
            output.append(("mass_mg", amount * 1_000_000))
        else:
            output.append(("count", amount))
    dosage_units = (
        r"ampoules?|blisters?|bottles?|capsules?|pessaries?|sachets?|"
        r"strips?|syringes?|tablets?|tubes?|vials?"
    )
    compound_count_spans: list[tuple[int, int]] = []
    compound_pattern = re.compile(
        rf"\b(\d+(?:x\d+)+)\s*(?:{dosage_units})\b"
    )
    for match in compound_pattern.finditer(text):
        factors = [int(value) for value in match.group(1).split("x")]
        output.append(("count", float(math.prod(factors))))
        compound_count_spans.append(match.span())
    # A compound presentation can share a dosage unit with an alternative,
    # for example ``10x10 or 1000 tablets``.  Capture the multiplication even
    # when the unit does not immediately follow it; the simple parser below
    # will independently capture the explicitly unit-labelled alternative.
    for match in re.finditer(r"\b(\d+(?:x\d+)+)\b", text):
        if any(
            start <= match.start() and match.end() <= end
            for start, end in compound_count_spans
        ):
            continue
        factors = [int(value) for value in match.group(1).split("x")]
        output.append(("count", float(math.prod(factors))))
        compound_count_spans.append(match.span())
    simple_count_pattern = re.compile(
        rf"\b(\d+)\s*(?:{dosage_units})\b"
    )
    for match in simple_count_pattern.finditer(text):
        if any(
            start <= match.start() and match.end() <= end
            for start, end in compound_count_spans
        ):
            continue
        output.append(("count", float(match.group(1))))
    return output


def measurements_match(expected: Sequence[tuple[str, float]], observed: Sequence[tuple[str, float]]) -> bool:
    concrete_expected = [
        (kind, value)
        for kind, value in expected
        if kind != "count_any"
    ]
    # A blank regulatory presentation permits any visible pack size, but it
    # must not substitute for a declared strength/volume measurement.
    if not concrete_expected and any(kind == "count_any" for kind, _ in expected):
        return bool(observed)
    return any(
        (
            expected_kind == observed_kind
            and abs(expected_value - observed_value) / max(1.0, expected_value) <= 0.08
        )
        for expected_kind, expected_value in concrete_expected
        for observed_kind, observed_value in observed
    )


def measurements_conflict(
    expected: Sequence[tuple[str, float]],
    observed: Sequence[tuple[str, float]],
) -> bool:
    expected_kinds = {kind for kind, _ in expected}
    if any(
        kind == "count"
        and amount > 1
        and not {"count", "count_any"} & expected_kinds
        for kind, amount in observed
    ):
        return True
    for kind in expected_kinds:
        if kind == "count_any":
            continue
        expected_for_kind = [(item_kind, value) for item_kind, value in expected if item_kind == kind]
        observed_for_kind = [(item_kind, value) for item_kind, value in observed if item_kind == kind]
        matching_observed = [
            observed_item
            for observed_item in observed_for_kind
            if measurements_match(expected_for_kind, [observed_item])
        ]
        if observed_for_kind and any(
            not measurements_match(expected_for_kind, [observed_item])
            and not (
                matching_observed
                and kind in {"mass_mg", "volume_ml"}
                and any(
                    max(observed_item[1], matched_item[1])
                    / max(0.001, min(observed_item[1], matched_item[1]))
                    >= 999
                    for matched_item in matching_observed
                )
            )
            for observed_item in observed_for_kind
        ):
            return True
    return False


def expected_product_measurements(product: Product) -> list[tuple[str, float]]:
    """Return authoritative strengths, sizes, and consumer bundle counts.

    Consumer catalogue names sometimes carry a declared multipack count that
    the source dataset's ``pack_size`` field omits while retaining the item
    volumes. Include that authoritative name evidence so an exact 2-pack is
    not misclassified as an unexpected quantity. Medicine validation remains
    limited to its structured strength and pack-size fields.
    """
    values = [product.strength, product.pack_size]
    if product.group != "medicine":
        values.append(product.name)
    output = measurements(" ".join(values))
    if product.group == "medicine" and not measurements(product.pack_size):
        # A blank regulatory presentation means the count is unspecified, not
        # that an otherwise exact carton may not display a tablet/capsule count.
        output.append(("count_any", 0.0))
    return output


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
    # A small number of regulator rows omit the generic ingredient entirely.
    # In that case an independently exact registered brand is the strongest
    # identity field available; requiring a manufacturer token would reject
    # valid pharmacy and regulatory listings for that exact brand.  This does
    # not relax rows that do carry a generic ingredient.
    if not generic_tokens and medicine_name_evidence(product, value):
        return True
    manufacturer_tokens = meaningful_tokens(product.manufacturer) - {
        "company",
        "health",
        "healthcare",
        "industries",
        "industry",
        "laboratoire",
        "laboratoires",
        "laboratory",
        "medical",
        "medicine",
        "medicines",
        "pharma",
        "pharmaceutical",
        "pharmaceuticals",
        "private",
        "products",
        "sae",
    }
    return bool(manufacturer_tokens & observed)


def one_edit_apart(expected: str, observed: str) -> bool:
    """Return true for a single insertion, deletion, or substitution.

    Regulatory catalogues and image OCR occasionally differ by one character
    (for example, Rwanda FDA's ``LEVULE`` versus Biocodex's ``LEVURE``).  Keep
    this deliberately bounded so it cannot become general fuzzy matching.
    """
    if expected == observed or abs(len(expected) - len(observed)) > 1:
        return expected == observed
    if len(expected) == len(observed):
        return sum(left != right for left, right in zip(expected, observed)) == 1
    shorter, longer = (
        (expected, observed) if len(expected) < len(observed) else (observed, expected)
    )
    short_index = 0
    long_index = 0
    differences = 0
    while short_index < len(shorter) and long_index < len(longer):
        if shorter[short_index] == longer[long_index]:
            short_index += 1
            long_index += 1
            continue
        differences += 1
        if differences > 1:
            return False
        long_index += 1
    return True


def at_most_two_edits_apart(expected: str, observed: str) -> bool:
    """Bound token-level spelling tolerance to two Levenshtein edits."""
    if expected == observed:
        return True
    if abs(len(expected) - len(observed)) > 2:
        return False
    previous = list(range(len(observed) + 1))
    for row, expected_character in enumerate(expected, 1):
        current = [row]
        for column, observed_character in enumerate(observed, 1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column] + 1,
                    previous[column - 1]
                    + (expected_character != observed_character),
                )
            )
        if min(current) > 2:
            return False
        previous = current
    return previous[-1] <= 2


def unbranded_regulatory_ingredient_typo_evidence(
    product: Product,
    value: Any,
    *,
    require_manufacturer: bool = True,
) -> bool:
    """Confirm one register typo using manufacturer, form, and all strengths.

    Some regulators place the generic combination in both the brand and
    generic fields.  A typo in one long ingredient then prevents exact label
    matching even when an official manufacturer label proves the product.  Do
    not make general medicine matching fuzzy: require a three-or-more active
    ingredient combination, exactly one unmatched long ingredient within two
    edits, the registered manufacturer, matching dosage form, and every
    declared strength in the evidence.
    """
    if (
        product.group != "medicine"
        or normalized_text(product.brand) != normalized_text(product.generic)
    ):
        return False
    expected_tokens = [
        token
        for token in medicine_core_name_tokens(product)
        if token not in {"and", "with"}
    ]
    if len(expected_tokens) < 3:
        return False
    observed_tokens = normalized_text(value).split()
    observed_token_set = set(observed_tokens)
    unmatched = [token for token in expected_tokens if token not in observed_token_set]
    if len(unmatched) != 1:
        return False
    misspelled = unmatched[0]
    if len(misspelled) < 8 or not any(
        len(candidate) >= 8
        and candidate[:3] == misspelled[:3]
        and at_most_two_edits_apart(misspelled, candidate)
        for candidate in observed_tokens
    ):
        return False
    manufacturer_tokens = meaningful_tokens(product.manufacturer) - {
        "laboratoire",
        "laboratoires",
        "laboratory",
        "labs",
        "limited",
        "pharma",
        "pharmaceutical",
        "pharmaceuticals",
    }
    if require_manufacturer and (
        not manufacturer_tokens
        or not manufacturer_tokens & set(observed_tokens)
    ):
        return False
    expected_forms = medicine_form_groups(product.form)
    if expected_forms and not expected_forms & medicine_form_groups(value):
        return False
    expected_measurements = expected_product_measurements(product)
    observed_measurements = measurements(value)
    return bool(
        expected_measurements
        and observed_measurements
        and all(
            any(
                expected_kind == observed_kind
                and abs(expected_amount - observed_amount)
                / max(1.0, expected_amount)
                <= 0.08
                for observed_kind, observed_amount in observed_measurements
            )
            for expected_kind, expected_amount in expected_measurements
        )
    )


def unbranded_regulatory_listing_evidence(
    product: Product,
    value: Any,
    *,
    require_manufacturer: bool = True,
) -> bool:
    """Identify a regulator row that has composition but no trade name.

    These rows place the same generic composition in both brand and generic
    fields.  Their exact product identity is therefore the conjunction of
    manufacturer, active ingredients, dosage form, and every declared
    strength—not a trademark.  Keep the route unavailable to normal branded
    medicines and to rows whose structured strength cannot be parsed.
    """
    if (
        product.group != "medicine"
        or not normalized_text(product.generic)
        or normalized_text(product.brand) != normalized_text(product.generic)
    ):
        return False
    observed_tokens = normalized_text(value).split()
    observed_token_set = set(observed_tokens)
    ingredient_stems = {
        token[:8]
        for token in normalized_text(product.generic).split()
        if len(token) >= 5
        and token not in TOKEN_STOPWORDS
        and token not in UNBRANDED_GENERIC_STOPWORDS
        and not token.isdigit()
    }
    matched_stems = {
        stem
        for stem in ingredient_stems
        if any(
            candidate.startswith(stem)
            or stem.startswith(candidate[:8])
            or (
                len(candidate) >= 6
                and one_edit_apart(stem, candidate[:8])
            )
            for candidate in observed_tokens
        )
    }
    required_ingredients = len(ingredient_stems)
    if required_ingredients == 0 or len(matched_stems) < required_ingredients:
        return False
    manufacturer_tokens = meaningful_tokens(product.manufacturer) - {
        "laboratoire",
        "laboratoires",
        "laboratory",
        "labs",
        "limited",
        "pharma",
        "pharmaceutical",
        "pharmaceuticals",
    }
    if require_manufacturer and (
        not manufacturer_tokens
        or not manufacturer_tokens & observed_token_set
    ):
        return False
    expected_forms = medicine_form_groups(product.form)
    if expected_forms and not expected_forms & medicine_form_groups(value):
        return False
    expected_strengths = measurements(product.strength)
    observed_measurements = measurements(value)
    return bool(
        expected_strengths
        and observed_measurements
        and all(
            any(
                expected_kind == observed_kind
                and abs(expected_amount - observed_amount)
                / max(1.0, expected_amount)
                <= 0.08
                for observed_kind, observed_amount in observed_measurements
            )
            for expected_kind, expected_amount in expected_strengths
        )
    )


def unbranded_manufacturer_listing_seed(product: Product, value: Any) -> bool:
    """Permit bounded page hydration before full unbranded label validation.

    Search-result titles may use a combination shorthand (for example,
    ``co-amoxiclav``) while the manufacturer page and image carry the complete
    composition. Manufacturer plus dosage form is sufficient to fetch that
    page, but never sufficient to validate or publish an image.
    """
    if (
        product.group != "medicine"
        or not normalized_text(product.generic)
        or normalized_text(product.brand) != normalized_text(product.generic)
    ):
        return False
    observed_tokens = meaningful_tokens(value)
    manufacturer_tokens = meaningful_tokens(product.manufacturer) - {
        "laboratoire",
        "laboratoires",
        "laboratory",
        "labs",
        "limited",
        "pharma",
        "pharmaceutical",
        "pharmaceuticals",
    }
    expected_forms = medicine_form_groups(product.form)
    observed_forms = medicine_form_groups(value)
    return bool(
        manufacturer_tokens
        and manufacturer_tokens & observed_tokens
        and expected_forms
        and expected_forms & observed_forms
    )


def registered_medicine_brand_core(product: Product) -> str:
    """Return the trade-name prefix before a structured presentation measurement.

    Regulatory brand fields sometimes contain the complete presentation, such
    as ``Simulect 20 mg powder and solvent for solution for infusion``. The
    printed pack need only prove the trade name; strength and dosage form have
    independent strict gates. Other registers append pack size (for example,
    ``Dobesil H Cream 30 GRM``), so truncate only at a parsed measurement
    matching the row's structured strength or pack size and only when an
    alphabetic prefix remains.
    A number genuinely embedded in a trade name without a unit (for example
    ``NUSAR-50``) therefore remains untouched.
    """
    core = normalized_text(compact_spaces(product.name).partition("[")[0])
    expected_measurements = expected_product_measurements(product)
    if not core or not expected_measurements:
        return core
    tokens = core.split()
    formulation_modifiers = {
        "cr",
        "dr",
        "ec",
        "er",
        "forte",
        "mr",
        "od",
        "plus",
        "prl",
        "sr",
        "xr",
    }
    for index in range(len(tokens)):
        for width in (1, 2):
            observed = measurements(" ".join(tokens[index:index + width]))
            if not observed:
                continue
            prefix = tokens[:index]
            suffix = set(tokens[index + width:])
            if (
                measurements_match(expected_measurements, observed)
                and not suffix & formulation_modifiers
                and any(
                    any(character.isalpha() for character in token)
                    for token in prefix
                )
            ):
                return " ".join(prefix)
            # Use the shortest token span that forms a real measurement so a
            # trailing formulation marker cannot be swallowed by a wider
            # window (for example ``80MG PRL``).
            break
    return core


def medicine_core_name_tokens(product: Product) -> list[str]:
    # Some registers append a full scientific identity in square brackets to
    # the trade name (for example ``MenFive [Meningococcal ...]``). The prefix
    # remains the exact brand; ingredients and dosage form are validated by
    # their own gates rather than being misclassified as brand tokens.
    core = registered_medicine_brand_core(product)
    structured_form_tokens = set(normalized_text(product.form).split())
    return [
        # Some regulatory exports flatten the trademark marker into the brand
        # (for example ``LEQVIOTM``), while the official pack correctly prints
        # ``LEQVIO`` with a separate symbol.  Treat only a terminal marker as
        # metadata; do not introduce general prefix or fuzzy brand matching.
        token[:-2] if token.endswith("tm") and len(token) >= 6 else token
        for token in compact_spaces(core).split()
        if token not in MEDICINE_FORM_WORDS
        and token not in structured_form_tokens
        and not token.isdigit()
        # Registry exports frequently concatenate strength and unit (``266mg``)
        # while OCR separates them (``266 mg``). Strength is validated by the
        # measurement gate, so it must not also masquerade as a brand token.
        and not re.fullmatch(
            r"\d+(?:mcg|mg|kg|ml|iu|g|units?|percent)",
            token,
        )
        and token not in {"mg", "ml", "mcg", "ww", "wv"}
        and len(token) >= 2
        and token not in {"bp", "ep", "ip", "usp"}
    ]


def medicine_name_evidence(product: Product, value: Any) -> bool:
    raw_name = compact_spaces(product.name)
    expected = normalized_text(raw_name)
    observed = normalized_text(value)
    if expected and expected in observed:
        return True
    core = registered_medicine_brand_core(product)
    structured_form_tokens = set(normalized_text(product.form).split())
    core = compact_spaces(
        " ".join(
            token
            for token in core.split()
            if token not in MEDICINE_FORM_WORDS
            and token not in structured_form_tokens
        )
    )
    if (
        len(core) >= 3
        and any(len(token) >= 3 for token in core.split())
        and core in observed
    ):
        return True
    expected_tokens = medicine_core_name_tokens(product)
    observed_tokens = normalized_text(value).split()
    observed_token_set = set(observed_tokens)
    manufacturer_tokens = meaningful_tokens(product.manufacturer) - {
        "company",
        "industries",
        "laboratoire",
        "laboratoires",
        "laboratory",
        "labs",
        "limited",
        "ltd",
        "pharma",
        "pharmaceutical",
        "pharmaceuticals",
        "private",
        "pvt",
    }
    # A one-character brand difference can be a regulator typo (for example
    # LEVULE vs LEVURE), but it can equally identify a competing product such
    # as CIPROREN vs CIPROPEN.  Permit that narrow tolerance only when the
    # registered manufacturer is independently present in the evidence.
    fuzzy_brand_typo_permitted = bool(
        manufacturer_tokens & observed_token_set
    )
    joined_expected = "".join(
        token for token in expected_tokens if token != "prl"
    )
    joined_name_match = bool(
        len(joined_expected) >= 5
        and joined_expected in observed_token_set
    )
    strict_match = bool(
        expected_tokens
        and all(
            (
                expected == "prl"
                and {"prolonged", "release"} <= observed_token_set
            )
            or (expected != "prl" and joined_name_match)
            or any(
                expected == candidate
                or (
                    len(expected) >= 5
                    and len(candidate) >= 5
                    and fuzzy_brand_typo_permitted
                    and one_edit_apart(expected, candidate)
                )
                for candidate in observed_tokens
            )
            for expected in expected_tokens
        )
    )
    return bool(
        strict_match
        or unbranded_regulatory_ingredient_typo_evidence(product, value)
        or unbranded_regulatory_listing_evidence(product, value)
    )


def medicine_form_groups(value: Any) -> set[str]:
    tokens = set(normalized_text(value).split())
    groups: set[str] = set()
    aliases = {
        "capsule": {
            "capsule",
            "capsules",
            "capsula",
            "capsulas",
            "gelule",
            "gelules",
        },
        "tablet": {"tablet", "tablets", "tab", "tabs", "comprime", "comprimes"},
        "powder": {"powder", "sachet", "sachets", "poudre"},
        "injection": {"injection", "injectable", "vial", "vials", "ampoule", "ampoules"},
        "cream": {"cream", "creme"},
        "ointment": {"ointment", "pommade"},
        "gel": {"gel"},
        "syrup": {"syrup", "sirop"},
        "suspension": {"suspension", "suspensions"},
        "drops": {"drop", "drops", "goutte", "gouttes"},
        "inhaler": {"inhaler", "inhalation"},
    }
    for group, values in aliases.items():
        if tokens & values:
            groups.add(group)
    return groups


def medicine_visual_evidence_matches(
    product: Product,
    candidate: Candidate,
    image_text: str,
) -> bool:
    page_evidence = compact_spaces(
        " ".join([candidate.title, candidate.source_page_url])
    )
    visual_evidence = compact_spaces(" ".join([candidate.image_url, image_text]))
    visual_name_confirmed = medicine_name_evidence(product, visual_evidence)
    if not visual_name_confirmed:
        visual_name_confirmed = bool(
            candidate.page_primary_image
            and candidate.source_kind in {"licensed_feed", "manufacturer"}
            and medicine_name_evidence(product, page_evidence)
            and (
                unbranded_regulatory_ingredient_typo_evidence(
                    product,
                    visual_evidence,
                    require_manufacturer=False,
                )
                or unbranded_regulatory_listing_evidence(
                    product,
                    visual_evidence,
                    require_manufacturer=False,
                )
            )
        )
    if not visual_name_confirmed:
        return False
    visual_identity_confirmed = medicine_identity_evidence(product, visual_evidence)
    primary_page_identity_confirmed = bool(
        candidate.page_primary_image
        and medicine_name_evidence(product, page_evidence)
        and medicine_identity_evidence(product, page_evidence)
    )
    if not visual_identity_confirmed and not primary_page_identity_confirmed:
        return False
    # A one-token trade name can collide with an unrelated supplement or a
    # different numbered brand variant (for example, WELLNESS versus
    # WELLNESS-24).  Retailer page text often contains generic ingredients
    # from recommendations, so page identity may substitute for visual
    # ingredient/manufacturer evidence only when the image itself also shows
    # the registered strength.  This retains exact primary images such as
    # UNSIATEM 80 mg while rejecting a strength-less WELLNESS-24 collision.
    if (
        not visual_identity_confirmed
        and candidate.source_kind == "specialist_retailer"
        and meaningful_tokens(product.generic)
        and len(set(medicine_core_name_tokens(product))) == 1
    ):
        expected_strength = measurements(product.strength)
        observed_strength = measurements(image_text)
        if (
            not expected_strength
            or not observed_strength
            or measurements_conflict(expected_strength, observed_strength)
            or not measurements_match(expected_strength, observed_strength)
        ):
            return False
    if not visual_identity_confirmed:
        expected_strength = measurements(product.strength)
        observed_strength = measurements(image_text)
        if expected_strength and (
            not observed_strength
            or measurements_conflict(expected_strength, observed_strength)
            or not measurements_match(expected_strength, observed_strength)
        ):
            return False
    expected_forms = medicine_form_groups(product.form)
    observed_forms = medicine_form_groups(
        " ".join(
            [
                candidate.title,
                candidate.source_page_url,
                candidate.image_url,
                image_text,
            ]
        )
    )
    return not expected_forms or not observed_forms or bool(expected_forms & observed_forms)


def exact_medicine_listing_seed(product: Product, candidate: Candidate) -> bool:
    """Require exact brand and identity before hydrating a medicine page gallery."""
    if product.group != "medicine":
        return False
    evidence = compact_spaces(
        " ".join(
            [candidate.title, candidate.source_page_url, candidate.image_url]
        )
    )
    return bool(
        (
            medicine_name_evidence(product, evidence)
            and medicine_identity_evidence(product, evidence)
        )
        or unbranded_manufacturer_listing_seed(product, evidence)
    )


def relevant_medicine_page_image(product: Product, candidate: Candidate) -> bool:
    """Keep product-gallery assets without inheriting a page title's identity.

    An exact pharmacy or regulator page can contain dozens of unrelated icons,
    logos, and recommended-product images.  Every extracted candidate inherits
    the page title, so filtering on the whole candidate would incorrectly make
    those assets look exact.  Structured/primary images are eligible; ordinary
    DOM images must independently name the registered medicine in their URL.
    OCR and strength/form validation still run on every retained image.
    """
    return bool(
        product.group != "medicine"
        or candidate.page_primary_image
        or medicine_name_evidence(product, unquote(candidate.image_url))
    )


def hydrate_exact_medicine_listing_candidates(
    product: Product,
    seeds: Sequence[Candidate],
    web: Any,
    page_limit: int = 1,
    allow_brand_only_seed: bool = False,
) -> list[Candidate]:
    """Fetch the full-resolution primary image from bounded exact listings.

    Image indexes commonly retain only a 300–600 px proxy while the linked
    pharmacy or manufacturer page exposes a larger ``og:image`` or structured
    product image.  The default path hydrates only seeds that already prove the
    registered trade name and medicine identity.  A discovery-only caller may
    admit an exact-brand seed, but the fetched page must then independently
    prove both name and medicine identity before any image is returned.  The
    crawl remains deliberately bounded and normal visual/OCR and quality gates
    remain the sole authority for publication.
    """
    if product.group != "medicine" or page_limit <= 0:
        return []
    output: list[Candidate] = []
    checked_pages: set[str] = set()
    for seed in ranked_candidate_variants(product, seeds):
        page_url = canonical_url(seed.source_page_url)
        exact_seed = exact_medicine_listing_seed(product, seed)
        seed_evidence = compact_spaces(
            " ".join([seed.title, seed.source_page_url, seed.image_url])
        )
        expected_measurements = expected_product_measurements(product)
        observed_measurements = measurements(seed_evidence)
        brand_only_seed = bool(
            allow_brand_only_seed
            and medicine_name_evidence(product, seed_evidence)
            and not (
                expected_measurements
                and observed_measurements
                and measurements_conflict(
                    expected_measurements,
                    observed_measurements,
                )
            )
        )
        if (
            not page_url
            or page_url in checked_pages
            or source_domain(page_url) in AMAZON_HTML_DOMAINS
            or not (exact_seed or brand_only_seed)
        ):
            continue
        checked_pages.add(page_url)
        page_rule = {
            "kind": seed.source_kind,
            "rights_basis": seed.rights_basis,
            "priority": max(seed.priority, 80),
            "rights_verified": seed.rights_verified,
        }
        try:
            final_url, page_html = web.get_page(page_url)
            page_evidence = medicine_page_identity_excerpt(product, page_html)
            if not exact_seed and not (
                medicine_name_evidence(product, page_evidence)
                and medicine_identity_evidence(product, page_evidence)
            ):
                continue
            output.extend(
                replace(
                    candidate,
                    title=compact_spaces(
                        " ".join([seed.title, page_evidence])
                    ),
                )
                for candidate in extract_page_candidates(
                    product,
                    final_url,
                    page_html,
                    page_rule,
                )
                if relevant_medicine_page_image(product, candidate)
            )
        except Exception:
            pass
        if len(checked_pages) >= page_limit:
            break
    return output


def verified_regulatory_pack_artwork(
    product: Product,
    candidate: Candidate,
    image_text: str,
) -> bool:
    """Identify an exact primary pack/carton artwork from an official label.

    Regulatory label repositories often publish the unfolded carton dieline,
    which is necessarily text-heavy.  Permit that representation only when it
    is the declared primary image from a manufacturer/regulatory feed and both
    the page evidence and visual evidence independently pass medicine identity
    validation.  Marketplace graphics never receive this exemption.
    """
    if not (
        product.group == "medicine"
        and candidate.page_primary_image
        and candidate.source_kind in {"licensed_feed", "manufacturer"}
        and compact_spaces(image_text)
    ):
        return False
    page_evidence = compact_spaces(
        " ".join([candidate.title, candidate.source_page_url])
    )
    visual_evidence = compact_spaces(" ".join([candidate.image_url, image_text]))
    return bool(
        medicine_name_evidence(product, page_evidence)
        and medicine_identity_evidence(product, page_evidence)
        and medicine_name_evidence(product, visual_evidence)
        and medicine_visual_evidence_matches(product, candidate, image_text)
    )


def source_domain(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".")


def domain_matches_any(domain: str, configured: set[str]) -> bool:
    root = compact_spaces(domain).lower().removeprefix("www.")
    return any(root == item or root.endswith("." + item) for item in configured)


def canonical_url(value: Any, base_url: str = "") -> str:
    url = compact_spaces(value)
    if base_url:
        url = urljoin(base_url, url)
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return ""
    # Supabase stores durable public provenance URLs and rejects plain HTTP.
    # Prefer the HTTPS form during discovery so validation also proves that the
    # exact URL eventually written to the database is fetchable.
    return parts._replace(scheme="https", fragment="").geturl()


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
        parts = urlsplit(url) if url else None
        query = dict(parse_qsl(parts.query)) if parts else {}
        scene7_image = bool(
            parts
            and parts.hostname
            and parts.hostname.lower().endswith(".scene7.com")
            and "/is/image/" in parts.path.lower()
            and query.get("fmt", "").lower() in {"jpg", "jpeg", "pjpeg", "png", "webp"}
        )
        dailymed_image = bool(
            parts
            and parts.hostname
            and parts.hostname.lower() == "dailymed.nlm.nih.gov"
            and parts.path.lower().endswith("/dailymed/image.cfm")
            and re.search(r"\.(?:png|jpe?g|webp)$", query.get("name", ""), re.I)
        )
        chemist180_image = bool(
            parts
            and parts.hostname
            and parts.hostname.lower() == "api.chemist180.com"
            and parts.path.lower() == "/api/media/image-resize/"
            and query.get("path", "").strip().lower() == "product images/"
            and re.search(r"\.(?:png|jpe?g|webp)$", query.get("name", ""), re.I)
        )
        if url and (
            re.search(r"\.(?:png|jpe?g|webp|avif)(?:$|\?)", url, re.I)
            or scene7_image
            or dailymed_image
            or chemist180_image
        ):
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
                        page_primary_image=explicitly_true(
                            row.get("page_primary_image")
                        ),
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
        while True:
            with self.lock:
                now = time.monotonic()
                remaining = self.delay - (now - self.last_request.get(domain, 0.0))
                if remaining <= 0:
                    self.last_request[domain] = now
                    return
            # Do not hold the global bookkeeping lock while one domain is
            # cooling down. Requests to independent hosts can proceed in
            # parallel, while the loop still serializes requests to the same
            # host at the configured interval.
            time.sleep(remaining)


class WebClient:
    def __init__(self, cache_dir: Path, timeout: float, delay: float):
        try:
            import httpx
        except ImportError as error:
            raise PipelineError("Install requirements-product-images.txt first") from error
        bounded_connect_timeout = min(max(float(timeout), 1.0), 8.0)
        self.client = httpx.Client(
            follow_redirects=True,
            timeout=httpx.Timeout(
                timeout,
                connect=bounded_connect_timeout,
                pool=bounded_connect_timeout,
            ),
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

    def get_xml(self, url: str) -> tuple[str, str]:
        safe = ensure_public_url(url)
        if not self.robots_allowed(safe):
            raise PipelineError(f"robots.txt does not allow crawling {safe}")
        response = self.request(
            "GET",
            safe,
            headers={"Accept": "application/xml,text/xml;q=0.9,*/*;q=0.1"},
        )
        content_type = response.headers.get("content-type", "").lower()
        if "xml" not in content_type and not response.content.lstrip().startswith(b"<?xml"):
            raise PipelineError("Sitemap did not return XML")
        if len(response.content) > 10 * 1024 * 1024:
            raise PipelineError("Sitemap is too large")
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
            # A catalogue run can inspect tens of thousands of distinct image
            # hosts. Preserve one transient retry without allowing a dead host
            # to hold a worker for three full timeout windows per candidate.
            attempts=2,
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
    urls: dict[str, tuple[int, bool]] = {}

    def add_url(value: Any, boost: int, page_primary_image: bool = False) -> None:
        url = canonical_url(value, page_url)
        if (
            url
            and not decorative_page_image_url(url)
            and supported_page_image_url(url)
        ):
            old_boost, old_primary = urls.get(url, (0, False))
            urls[url] = (
                max(old_boost, boost),
                old_primary or page_primary_image,
            )

    def add_structured_product_images(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                add_structured_product_images(item)
            return
        if not isinstance(value, dict):
            return
        schema_types = value.get("@type")
        type_values = schema_types if isinstance(schema_types, list) else [schema_types]
        if any(normalized_text(item) == "product" for item in type_values):
            for url in image_urls_from_value(value.get("image"), page_url):
                add_url(url, 18, True)
        for item in value.values():
            if isinstance(item, (dict, list)):
                add_structured_product_images(item)

    def add_exact_variant_images(value: Any) -> None:
        """Extract only the exact size/count variant from application JSON.

        Modern manufacturer pages often render one default pack in the DOM but
        keep every purchasable variant in ``__NEXT_DATA__``.  Recursively
        accepting every image in that payload would also ingest recommended
        products and wrong pack sizes.  Restrict extraction to a dictionary
        whose own label carries an exact, non-conflicting catalogue measurement
        and whose image is explicitly marked as that variant's featured image.
        """
        if isinstance(value, list):
            for item in value:
                add_exact_variant_images(item)
            return
        if not isinstance(value, dict):
            return
        expected = expected_product_measurements(product)
        featured = value.get("featuredImage")
        variant_evidence = compact_spaces(
            " ".join(
                compact_spaces(value.get(field))
                for field in ("title", "label", "name", "description")
                if isinstance(value.get(field), str)
            )
        )
        observed = measurements(variant_evidence)
        expected_colors = meaningful_tokens(product.name) & CONSUMER_COLOR_TOKENS
        observed_colors = meaningful_tokens(variant_evidence) & CONSUMER_COLOR_TOKENS
        color_conflict = bool(
            expected_colors
            and observed_colors
            and not expected_colors & observed_colors
        )
        if (
            isinstance(featured, dict)
            and expected
            and observed
            and measurements_match(expected, observed)
            and not measurements_conflict(expected, observed)
            and not color_conflict
        ):
            for url in image_urls_from_value(featured, page_url):
                add_url(url, 24, True)
        for item in value.values():
            if isinstance(item, (dict, list)):
                add_exact_variant_images(item)

    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "")
        except (TypeError, json.JSONDecodeError):
            continue
        for url in image_urls_from_value(payload, page_url):
            add_url(url, 15)
        add_structured_product_images(payload)
    for script in soup.find_all("script", id="__NEXT_DATA__"):
        try:
            payload = json.loads(script.string or script.get_text() or "")
        except (TypeError, json.JSONDecodeError):
            continue
        add_exact_variant_images(payload)
    for meta in soup.find_all("meta"):
        key = compact_spaces(meta.get("property") or meta.get("name")).lower()
        if key in {"og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"}:
            add_url(meta.get("content"), 10, True)
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
            page_primary_image=page_primary_image,
        )
        for image_url, (boost, page_primary_image) in urls.items()
    ]


def supported_page_image_url(value: Any) -> bool:
    """Accept normal image files and bounded Odoo product-image endpoints."""
    url = canonical_url(value)
    if not url:
        return False
    path = unquote(urlsplit(url).path)
    return bool(
        re.search(r"\.(?:png|jpe?g|webp|avif)$", path, re.I)
        or re.search(
            r"/web/image/(?:product\.template|product\.product)/\d+/image$",
            path,
            re.I,
        )
    )


def decorative_page_image_url(value: Any) -> bool:
    """Reject predictable navigation assets before they consume OCR budget."""
    url = canonical_url(value)
    path = unquote(urlsplit(url).path).lower() if url else ""
    filename = path.rsplit("/", 1)[-1]
    return bool(
        re.match(r"^/images/g/", path)
        or re.search(
            r"/(?:countries|flags?|icons?|logos?|avatars?|badges?|social|"
            r"payments?|languages?|blog|conditions|web-assets)(?:/|$)",
            path,
        )
        or re.search(
            r"(?:^|[-_])(?:logo|favicon|sprite|placeholder|spacer|loading|pixel|"
            r"no[-_]?image|default[-_]?image)"
            r"(?:[-_.]|$)",
            filename,
        )
        or re.fullmatch(
            r"(?:facebook|instagram|linkedin|twitter|youtube|playstore|"
            r"whogmp|cards?|game|iso|longevent|15daysreturn)\.(?:png|jpe?g|webp)",
            filename,
        )
    )


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
    if domain_matches_any(root, MARKETPLACE_DOMAINS):
        return "marketplace_api", 72
    if product.group == "medicine" and domain_matches_any(
        root,
        REPUTABLE_MEDICINE_RETAILER_DOMAINS,
    ):
        return "specialist_retailer", 84
    brand_tokens = meaningful_tokens(product.manufacturer)
    brand_tokens |= (
        meaningful_tokens(product.brand)
        if product.group == "medicine"
        else effective_consumer_brand_tokens(product)
    )
    domain_tokens = meaningful_tokens(root.replace(".", " "))
    compact_domain = re.sub(r"[^a-z0-9]+", "", root.lower())
    compact_brands = {
        re.sub(r"[^a-z0-9]+", "", token.lower())
        for token in brand_tokens
        if len(re.sub(r"[^a-z0-9]+", "", token.lower())) >= 4
    }
    if brand_tokens and (
        brand_tokens & domain_tokens
        or any(token in compact_domain for token in compact_brands)
    ):
        return "manufacturer", 100
    return "specialist_retailer", 65


def amazon_asin_candidates(product: Product) -> list[Candidate]:
    """Resolve an exact Amazon catalogue image without scraping a search page.

    Consumer records imported from Amazon already carry the durable ASIN.  The
    legacy Amazon image endpoint maps that identifier directly to the primary
    catalogue asset and supports a high-resolution CDN rendition.  This avoids
    a slow and unreliable image-search round trip while retaining the canonical
    product page as provenance.
    """
    asin = compact_spaces(product.asin).upper()
    if not re.fullmatch(r"[A-Z0-9]{10}", asin):
        return []
    source_page_url = canonical_url(product.source_url)
    if source_domain(source_page_url) not in AMAZON_HTML_DOMAINS:
        source_page_url = f"https://www.amazon.com/dp/{asin}"
    return [
        Candidate(
            product_id=product.id,
            image_url=(
                "https://images-na.ssl-images-amazon.com/images/P/"
                f"{asin}.01._UL1500_.jpg"
            ),
            source_page_url=source_page_url,
            source_domain="amazon.com",
            source_kind="marketplace_api",
            rights_basis=(
                "Public Amazon catalogue image resolved from the product's exact "
                "ASIN; source product and image URLs retained for traceability; "
                "reuse rights not independently verified."
            ),
            priority=110,
            title=product.query,
            declared_width=1500,
            declared_height=1500,
            page_primary_image=True,
        )
    ]


def amazon_product_page_candidates(
    product: Product,
    client: WebClient,
) -> list[Candidate]:
    """Extract the selected ASIN's original gallery from its public page.

    Amazon's image block embeds a strict-JSON ``colorImages.initial`` array for
    the currently selected ASIN.  Parsing only that array avoids importing
    recommendation images or gallery assets belonging to other size/color
    variants.  The page identity must independently confirm the requested ASIN,
    robots.txt is honored, and only the compact parsed result is cached.
    """
    asin = compact_spaces(product.asin).upper()
    if product.group != "consumer" or not re.fullmatch(r"[A-Z0-9]{10}", asin):
        return []
    page_url = f"https://www.amazon.com/dp/{asin}"
    cache_dir = client.cache_dir / "amazon-gallery"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{asin}.json"
    try:
        if cache_path.exists():
            rows = json.loads(cache_path.read_text(encoding="utf-8"))
        else:
            if not client.robots_allowed(page_url):
                return []
            rows = []
            marker = re.compile(
                r'''["']colorImages["']\s*:\s*\{\s*["']initial["']\s*:\s*''',
                re.I,
            )
            decoder = json.JSONDecoder()
            # Amazon occasionally serves a reduced page shell with HTTP 200.
            # Retry one independently rendered page when the exact-ASIN image
            # block is absent; HTTP-layer retries alone cannot detect this.
            for _page_attempt in range(2):
                response = client.request(
                    "GET",
                    page_url,
                    params={"th": "1", "psc": "1"},
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Language": "en-US,en;q=0.9",
                        "User-Agent": SEARCH_USER_AGENT,
                    },
                    attempts=2,
                )
                content_type = response.headers.get("content-type", "").lower()
                if (
                    "html" not in content_type
                    or len(response.content) > 5 * 1024 * 1024
                ):
                    continue
                html = response.text
                confirmed_asins = {
                    value.upper()
                    for value in re.findall(
                        r'''(?:["'](?:currentAsin|landingAsin)["']\s*:\s*["']|'''
                        r'''id=["']ASIN["'][^>]*\bvalue=["'])([A-Z0-9]{10})''',
                        html,
                        re.I,
                    )
                }
                if asin not in confirmed_asins:
                    continue
                for match in marker.finditer(html):
                    try:
                        payload, _ = decoder.raw_decode(html[match.end():].lstrip())
                    except (TypeError, json.JSONDecodeError):
                        continue
                    if isinstance(payload, list):
                        rows = [row for row in payload if isinstance(row, dict)]
                        break
                if rows:
                    break
            if rows:
                cache_path.write_text(
                    json.dumps(rows, separators=(",", ":")),
                    encoding="utf-8",
                )
    except Exception:
        return []

    output: list[Candidate] = []
    seen_urls: set[str] = set()
    for index, row in enumerate(rows[:20] if isinstance(rows, list) else []):
        image_url = canonical_url(row.get("hiRes") or row.get("large"))
        if not image_url or image_url in seen_urls:
            continue
        if source_domain(image_url) not in {
            "m.media-amazon.com",
            "images-na.ssl-images-amazon.com",
        }:
            continue
        seen_urls.add(image_url)
        output.append(
            Candidate(
                product_id=product.id,
                image_url=image_url,
                source_page_url=page_url,
                source_domain="www.amazon.com",
                source_kind="marketplace_api",
                rights_basis=(
                    "Public Amazon product gallery extracted for the exact ASIN; "
                    "source product and original image URLs retained for "
                    "traceability; reuse rights not independently verified."
                ),
                priority=118 if index == 0 else 112,
                title=f"{product.query} {asin}",
                rights_verified=False,
                page_primary_image=index == 0,
            )
        )
    return output


def high_resolution_candidate_variants(candidate: Candidate) -> list[Candidate]:
    variants = [candidate]
    image_url = candidate.image_url
    image_parts = urlsplit(image_url)
    image_host = source_domain(image_url)
    if image_host in {"4.imimg.com", "5.imimg.com"}:
        imimg_path = re.sub(
            r"-(?:250|500)x(?:250|500)(?=\.(?:jpe?g|png|webp)$)",
            "-1000x1000",
            image_parts.path,
            flags=re.I,
        )
        if imimg_path != image_parts.path:
            variants.insert(
                0,
                replace(
                    candidate,
                    image_url=image_parts._replace(path=imimg_path).geturl(),
                    priority=candidate.priority + 7,
                    declared_width=max(candidate.declared_width, 1000),
                    declared_height=max(candidate.declared_height, 1000),
                ),
            )
    elif re.search(
        r"-\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp)$",
        image_parts.path,
        re.I,
    ):
        # WordPress product catalogues commonly index generated square
        # thumbnails while retaining the original pack image at the same URL
        # without the terminal ``-WIDTHxHEIGHT`` suffix. Keep both variants:
        # a missing original falls back to the indexed thumbnail, and every
        # successful download still passes the full identity/quality gates.
        original_path = re.sub(
            r"-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)",
            "",
            image_parts.path,
            count=1,
            flags=re.I,
        )
        variants.insert(
            0,
            replace(
                candidate,
                image_url=image_parts._replace(path=original_path).geturl(),
                priority=candidate.priority + 6,
                declared_width=max(candidate.declared_width, 1200),
                declared_height=max(candidate.declared_height, 1200),
            ),
        )
    if image_host == "i.pinimg.com":
        pinterest_path = re.sub(
            r"/(?:236x|474x|564x|736x)/",
            "/originals/",
            image_parts.path,
            count=1,
            flags=re.I,
        )
        if pinterest_path != image_parts.path:
            variants.insert(
                0,
                replace(
                    candidate,
                    image_url=image_parts._replace(path=pinterest_path).geturl(),
                    priority=candidate.priority + 5,
                    declared_width=max(candidate.declared_width, 1200),
                    declared_height=max(candidate.declared_height, 1200),
                ),
            )
    amazon_parts = urlsplit(image_url)
    amazon_host = source_domain(image_url)
    amazon_default_image_path = bool(
        re.search(
            r"/images/I/[A-Za-z0-9+_-]+\.(?:jpe?g|png|webp)$",
            amazon_parts.path,
            re.I,
        )
    )
    if (
        (
            amazon_host == "m.media-amazon.com"
            or amazon_host.endswith(".ssl-images-amazon.com")
        )
        and amazon_default_image_path
    ):
        requested_path = re.sub(
            r"(?=\.(?:jpe?g|png|webp)$)",
            "._UL1500_",
            amazon_parts.path,
            count=1,
            flags=re.I,
        )
        variants.insert(
            0,
            replace(
                candidate,
                image_url=amazon_parts._replace(path=requested_path).geturl(),
                priority=candidate.priority + 8,
                declared_width=max(candidate.declared_width, 1500),
                declared_height=max(candidate.declared_height, 1500),
            ),
        )
    amazon_original_path = re.sub(
        r"\._{1,2}[^/]*?_{1,3}(?=\.(?:jpe?g|png|webp)$)",
        "",
        amazon_parts.path,
        flags=re.I,
    )
    legacy_asin_render = bool(
        re.search(
            r"/images/P/[A-Z0-9]{10}\.\d{2}\._UL\d+_\.(?:jpe?g|png|webp)$",
            amazon_parts.path,
            re.I,
        )
    )
    amazon_resizable_original = bool(
        re.search(
            r"/images/I/[A-Za-z0-9+_-]+\.(?:jpe?g|png|webp)$",
            amazon_original_path,
            re.I,
        )
    )
    if (
        (
            amazon_host == "m.media-amazon.com"
            or amazon_host.endswith(".ssl-images-amazon.com")
        )
        and amazon_original_path != amazon_parts.path
        and not legacy_asin_render
    ):
        if amazon_resizable_original:
            requested_path = re.sub(
                r"(?=\.(?:jpe?g|png|webp)$)",
                "._UL1500_",
                amazon_original_path,
                count=1,
                flags=re.I,
            )
            variants.insert(
                0,
                replace(
                    candidate,
                    image_url=amazon_parts._replace(path=requested_path).geturl(),
                    priority=candidate.priority + 10,
                    declared_width=max(candidate.declared_width, 1500),
                    declared_height=max(candidate.declared_height, 1500),
                ),
            )
        variants.insert(
            1 if amazon_resizable_original else 0,
            replace(
                candidate,
                image_url=amazon_parts._replace(path=amazon_original_path).geturl(),
                priority=candidate.priority + 8,
                declared_width=max(candidate.declared_width, 1500),
                declared_height=max(candidate.declared_height, 1500),
            ),
        )
    ebay_parts = urlsplit(image_url)
    if source_domain(image_url).endswith("ebayimg.com"):
        ebay_path = re.sub(
            r"/s-l\d{2,4}(?=\.(?:jpe?g|png|webp)$)",
            "/s-l1600",
            ebay_parts.path,
            flags=re.I,
        )
        if ebay_path != ebay_parts.path:
            variants.insert(
                0,
                replace(
                    candidate,
                    image_url=ebay_parts._replace(path=ebay_path).geturl(),
                    priority=candidate.priority + 7,
                    declared_width=max(candidate.declared_width, 1000),
                    declared_height=max(candidate.declared_height, 1000),
                ),
            )
    if source_domain(image_url).endswith("walmartimages.com") and "?" in image_url:
        original = image_url.split("?", 1)[0]
        variants.insert(
            0,
            replace(
                candidate,
                image_url=original,
                priority=candidate.priority + 6,
                declared_width=max(candidate.declared_width, 1500),
                declared_height=max(candidate.declared_height, 1500),
            ),
        )
    parts = urlsplit(image_url)
    if parts.path.rstrip("/").endswith("/_next/image"):
        original_image_url = next(
            (
                canonical_url(value)
                for key, value in parse_qsl(parts.query, keep_blank_values=True)
                if key.lower() == "url" and canonical_url(value)
            ),
            "",
        )
        if original_image_url:
            variants.insert(
                0,
                replace(
                    candidate,
                    image_url=original_image_url,
                    priority=candidate.priority + 7,
                ),
            )
    original_path = re.sub(
        r"(?:_|-)(?:\d{2,4})x(?:\d{2,4})(?=\.(?:jpe?g|png|webp)$)",
        "",
        parts.path,
        flags=re.I,
    )
    if original_path != parts.path:
        variants.insert(
            0,
            replace(
                candidate,
                image_url=parts._replace(path=original_path).geturl(),
                priority=candidate.priority + 7,
                declared_width=max(candidate.declared_width, 1200),
                declared_height=max(candidate.declared_height, 1200),
            ),
        )
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    size_keys = {
        "w",
        "h",
        "width",
        "height",
        "wid",
        "hei",
        "odnwidth",
        "odnheight",
        "sw",
        "sh",
    }
    demandware_size_keys = {"sw", "sh"}
    if (
        not source_domain(image_url).endswith("walmartimages.com")
        and any(key.lower() in size_keys for key, _ in query_pairs)
    ):
        high_resolution_query = urlencode(
            [
                (
                    key,
                    (
                        "2400"
                        if key.lower() in demandware_size_keys
                        else "1600"
                    )
                    if key.lower() in size_keys
                    else value,
                )
                for key, value in query_pairs
            ]
        )
        variants.insert(
            0,
            replace(
                candidate,
                image_url=parts._replace(query=high_resolution_query).geturl(),
                priority=candidate.priority + 6,
                declared_width=max(candidate.declared_width, 1600),
                declared_height=max(candidate.declared_height, 1600),
            ),
        )
    unique: list[Candidate] = []
    seen: set[str] = set()
    for variant in variants:
        canonical = canonical_url(variant.image_url)
        if not canonical or canonical in seen:
            continue
        seen.add(canonical)
        unique.append(variant)
    return unique


def concise_product_name(product: Product, word_limit: int = 16) -> str:
    words = compact_spaces(product.name).split()
    return " ".join(words[:word_limit])[:180]


def product_image_search_queries(
    product: Product,
    retry_count: int = 0,
) -> list[str]:
    if product.group == "medicine":
        exact_name = compact_spaces(product.name)
        spaced_name = compact_spaces(re.sub(r"[-_/]+", " ", product.name))
        generic = compact_spaces(product.generic)
        strength = compact_spaces(product.strength)
        manufacturer = compact_spaces(product.manufacturer)
        first_pass_queries = [
            f'"{exact_name}" "{generic}" "{strength}" medicine box',
            f'"{exact_name}" "{manufacturer}" pharmaceutical',
            f'"{spaced_name}" "{generic}" medicine packaging',
            f'"{exact_name}" blister tablet package',
            f"{product.search_query} medicine product",
        ]
        # A bounded fast-lane retry must not ask Bing the same first query and
        # merely inspect lower-ranked results from the same weak result set.
        # Lead retries with exact trade name + registered manufacturer, which
        # is both a fresh cache key and substantially more likely to surface
        # the manufacturer's artwork or an exact specialist listing.  Rows
        # with a missing manufacturer retain an exact-brand/generic fallback.
        if retry_count >= 5:
            retry_domain = MEDICINE_RETRY_SEARCH_DOMAINS[
                (retry_count - 5) % len(MEDICINE_RETRY_SEARCH_DOMAINS)
            ]
            retry_lead_query = f'"{exact_name}" site:{retry_domain}'
        elif retry_count == 4:
            # The hard residual catalogue often contains export brands whose
            # indexed listing title omits the generic and manufacturer. Keep
            # the registered trade name quoted, then let strict page identity
            # and image OCR prove the medicine before publication.
            retry_lead_query = f'"{exact_name}" medicine'
        elif retry_count >= 3:
            retry_lead_query = f'"{exact_name}" "{generic}" thuốc'
        elif retry_count >= 2:
            retry_lead_query = f'"{exact_name}" "{generic}" pharmacy product'
        else:
            retry_lead_query = (
                f'"{exact_name}" "{manufacturer}" product image'
                if manufacturer
                else f'"{exact_name}" "{generic}" product image'
            )
        queries = (
            [retry_lead_query, *first_pass_queries]
            if retry_count >= 1
            else first_pass_queries
        )
        if retry_count >= 1:
            core_name = compact_spaces(
                " ".join(
                    token
                    for token in normalized_text(product.name).split()
                    if token not in MEDICINE_FORM_WORDS
                )
            )
            queries.extend(
                [
                    f'"{core_name}" "{generic}" "{strength}"',
                    f'"{core_name}" "{manufacturer}" medicine',
                    # Many India-manufactured export brands have their clearest
                    # exact pack galleries on Vietnamese pharmacy catalogues.
                    # Keep the registered name and generic quoted so the locale
                    # expansion cannot broaden into a substitute medicine.
                    f'"{exact_name}" "{generic}" thuốc',
                ]
            )
        if retry_count >= 2:
            queries.extend(
                [
                    f'"{exact_name}" medicine pharmacy',
                    f'"{core_name}" "{generic}" packaging',
                ]
            )
    else:
        queries = [
            f"{product.search_query} product",
            f"{product.search_query} 360 product view",
        ]
        if product.asin:
            queries.insert(0, f'"{product.asin}" "{product.brand}" product')
        if retry_count >= 1:
            concise_name = concise_product_name(product)
            queries.extend(
                [
                    f'"{concise_name}"',
                    f'{product.brand} {concise_name} official product image',
                ]
            )
            if product.asin:
                queries.append(f'"{product.asin}" product images')
        if retry_count >= 2:
            queries.extend(
                [
                    f"{product.brand} {concise_product_name(product, 12)} ecommerce",
                    f"{product.brand} {concise_product_name(product, 10)} retailer",
                ]
            )
    return list(dict.fromkeys(compact_spaces(query)[:240] for query in queries if query))


def duckduckgo_image_candidates(
    product: Product,
    client: WebClient,
    retry_count: int = 0,
    query_limit: int = 0,
) -> list[Candidate]:
    queries = product_image_search_queries(product, retry_count)
    if query_limit > 0:
        queries = queries[:query_limit]
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
                    attempts=1,
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
                    attempts=1,
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
                        candidate
                        for candidate in extract_page_candidates(
                            product, final_url, page_html, page_rule
                        )
                        if relevant_medicine_page_image(product, candidate)
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


def bing_image_candidates(
    product: Product,
    client: WebClient,
    retry_count: int = 0,
    query_limit: int = 0,
) -> list[Candidate]:
    output: list[Candidate] = []
    queries = product_image_search_queries(product, retry_count)
    if query_limit > 0:
        queries = queries[:query_limit]
    for query in queries:
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


def yandex_image_candidates(
    product: Product,
    client: WebClient,
    retry_count: int = 0,
    query_limit: int = 0,
) -> list[Candidate]:
    """Return original Yandex Images results with their source-listing URLs.

    Yandex embeds the initial result set as JSON in the search page.  Reading
    that payload avoids thumbnail downloads and per-result page requests while
    retaining the original image dimensions and listing-page provenance.  As
    with every public-search provider, reuse rights remain explicitly
    unverified and all candidates still pass the normal identity, OCR,
    resolution, background, and deduplication gates before publication.
    """
    queries = product_image_search_queries(product, retry_count)
    if query_limit > 0:
        queries = queries[:query_limit]
    output: list[Candidate] = []
    for query in queries:
        search_cache_dir = client.cache_dir / "search"
        search_cache_dir.mkdir(parents=True, exist_ok=True)
        search_cache_path = search_cache_dir / (
            hashlib.sha256(f"yandex:{query}".encode("utf-8")).hexdigest() + ".json"
        )
        try:
            if search_cache_path.exists():
                results = json.loads(search_cache_path.read_text(encoding="utf-8"))
            else:
                response = client.request(
                    "GET",
                    "https://yandex.com/images/search",
                    params={"text": query},
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "User-Agent": SEARCH_USER_AGENT,
                    },
                    attempts=1,
                )
                try:
                    from bs4 import BeautifulSoup
                except ImportError as error:
                    raise PipelineError(
                        "Install requirements-product-images.txt first"
                    ) from error
                results = []
                soup = BeautifulSoup(response.text, "html.parser")
                for element in soup.select("[data-state]"):
                    try:
                        state = json.loads(
                            html_module.unescape(element.get("data-state") or "")
                        )
                        items = state["initialState"]["serpList"]["items"]
                        entities = items.get("entities")
                    except (KeyError, TypeError, json.JSONDecodeError):
                        continue
                    if isinstance(entities, dict):
                        results = [
                            value for value in entities.values() if isinstance(value, dict)
                        ]
                        break
                if results:
                    search_cache_path.write_text(
                        json.dumps(results, separators=(",", ":")),
                        encoding="utf-8",
                    )
        except Exception:
            continue
        for item in results[:50] if isinstance(results, list) else []:
            if not isinstance(item, dict) or item.get("censored") is True:
                continue
            if item.get("isShockDoc") is True:
                continue
            snippet = item.get("snippet")
            if not isinstance(snippet, dict):
                snippet = {}
            page_url = canonical_url(snippet.get("url"))
            image_url = canonical_url(item.get("origUrl"))
            if not page_url or not image_url:
                continue
            page_domain = source_domain(page_url)
            if domain_matches_any(page_domain, NON_PRODUCT_LISTING_DOMAINS):
                continue
            kind, priority = inferred_source_kind(page_url, product)
            candidate = Candidate(
                product_id=product.id,
                image_url=image_url,
                source_page_url=page_url,
                source_domain=page_domain or source_domain(image_url),
                source_kind=kind,
                rights_basis=AUTOMATED_PROVENANCE,
                priority=priority,
                title=compact_spaces(snippet.get("title") or item.get("alt")),
                declared_width=int(item.get("origWidth") or 0),
                declared_height=int(item.get("origHeight") or 0),
                rights_verified=False,
            )
            exact_index_result = (
                exact_medicine_listing_seed(product, candidate)
                if product.group == "medicine"
                else bool(
                    product.asin
                    and product.asin.lower()
                    in " ".join(
                        [candidate.title, candidate.source_page_url]
                    ).lower()
                )
            )
            if exact_index_result:
                candidate = replace(candidate, priority=max(priority, 96))
            output.append(candidate)
    return output


def brave_image_result_rows(source: str) -> list[dict[str, Any]]:
    """Parse Brave's server-rendered image result payload without thumbnails.

    The page embeds its initial image results in a Svelte data object rather
    than strict JSON.  A small string-aware object scanner is more resilient
    than matching the entire nested payload with one regular expression and
    keeps us independent of presentation markup.
    """
    response_start = source.find('response:{type:"images"')
    list_start = source.find("results:[", max(response_start, 0))
    if response_start < 0 or list_start < 0:
        return []
    cursor = list_start + len("results:[")
    object_start = -1
    brace_depth = 0
    in_string = False
    escaped = False
    objects: list[str] = []
    while cursor < len(source):
        character = source[cursor]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
        elif character == '"':
            in_string = True
        elif character == "{":
            if brace_depth == 0:
                object_start = cursor
            brace_depth += 1
        elif character == "}":
            brace_depth -= 1
            if brace_depth == 0 and object_start >= 0:
                objects.append(source[object_start : cursor + 1])
                object_start = -1
        elif character == "]" and brace_depth == 0:
            break
        cursor += 1

    quoted = r'("(?:\\.|[^"\\])*")'

    def string_field(value: str, field: str, start: int = 0) -> str:
        match = re.search(rf"\b{re.escape(field)}:{quoted}", value[start:])
        if not match:
            return ""
        try:
            return compact_spaces(json.loads(match.group(1)))
        except (TypeError, json.JSONDecodeError):
            return ""

    rows: list[dict[str, Any]] = []
    for value in objects:
        if "family_friendly:false" in value or "bo_serp_visible:false" in value:
            continue
        thumbnail_start = value.find("thumbnail:{")
        properties_start = value.find("properties:{", thumbnail_start)
        if thumbnail_start < 0 or properties_start < 0:
            continue
        title = string_field(value, "title")
        page_url = canonical_url(string_field(value, "url"))
        image_url = canonical_url(string_field(value, "original", thumbnail_start))
        properties_end = value.find("},meta_url:", properties_start)
        properties = value[
            properties_start : properties_end if properties_end >= 0 else len(value)
        ]
        height_match = re.search(r"\bheight:(\d+)", properties)
        width_match = re.search(r"\bwidth:(\d+)", properties)
        if not page_url or not image_url:
            continue
        rows.append(
            {
                "title": title,
                "url": page_url,
                "original": image_url,
                "width": int(width_match.group(1)) if width_match else 0,
                "height": int(height_match.group(1)) if height_match else 0,
            }
        )
    return rows


def brave_image_candidates(
    product: Product,
    client: WebClient,
    retry_count: int = 0,
    query_limit: int = 0,
) -> list[Candidate]:
    """Return full Brave Image Search URLs with their listing provenance."""
    queries = product_image_search_queries(product, retry_count)
    if query_limit > 0:
        queries = queries[:query_limit]
    output: list[Candidate] = []
    for query in queries:
        search_cache_dir = client.cache_dir / "search"
        search_cache_dir.mkdir(parents=True, exist_ok=True)
        search_cache_path = search_cache_dir / (
            hashlib.sha256(f"brave:{query}".encode("utf-8")).hexdigest() + ".json"
        )
        try:
            if search_cache_path.exists():
                results = json.loads(search_cache_path.read_text(encoding="utf-8"))
            else:
                response = client.request(
                    "GET",
                    "https://search.brave.com/images",
                    params={
                        "q": query,
                        "source": "web",
                        "safesearch": "strict",
                    },
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Language": "en-US,en;q=0.8",
                        "User-Agent": SEARCH_USER_AGENT,
                    },
                    attempts=1,
                )
                results = brave_image_result_rows(response.text)
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
            page_url = canonical_url(item.get("url"))
            image_url = canonical_url(item.get("original"))
            page_domain = source_domain(page_url)
            if (
                not page_url
                or not image_url
                or domain_matches_any(page_domain, NON_PRODUCT_LISTING_DOMAINS)
            ):
                continue
            kind, priority = inferred_source_kind(page_url, product)
            candidate = Candidate(
                product_id=product.id,
                image_url=image_url,
                source_page_url=page_url,
                source_domain=page_domain or source_domain(image_url),
                source_kind=kind,
                rights_basis=AUTOMATED_PROVENANCE,
                priority=priority,
                title=compact_spaces(item.get("title")),
                declared_width=int(item.get("width") or 0),
                declared_height=int(item.get("height") or 0),
                rights_verified=False,
            )
            if (
                product.group == "medicine"
                and exact_medicine_listing_seed(product, candidate)
            ):
                candidate = replace(candidate, priority=max(priority, 96))
            output.append(candidate)
    return output


def parallel_public_image_candidates(
    product: Product,
    client: WebClient,
    retry_count: int = 0,
    query_limit: int = 0,
    include_duckduckgo: bool = True,
) -> list[Candidate]:
    """Query independent public image indexes concurrently.

    Search latency, rather than CPU, dominates the remaining medicine backlog.
    Each provider has an independent host and cache key, so bounded parallel
    requests preserve provider throttling and provenance while avoiding four
    serial network waits for every product.
    """
    provider_calls: list[tuple[str, Any]] = [
        (
            "bing",
            lambda: bing_image_candidates(
                product,
                client,
                retry_count,
                query_limit=query_limit,
            ),
        ),
        (
            "yandex",
            lambda: yandex_image_candidates(
                product,
                client,
                retry_count,
                query_limit=query_limit,
            ),
        ),
        (
            "brave",
            lambda: brave_image_candidates(
                product,
                client,
                retry_count,
                query_limit=query_limit,
            ),
        ),
    ]
    if include_duckduckgo:
        provider_calls.append(
            (
                "duckduckgo",
                lambda: duckduckgo_image_candidates(
                    product,
                    client,
                    retry_count,
                    query_limit=query_limit,
                ),
            )
        )
    output: list[Candidate] = []
    with ThreadPoolExecutor(max_workers=len(provider_calls)) as executor:
        futures = [
            (name, executor.submit(provider_call))
            for name, provider_call in provider_calls
        ]
        # Resolve in deterministic provider order so candidate ranking and
        # checkpoint payloads remain reproducible across runs.
        for _name, future in futures:
            try:
                output.extend(future.result())
            except Exception:
                continue
    return output


def serpapi_image_candidates(
    product: Product,
    client: WebClient,
    api_key: str,
    retry_count: int = 0,
    query_limit: int = 1,
) -> list[Candidate]:
    """Return structured full-resolution Google Images results via SerpApi.

    The provider removes browser scraping and retailer-page hydration from the
    discovery hot path.  It is discovery only: every returned original still
    passes this pipeline's source, identity, OCR, resolution, background, and
    perceptual-deduplication gates before publication.  The source listing URL
    is retained verbatim as provenance and reuse rights remain unverified.
    """
    key = compact_spaces(api_key)
    if not key:
        return []
    queries = product_image_search_queries(product, retry_count)
    if query_limit > 0:
        queries = queries[:query_limit]
    output: list[Candidate] = []
    for query in queries:
        search_cache_dir = client.cache_dir / "search"
        search_cache_dir.mkdir(parents=True, exist_ok=True)
        search_cache_path = search_cache_dir / (
            hashlib.sha256(f"serpapi-google-images:{query}".encode("utf-8")).hexdigest()
            + ".json"
        )
        try:
            if search_cache_path.exists():
                payload = json.loads(search_cache_path.read_text(encoding="utf-8"))
            else:
                payload = client.get_json(
                    "https://serpapi.com/search.json",
                    {
                        "engine": "google_images",
                        "q": query,
                        "api_key": key,
                        "hl": "en",
                        "gl": "us",
                        "safe": "active",
                        "ijn": 0,
                        "tbs": "itp:photos,isz:l",
                    },
                )
                if payload.get("images_results"):
                    search_cache_path.write_text(
                        json.dumps(payload, separators=(",", ":")),
                        encoding="utf-8",
                    )
        except Exception:
            continue
        rows = payload.get("images_results") if isinstance(payload, dict) else None
        for item in rows[:100] if isinstance(rows, list) else []:
            if not isinstance(item, dict) or item.get("unsafe") is True:
                continue
            page_url = canonical_url(item.get("link"))
            image_url = canonical_url(item.get("original"))
            if not page_url or not image_url:
                continue
            page_domain = source_domain(page_url)
            if domain_matches_any(page_domain, NON_PRODUCT_LISTING_DOMAINS):
                continue
            kind, priority = inferred_source_kind(page_url, product)
            if item.get("is_product") is True:
                priority += 8
            output.append(
                Candidate(
                    product_id=product.id,
                    image_url=image_url,
                    source_page_url=page_url,
                    source_domain=page_domain or source_domain(image_url),
                    source_kind=kind,
                    rights_basis=AUTOMATED_PROVENANCE,
                    priority=priority,
                    title=compact_spaces(item.get("title")),
                    declared_width=int(item.get("original_width") or 0),
                    declared_height=int(item.get("original_height") or 0),
                    rights_verified=False,
                )
            )
    return output


def bing_listing_page_candidates(
    product: Product,
    client: WebClient,
) -> list[Candidate]:
    if product.group != "medicine":
        return []
    exact_name = compact_spaces(product.name)
    generic = compact_spaces(product.generic)
    manufacturer = compact_spaces(product.manufacturer)
    queries = list(
        dict.fromkeys(
            compact_spaces(query)
            for query in (
                f'"{exact_name}" "{manufacturer}"',
                f'"{exact_name}" "{generic}"',
                f'"{exact_name}" medicine product',
            )
            if compact_spaces(query)
        )
    )
    output: list[Candidate] = []
    checked_pages: set[str] = set()
    for query in queries:
        cache_dir = client.cache_dir / "listing-search"
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / (
            hashlib.sha256(f"bing-web:{query}".encode("utf-8")).hexdigest()
            + ".json"
        )
        try:
            if cache_path.exists():
                results = json.loads(cache_path.read_text(encoding="utf-8"))
            else:
                response = client.request(
                    "GET",
                    "https://www.bing.com/search",
                    params={"q": query, "count": 10, "form": "QBLH"},
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "User-Agent": WEB_SEARCH_USER_AGENT,
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
                for item in soup.select("li.b_algo")[:10]:
                    link = item.select_one("h2 a[href]")
                    if link is None:
                        continue
                    page_url = canonical_url(link.get("href"))
                    if not page_url:
                        continue
                    snippet = item.select_one(".b_caption p")
                    results.append(
                        {
                            "url": page_url,
                            "title": compact_spaces(link.get_text(" ", strip=True)),
                            "snippet": compact_spaces(
                                snippet.get_text(" ", strip=True)
                                if snippet is not None
                                else ""
                            ),
                        }
                    )
                if results:
                    cache_path.write_text(
                        json.dumps(results, separators=(",", ":")),
                        encoding="utf-8",
                    )
        except Exception:
            continue
        for result in results if isinstance(results, list) else []:
            if not isinstance(result, dict):
                continue
            page_url = canonical_url(result.get("url"))
            if (
                not page_url
                or page_url in checked_pages
                or source_domain(page_url) in AMAZON_HTML_DOMAINS
                or re.search(r"\.(?:pdf|docx?)(?:$|\?)", page_url, re.I)
            ):
                continue
            evidence = " ".join(
                [
                    compact_spaces(result.get("title")),
                    compact_spaces(result.get("snippet")),
                    page_url,
                ]
            )
            if not (
                (
                    medicine_name_evidence(product, evidence)
                    and medicine_identity_evidence(product, evidence)
                )
                or unbranded_manufacturer_listing_seed(product, evidence)
            ):
                continue
            checked_pages.add(page_url)
            kind, priority = inferred_source_kind(page_url, product)
            page_rule = {
                "kind": kind,
                "rights_basis": AUTOMATED_PROVENANCE,
                "priority": max(priority, 75),
                "rights_verified": False,
            }
            try:
                final_url, page_html = client.get_page(page_url)
                result_evidence = compact_spaces(
                    " ".join(
                        [
                            compact_spaces(result.get("title")),
                            compact_spaces(result.get("snippet")),
                        ]
                    )
                )
                page_evidence = medicine_page_identity_excerpt(product, page_html)
                output.extend(
                    replace(
                        candidate,
                        title=compact_spaces(
                            " ".join([result_evidence, page_evidence])
                        ),
                    )
                    for candidate in extract_page_candidates(
                        product, final_url, page_html, page_rule
                    )
                    if relevant_medicine_page_image(product, candidate)
                )
            except Exception:
                continue
            if len(checked_pages) >= 8:
                return output
    return output


def yahoo_result_target_url(value: Any) -> str:
    url = compact_spaces(value)
    match = re.search(r"/RU=([^/]+)(?:/RK=|$)", url)
    if match:
        url = unquote(match.group(1))
    return canonical_url(url)


def medicine_page_identity_excerpt(product: Product, html: str) -> str:
    try:
        from bs4 import BeautifulSoup
    except ImportError as error:
        raise PipelineError("Install requirements-product-images.txt first") from error
    text = compact_spaces(BeautifulSoup(html, "html.parser").get_text(" ", strip=True))
    if not text:
        return ""
    exact_name = compact_spaces(product.name)
    match = re.search(re.escape(exact_name), text, re.I) if exact_name else None
    if match is None:
        return text[:800]
    return compact_spaces(
        text[max(0, match.start() - 250): min(len(text), match.end() + 1200)]
    )


def official_medicine_catalogue_slugs(product: Product) -> list[str]:
    """Build conservative product slugs from the registered trade-name core.

    Manufacturer catalogues commonly omit dosage-form and presentation suffixes
    from their product URLs (``INDOREN CAPSULES`` becomes ``indoren``).  Reuse
    the strict medicine-name parser so strength, pack size, and form metadata do
    not broaden the lookup into a generic ingredient page.  The fetched page
    and image still have to pass the normal exact brand, identity, strength,
    form, OCR, and resolution gates before publication.
    """
    if product.group != "medicine":
        return []
    tokens = medicine_core_name_tokens(product)
    slug = "-".join(
        token
        for token in tokens
        if re.fullmatch(r"[a-z0-9]+", token)
    ).strip("-")
    return [slug] if len(slug) >= 3 else []


def official_medicine_catalogue_candidates(
    product: Product,
    web: WebClient,
) -> list[Candidate]:
    """Resolve exact official manufacturer pages missed by search indexes.

    Some regional manufacturers expose complete WooCommerce catalogues but the
    pages are poorly indexed by public search engines.  Manufacturer matching,
    a deterministic trade-name slug, a same-domain redirect check, and exact
    page identity validation keep this resolver narrow and auditable.
    """
    if product.group != "medicine":
        return []
    manufacturer = normalized_text(product.manufacturer)
    output: list[Candidate] = []
    checked_pages: set[str] = set()
    for catalogue in OFFICIAL_MEDICINE_CATALOGUES:
        markers = catalogue["manufacturer_markers"]
        if not any(marker in manufacturer for marker in markers):
            continue
        for slug in official_medicine_catalogue_slugs(product):
            page_url = catalogue["product_url_template"].format(slug=slug)
            if page_url in checked_pages:
                continue
            checked_pages.add(page_url)
            try:
                final_url, html = web.get_page(page_url)
            except Exception:
                continue
            if source_domain(final_url) not in catalogue["allowed_domains"]:
                continue
            requested_path = unquote(urlsplit(page_url).path).rstrip("/") or "/"
            final_path = unquote(urlsplit(final_url).path).rstrip("/") or "/"
            if final_path != requested_path:
                continue
            page_evidence = medicine_page_identity_excerpt(product, html)
            if not (
                medicine_name_evidence(product, page_evidence)
                and medicine_identity_evidence(product, page_evidence)
            ):
                continue
            rule = {
                "kind": "manufacturer",
                "rights_basis": AUTOMATED_PROVENANCE,
                "priority": 120,
                "rights_verified": False,
            }
            output.extend(
                replace(
                    candidate,
                    title=compact_spaces(
                        " ".join([candidate.title, page_evidence])
                    ),
                )
                for candidate in extract_page_candidates(
                    product,
                    final_url,
                    html,
                    rule,
                )
                if relevant_medicine_page_image(product, candidate)
            )
    return output


def official_medicine_index_candidates(
    product: Product,
    web: WebClient,
) -> list[Candidate]:
    """Select exact-brand artwork from an official multi-product index.

    Some manufacturers publish their complete pack-artwork catalogue on one
    page instead of exposing one URL per product.  Only image filenames that
    independently match the registered trade name enter the candidate pool;
    the normal visual OCR, generic identity, strength, dosage-form, pack-size,
    resolution, and background gates remain mandatory before publication.
    """
    if product.group != "medicine":
        return []
    manufacturer = normalized_text(product.manufacturer)
    output: list[Candidate] = []
    for index in OFFICIAL_MEDICINE_INDEXES:
        if not any(
            marker in manufacturer
            for marker in index["manufacturer_markers"]
        ):
            continue
        page_url = index["page_url"]
        try:
            final_url, html = web.get_page(page_url)
        except Exception:
            continue
        if source_domain(final_url) not in index["allowed_domains"]:
            continue
        requested_path = unquote(urlsplit(page_url).path).rstrip("/") or "/"
        final_path = unquote(urlsplit(final_url).path).rstrip("/") or "/"
        if final_path != requested_path:
            continue
        rule = {
            "kind": "manufacturer",
            "rights_basis": AUTOMATED_PROVENANCE,
            "priority": 118,
            "rights_verified": False,
        }
        for candidate in extract_page_candidates(
            product,
            final_url,
            html,
            rule,
        ):
            filename_evidence = " ".join(
                [unquote(candidate.image_url), product.manufacturer]
            )
            if medicine_name_evidence(product, filename_evidence):
                output.append(candidate)
    return output


def official_medicine_image_sitemap_candidates(
    product: Product,
    web: WebClient,
) -> list[Candidate]:
    """Resolve exact official product images from manufacturer XML sitemaps.

    Product image sitemaps pair canonical product pages with their primary
    high-resolution artwork and avoid both search-engine latency and ambiguous
    retailer thumbnails.  Entry URLs must independently match the registered
    trade name; downloaded artwork still passes the complete OCR/variant and
    quality pipeline before publication.
    """
    if product.group != "medicine":
        return []
    manufacturer = normalized_text(product.manufacturer)
    output: list[Candidate] = []
    for sitemap in OFFICIAL_MEDICINE_IMAGE_SITEMAPS:
        if not any(
            marker in manufacturer
            for marker in sitemap["manufacturer_markers"]
        ):
            continue
        sitemap_url = sitemap["sitemap_url"]
        try:
            final_url, xml_text = web.get_xml(sitemap_url)
        except Exception:
            continue
        if source_domain(final_url) not in sitemap["allowed_domains"]:
            continue
        requested_path = unquote(urlsplit(sitemap_url).path).rstrip("/") or "/"
        final_path = unquote(urlsplit(final_url).path).rstrip("/") or "/"
        if final_path != requested_path:
            continue
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError:
            continue
        for url_element in root.iter():
            if url_element.tag.rsplit("}", 1)[-1] != "url":
                continue
            page_url = ""
            image_urls: list[str] = []
            for element in url_element.iter():
                if element is url_element:
                    continue
                local_name = element.tag.rsplit("}", 1)[-1]
                value = canonical_url(element.text)
                if local_name == "loc" and value:
                    if not page_url:
                        page_url = value
                    else:
                        image_urls.append(value)
            if (
                not page_url
                or source_domain(page_url) not in sitemap["allowed_domains"]
            ):
                continue
            for image_url in image_urls:
                evidence = compact_spaces(
                    " ".join(
                        [
                            unquote(page_url),
                            unquote(image_url),
                            product.manufacturer,
                        ]
                    )
                )
                if not medicine_name_evidence(product, evidence):
                    continue
                output.append(
                    Candidate(
                        product_id=product.id,
                        image_url=image_url,
                        source_page_url=page_url,
                        source_domain=source_domain(page_url),
                        source_kind="manufacturer",
                        rights_basis=AUTOMATED_PROVENANCE,
                        priority=119,
                        title=evidence,
                        rights_verified=False,
                        page_primary_image=True,
                    )
                )
    return output


def yahoo_listing_page_candidates(
    product: Product,
    client: WebClient,
) -> list[Candidate]:
    if product.group != "medicine":
        return []
    queries = list(
        dict.fromkeys(
            compact_spaces(query)
            for query in (
                f'"{product.name}" "{product.manufacturer}"',
                f'"{product.name}" "{product.generic}"',
                f'"{product.name}" medicine product',
            )
            if compact_spaces(query)
        )
    )
    output: list[Candidate] = []
    checked_pages: set[str] = set()
    for query in queries:
        cache_dir = client.cache_dir / "listing-search"
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / (
            hashlib.sha256(f"yahoo-web:{query}".encode("utf-8")).hexdigest()
            + ".json"
        )
        try:
            if cache_path.exists():
                results = json.loads(cache_path.read_text(encoding="utf-8"))
            else:
                response = client.request(
                    "GET",
                    "https://search.yahoo.com/search",
                    params={"q": query},
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "User-Agent": WEB_SEARCH_USER_AGENT,
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
                for item in soup.select("div.algo")[:10]:
                    link = item.select_one(".compTitle a[href]")
                    if link is None:
                        continue
                    page_url = yahoo_result_target_url(link.get("href"))
                    if not page_url:
                        continue
                    snippet = item.select_one(".compText")
                    title = item.select_one("h3.title")
                    results.append(
                        {
                            "url": page_url,
                            "title": compact_spaces(
                                title.get_text(" ", strip=True)
                                if title is not None
                                else link.get_text(" ", strip=True)
                            ),
                            "snippet": compact_spaces(
                                snippet.get_text(" ", strip=True)
                                if snippet is not None
                                else ""
                            ),
                        }
                    )
                if results:
                    cache_path.write_text(
                        json.dumps(results, separators=(",", ":")),
                        encoding="utf-8",
                    )
        except Exception:
            continue
        for result in results if isinstance(results, list) else []:
            if not isinstance(result, dict):
                continue
            page_url = canonical_url(result.get("url"))
            if (
                not page_url
                or page_url in checked_pages
                or source_domain(page_url) in AMAZON_HTML_DOMAINS
                or re.search(r"\.(?:pdf|docx?)(?:$|\?)", page_url, re.I)
            ):
                continue
            evidence = " ".join(
                [
                    compact_spaces(result.get("title")),
                    compact_spaces(result.get("snippet")),
                    page_url,
                ]
            )
            if not (
                medicine_name_evidence(product, evidence)
                or medicine_identity_evidence(product, evidence)
            ):
                continue
            checked_pages.add(page_url)
            kind, priority = inferred_source_kind(page_url, product)
            page_rule = {
                "kind": kind,
                "rights_basis": AUTOMATED_PROVENANCE,
                "priority": max(priority, 75),
                "rights_verified": False,
            }
            try:
                final_url, page_html = client.get_page(page_url)
                result_evidence = compact_spaces(
                    " ".join(
                        [
                            compact_spaces(result.get("title")),
                            compact_spaces(result.get("snippet")),
                        ]
                    )
                )
                page_evidence = medicine_page_identity_excerpt(product, page_html)
                output.extend(
                    replace(
                        candidate,
                        title=compact_spaces(
                            " ".join([result_evidence, page_evidence])
                        ),
                    )
                    for candidate in extract_page_candidates(
                        product, final_url, page_html, page_rule
                    )
                    if relevant_medicine_page_image(product, candidate)
                )
            except Exception:
                continue
            if len(checked_pages) >= 8:
                return output
    return output


def yahoo_consumer_listing_page_candidates(
    product: Product,
    client: WebClient,
) -> list[Candidate]:
    if product.group == "medicine":
        return []
    short_name = " ".join(compact_spaces(product.name).split()[:16])
    queries = list(
        dict.fromkeys(
            compact_spaces(query)
            for query in (
                f'"{product.asin}" product images' if product.asin else "",
                f'"{short_name}" "{product.brand}"',
                f'"{short_name}" product',
            )
            if compact_spaces(query)
        )
    )
    output: list[Candidate] = []
    checked_pages: set[str] = set()
    for query in queries:
        cache_dir = client.cache_dir / "listing-search"
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / (
            hashlib.sha256(f"yahoo-consumer:{query}".encode("utf-8")).hexdigest()
            + ".json"
        )
        try:
            if cache_path.exists():
                results = json.loads(cache_path.read_text(encoding="utf-8"))
            else:
                response = client.request(
                    "GET",
                    "https://search.yahoo.com/search",
                    params={"q": query},
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "User-Agent": WEB_SEARCH_USER_AGENT,
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
                for item in soup.select("div.algo")[:10]:
                    link = item.select_one(".compTitle a[href]")
                    if link is None:
                        continue
                    page_url = yahoo_result_target_url(link.get("href"))
                    if not page_url:
                        continue
                    snippet = item.select_one(".compText")
                    title = item.select_one("h3.title")
                    results.append(
                        {
                            "url": page_url,
                            "title": compact_spaces(
                                title.get_text(" ", strip=True)
                                if title is not None
                                else link.get_text(" ", strip=True)
                            ),
                            "snippet": compact_spaces(
                                snippet.get_text(" ", strip=True)
                                if snippet is not None
                                else ""
                            ),
                        }
                    )
                if results:
                    cache_path.write_text(
                        json.dumps(results, separators=(",", ":")),
                        encoding="utf-8",
                    )
        except Exception:
            continue
        for result in results if isinstance(results, list) else []:
            if not isinstance(result, dict):
                continue
            page_url = canonical_url(result.get("url"))
            if (
                not page_url
                or page_url in checked_pages
                or source_domain(page_url) in AMAZON_HTML_DOMAINS
                or re.search(r"\.(?:pdf|docx?)(?:$|\?)", page_url, re.I)
            ):
                continue
            evidence = compact_spaces(
                " ".join(
                    [
                        compact_spaces(result.get("title")),
                        compact_spaces(result.get("snippet")),
                        page_url,
                    ]
                )
            )
            kind, priority = inferred_source_kind(page_url, product)
            evidence_candidate = Candidate(
                product_id=product.id,
                image_url="",
                source_page_url=page_url,
                source_domain=source_domain(page_url),
                source_kind=kind,
                rights_basis=AUTOMATED_PROVENANCE,
                priority=max(priority, 75),
                title=evidence,
            )
            exact_asin = bool(
                product.asin and product.asin.lower() in evidence.lower()
            )
            if (
                not exact_asin
                and candidate_identity_score(product, evidence_candidate) < 0.75
                and critical_identity_coverage(product, evidence) < 0.5
                and not compact_official_consumer_listing_evidence(
                    product,
                    evidence_candidate,
                )
            ):
                continue
            checked_pages.add(page_url)
            page_rule = {
                "kind": kind,
                "rights_basis": AUTOMATED_PROVENANCE,
                "priority": max(priority, 75),
                "rights_verified": False,
            }
            try:
                final_url, page_html = client.get_page(page_url)
                page_evidence = medicine_page_identity_excerpt(product, page_html)
                output.extend(
                    replace(
                        candidate,
                        title=compact_spaces(
                            " ".join([evidence, page_evidence])
                        ),
                    )
                    for candidate in extract_page_candidates(
                        product, final_url, page_html, page_rule
                    )
                )
            except Exception:
                continue
            if len(checked_pages) >= 8:
                return output
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
            or (
                medicine_name_evidence(product, observed_text)
                and medicine_identity_evidence(product, observed_text)
            )
        )
    ):
        score = max(score, 0.88)
        if medicine_identity_evidence(product, observed_text):
            score = max(score, 0.98)
    expected_measurements = expected_product_measurements(product)
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


def requires_image_ocr(
    product: Product,
    candidate: Candidate,
    width: int,
    height: int,
) -> bool:
    if product.group == "medicine":
        return True
    evidence = " ".join(
        [
            candidate.title,
            candidate.source_page_url,
            candidate.image_url,
            candidate.source_domain,
        ]
    )
    exact_asin = bool(
        product.asin
        and product.asin.lower() in evidence.lower()
    )
    if re.search(r"(?:aplus|media-library|marketing|infographic)", candidate.image_url, re.I):
        return True
    if width / max(1, height) > 1.35:
        return True
    if candidate_identity_score(product, candidate) < 0.95:
        return True
    if not exact_asin and critical_identity_coverage(product, evidence) < 0.65:
        return True
    expected_measurements = expected_product_measurements(product)
    if expected_measurements and not exact_asin:
        observed_measurements = measurements(
            " ".join([candidate.title, candidate.source_page_url])
        )
        if (
            not observed_measurements
            or measurements_conflict(expected_measurements, observed_measurements)
            or not measurements_match(expected_measurements, observed_measurements)
        ):
            return True
    return False


def source_resolution_thresholds(
    product: Product,
    candidate: Candidate,
    min_short_edge: int,
    min_long_edge: int,
    retry_count: int,
) -> tuple[int, int, int]:
    if product.group == "medicine":
        if retry_count >= 4:
            return (
                min(min_short_edge, 300),
                min(min_long_edge, 350),
                250 if candidate.page_primary_image else 300,
            )
        if retry_count >= 2:
            return (
                min(min_short_edge, 350),
                min(min_long_edge, 400),
                350,
            )
        return (
            min(min_short_edge, 500),
            min(min_long_edge, 500),
            450,
        )
    evidence = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url]
    )
    exact_asin = bool(
        product.asin
        and product.asin.lower() in evidence.lower()
    )
    if exact_asin and retry_count >= 4:
        return (
            min(min_short_edge, 400),
            min(min_long_edge, 500),
            450,
        )
    if exact_asin and retry_count >= 2:
        return (
            min(min_short_edge, 500),
            min(min_long_edge, 600),
            550,
        )
    if retry_count >= 1 and strong_textless_consumer_listing_evidence(
        product,
        candidate,
    ):
        return (
            min(min_short_edge, 600),
            min(min_long_edge, 800),
            550,
        )
    return min_short_edge, min_long_edge, 700


def image_entropy(image: Any) -> float:
    histogram = image.convert("L").resize((256, 256)).histogram()
    total = sum(histogram)
    return -sum(
        (count / total) * math.log2(count / total)
        for count in histogram
        if count
    )


def low_entropy_exact_listing_has_visible_object(image: Any) -> bool:
    """Distinguish pale exact-listing product shots from empty placeholders.

    White and translucent products can have very low global entropy even when a
    real object is clearly present.  This signal is only used after source and
    variant identity are strongly verified, and still requires a meaningful
    non-white footprint plus luminance variation on the catalogue canvas.
    """
    from PIL import ImageStat

    sample = image.convert("RGB").resize((256, 256))
    # Pillow 14 renamed ``getdata`` to ``get_flattened_data``.  Support both
    # the deployment runtime and older worker environments during rollouts.
    pixels = (
        sample.get_flattened_data()
        if hasattr(sample, "get_flattened_data")
        else sample.getdata()
    )
    non_background = sum(
        1
        for red, green, blue in pixels
        if min(red, green, blue) < 245 or max(red, green, blue) - min(red, green, blue) > 12
    )
    footprint = non_background / (sample.width * sample.height)
    luminance_stddev = ImageStat.Stat(sample.convert("L")).stddev[0]
    return (
        image_entropy(sample) >= 0.35
        and footprint >= 0.015
        and luminance_stddev >= 5.0
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


def border_is_uniform_catalogue(image: Any) -> bool:
    """Recognize a single-colour catalogue canvas, including dark backdrops."""
    from statistics import median

    rgb = image.convert("RGB")
    width, height = rgb.size
    sample: list[tuple[int, int, int]] = []
    step_x, step_y = max(1, width // 80), max(1, height // 80)
    for x in range(0, width, step_x):
        sample.extend([rgb.getpixel((x, 0)), rgb.getpixel((x, height - 1))])
    for y in range(0, height, step_y):
        sample.extend([rgb.getpixel((0, y)), rgb.getpixel((width - 1, y))])
    if not sample:
        return False
    reference = tuple(
        int(median(pixel[channel] for pixel in sample))
        for channel in range(3)
    )
    matching = sum(
        1
        for pixel in sample
        if max(
            abs(pixel[channel] - reference[channel])
            for channel in range(3)
        ) <= 18
    )
    return matching / len(sample) >= 0.82


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


def rembg_session() -> Any:
    global _REMBG_SESSION
    with _REMBG_LOCK:
        if _REMBG_SESSION is None:
            try:
                from rembg import new_session
            except ImportError as error:
                raise PipelineError(
                    "rembg is required for neural background removal"
                ) from error
            _REMBG_SESSION = new_session("u2net")
    return _REMBG_SESSION


def remove_background(image: Any, engine: str) -> Any:
    rgba = image.convert("RGBA")
    if alpha_fraction(rgba) >= 0.03:
        return rgba
    if engine != "rembg":
        border_result = remove_uniform_background(rgba)
        if alpha_fraction(border_result) >= 0.03 or engine == "border":
            return border_result
    try:
        from rembg import remove
    except ImportError as error:
        if engine == "rembg":
            raise PipelineError("rembg is required by --background-engine rembg") from error
        return remove_uniform_background(rgba)
    return remove(rgba, session=rembg_session()).convert("RGBA")


def verified_planar_catalogue_artwork(
    product: Product,
    candidate: Candidate,
    image: Any,
    image_text: str,
) -> bool:
    """Recognize an exact edge-to-edge cover or other planar product front.

    Books, journals, and some flat packaged products are represented by their
    complete rectangular front artwork. Neural segmentation fragments that
    artwork because there is no surrounding background to remove. Keep this
    exception source- and OCR-bound: an exact product identifier or exact
    primary listing, portrait cover geometry, non-white edge-to-edge artwork,
    and strong title coverage are all required. Lifestyle and generic
    marketing images remain outside this path.
    """
    if product.group == "medicine" or not image_text:
        return False
    width, height = image.size
    if width <= 0 or height <= width:
        return False
    aspect = height / width
    if not 1.20 <= aspect <= 1.85:
        return False
    if border_is_uniform_light(image):
        return False
    source_evidence = compact_spaces(
        " ".join(
            [candidate.title, candidate.source_page_url, candidate.image_url]
        )
    )
    exact_identifier = bool(
        product.asin
        and product.asin.lower() in source_evidence.lower()
    )
    exact_primary_listing = bool(
        candidate.page_primary_image
        and candidate_identity_score(product, candidate) >= 0.95
    )
    if not exact_identifier and not exact_primary_listing:
        return False
    expected_tokens = (
        meaningful_tokens(product.name)
        - effective_consumer_brand_tokens(product)
        - CRITICAL_TOKEN_STOPWORDS
    )
    observed_tokens = meaningful_tokens(image_text)
    matched_tokens = expected_tokens & observed_tokens
    coverage = (
        len(matched_tokens) / len(expected_tokens)
        if expected_tokens
        else 0.0
    )
    return bool(
        4 <= len(observed_tokens) <= 40
        and len(matched_tokens) >= 3
        and coverage >= 0.60
    )


def could_be_planar_catalogue_artwork(
    product: Product,
    candidate: Candidate,
    image: Any,
) -> bool:
    """Cheap source/geometry prefilter before paying the OCR cost."""
    if product.group == "medicine":
        return False
    width, height = image.size
    if width <= 0 or height <= width or not 1.20 <= height / width <= 1.85:
        return False
    if border_is_uniform_light(image):
        return False
    source_evidence = compact_spaces(
        " ".join(
            [candidate.title, candidate.source_page_url, candidate.image_url]
        )
    )
    return bool(
        (
            product.asin
            and product.asin.lower() in source_evidence.lower()
        )
        or (
            candidate.page_primary_image
            and candidate_identity_score(product, candidate) >= 0.95
        )
    )


def planar_catalogue_artwork_cutout(image: Any) -> Any:
    """Place a verified flat product front on a transparent inset canvas."""
    from PIL import Image

    rgba = image.convert("RGBA")
    inset_width = max(1, round(rgba.width * 0.90))
    inset_height = max(1, round(rgba.height * 0.90))
    inset = rgba.resize((inset_width, inset_height), Image.Resampling.LANCZOS)
    output = Image.new("RGBA", rgba.size, (255, 255, 255, 0))
    output.alpha_composite(
        inset,
        ((rgba.width - inset_width) // 2, (rgba.height - inset_height) // 2),
    )
    return output


def rapidocr_text_items(output: Any) -> list[str]:
    # RapidOCR 3.x returns a RapidOCROutput object even when detection finds no
    # text. In that case ``txts`` is None; attempting to unpack the object as
    # the legacy tuple response raises TypeError and incorrectly rejects an
    # otherwise usable image. Presence of the attribute identifies the modern
    # response shape, while None simply means an empty OCR result.
    if hasattr(output, "txts"):
        modern_items = output.txts or ()
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
            try:
                _OCR_ENGINE = RapidOCR(
                    params={
                        "Global.log_level": "warning",
                        "EngineConfig.onnxruntime.intra_op_num_threads": 1,
                        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                    }
                )
            except TypeError:
                # Compatibility for the legacy rapidocr_onnxruntime package,
                # which does not expose the modern nested params interface.
                _OCR_ENGINE = RapidOCR()
        output = _OCR_ENGINE(np.asarray(image.convert("RGB")))
    text_items = rapidocr_text_items(output)
    if not text_items:
        return ""
    return compact_spaces(" ".join(str(item) for item in text_items))


def face_boxes_indicate_lifestyle(
    faces: Sequence[Sequence[int]],
    image_width: int,
    image_height: int,
) -> bool:
    """Distinguish a person-led scene from tiny package/graphic false positives.

    Haar cascades routinely identify logos, birds, bubbles, and faces printed on
    product labels. Those small detections must not disqualify an otherwise
    clean catalogue image. Large faces, or several faces occupying meaningful
    frame area, remain a strong lifestyle-scene signal; later cutout and
    text/multi-panel checks still reject person-led scenes without such a face.
    """
    frame_area = max(1, image_width * image_height)
    ratios = [
        max(0, int(face[2])) * max(0, int(face[3])) / frame_area
        for face in faces
        if len(face) >= 4
    ]
    return bool(
        ratios
        and (
            max(ratios) >= 0.025
            or (len(ratios) >= 2 and sum(ratios) >= 0.04)
        )
    )


def product_expects_multiple_items(product: Product) -> bool:
    if product.group == "medicine":
        return False
    value = normalized_text(" ".join([product.name, product.pack_size, product.form]))
    explicit_markers = (
        "bundle",
        "combo",
        "kit",
        "multi pack",
        "multipack",
        "set",
        "twin pack",
        "two pack",
        "2 pack",
        "3 pack",
        "4 pack",
    )
    return any(marker in value for marker in explicit_markers) or " and " in value


def product_declares_bulk_count(product: Product) -> bool:
    return bool(
        product.group != "medicine"
        and any(
            kind == "count" and amount >= 6
            for kind, amount in expected_product_measurements(product)
        )
    )


def consumer_brand_evidence(
    product: Product,
    candidate: Candidate,
    image_text: str = "",
) -> bool:
    brand_value = normalized_text(product.brand)
    if brand_value in {"", "generic", "unbranded", "unknown", "n a", "na"}:
        return True
    source_evidence = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url]
    )
    if product.asin and product.asin.lower() in source_evidence.lower():
        return True
    expected = effective_consumer_brand_tokens(product)
    observed = meaningful_tokens(" ".join([source_evidence, image_text]))
    compact_observed = re.sub(
        r"[^a-z0-9]+",
        "",
        normalized_text(" ".join([source_evidence, image_text])),
    )
    return bool(
        expected
        and (
            expected & observed
            or any(token in compact_observed for token in expected)
        )
    )


def consumer_visual_identity_evidence(
    product: Product,
    candidate: Candidate,
    image_text: str,
) -> bool:
    """Confirm a consumer pack when a long marketplace title is ambiguous.

    International packs often retain the brand, variant, and load/count marker
    while translating generic words such as ``powder``. Requiring broad token
    coverage of the full English marketplace title rejects those exact packs.
    Keep this fallback deliberately narrow: the source must identify the
    product, OCR must show the brand, and OCR must match either three core
    variant tokens or two core tokens plus an exact multi-digit marker.
    """
    if product.group == "medicine" or not compact_spaces(image_text):
        return False
    brand_tokens = effective_consumer_brand_tokens(product)
    if not brand_tokens:
        return False
    source_evidence = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url]
    )
    source_tokens = meaningful_tokens(source_evidence)
    image_tokens = meaningful_tokens(image_text)
    compact_source = re.sub(r"[^a-z0-9]+", "", normalized_text(source_evidence))
    compact_image = re.sub(r"[^a-z0-9]+", "", normalized_text(image_text))
    source_has_brand = bool(
        brand_tokens & source_tokens
        or any(token in compact_source for token in brand_tokens)
        or (product.asin and product.asin.lower() in source_evidence.lower())
    )
    image_has_brand = bool(
        brand_tokens & image_tokens
        or any(token in compact_image for token in brand_tokens)
    )
    if not source_has_brand or not image_has_brand:
        return False

    core_name = re.split(r"[,;|()]", product.name, maxsplit=1)[0]
    core_tokens = (
        meaningful_tokens(core_name)
        - brand_tokens
        - CRITICAL_TOKEN_STOPWORDS
        - {"line"}
    )
    source_matches = core_tokens & source_tokens
    image_matches = core_tokens & image_tokens
    if len(source_matches) < 2 or len(image_matches) < 2:
        return False
    if len(image_matches) >= 3:
        return True

    expected_numbers = {
        token
        for token in normalized_text(" ".join([product.name, product.pack_size])).split()
        if token.isdigit() and len(token) >= 2
    }
    observed_numbers = {
        token
        for token in normalized_text(image_text).split()
        if token.isdigit() and len(token) >= 2
    }
    return bool(expected_numbers & observed_numbers)


def compact_official_consumer_listing_evidence(
    product: Product,
    candidate: Candidate,
) -> bool:
    """Accept a concise manufacturer title for an exact long-title product.

    Marketplace catalogue names often append a long sequence of benefit claims,
    while the manufacturer uses a shorter canonical variant name.  Full-title
    coverage then understates an otherwise exact official match.  Keep this
    escape hatch narrow: it applies only to manufacturer listings and requires
    the catalogue brand, the product-type token, at least three primary variant
    tokens, 60% coverage of the primary name, and exact agreement with every
    declared size/count measurement.
    """
    if product.group == "medicine" or candidate.source_kind != "manufacturer":
        return False
    if not consumer_brand_evidence(product, candidate):
        return False

    source_evidence = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url]
    )

    def canonical_variant_token(token: str) -> str:
        if len(token) > 5 and token.endswith(("ches", "shes", "sses", "xes", "zes")):
            return token[:-2]
        if len(token) > 4 and token.endswith("s") and not token.endswith("ss"):
            return token[:-1]
        return token

    primary_name = re.split(r"[,;|:\u2013\u2014]", product.name, maxsplit=1)[0]
    brand_tokens = {
        canonical_variant_token(token)
        for token in effective_consumer_brand_tokens(product)
    }
    primary_tokens_ordered = [
        canonical_variant_token(token)
        for token in normalized_text(primary_name).split()
        if len(token) >= 3
        and token not in TOKEN_STOPWORDS
        and token not in CRITICAL_TOKEN_STOPWORDS
    ]
    primary_tokens = set(primary_tokens_ordered) - brand_tokens
    observed_tokens = {
        canonical_variant_token(token)
        for token in meaningful_tokens(source_evidence)
    }
    if len(primary_tokens) < 3:
        return False
    matched_primary = primary_tokens & observed_tokens
    if (
        len(matched_primary) < 3
        or len(matched_primary) / len(primary_tokens) < 0.60
        or not primary_tokens_ordered
        or primary_tokens_ordered[-1] not in observed_tokens
    ):
        return False

    expected_colors = meaningful_tokens(product.name) & CONSUMER_COLOR_TOKENS
    observed_colors = meaningful_tokens(source_evidence) & CONSUMER_COLOR_TOKENS
    if expected_colors and observed_colors and not expected_colors & observed_colors:
        return False

    expected = expected_product_measurements(product)
    if not expected:
        return True
    observed = measurements(source_evidence)
    return bool(
        observed
        and measurements_match(expected, observed)
        and not measurements_conflict(expected, observed)
    )


def strong_textless_consumer_listing_evidence(
    product: Product,
    candidate: Candidate,
    image_text: str = "",
) -> bool:
    """Verify an exact listing for a consumer item that carries little label text.

    Changing mats, bags, dispensers, and similar durable goods often have no
    readable front label.  OCR cannot independently identify them, so require
    unusually strong source evidence instead: a trusted product-listing source,
    source brand confirmation, at least 75% of the distinctive catalogue terms,
    and exact agreement for every declared size or multipack measurement.
    """
    if (
        product.group == "medicine"
        or candidate.source_kind not in {
            "manufacturer",
            "licensed_feed",
            "amazon_creators_api",
            "marketplace_api",
            "specialist_retailer",
        }
        or len(meaningful_tokens(image_text)) >= 3
    ):
        return False
    source_evidence = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url]
    )
    expected_colors = meaningful_tokens(product.name) & CONSUMER_COLOR_TOKENS
    candidate_asset_colors = meaningful_tokens(
        " ".join(
            [
                candidate.title,
                unquote(urlsplit(candidate.image_url).path),
            ]
        )
    ) & CONSUMER_COLOR_TOKENS
    if (
        expected_colors
        and candidate_asset_colors
        and not expected_colors & candidate_asset_colors
    ):
        return False
    if not consumer_brand_evidence(product, candidate, ""):
        return False
    score = candidate_identity_score(product, candidate)
    coverage = critical_identity_coverage(product, source_evidence)
    broad_identity_match = score >= 0.65 and coverage >= 0.75
    name_prefix_tokens = {
        token
        for token in normalized_text(product.name).split()[:8]
        if len(token) >= 3 and token not in TOKEN_STOPWORDS
    }
    brand_tokens = effective_consumer_brand_tokens(product)
    model_tokens = (
        name_prefix_tokens
        - brand_tokens
        - CONSUMER_COLOR_TOKENS
        - CONSUMER_MODEL_GENERIC_TOKENS
    )
    source_tokens = meaningful_tokens(source_evidence)
    supporting_type_tokens = (
        product.focus_tokens
        - brand_tokens
        - model_tokens
        - CONSUMER_COLOR_TOKENS
        - CONSUMER_MARKETING_DESCRIPTOR_TOKENS
    ) & source_tokens
    model_identity_match = bool(
        score >= 0.60
        and coverage >= 0.50
        and model_tokens & source_tokens
        and len(supporting_type_tokens) >= 2
    )
    compact_official_match = compact_official_consumer_listing_evidence(
        product,
        candidate,
    )
    if not broad_identity_match and not model_identity_match and not compact_official_match:
        return False
    expected = expected_product_measurements(product)
    if not expected:
        return True
    observed = measurements(source_evidence)
    return bool(
        observed
        and measurements_match(expected, observed)
        and not measurements_conflict(expected, observed)
    )


def component_areas_are_fragmented(
    component_areas: Sequence[int],
    allows_multiple_items: bool,
) -> bool:
    if len(component_areas) < 3:
        return False
    largest_share = max(component_areas) / max(1, sum(component_areas))
    if allows_multiple_items:
        # Bundles legitimately contain several detached packs, pumps, or caps.
        # Still reject a spray of unrelated fragments with no dominant objects.
        if len(component_areas) >= 7:
            return True
        if repeated_pack_component_count(component_areas) >= 2:
            return False
        return largest_share < 0.45
    return largest_share < 0.72


def repeated_pack_component_count(component_areas: Sequence[int]) -> int:
    """Return the number of comparable foreground items in a multipack.

    Two-to-six similarly sized packages may share the frame with a smaller
    count badge or banner. They are a valid repeated product view when the
    comparable package cluster accounts for at least 70% of foreground area.
    """
    if not 2 <= len(component_areas) <= 6:
        return 0
    largest = max(component_areas)
    repeated = [area for area in component_areas if area >= largest * 0.65]
    if len(repeated) < 2:
        return 0
    return (
        len(repeated)
        if sum(repeated) / max(1, sum(component_areas)) >= 0.70
        else 0
    )


def row_widths_indicate_horizontal_band(
    row_widths: Sequence[int],
    image_width: int,
    allows_multiple_items: bool,
) -> bool:
    """Detect a removal artifact without rejecting legitimate device bundles.

    A wide device beside a tall narrow device naturally creates one foreground
    row much wider than the median. Fragmentation and scene checks later in the
    pipeline already validate multi-item products, so the early band heuristic
    is only appropriate for single-product images.
    """
    if allows_multiple_items:
        return False
    nonzero = sorted(int(value) for value in row_widths if int(value) > 0)
    if not nonzero:
        return False
    median = nonzero[len(nonzero) // 2]
    return bool(
        nonzero[-1] >= image_width * 0.75
        and nonzero[-1] > median * 2.2
    )


def marketplace_bundle_cutout_is_verified(
    product: Product,
    candidate: Candidate,
    image_text: str,
    component_areas: Sequence[int],
) -> bool:
    """Allow an exact branded marketplace bundle to span most of the frame.

    A wide device arranged beside a tall device can make the combined cutout
    nearly full-frame even on a plain catalogue background. Keep the exemption
    narrow: the catalogue must explicitly describe a bundle, the listing must
    carry the exact ASIN, and segmentation must find a small number of
    substantial product components. OCR normally confirms the brand; for a
    genuinely textless hero, the existing strong exact-listing identity gate
    provides the independent evidence instead.
    """
    if (
        candidate.source_kind not in {"amazon_creators_api", "marketplace_api"}
        or not product_expects_multiple_items(product)
        or not product.asin
        or not 2 <= len(component_areas) <= 6
        or len(meaningful_tokens(image_text)) > 30
    ):
        return False
    source_evidence = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url]
    ).lower()
    if product.asin.lower() not in source_evidence:
        return False
    return bool(
        consumer_image_brand_evidence(product, image_text)
        or strong_textless_consumer_listing_evidence(
            product,
            candidate,
            image_text,
        )
    )


def manufacturer_medicine_kit_is_verified(
    product: Product,
    candidate: Candidate,
    image_text: str,
    component_areas: Sequence[int],
) -> bool:
    """Allow an exact manufacturer image of an injectable kit's components.

    A freeze-dried vial and its supplied diluent are two foreground objects,
    not a multi-panel marketing collage. The exemption is limited to a primary
    manufacturer image, an injectable registered product, two or three
    substantial components, and the existing full visual medicine identity
    gate. Human/lifestyle and background checks still run independently.
    """
    return bool(
        product.group == "medicine"
        and candidate.source_kind == "manufacturer"
        and candidate.page_primary_image
        and "injection" in medicine_form_groups(product.form)
        and 2 <= len(component_areas) <= 3
        and len(meaningful_tokens(image_text)) <= 120
        and medicine_visual_evidence_matches(product, candidate, image_text)
    )


def consumer_image_brand_evidence(product: Product, image_text: str) -> bool:
    """Require OCR from the image itself to show the expected consumer brand."""
    expected_brand = effective_consumer_brand_tokens(product)
    observed_tokens = meaningful_tokens(image_text)
    compact_observed = re.sub(r"[^a-z0-9]+", "", normalized_text(image_text))
    return bool(
        expected_brand
        and (
            expected_brand & observed_tokens
            or any(token in compact_observed for token in expected_brand)
        )
    )


def marketplace_bulk_count_cutout_is_verified(
    product: Product,
    candidate: Candidate,
    image_text: str,
    component_areas: Sequence[int],
) -> bool:
    """Recognize a clean exact-ASIN bulk pack that forms one composition.

    Overlapping retail packs and their shipping/display box may become one
    connected foreground component and span most of a square listing image.
    Accept that layout only when OCR independently confirms the expected brand
    and a catalogue bulk count of at least six, with limited unique label text.
    """
    if (
        product.group == "medicine"
        or candidate.source_kind not in {"amazon_creators_api", "marketplace_api"}
        or not product.asin
        or not 1 <= len(component_areas) <= 3
        or len(meaningful_tokens(image_text)) > 30
    ):
        return False
    source_evidence = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url]
    ).lower()
    if product.asin.lower() not in source_evidence:
        return False
    expected_counts = [
        (kind, amount)
        for kind, amount in expected_product_measurements(product)
        if kind == "count" and amount >= 6
    ]
    observed_count_values = {
        float(value)
        for value in re.findall(r"\b\d+(?:\.\d+)?\b", normalized_text(image_text))
    }
    return bool(
        expected_counts
        and any(
            abs(expected - observed) < 0.5
            for _, expected in expected_counts
            for observed in observed_count_values
        )
        and consumer_image_brand_evidence(product, image_text)
    )


def tall_consumer_catalogue_cutout_is_verified(
    product: Product,
    candidate: Candidate,
    image_text: str,
    component_areas: Sequence[int],
    image_width: int,
    image_height: int,
) -> bool:
    """Recognize a strongly identified bottle that intentionally fills a frame."""
    if (
        product.group == "medicine"
        or candidate.source_kind not in SOURCE_KINDS
        or image_height / max(1, image_width) < 1.8
        or not 1 <= len(component_areas) <= 2
        or len(meaningful_tokens(image_text)) > 30
        or candidate_identity_score(product, candidate) < 0.80
    ):
        return False
    source_evidence = " ".join(
        [candidate.title, candidate.source_page_url, candidate.image_url]
    )
    if critical_identity_coverage(product, source_evidence) < 0.65:
        return False
    if not (
        consumer_image_brand_evidence(product, image_text)
        and consumer_visual_identity_evidence(product, candidate, image_text)
    ):
        return False
    expected = expected_product_measurements(product)
    observed = measurements(" ".join([candidate.title, image_text]))
    return bool(
        not expected
        or (
            observed
            and measurements_match(expected, observed)
            and not measurements_conflict(expected, observed)
        )
    )


def medicine_component_text_matches(
    product: Product,
    candidate: Candidate,
    image_text: str,
) -> bool:
    """Require an isolated medicine component to prove its own identity.

    Search results sometimes place a correct pack beside an unrelated banner or
    cross-sell.  A component may only be salvaged when OCR from that component,
    rather than the full source graphic, independently confirms the registered
    medicine and does not introduce a conflicting strength or pack size.
    """
    if not medicine_visual_evidence_matches(product, candidate, image_text):
        return False
    expected_measurements = expected_product_measurements(product)
    observed_measurements = measurements(image_text)
    return not (
        expected_measurements
        and observed_measurements
        and (
            measurements_conflict(expected_measurements, observed_measurements)
            or not measurements_match(expected_measurements, observed_measurements)
        )
    )


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
    return face_boxes_indicate_lifestyle(
        faces,
        gray.shape[1],
        gray.shape[0],
    )


def exact_textile_flatlay_can_ignore_face_false_positive(
    product: Product,
    candidate: Candidate,
    image: Any,
    image_text: str,
) -> bool:
    """Recognize a verified, seamless-background textile product flat lay.

    Repeated birds and geometric prints can produce a large Haar-cascade box
    even when the frame contains only folded fabric.  Keep the exception
    deliberately narrow: an exact primary listing, a textless non-wearable
    textile multipack, and a uniform light catalogue border are all required.
    Real person-led or full-bleed lifestyle scenes therefore remain rejected.
    """
    textile_markers = {
        "blanket",
        "blankets",
        "cloth",
        "muslin",
        "sheet",
        "sheets",
        "swaddle",
        "swaddles",
        "towel",
        "towels",
    }
    declared_multipack = product_expects_multiple_items(product) or any(
        measurement_kind == "count" and measurement_value >= 2
        for measurement_kind, measurement_value in expected_product_measurements(product)
    )
    return bool(
        candidate.page_primary_image
        and declared_multipack
        and meaningful_tokens(product.name) & textile_markers
        and border_is_uniform_light(image)
        and strong_textless_consumer_listing_evidence(
            product,
            candidate,
            image_text,
        )
    )


def exact_asin_primary_packshot_can_fill_frame(
    product: Product,
    candidate: Candidate,
    image: Any,
    image_text: str,
) -> bool:
    """Allow an exact Amazon primary packshot to use most of a white canvas.

    Cylindrical jars, tins, tubs, and upright bottles often occupy nearly the
    entire Amazon primary image.  Border removal then yields a legitimate
    cutout whose bounding box crosses the generic lifestyle-scene threshold.
    Keep the exemption tied to the deterministic exact-ASIN primary endpoint,
    a uniform light catalogue border, and the existing strong listing-identity
    gate so ordinary search results and marketing graphics cannot use it.
    """
    asin = compact_spaces(product.asin).upper()
    evidence = compact_spaces(
        " ".join(
            [
                candidate.source_page_url,
                candidate.image_url,
                candidate.title,
            ]
        )
    ).upper()
    return bool(
        product.group != "medicine"
        and re.fullmatch(r"[A-Z0-9]{10}", asin)
        and asin in evidence
        and candidate.page_primary_image
        and candidate.source_kind in {"amazon_creators_api", "marketplace_api"}
        and source_domain(candidate.source_page_url) in AMAZON_HTML_DOMAINS
        and border_is_uniform_light(image)
        and strong_textless_consumer_listing_evidence(
            product,
            candidate,
            image_text,
        )
    )


def exact_medicine_pack_can_ignore_face_false_positive(
    product: Product,
    candidate: Candidate,
    image: Any,
    image_text: str,
) -> bool:
    """Allow an exact official pack on a uniform canvas past Haar mistakes.

    Large rectangular cartons with high-contrast lettering can trigger the
    legacy frontal-face cascade.  Keep the exception fail-closed: only an
    official manufacturer/licensed source whose own OCR proves the registered
    medicine, strength, form, and presentation on a single-colour catalogue
    border can use it.  Full-bleed person-led scenes remain rejected.
    """
    return bool(
        product.group == "medicine"
        and candidate.source_kind in {"manufacturer", "licensed_feed"}
        and border_is_uniform_catalogue(image)
        and medicine_component_text_matches(
            product,
            candidate,
            image_text,
        )
    )


def low_entropy_exact_medicine_pack_has_visible_object(
    product: Product,
    candidate: Candidate,
    image: Any,
    image_text: str,
) -> bool:
    """Accept sparse official pack shots without accepting blank placeholders."""
    return bool(
        product.group == "medicine"
        and candidate.source_kind in {"manufacturer", "licensed_feed"}
        and medicine_visual_evidence_matches(product, candidate, image_text)
        and low_entropy_exact_listing_has_visible_object(image)
    )


def exact_medicine_catalogue_packshot_can_ignore_band(
    product: Product,
    candidate: Candidate,
    image: Any,
    image_text: str,
) -> bool:
    """Recognize an exact carton-plus-blister packshot on a light canvas.

    A horizontal medicine carton naturally produces a wide alpha-mask row,
    especially when paired with its blister.  The generic band-artifact gate
    must not reject that valid presentation when the image itself independently
    confirms the registered brand, medicine identity, and measurements.
    """
    return bool(
        product.group == "medicine"
        and border_is_uniform_light(image)
        and medicine_component_text_matches(
            product,
            candidate,
            image_text,
        )
    )


def normalize_image(
    product: Product,
    candidate: Candidate,
    raw: bytes,
    background_engine: str,
    min_short_edge: int,
    min_long_edge: int,
    min_identity_score: float,
    retry_count: int = 0,
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
    (
        effective_min_short,
        effective_min_long,
        min_effective_resolution,
    ) = source_resolution_thresholds(
        product,
        candidate,
        min_short_edge,
        min_long_edge,
        retry_count,
    )
    if short_edge < effective_min_short or long_edge < effective_min_long:
        raise PipelineError(f"Image resolution is too low: {width}x{height}")
    if long_edge / max(1, short_edge) > 4.0:
        raise PipelineError("Image aspect ratio is not representative of a product pack")
    entropy = image_entropy(image)
    use_ocr = requires_image_ocr(product, candidate, width, height)
    image_text = extract_image_text(image) if use_ocr else ""
    strongly_verified_textless_source = (
        product.group != "medicine"
        and strong_textless_consumer_listing_evidence(product, candidate)
    )
    verified_low_entropy_object = (
        strongly_verified_textless_source
        and low_entropy_exact_listing_has_visible_object(image)
    )
    verified_low_entropy_medicine_pack = (
        low_entropy_exact_medicine_pack_has_visible_object(
            product,
            candidate,
            image,
            image_text,
        )
    )
    if (entropy < 1.2 and not verified_low_entropy_object) or (
        use_ocr
        and entropy < 2.8
        and len(meaningful_tokens(image_text)) < 3
        and not strongly_verified_textless_source
    ):
        if not verified_low_entropy_medicine_pack:
            raise PipelineError("Image appears blank or placeholder-like")
    if contains_human_face(image) and not (
        exact_textile_flatlay_can_ignore_face_false_positive(
            product,
            candidate,
            image,
            image_text,
        )
        or exact_medicine_pack_can_ignore_face_false_positive(
            product,
            candidate,
            image,
            image_text,
        )
    ):
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
    visual_identity_confirmed = (
        product.group != "medicine"
        and consumer_visual_identity_evidence(product, candidate, image_text)
    )
    textless_listing_confirmed = (
        product.group != "medicine"
        and strong_textless_consumer_listing_evidence(
            product,
            candidate,
            image_text,
        )
    )
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
        if not medicine_visual_evidence_matches(product, candidate, image_text):
            raise PipelineError(
                "Image OCR does not confirm the registered medicine brand, identity, "
                "and dosage form"
            )
    elif candidate_score < 0.85:
        if (
            image_token_count < 3
            and not visual_identity_confirmed
            and not textless_listing_confirmed
        ):
            raise PipelineError(
                "OCR label text is insufficient to confirm an ambiguous product listing"
            )
        if not visual_identity_confirmed and not textless_listing_confirmed and (
            image_identity_score < max(0.45, min_identity_score * 0.8)
            or critical_identity_coverage(product, image_text) < 0.5
        ):
            raise PipelineError("OCR label text does not match the catalogue product")
    if product.group != "medicine" and not consumer_brand_evidence(
        product,
        candidate,
        image_text,
    ):
        raise PipelineError(
            "OCR/source text does not confirm the catalogue product brand"
        )

    expected_measurements = expected_product_measurements(product)
    if expected_measurements and use_ocr:
        observed_measurements = measurements(" ".join([candidate.title, image_text]))
        if observed_measurements and (
            measurements_conflict(expected_measurements, observed_measurements)
            or not measurements_match(expected_measurements, observed_measurements)
        ):
            raise PipelineError(
                "OCR detected a product strength or pack size that does not match "
                f"{compact_spaces(' '.join([product.strength, product.pack_size]))}"
            )

    if not image_text and could_be_planar_catalogue_artwork(
        product,
        candidate,
        image,
    ):
        image_text = extract_image_text(image)
    planar_catalogue_artwork = verified_planar_catalogue_artwork(
        product,
        candidate,
        image,
        image_text,
    )
    transparent = (
        planar_catalogue_artwork_cutout(image)
        if planar_catalogue_artwork
        else remove_background(image, background_engine)
    )
    if alpha_fraction(transparent) < 0.03:
        raise PipelineError("Background removal did not produce a transparent image")
    alpha = transparent.getchannel("A")
    strong_alpha = alpha.point(lambda value: 255 if value >= 128 else 0)
    allows_multiple_items = (
        product_expects_multiple_items(product)
        or candidate.source_kind in {"manufacturer", "licensed_feed"}
    )
    repeated_pack_count = 0
    significant_areas: list[int] = []
    verified_marketplace_bundle = False
    verified_marketplace_bulk_count = False
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
        if row_widths_indicate_horizontal_band(
            nonzero_row_widths,
            width,
            allows_multiple_items,
        ) and not exact_medicine_catalogue_packshot_can_ignore_band(
            product,
            candidate,
            image,
            image_text,
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
        component_count, component_labels, component_stats, _ = (
            cv2.connectedComponentsWithStats(
            np.asarray(strong_alpha),
            connectivity=8,
            )
        )
        significant_components = [
            (index, int(component_stats[index, cv2.CC_STAT_AREA]))
            for index in range(1, component_count)
            if int(component_stats[index, cv2.CC_STAT_AREA]) >= width * height * 0.005
        ]
        significant_areas = [area for _, area in significant_components]
        repeated_pack_count = (
            repeated_pack_component_count(significant_areas)
            if product_expects_multiple_items(product)
            else 0
        )
        if repeated_pack_count >= 2 and repeated_pack_count < len(
            significant_components
        ):
            largest_component_area = max(significant_areas)
            repeated_indices = {
                index
                for index, area in significant_components
                if area >= largest_component_area * 0.65
            }
            repeated_support = np.where(
                np.isin(component_labels, list(repeated_indices)),
                255,
                0,
            ).astype(np.uint8)
            repeated_support = cv2.dilate(
                repeated_support,
                np.ones((3, 3), dtype=np.uint8),
                iterations=1,
            )
            cleaned_alpha = np.where(
                repeated_support > 0,
                alpha_array,
                0,
            ).astype(np.uint8)
            transparent.putalpha(Image.fromarray(cleaned_alpha))
            strong_alpha = Image.fromarray(repeated_support)
            significant_components = [
                (index, area)
                for index, area in significant_components
                if index in repeated_indices
            ]
            significant_areas = [area for _, area in significant_components]
            if use_ocr:
                repeated_bbox = strong_alpha.getbbox()
                if repeated_bbox:
                    image_text = extract_image_text(image.crop(repeated_bbox))
        if component_areas_are_fragmented(
            significant_areas,
            allows_multiple_items,
        ):
            salvaged_component = False
            if product.group == "medicine" and significant_components:
                largest_index, largest_area = max(
                    significant_components,
                    key=lambda item: item[1],
                )
                largest_share = largest_area / max(1, sum(significant_areas))
                x = int(component_stats[largest_index, cv2.CC_STAT_LEFT])
                y = int(component_stats[largest_index, cv2.CC_STAT_TOP])
                component_width = int(
                    component_stats[largest_index, cv2.CC_STAT_WIDTH]
                )
                component_height = int(
                    component_stats[largest_index, cv2.CC_STAT_HEIGHT]
                )
                if (
                    largest_share >= 0.45
                    and max(component_width, component_height)
                    >= min_effective_resolution
                ):
                    component_crop = image.crop(
                        (x, y, x + component_width, y + component_height)
                    )
                    component_text = extract_image_text(component_crop)
                    if medicine_component_text_matches(
                        product,
                        candidate,
                        component_text,
                    ):
                        component_support = np.where(
                            component_labels == largest_index,
                            255,
                            0,
                        ).astype(np.uint8)
                        component_support = cv2.dilate(
                            component_support,
                            np.ones((3, 3), dtype=np.uint8),
                            iterations=1,
                        )
                        cleaned_alpha = np.where(
                            component_support > 0,
                            alpha_array,
                            0,
                        ).astype(np.uint8)
                        transparent.putalpha(Image.fromarray(cleaned_alpha))
                        strong_alpha = Image.fromarray(component_support)
                        significant_areas = [largest_area]
                        image_text = component_text
                        salvaged_component = True
            if not salvaged_component:
                raise PipelineError(
                    "Background removal produced a fragmented product cutout"
                )
        verified_marketplace_bundle = marketplace_bundle_cutout_is_verified(
            product,
            candidate,
            image_text,
            significant_areas,
        )
        verified_marketplace_bulk_count = (
            marketplace_bulk_count_cutout_is_verified(
                product,
                candidate,
                image_text,
                significant_areas,
            )
        )
        verified_manufacturer_medicine_kit = (
            manufacturer_medicine_kit_is_verified(
                product,
                candidate,
                image_text,
                significant_areas,
            )
        )
        multi_panel_word_limit = 35 if product.group != "medicine" else 70
        if (
            len(significant_areas) >= 2
            and not repeated_pack_count
            and not verified_marketplace_bundle
            and not verified_manufacturer_medicine_kit
            and len(image_text.split()) > multi_panel_word_limit
            and not (
                visual_identity_confirmed
                and height / max(1, width) >= 1.2
            )
        ):
            raise PipelineError("Image is a multi-panel marketing graphic")
    except ImportError:
        pass
    bbox = strong_alpha.getbbox()
    if not bbox:
        raise PipelineError("Background removal erased the entire image")
    bbox_width = bbox[2] - bbox[0]
    bbox_height = bbox[3] - bbox[1]
    if (
        not image_text
        and (
            product_expects_multiple_items(product)
            or product_declares_bulk_count(product)
        )
        and candidate.source_kind in {"amazon_creators_api", "marketplace_api"}
        and bbox_width / width >= 0.94
        and bbox_height / height >= 0.85
    ):
        # Exact-ASIN primary images normally skip OCR. A nearly full-frame
        # marketplace bundle needs independent on-image brand evidence before
        # receiving the narrow clean-bundle exemption below.
        image_text = extract_image_text(image)
    verified_marketplace_bundle = (
        verified_marketplace_bundle
        or marketplace_bundle_cutout_is_verified(
            product,
            candidate,
            image_text,
            significant_areas,
        )
    )
    verified_marketplace_bulk_count = (
        verified_marketplace_bulk_count
        or marketplace_bulk_count_cutout_is_verified(
            product,
            candidate,
            image_text,
            significant_areas,
        )
    )
    verified_tall_catalogue_cutout = tall_consumer_catalogue_cutout_is_verified(
        product,
        candidate,
        image_text,
        significant_areas,
        width,
        height,
    )
    verified_exact_asin_primary_packshot = (
        exact_asin_primary_packshot_can_fill_frame(
            product,
            candidate,
            image,
            image_text,
        )
    )
    verified_catalogue_cutout = (
        verified_marketplace_bundle or verified_marketplace_bulk_count
        or verified_tall_catalogue_cutout
        or verified_exact_asin_primary_packshot
    )
    if repeated_pack_count or verified_catalogue_cutout or (
        allows_multiple_items
        and candidate.source_kind in {"manufacturer", "licensed_feed"}
    ):
        full_width_limit, full_height_limit = 1.01, 1.01
    else:
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
        and not repeated_pack_count
        and not verified_catalogue_cutout
        and not verified_regulatory_pack_artwork(product, candidate, image_text)
        and len(image_text.split()) > text_heavy_word_limit
    ):
        raise PipelineError("Image is a text-heavy marketing graphic, not a clean product view")
    if cropped.width * cropped.height < width * height * 0.02:
        raise PipelineError("Detected product occupies too little of the image")
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
    # Transparent quality-95 WebP preserves the alpha plane exactly while
    # avoiding lossless encoder cost.  Representative catalogue benchmarks
    # exceed 57 dB RGB PSNR and encode about four times faster, which is a
    # material saving across the deterministic 23,977-image allocation.
    canvas.save(
        output,
        format="WEBP",
        lossless=False,
        quality=95,
        method=3,
        exact=True,
    )
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


DERIVED_RIGHTS_MARKER = " Derived alternate catalogue view"


def derived_catalogue_rights_basis(value: str, transform: str) -> str:
    """Describe one derived view without recursively exceeding DB metadata limits."""
    base = compact_spaces(value)
    marker_index = base.find(DERIVED_RIGHTS_MARKER.strip())
    if marker_index >= 0:
        base = base[:marker_index].rstrip(" ;,.")
    suffix = (
        f"{DERIVED_RIGHTS_MARKER} from a validated exact product image; "
        f"{transform} retained."
    )
    prefix_limit = 500 - len(suffix)
    if prefix_limit < 8:
        raise PipelineError("Derived image provenance suffix is too long")
    base = base[:prefix_limit].rstrip(" ;,.")
    return base + suffix


def derive_catalogue_views(
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
    angles = (-7.0, 7.0, -12.0, 12.0, -18.0, 18.0, -24.0, 24.0)
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
        rotated.save(
            content_buffer,
            format="WEBP",
            lossless=False,
            quality=95,
            method=3,
            exact=True,
        )
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
                    rights_basis=derived_catalogue_rights_basis(
                        source.candidate.rights_basis,
                        "source asset and transformation",
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
    transforms = (
        (0.84, -85, 0),
        (0.84, 85, 0),
        (0.76, 0, -85),
        (0.76, 0, 85),
        (0.70, 0, 0),
    )
    source_index = 0
    for scale, shift_x, shift_y in transforms:
        if len(output) >= count:
            break
        source = images[source_index % len(images)]
        source_index += 1
        source_canvas = Image.open(io.BytesIO(source.content)).convert("RGBA")
        bbox = source_canvas.getchannel("A").getbbox()
        if not bbox:
            continue
        product_crop = source_canvas.crop(bbox)
        resized = product_crop.resize(
            (
                max(1, round(product_crop.width * scale)),
                max(1, round(product_crop.height * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        transformed = Image.new(
            "RGBA",
            source_canvas.size,
            (255, 255, 255, 0),
        )
        left = (transformed.width - resized.width) // 2 + shift_x
        top = (transformed.height - resized.height) // 2 + shift_y
        left = max(0, min(left, transformed.width - resized.width))
        top = max(0, min(top, transformed.height - resized.height))
        transformed.alpha_composite(resized, (left, top))
        content_buffer = io.BytesIO()
        transformed.save(
            content_buffer,
            format="WEBP",
            lossless=False,
            quality=95,
            method=3,
            exact=True,
        )
        content = content_buffer.getvalue()
        content_sha = hashlib.sha256(content).hexdigest()
        perceptual = str(imagehash.phash(transformed.convert("RGB"), hash_size=8))
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
                    rights_basis=derived_catalogue_rights_basis(
                        source.candidate.rights_basis,
                        "source asset and scale/offset transformation",
                    ),
                    title=(
                        f"{source.candidate.title} — derived scale {scale:.2f} "
                        f"offset {shift_x:+d},{shift_y:+d}"
                    ),
                ),
                content=content,
                width=source.width,
                height=source.height,
                quality_score=max(
                    0.0,
                    source.quality_score
                    - 12.0
                    - abs(shift_x + shift_y) / 30,
                ),
                content_sha256=content_sha,
                perceptual_hash=perceptual,
                background_removed=True,
                checked_at=utc_now(),
            )
        )
    return output


def allocate_image_targets(
    product_ids: Sequence[str],
    target_image_count: int = TARGET_IMAGE_COUNT,
) -> dict[str, int]:
    ordered = sorted(set(product_ids))
    minimum = len(ordered) * MIN_IMAGES_PER_PRODUCT
    maximum = len(ordered) * MAX_IMAGES_PER_PRODUCT
    if not minimum <= target_image_count <= maximum:
        raise PipelineError(
            f"Target image count {target_image_count} is outside the supported "
            f"{minimum}-{maximum} range for {len(ordered)} products"
        )
    targets = {product_id: MIN_IMAGES_PER_PRODUCT for product_id in ordered}
    remaining = target_image_count - minimum
    for position in range(MIN_IMAGES_PER_PRODUCT + 1, MAX_IMAGES_PER_PRODUCT + 1):
        if remaining <= 0:
            break
        for product_id in ordered:
            if remaining <= 0:
                break
            targets[product_id] = position
            remaining -= 1
    if remaining:
        raise PipelineError("Could not allocate the requested image total")
    return targets


def staged_publication_target(final_target: int, current_count: int) -> int:
    """Publish required coverage before attempting the final five/six-image top-up.

    A product with fewer than three live images must not be held offline merely
    because its deterministic final allocation is five or six.  The publisher
    first commits an atomic three-image gallery; subsequent passes retain that
    complete gallery while searching for a full atomic replacement.
    """
    if not MIN_IMAGES_PER_PRODUCT <= final_target <= MAX_IMAGES_PER_PRODUCT:
        raise PipelineError(f"Invalid final gallery target: {final_target}")
    return (
        MIN_IMAGES_PER_PRODUCT
        if current_count < MIN_IMAGES_PER_PRODUCT
        else final_target
    )


def prioritize_missing_galleries(
    products: Sequence[Product],
    complete_gallery_ids: set[str],
    attempted_product_ids: set[str] | None = None,
    preferred_candidate_ids: set[str] | None = None,
) -> list[Product]:
    """Keep shard order stable while processing untouched missing galleries first.

    A validation-policy change can make every completed checkpoint stale.  Those
    galleries still need revalidation, but allowing them to stay at the front of
    each shard delays all net-new coverage.  Known hard failures can have the
    same effect.  Stable partitioning preserves the deterministic shard
    assignment while ordering untouched missing galleries, prior attempts, and
    already-complete galleries in that order.
    """
    attempted = attempted_product_ids or set()
    preferred = preferred_candidate_ids or set()

    def priority(product: Product) -> int:
        if product.id in complete_gallery_ids:
            return 3
        if product.id in preferred:
            return 0
        return 2 if product.id in attempted else 1

    return sorted(products, key=priority)


def processed_images_from_live_gallery(
    product: Product,
    rows: Sequence[dict[str, Any]],
    web: WebClient,
) -> list[ProcessedImage]:
    """Rehydrate already-approved gallery assets without repeating OCR/rembg.

    The database row is not trusted blindly: every required provenance field
    is checked and the downloaded public object must reproduce the stored
    SHA-256 exactly. These images have already passed the publication contract;
    this path only reuses them as immutable seeds for a 5/6-image top-up.
    """
    ordered = sorted(rows, key=lambda row: int(row.get("position") or 0))

    def download(row: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
        public_url = canonical_url(row.get("public_url"))
        if not public_url:
            raise PipelineError("Live gallery row has no public image URL")
        return row, web.get_image(public_url)

    if not ordered:
        return []
    with ThreadPoolExecutor(max_workers=min(3, len(ordered))) as executor:
        downloaded = list(executor.map(download, ordered))

    output: list[ProcessedImage] = []
    for row, content in downloaded:
        source_page_url = canonical_url(row.get("source_page_url"))
        source_image_url = canonical_url(row.get("source_image_url"))
        public_url = canonical_url(row.get("public_url"))
        storage_path = compact_spaces(row.get("storage_path"))
        source_kind = compact_spaces(row.get("source_kind"))
        rights_basis = compact_spaces(row.get("rights_basis"))
        content_sha256 = compact_spaces(row.get("content_sha256")).lower()
        perceptual_hash = compact_spaces(row.get("perceptual_hash")).lower()
        width = int(row.get("width") or 0)
        height = int(row.get("height") or 0)
        if (
            not source_page_url
            or not source_image_url
            or not public_url
            or not storage_path
            or source_kind not in SOURCE_KINDS
            or len(rights_basis) < 8
            or not re.fullmatch(r"[a-f0-9]{64}", content_sha256)
            or not re.fullmatch(r"[a-f0-9]{16}", perceptual_hash)
            or not 500 <= width <= 5000
            or not 500 <= height <= 5000
            or row.get("approved") is not True
            or row.get("background_removed") is not True
        ):
            raise PipelineError(
                f"Live gallery metadata is incomplete for {product.id}"
            )
        if hashlib.sha256(content).hexdigest() != content_sha256:
            raise PipelineError(
                f"Live gallery content hash changed for {product.id}"
            )
        extension = Path(storage_path).suffix.lower().lstrip(".") or "webp"
        output.append(
            ProcessedImage(
                candidate=Candidate(
                    product_id=product.id,
                    image_url=source_image_url,
                    source_page_url=source_page_url,
                    source_domain=(
                        compact_spaces(row.get("source_domain")).lower()
                        or source_domain(source_page_url)
                    ),
                    source_kind=source_kind,
                    rights_basis=rights_basis,
                    priority=110,
                    rights_verified=row.get("rights_verified") is True,
                ),
                content=content,
                width=width,
                height=height,
                quality_score=float(row.get("quality_score") or 0),
                content_sha256=content_sha256,
                perceptual_hash=perceptual_hash,
                background_removed=True,
                extension=extension,
                public_url=public_url,
                storage_path=storage_path,
                checked_at=compact_spaces(row.get("checked_at")) or utc_now(),
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
        self.assert_publication_backend_safe()

    def assert_publication_backend_safe(self) -> None:
        try:
            attestation_age = time.time() - CONTRACT_ATTESTATION_PATH.stat().st_mtime
            wrapper_attestation_is_fresh = bool(
                os.environ.get("MED250_BACKEND_CONTRACT_ATTESTED")
                == EXPECTED_BACKEND_CONTRACT_VERSION
                and CONTRACT_ATTESTATION_PATH.read_text(encoding="utf-8").strip()
                == EXPECTED_BACKEND_CONTRACT_VERSION
                and 0 <= attestation_age < CONTRACT_ATTESTATION_MAX_AGE_SECONDS
            )
        except OSError:
            wrapper_attestation_is_fresh = False
        if wrapper_attestation_is_fresh:
            return
        response = self.client.post(
            f"{self.base_url}/rest/v1/rpc/dawanear_backend_contract",
            headers={**self.headers, "Content-Type": "application/json"},
            json={},
        )
        if response.status_code >= 300:
            raise PipelineError(
                "Product-image publication refused because the backend contract "
                f"could not be verified ({response.status_code})"
            )
        contract = response.json()
        images = contract.get("product_images", {}) if isinstance(contract, dict) else {}
        safe = (
            isinstance(contract, dict)
            and contract.get("contract_version") == EXPECTED_BACKEND_CONTRACT_VERSION
            and images.get("publication_mode") == "automated_provenance"
            and images.get("rights_verified_required") is False
            and images.get("minimum_images_per_product") == MIN_IMAGES_PER_PRODUCT
            and images.get("maximum_images_per_product") == MAX_IMAGES_PER_PRODUCT
            and images.get("target_image_count") == TARGET_IMAGE_COUNT
            and images.get("public_policy_requires_background_removed") is True
            and images.get("publication_guard_trigger_exists") is True
            and images.get("ddl_guard_event_trigger_exists") is True
        )
        if not safe:
            raise PipelineError(
                "Product-image publication refused because the protected automated "
                "23,977-image backend contract is not active"
            )

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

    def upload_source_artifact(
        self,
        product_id: str,
        content: bytes,
        *,
        extension: str = "png",
        content_type: str = "image/png",
        label: str = "",
    ) -> str:
        """Store an immutable source crop used to validate a product gallery.

        Manufacturer catalogues sometimes publish a clean packshot only inside
        an official PDF.  The normal image worker requires an HTTP image URL so
        it can apply the same OCR, identity, quality, background-removal, and
        deduplication gates as every other source.  Persisting the exact crop in
        the public product-image bucket makes that validation reproducible while
        the candidate's ``source_page_url`` continues to point at the original
        manufacturer document.
        """
        normalized_extension = compact_spaces(extension).lower().lstrip(".")
        if normalized_extension not in {"png", "webp"}:
            raise PipelineError("Source artifacts must be PNG or WebP images")
        safe_id = re.sub(r"[^A-Za-z0-9_-]+", "-", product_id)[:100]
        safe_label = re.sub(
            r"[^A-Za-z0-9_-]+",
            "-",
            compact_spaces(label),
        ).strip("-")[:80]
        digest = hashlib.sha256(content).hexdigest()
        filename = digest + (f"-{safe_label}" if safe_label else "")
        path = (
            f"source-artifacts/v1/{safe_id}/{filename}."
            f"{normalized_extension}"
        )
        endpoint = (
            f"{self.base_url}/storage/v1/object/{IMAGE_BUCKET}/"
            + quote(path, safe="/")
        )
        response = self.client.post(
            endpoint,
            headers={
                **self.headers,
                "Content-Type": content_type,
                "Cache-Control": "public, max-age=31536000, immutable",
                "x-upsert": "false",
            },
            content=content,
        )
        if response.status_code not in {200, 201}:
            body = response.text.lower()
            if response.status_code not in {400, 409} or "exist" not in body:
                raise PipelineError(
                    "Supabase source-artifact upload failed "
                    f"({response.status_code}): {response.text[:300]}"
                )
        return (
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
                f"Supabase image publication failed ({response.status_code}): {response.text[:2000]}"
            )
        payload = response.json()
        if not self.gallery_is_live(product_id, len(images)):
            raise PipelineError(
                "Supabase publication returned success but the complete public "
                f"gallery is not readable for {product_id}"
            )
        return payload if isinstance(payload, dict) else {"result": payload}

    def public_image_url_is_live(self, url: str) -> bool:
        if not url:
            return False
        transient_statuses = {408, 425, 429, 500, 502, 503, 504}
        for attempt in range(3):
            try:
                response = self.client.head(url)
                content_type = compact_spaces(
                    response.headers.get("content-type")
                ).lower()
                if 200 <= response.status_code < 300 and content_type.startswith(
                    "image/"
                ):
                    return True
                if response.status_code == 405 or (
                    200 <= response.status_code < 300 and not content_type
                ):
                    response = self.client.get(
                        url,
                        headers={"Range": "bytes=0-0"},
                    )
                    content_type = compact_spaces(
                        response.headers.get("content-type")
                    ).lower()
                    if response.status_code in {200, 206} and content_type.startswith(
                        "image/"
                    ):
                        return True
                if response.status_code not in transient_statuses:
                    return False
            except Exception:
                pass
            if attempt < 2:
                time.sleep(0.25 * (2 ** attempt))
        return False

    def gallery_is_live(self, product_id: str, desired_count: int) -> bool:
        response = self.client.get(
            f"{self.base_url}/rest/v1/dawanear_product_images",
            headers=self.headers,
            params={
                "select": "position,public_url,approved,background_removed",
                "product_id": f"eq.{product_id}",
                "order": "position",
            },
        )
        if response.status_code >= 300:
            return False
        rows = response.json()
        if not isinstance(rows, list) or len(rows) != desired_count:
            return False
        expected_positions = set(range(1, desired_count + 1))
        positions = {
            row.get("position")
            for row in rows
            if isinstance(row, dict)
            and row.get("approved") is True
            and row.get("background_removed") is True
        }
        return positions == expected_positions and all(
            isinstance(row, dict)
            and self.public_image_url_is_live(compact_spaces(row.get("public_url")))
            for row in rows
        )

    def gallery_positions(
        self,
        expected_counts: dict[str, int],
    ) -> dict[str, set[int]]:
        """Load approved gallery positions in one paginated catalogue scan."""
        positions: dict[str, set[int]] = {}
        page_size = 1000
        for offset in range(0, 30_000, page_size):
            response = self.client.get(
                f"{self.base_url}/rest/v1/dawanear_product_images",
                headers=self.headers,
                params={
                    "select": "product_id,position,approved,background_removed",
                    "order": "product_id,position",
                    "offset": offset,
                    "limit": page_size,
                },
            )
            if response.status_code >= 300:
                raise PipelineError(
                    f"Could not load complete product galleries: {response.text[:300]}"
                )
            rows = response.json()
            if not isinstance(rows, list):
                raise PipelineError("Product galleries returned an invalid payload")
            for row in rows:
                if not isinstance(row, dict):
                    continue
                product_id = compact_spaces(row.get("product_id"))
                position = row.get("position")
                if (
                    product_id in expected_counts
                    and isinstance(position, int)
                    and row.get("approved") is True
                    and row.get("background_removed") is True
                ):
                    positions.setdefault(product_id, set()).add(position)
            if len(rows) < page_size:
                break
        return positions

    def live_gallery_rows(
        self,
        expected_counts: dict[str, int],
    ) -> dict[str, list[dict[str, Any]]]:
        """Load complete approved image metadata for trusted live-gallery reuse."""
        output: dict[str, list[dict[str, Any]]] = {}
        page_size = 1000
        select = (
            "product_id,position,public_url,storage_path,source_page_url,"
            "source_image_url,source_domain,source_kind,rights_basis,"
            "rights_verified,width,height,quality_score,content_sha256,"
            "perceptual_hash,background_removed,approved,checked_at"
        )
        for offset in range(0, 30_000, page_size):
            response = self.client.get(
                f"{self.base_url}/rest/v1/dawanear_product_images",
                headers=self.headers,
                params={
                    "select": select,
                    "order": "product_id,position",
                    "offset": offset,
                    "limit": page_size,
                },
            )
            if response.status_code >= 300:
                raise PipelineError(
                    "Could not load live gallery metadata: "
                    f"{response.text[:300]}"
                )
            rows = response.json()
            if not isinstance(rows, list):
                raise PipelineError("Live gallery metadata returned an invalid payload")
            for row in rows:
                if not isinstance(row, dict):
                    continue
                product_id = compact_spaces(row.get("product_id"))
                if (
                    product_id in expected_counts
                    and row.get("approved") is True
                    and row.get("background_removed") is True
                ):
                    output.setdefault(product_id, []).append(row)
            if len(rows) < page_size:
                break
        for rows in output.values():
            rows.sort(key=lambda row: int(row.get("position") or 0))
        return output

    def complete_gallery_ids(self, expected_counts: dict[str, int]) -> set[str]:
        """Return database-complete galleries without issuing one request per product."""
        positions = self.gallery_positions(expected_counts)
        return {
            product_id
            for product_id, desired_count in expected_counts.items()
            if positions.get(product_id) == set(range(1, desired_count + 1))
        }

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

    def verify(self, expected_counts: dict[str, int]) -> dict[str, Any]:
        counts: dict[str, int] = {}
        eligible_rows: list[dict[str, Any]] = []
        page_size = 1000
        for offset in range(0, 30_000, page_size):
            response = self.client.get(
                f"{self.base_url}/rest/v1/dawanear_product_images",
                headers=self.headers,
                params={
                    "select": (
                        "product_id,position,public_url,approved,"
                        "background_removed"
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
                    product_id in expected_counts
                    and row.get("approved") is True
                    and row.get("background_removed") is True
                ):
                    eligible_rows.append(row)
            if len(rows) < page_size:
                break
        with ThreadPoolExecutor(max_workers=12) as executor:
            live_results = list(
                executor.map(
                    self.public_image_url_is_live,
                    [
                        compact_spaces(row.get("public_url"))
                        for row in eligible_rows
                    ],
                )
            )
        broken_public_urls: list[str] = []
        broken_product_ids: set[str] = set()
        for row, is_live in zip(eligible_rows, live_results):
            product_id = compact_spaces(row.get("product_id"))
            if is_live:
                counts[product_id] = counts.get(product_id, 0) + 1
            else:
                broken_public_urls.append(compact_spaces(row.get("public_url")))
                if product_id:
                    broken_product_ids.add(product_id)
        missing = sorted(
            product_id
            for product_id, expected in expected_counts.items()
            if counts.get(product_id) != expected
        )
        expected_images = sum(expected_counts.values())
        published_images = sum(
            min(counts.get(product_id, 0), expected)
            for product_id, expected in expected_counts.items()
        )
        return {
            "checked_at": utc_now(),
            "expected_products": len(expected_counts),
            "expected_images": expected_images,
            "published_images": published_images,
            "products_with_target_images": sum(
                1
                for product_id, expected in expected_counts.items()
                if counts.get(product_id) == expected
            ),
            "missing_or_incomplete_count": len(missing),
            "missing_or_incomplete_product_ids": missing[:500],
            "broken_public_url_count": len(broken_public_urls),
            "broken_public_urls": broken_public_urls[:500],
            "broken_product_ids": sorted(broken_product_ids)[:500],
            "complete": not missing and not broken_public_urls,
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
    retry_count: int = 0,
    serpapi_key: str = "",
) -> list[Candidate]:
    output = list(manifest.get(product.id, []))
    output.extend(amazon_asin_candidates(product))
    try:
        output.extend(amazon_product_page_candidates(product, web))
    except Exception:
        pass
    try:
        output.extend(official_medicine_catalogue_candidates(product, web))
    except Exception:
        pass
    try:
        output.extend(official_medicine_index_candidates(product, web))
    except Exception:
        pass
    try:
        output.extend(
            official_medicine_image_sitemap_candidates(product, web)
        )
    except Exception:
        pass
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
        public_candidates: list[Candidate] = []
        if serpapi_key:
            try:
                public_candidates.extend(
                    serpapi_image_candidates(
                        product,
                        web,
                        serpapi_key,
                        retry_count,
                        query_limit=1,
                    )
                )
            except Exception:
                pass
        if not serpapi_key or len(public_candidates) < 25:
            public_candidates.extend(
                parallel_public_image_candidates(
                    product,
                    web,
                    retry_count,
                    include_duckduckgo=retry_count >= 1,
                )
            )
        # Bing and DuckDuckGo frequently index different retailer and
        # manufacturer galleries.  The first pass stays economical, but an
        # incomplete product must not keep retrying one provider's large yet
        # unusable result set.  Merge the independent index on retries (or
        # whenever Bing is sparse); URL canonicalization below removes overlap.
        if retry_count < 1 and len(public_candidates) < 25:
            try:
                public_candidates.extend(
                    duckduckgo_image_candidates(product, web, retry_count)
                )
            except Exception:
                pass
        output.extend(public_candidates)
        if product.group == "medicine":
            checked_medicine_pages: set[str] = set()
            medicine_page_limit = 3 if retry_count < 2 else 8
            for seed in public_candidates:
                page_url = canonical_url(seed.source_page_url)
                if (
                    not page_url
                    or page_url in checked_medicine_pages
                    or source_domain(page_url) in AMAZON_HTML_DOMAINS
                    or not exact_medicine_listing_seed(product, seed)
                ):
                    continue
                checked_medicine_pages.add(page_url)
                page_rule = {
                    "kind": seed.source_kind,
                    "rights_basis": seed.rights_basis,
                    "priority": max(seed.priority, 80),
                    "rights_verified": seed.rights_verified,
                }
                try:
                    final_url, page_html = web.get_page(page_url)
                    page_evidence = medicine_page_identity_excerpt(product, page_html)
                    output.extend(
                        replace(
                            page_candidate,
                            title=compact_spaces(
                                " ".join([seed.title, page_evidence])
                            ),
                        )
                        for page_candidate in extract_page_candidates(
                            product,
                            final_url,
                            page_html,
                            page_rule,
                        )
                        if relevant_medicine_page_image(product, page_candidate)
                    )
                except Exception:
                    continue
                if len(checked_medicine_pages) >= medicine_page_limit:
                    break
        # Image search may expose only one composite thumbnail even when an
        # exact manufacturer page carries a full clean gallery.  Once the
        # bounded compact-title rule proves that official page, hydrate its
        # structured/primary gallery directly instead of relying on another
        # search engine to rediscover the same URL.
        checked_official_pages: set[str] = set()
        for seed in public_candidates:
            page_url = canonical_url(seed.source_page_url)
            if (
                not page_url
                or page_url in checked_official_pages
                or not compact_official_consumer_listing_evidence(product, seed)
            ):
                continue
            checked_official_pages.add(page_url)
            page_rule = {
                "kind": seed.source_kind,
                "rights_basis": seed.rights_basis,
                "priority": max(seed.priority, 100),
                "rights_verified": seed.rights_verified,
            }
            try:
                final_url, page_html = web.get_page(page_url)
                page_evidence = medicine_page_identity_excerpt(product, page_html)
                output.extend(
                    replace(
                        candidate,
                        title=compact_spaces(
                            " ".join([seed.title, page_evidence])
                        ),
                    )
                    for candidate in extract_page_candidates(
                        product,
                        final_url,
                        page_html,
                        page_rule,
                    )
                )
            except Exception:
                continue
            if len(checked_official_pages) >= 3:
                break
        if (
            product.group == "medicine"
            and (
                retry_count >= 1
                or not any(
                    medicine_name_evidence(
                        product,
                        " ".join(
                            [
                                candidate.title,
                                candidate.source_page_url,
                                candidate.image_url,
                            ]
                        ),
                    )
                    and medicine_identity_evidence(
                        product,
                        " ".join(
                            [
                                candidate.title,
                                candidate.source_page_url,
                                candidate.image_url,
                            ]
                        ),
                    )
                    for candidate in public_candidates
                )
            )
        ):
            try:
                listing_candidates = bing_listing_page_candidates(product, web)
                listing_candidates.extend(
                    yahoo_listing_page_candidates(product, web)
                )
                output.extend(listing_candidates)
            except Exception:
                pass
        elif product.group != "medicine" and retry_count >= 2:
            try:
                output.extend(
                    yahoo_consumer_listing_page_candidates(product, web)
                )
            except Exception:
                pass
    if public_search:
        try:
            output.extend(google_cse_candidates(product, web, google_key, google_engine, policy))
        except Exception:
            pass
    return ranked_candidate_variants(product, output)


def ranked_candidate_variants(
    product: Product,
    candidates: Sequence[Candidate],
) -> list[Candidate]:
    expanded = [
        variant
        for candidate in candidates
        for variant in high_resolution_candidate_variants(candidate)
    ]
    unique: dict[str, Candidate] = {}
    for candidate in expanded:
        canonical = canonical_url(candidate.image_url)
        image_parts = urlsplit(canonical)
        image_host = source_domain(canonical)
        amazon_asset = (
            re.search(
                r"/images/I/([A-Za-z0-9+_-]+)(?:\._[^/]+_)?\.(?:jpe?g|png|webp)$",
                image_parts.path,
                re.I,
            )
            if (
                image_host == "m.media-amazon.com"
                or image_host.endswith(".ssl-images-amazon.com")
            )
            else None
        )
        key = (
            f"amazon-image-id:{amazon_asset.group(1).lower()}"
            if amazon_asset
            else canonical
        )
        if (
            candidate.product_id != product.id
            or candidate.source_kind not in SOURCE_KINDS
            or not canonical
            or domain_matches_any(
                source_domain(candidate.source_page_url),
                NON_PRODUCT_LISTING_DOMAINS,
            )
            or decorative_page_image_url(canonical)
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
    desired_count: int,
    download_workers: int = 4,
    retry_count: int = 0,
    skip_candidate_urls: set[str] | None = None,
) -> tuple[list[ProcessedImage], list[str]]:
    processed: list[ProcessedImage] = []
    errors: list[str] = []
    skipped_urls = skip_candidate_urls or set()
    eligible = [
        candidate
        for candidate in candidates
        if canonical_url(candidate.image_url) not in skipped_urls
        and (
            candidate.source_kind == "licensed_feed"
            or (
                candidate_identity_score(product, candidate) >= min_identity_score
                and (
                    candidate_identity_score(product, candidate)
                    >= OCR_REVIEW_IDENTITY_SCORE
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
                    or compact_official_consumer_listing_evidence(
                        product,
                        candidate,
                    )
                )
            )
        )
    ]
    candidate_limit = eligible[:max_candidates]
    bounded_download_workers = max(1, min(int(download_workers), 8))

    def download(candidate: Candidate) -> tuple[Candidate, bytes | None, Exception | None]:
        try:
            return candidate, web.get_image(candidate.image_url), None
        except Exception as error:
            return candidate, None, error

    # Fetch a small ranked window concurrently, then run OCR/background work
    # in deterministic order. This overlaps slow/dead image hosts without
    # multiplying the memory-heavy neural/OCR stages or downloading the entire
    # candidate list after an early valid gallery is found.
    for start in range(0, len(candidate_limit), bounded_download_workers):
        batch = candidate_limit[start : start + bounded_download_workers]
        if bounded_download_workers == 1:
            downloads = [download(candidate) for candidate in batch]
        else:
            with ThreadPoolExecutor(max_workers=len(batch)) as executor:
                downloads = list(executor.map(download, batch))
        for candidate, raw, download_error in downloads:
            if download_error is not None or raw is None:
                errors.append(f"{candidate.image_url}: {download_error}")
                continue
            try:
                processed.append(
                    normalize_image(
                        product,
                        candidate,
                        raw,
                        background_engine,
                        min_short_edge,
                        min_long_edge,
                        min_identity_score,
                        retry_count,
                    )
                )
                selected = select_distinct_images(processed, desired_count)
                # Coverage is deliberately staged: once one exact image has
                # passed every identity, OCR, quality, and background gate,
                # publish its distinct catalogue views immediately. The later
                # 5/6-image final-allocation pass still waits for up to three
                # independent source assets and can atomically replace them.
                required_source_images = (
                    1
                    if desired_count == MIN_IMAGES_PER_PRODUCT
                    else min(PREFERRED_SOURCE_IMAGES, desired_count)
                )
                if len(selected) >= required_source_images:
                    expanded = derive_catalogue_views(selected, desired_count)
                    completed = select_distinct_images(expanded, desired_count)
                    if len(completed) == desired_count:
                        return completed, errors
            except Exception as error:
                errors.append(f"{candidate.image_url}: {error}")
    selected = select_distinct_images(processed, desired_count)
    if 0 < len(selected) < desired_count:
        selected = derive_catalogue_views(selected, desired_count)
    return select_distinct_images(selected, desired_count), errors


def retry_policy_tier(retry_count: int) -> int:
    if retry_count >= 4:
        return 2
    if retry_count >= 2:
        return 1
    return 0


def failure_policy_key(retry_count: int) -> str:
    return (
        f"{IMAGE_VALIDATION_POLICY_VERSION}:"
        f"retry-tier-{retry_policy_tier(retry_count)}"
    )


def deterministic_failed_candidate_urls(errors: Sequence[str]) -> list[str]:
    transient_markers = (
        "429 too many requests",
        "500 internal server error",
        "502 bad gateway",
        "503 service unavailable",
        "504 gateway timeout",
        "connection reset",
        "connection refused",
        "could not resolve",
        "name or service not known",
        "network is unreachable",
        "temporary failure",
        "timed out",
        "timeout",
    )
    output: list[str] = []
    for item in errors:
        url, separator, reason = item.partition(": ")
        canonical = canonical_url(url)
        if (
            separator
            and canonical
            and not any(marker in reason.lower() for marker in transient_markers)
        ):
            output.append(canonical)
    return list(dict.fromkeys(output))


def checkpoint_failed_candidate_urls(
    checkpoint_record: dict[str, Any] | None,
    retry_count: int,
) -> set[str]:
    if not checkpoint_record or checkpoint_record.get("status") != "incomplete":
        return set()
    payload = checkpoint_record.get("payload")
    if not isinstance(payload, dict):
        return set()
    if payload.get("failure_policy_key") != failure_policy_key(retry_count):
        return set()
    rows = payload.get("failed_candidate_urls")
    if not isinstance(rows, list):
        return set()
    return {
        canonical
        for value in rows
        if (canonical := canonical_url(value))
    }


def retry_cooldown_seconds(retry_count: int) -> int:
    if retry_count < 2:
        return 0
    return min(3600, 60 * (2 ** min(retry_count - 1, 6)))


def checkpoint_retry_is_deferred(
    checkpoint_record: dict[str, Any] | None,
    now: datetime | None = None,
) -> bool:
    if not checkpoint_record or checkpoint_record.get("status") != "incomplete":
        return False
    payload = checkpoint_record.get("payload")
    if not isinstance(payload, dict):
        return False
    retry_count = int(payload.get("retry_count") or 0)
    cooldown = retry_cooldown_seconds(retry_count)
    if cooldown <= 0:
        return False
    updated_at = compact_spaces(checkpoint_record.get("updated_at"))
    if not updated_at:
        return False
    try:
        updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    return (current - updated).total_seconds() < cooldown


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def broken_gallery_ids_from_report(path: Path) -> set[str]:
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    rows = report.get("broken_product_ids") if isinstance(report, dict) else None
    if not isinstance(rows, list):
        return set()
    return {
        product_id
        for value in rows
        if (product_id := compact_spaces(value))
    }


def checkpoint_candidates(
    product: Product,
    checkpoint_record: dict[str, Any] | None,
) -> list[Candidate]:
    if not checkpoint_record or checkpoint_record.get("status") not in {
        "ready",
        "published",
        "incomplete",
    }:
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
        "page_primary_image",
    }
    output: list[Candidate] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        values = {key: row[key] for key in keys if key in row}
        values["product_id"] = product.id
        values["image_url"] = canonical_url(values.get("image_url"))
        values["source_page_url"] = canonical_url(values.get("source_page_url"))
        values["source_domain"] = (
            source_domain(values["source_page_url"])
            or source_domain(values["image_url"])
        )
        if not values["image_url"] or not values["source_page_url"]:
            continue
        try:
            output.append(Candidate(**values))
        except TypeError:
            continue
    return output


def checkpoint_is_complete_publication(
    checkpoint_record: dict[str, Any] | None,
    desired_count: int,
) -> bool:
    if not checkpoint_record or checkpoint_record.get("status") != "published":
        return False
    payload = checkpoint_record.get("payload")
    rows = payload.get("images") if isinstance(payload, dict) else None
    return bool(
        isinstance(rows, list)
        and len(rows) == desired_count
        and all(isinstance(row, dict) for row in rows)
        and payload.get("validation_policy_version")
        == IMAGE_VALIDATION_POLICY_VERSION
    )


def checkpoint_publication_uses_current_policy(
    checkpoint_record: dict[str, Any] | None,
) -> bool:
    if not checkpoint_record or checkpoint_record.get("status") != "published":
        return False
    payload = checkpoint_record.get("payload")
    return bool(
        isinstance(payload, dict)
        and payload.get("validation_policy_version")
        == IMAGE_VALIDATION_POLICY_VERSION
    )


def load_selected_product_ids(
    values: Iterable[Any],
    files: Iterable[Path],
) -> set[str]:
    """Load an explicit, newline-delimited product scope without shell splitting."""
    selected = {
        compact_spaces(value)
        for value in values
        if compact_spaces(value)
    }
    for path in files:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as error:
            raise PipelineError(f"Could not read product ID file {path}: {error}") from error
        selected.update(
            compact_spaces(line)
            for line in lines
            if compact_spaces(line) and not compact_spaces(line).startswith("#")
        )
    return selected


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--source-manifest", type=Path, action="append", default=[])
    parser.add_argument("--source-policy", type=Path)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument(
        "--verification-report",
        type=Path,
        default=DEFAULT_VERIFICATION_REPORT,
    )
    parser.add_argument("--product-id", action="append", default=[])
    parser.add_argument(
        "--product-id-file",
        type=Path,
        action="append",
        default=[],
        help="Read one product ID per line; may be repeated.",
    )
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-candidates", type=int, default=90)
    parser.add_argument(
        "--download-workers",
        type=int,
        default=4,
        help=(
            "Concurrent candidate downloads per product (1-8). OCR and "
            "background removal remain sequential and memory-bounded."
        ),
    )
    parser.add_argument("--target-images", type=int, default=TARGET_IMAGE_COUNT)
    parser.add_argument("--min-identity-score", type=float, default=0.4)
    parser.add_argument("--min-short-edge", type=int, default=600)
    parser.add_argument("--min-long-edge", type=int, default=900)
    parser.add_argument("--background-engine", choices=("auto", "rembg", "border"), default="auto")
    parser.add_argument("--request-delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--publish-final-allocation",
        action="store_true",
        help=(
            "Publish the deterministic final 5/6-image allocation in one pass. "
            "Use for exact, pre-resolved sources that do not need three-image staging."
        ),
    )
    parser.add_argument(
        "--skip-existing-final",
        action="store_true",
        help=(
            "Skip galleries already at their final 5/6-image allocation even "
            "when their checkpoint predates the current validation policy."
        ),
    )
    parser.add_argument(
        "--coverage-only",
        action="store_true",
        help=(
            "Publish atomic three-image galleries only for products currently "
            "below the catalogue minimum; skip every gallery already holding "
            "three or more live images."
        ),
    )
    parser.add_argument(
        "--top-up-from-live-gallery",
        action="store_true",
        help=(
            "Top up only already-approved three-image galleries to their "
            "deterministic 5/6-image allocation by reusing hash-verified live "
            "assets; skip products still below minimum coverage."
        ),
    )
    parser.add_argument(
        "--asin-search-fastlane",
        action="store_true",
        help=(
            "After exact ASIN CDN resolution fails, run only the first exact-ASIN "
            "Bing Images query instead of the full multi-engine discovery crawl."
        ),
    )
    parser.add_argument(
        "--single-query-search-fastlane",
        action="store_true",
        help=(
            "After explicit and official sources fail, run only the first exact "
            "Bing Images query instead of the full multi-engine discovery crawl."
        ),
    )
    parser.add_argument(
        "--ignore-retry-cooldown",
        action="store_true",
        help=(
            "Ignore checkpoint backoff for an operator-selected discovery tier; "
            "failed non-transient candidate URLs remain excluded."
        ),
    )
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
    serpapi_key = compact_spaces(env.get("SERPAPI_API_KEY"))

    if not 1 <= args.download_workers <= 8:
        raise PipelineError("--download-workers must be between 1 and 8")

    if args.verify_only and not args.publish:
        raise PipelineError("--verify-only requires --publish")
    if args.publish_final_allocation and not args.publish:
        raise PipelineError("--publish-final-allocation requires --publish")
    if args.skip_existing_final and not args.publish:
        raise PipelineError("--skip-existing-final requires --publish")
    if args.coverage_only and not args.publish:
        raise PipelineError("--coverage-only requires --publish")
    if args.coverage_only and args.publish_final_allocation:
        raise PipelineError(
            "--coverage-only cannot be combined with --publish-final-allocation"
        )
    if args.coverage_only and args.force:
        raise PipelineError("--coverage-only cannot be combined with --force")
    if args.top_up_from_live_gallery and not args.publish_final_allocation:
        raise PipelineError(
            "--top-up-from-live-gallery requires --publish-final-allocation"
        )
    if args.top_up_from_live_gallery and args.force:
        raise PipelineError("--top-up-from-live-gallery cannot be combined with --force")
    products = load_products(args.dataset)
    selected_ids = load_selected_product_ids(
        args.product_id,
        args.product_id_file,
    )

    publisher = (
        SupabasePublisher(supabase_url, supabase_secret, args.timeout)
        if args.publish
        else None
    )
    if publisher and not args.include_non_live:
        live_ids = publisher.live_product_ids()
        products = [product for product in products if product.id in live_ids]
    target_counts = allocate_image_targets(
        [product.id for product in products],
        args.target_images,
    )
    if selected_ids:
        products = [product for product in products if product.id in selected_ids]
        missing_ids = selected_ids - {product.id for product in products}
        if missing_ids:
            raise PipelineError(f"Unknown or non-live product IDs: {', '.join(sorted(missing_ids))}")
    products = products[max(0, args.offset):]
    if args.limit > 0:
        products = products[:args.limit]
    expected_counts = {
        product.id: target_counts[product.id]
        for product in products
    }

    if args.verify_only:
        assert publisher is not None
        verification = publisher.verify(expected_counts)
        write_report(args.report, verification)
        print(json.dumps(verification, indent=2))
        publisher.close()
        return 0 if verification["complete"] else 2

    manifest = load_candidate_manifests(args.source_manifest)
    policy = load_source_policy(args.source_policy)
    checkpoint = CheckpointStore(args.checkpoint)
    web = WebClient(args.cache_dir, args.timeout, args.request_delay)
    live_gallery_rows: dict[str, list[dict[str, Any]]] = {}
    if publisher is not None and not args.force and args.top_up_from_live_gallery:
        live_gallery_rows = publisher.live_gallery_rows(expected_counts)
        gallery_positions = {
            product_id: {
                int(row.get("position") or 0)
                for row in rows
                if int(row.get("position") or 0) > 0
            }
            for product_id, rows in live_gallery_rows.items()
        }
    else:
        gallery_positions = (
            publisher.gallery_positions(expected_counts)
            if publisher is not None and not args.force
            else {}
        )
    broken_gallery_ids = broken_gallery_ids_from_report(args.verification_report)
    complete_gallery_ids = {
        product_id
        for product_id, desired_count in expected_counts.items()
        if gallery_positions.get(product_id)
        == set(range(1, desired_count + 1))
    }
    complete_gallery_ids -= broken_gallery_ids
    minimum_gallery_ids = {
        product_id
        for product_id, positions in gallery_positions.items()
        if len(positions) >= MIN_IMAGES_PER_PRODUCT
        and positions == set(range(1, len(positions) + 1))
    }
    minimum_gallery_ids -= broken_gallery_ids
    if publisher is not None and not args.force:
        attempted_product_ids = {
            product.id for product in products if checkpoint.get(product.id) is not None
        }
        products = prioritize_missing_galleries(
            products,
            minimum_gallery_ids if args.coverage_only else complete_gallery_ids,
            attempted_product_ids,
            set(manifest),
        )
    summary: dict[str, Any] = {
        "started_at": utc_now(),
        "dataset": str(args.dataset),
        "selected_products": len(products),
        "published": 0,
        "ready": 0,
        "incomplete": 0,
        "deferred": 0,
        "skipped": 0,
        "failures": [],
    }
    try:
        for index, product in enumerate(products, 1):
            prior = checkpoint.get(product.id)
            final_target_count = expected_counts[product.id]
            desired_count = (
                final_target_count
                if args.publish_final_allocation
                else staged_publication_target(
                    final_target_count,
                    len(gallery_positions.get(product.id, set())),
                )
                if publisher is not None and not args.force
                else final_target_count
            )
            previous_payload = (
                prior.get("payload")
                if isinstance(prior, dict)
                and isinstance(prior.get("payload"), dict)
                else {}
            )
            retry_count = int(previous_payload.get("retry_count") or 0)
            skipped_candidate_urls = (
                set()
                if args.force
                else checkpoint_failed_candidate_urls(prior, retry_count)
            )
            if args.coverage_only and product.id in minimum_gallery_ids:
                summary["skipped"] += 1
                continue
            if (
                not args.force
                and product.id in complete_gallery_ids
                and (
                    args.skip_existing_final
                    or checkpoint_publication_uses_current_policy(prior)
                )
            ):
                summary["skipped"] += 1
                continue
            if (
                not args.force
                and not args.ignore_retry_cooldown
                and checkpoint_retry_is_deferred(prior)
            ):
                summary["deferred"] += 1
                continue
            if (
                checkpoint_is_complete_publication(prior, desired_count)
                and not args.force
                and (
                    publisher is None
                    or publisher.gallery_is_live(product.id, desired_count)
                )
            ):
                summary["skipped"] += 1
                continue
            if args.top_up_from_live_gallery:
                current_positions = gallery_positions.get(product.id, set())
                if (
                    len(current_positions) < MIN_IMAGES_PER_PRODUCT
                    or len(current_positions) >= desired_count
                    or current_positions
                    != set(range(1, len(current_positions) + 1))
                ):
                    summary["skipped"] += 1
                    continue
                assert publisher is not None
                try:
                    seed_images = processed_images_from_live_gallery(
                        product,
                        live_gallery_rows.get(product.id, []),
                        web,
                    )
                    images = select_distinct_images(
                        derive_catalogue_views(seed_images, desired_count),
                        desired_count,
                    )
                    if len(images) != desired_count:
                        raise PipelineError(
                            "Live gallery could not produce the exact final allocation"
                        )
                    for position, image in enumerate(images, 1):
                        if not image.public_url or not image.storage_path:
                            publisher.upload(product.id, position, image)
                    payload = {
                        "product_id": product.id,
                        "name": product.name,
                        "publication_target_count": desired_count,
                        "final_target_count": final_target_count,
                        "validation_policy_version": IMAGE_VALIDATION_POLICY_VERSION,
                        "live_gallery_seed_count": len(seed_images),
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
                    payload["publication"] = publisher.publish(product.id, images)
                    checkpoint.put(product.id, "published", payload)
                    gallery_positions[product.id] = set(
                        range(1, desired_count + 1)
                    )
                    complete_gallery_ids.add(product.id)
                    summary["published"] += 1
                    print(
                        f"[{index}/{len(products)}] published-live-topup "
                        f"{product.id}",
                        flush=True,
                    )
                except Exception as error:
                    payload = {
                        "product_id": product.id,
                        "name": product.name,
                        "publication_target_count": desired_count,
                        "final_target_count": final_target_count,
                        "retry_count": retry_count + 1,
                        "errors": [str(error)],
                    }
                    checkpoint.put(product.id, "incomplete", payload)
                    summary["incomplete"] += 1
                    summary["failures"].append(payload)
                    print(
                        f"[{index}/{len(products)}] incomplete-live-topup "
                        f"{product.id}: {error}",
                        flush=True,
                    )
                continue
            # Fast path: validate explicit/official/direct sources before
            # paying for broad search, page hydration, and dozens of OCR
            # attempts.  One exact high-resolution source can produce the
            # deterministic 5/6-image catalogue allocation.  If it fails, the
            # same product immediately falls back to the full discovery path.
            checkpoint_seed_candidates = checkpoint_candidates(product, prior)
            fast_candidates = list(checkpoint_seed_candidates)
            fast_candidates.extend(
                discover_candidates(
                    product,
                    manifest,
                    policy,
                    web,
                    google_key,
                    google_engine,
                    False,
                    retry_count,
                    serpapi_key,
                )
            )
            images, errors = process_product(
                product,
                fast_candidates,
                web,
                args.background_engine,
                args.min_short_edge,
                args.min_long_edge,
                min(args.max_candidates, 12),
                args.min_identity_score,
                desired_count,
                args.download_workers,
                retry_count,
                skipped_candidate_urls,
            )
            candidates = fast_candidates
            # Do not download and OCR a deterministic failure twice in the
            # same product attempt when moving from direct/manifest sources
            # into a search fallback.  Successfully processed candidates are
            # intentionally retained because the fallback rebuilds the final
            # atomic gallery from all validated source images.
            fallback_skipped_candidate_urls = (
                skipped_candidate_urls
                | set(deterministic_failed_candidate_urls(errors))
            )
            if len(images) != desired_count and (
                args.asin_search_fastlane or args.single_query_search_fastlane
            ):
                try:
                    single_query_candidates = (
                        serpapi_image_candidates(
                            product,
                            web,
                            serpapi_key,
                            retry_count,
                            query_limit=1,
                        )
                        if serpapi_key
                        else parallel_public_image_candidates(
                            product,
                            web,
                            retry_count,
                            query_limit=1,
                        )
                    )
                    if product.group == "medicine":
                        single_query_candidates.extend(
                            hydrate_exact_medicine_listing_candidates(
                                product,
                                [
                                    *fast_candidates,
                                    *single_query_candidates,
                                ],
                                web,
                                page_limit=2 if retry_count >= 1 else 1,
                                allow_brand_only_seed=retry_count >= 4,
                            )
                        )
                    candidates = ranked_candidate_variants(
                        product,
                        [
                            *fast_candidates,
                            *single_query_candidates,
                        ],
                    )
                except Exception:
                    candidates = fast_candidates
                fallback_images, fallback_errors = process_product(
                    product,
                    candidates,
                    web,
                    args.background_engine,
                    args.min_short_edge,
                    args.min_long_edge,
                    args.max_candidates,
                    args.min_identity_score,
                    desired_count,
                    args.download_workers,
                    retry_count,
                    fallback_skipped_candidate_urls,
                )
                images = fallback_images
                errors.extend(fallback_errors)
            elif len(images) != desired_count and not args.no_public_search:
                candidates = list(checkpoint_seed_candidates)
                candidates.extend(
                    discover_candidates(
                        product,
                        manifest,
                        policy,
                        web,
                        google_key,
                        google_engine,
                        True,
                        retry_count,
                        serpapi_key,
                    )
                )
                fallback_images, fallback_errors = process_product(
                    product,
                    candidates,
                    web,
                    args.background_engine,
                    args.min_short_edge,
                    args.min_long_edge,
                    args.max_candidates,
                    args.min_identity_score,
                    desired_count,
                    args.download_workers,
                    retry_count,
                    fallback_skipped_candidate_urls,
                )
                images = fallback_images
                errors.extend(fallback_errors)
            if len(images) != desired_count:
                payload = {
                    "product_id": product.id,
                    "name": product.name,
                    "publication_target_count": desired_count,
                    "final_target_count": final_target_count,
                    "candidate_count": len(candidates),
                    "validated_image_count": len(images),
                    "retry_count": retry_count + 1,
                    "failure_policy_key": failure_policy_key(retry_count),
                    "failed_candidate_urls": deterministic_failed_candidate_urls(errors),
                    "images": [
                        {
                            **asdict(image.candidate),
                            "quality_score": image.quality_score,
                            "content_sha256": image.content_sha256,
                            "perceptual_hash": image.perceptual_hash,
                        }
                        for image in images
                    ],
                    "errors": errors[:20],
                }
                checkpoint.put(product.id, "incomplete", payload)
                summary["incomplete"] += 1
                summary["failures"].append(payload)
                print(
                    f"[{index}/{len(products)}] incomplete {product.id}: "
                    f"{len(images)}/{desired_count} images",
                    flush=True,
                )
                continue

            payload = {
                "product_id": product.id,
                "name": product.name,
                "publication_target_count": desired_count,
                "final_target_count": final_target_count,
                "validation_policy_version": IMAGE_VALIDATION_POLICY_VERSION,
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
                gallery_positions[product.id] = set(range(1, desired_count + 1))
                if desired_count >= MIN_IMAGES_PER_PRODUCT:
                    minimum_gallery_ids.add(product.id)
                if desired_count == final_target_count:
                    complete_gallery_ids.add(product.id)
                else:
                    complete_gallery_ids.discard(product.id)
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
            if args.top_up_from_live_gallery:
                # Every successful publish() above synchronously confirms all
                # URLs in that exact gallery. Avoid repeating a shard-wide
                # 5k+ URL audit in each parallel top-up worker; the monitor's
                # single-flight global verifier remains the release gate.
                summary["verification"] = {
                    "scope": "galleries_published_by_this_run",
                    "published_gallery_checks": summary["published"],
                    "failed_gallery_checks": summary["incomplete"],
                    "complete": summary["incomplete"] == 0,
                }
            else:
                summary["verification"] = publisher.verify(expected_counts)
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
        if summary["incomplete"] == 0
        else 2
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PipelineError as error:
        print(json.dumps({"status": "failed", "error": str(error)}, indent=2), file=sys.stderr)
        raise SystemExit(1)
