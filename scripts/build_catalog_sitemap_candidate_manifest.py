#!/usr/bin/env python3
"""Build exact medicine candidates by indexing proven public catalogues once.

The normal image worker searches the web separately for every product.  This
builder reverses that relationship: it reads robots-advertised product
sitemaps from manufacturer and specialist-pharmacy domains that have already
produced approved MED250 galleries, matches URLs to the registered catalogue
locally, and fetches only exact-looking product pages.  The resulting manifest
still goes through the full image OCR, strength, form, pack, resolution,
background-removal, and perceptual-deduplication gates before publication.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urlsplit

import enrich_product_images as pipeline


DEFAULT_OUTPUT = (
    pipeline.REPO_ROOT
    / "data/product-images/catalog-sitemap-candidates.json"
)
RIGHTS_BASIS = (
    "Public manufacturer or specialist-pharmacy product listing discovered "
    "from a robots-advertised sitemap; exact source product and image URLs "
    "retained for traceability; reuse rights not independently verified."
)


@dataclass(frozen=True)
class Catalogue:
    name: str
    sitemap_urls: tuple[str, ...]
    allowed_domains: frozenset[str]
    source_kind: str
    priority: int
    page_path_pattern: str
    sitemap_name_pattern: str = r"(?:product|pharma|medicine|rx|fmcg)"
    manufacturer_markers: tuple[str, ...] = ()


CATALOGUES = (
    Catalogue(
        "Dawa Life Sciences",
        ("https://dawalifesciences.com/sitemap_index.xml",),
        frozenset({"dawalifesciences.com", "www.dawalifesciences.com"}),
        "manufacturer",
        122,
        r"/product/",
        manufacturer_markers=("dawa limited", "dawa life sciences"),
    ),
    Catalogue(
        "Rene Industries",
        ("https://www.rene.co.ug/wp-sitemap.xml",),
        frozenset({"rene.co.ug", "www.rene.co.ug"}),
        "manufacturer",
        122,
        r"/products?/",
        sitemap_name_pattern=r"posts-product",
        manufacturer_markers=("rene industries",),
    ),
    Catalogue(
        "Denk Pharma",
        ("https://www.denkpharma.com/sitemap_index.xml",),
        frozenset({"denkpharma.com", "www.denkpharma.com"}),
        "manufacturer",
        122,
        r"/(?:products|produkte|produits|productos)/",
        sitemap_name_pattern=r"products-sitemap",
        manufacturer_markers=("denk pharma", "denkpharma"),
    ),
    Catalogue(
        "Medecify",
        ("https://medecify.com/sitemap_index.xml",),
        frozenset({"medecify.com", "www.medecify.com"}),
        "specialist_retailer",
        98,
        r"/product/",
    ),
    Catalogue(
        "Asset Pharmacy",
        ("https://assetpharmacy.com/sitemap.xml",),
        frozenset({"assetpharmacy.com", "www.assetpharmacy.com"}),
        "specialist_retailer",
        96,
        r"/product/",
    ),
    Catalogue(
        "ePharmacy Kenya",
        ("http://www.epharmacyke.com/sitemap_index.xml",),
        frozenset({"epharmacyke.com", "www.epharmacyke.com"}),
        "specialist_retailer",
        100,
        r"/product/",
    ),
    Catalogue(
        "Apollo Pharmacy",
        ("https://www.apollopharmacy.in/sitemap/sitemap-master.xml",),
        frozenset({"apollopharmacy.in", "www.apollopharmacy.in"}),
        "specialist_retailer",
        100,
        r"/(?:medicine|workout-essentials)/",
        sitemap_name_pattern=r"(?:pharma-rx|pharma-otc|fmcg)",
    ),
    Catalogue(
        "PharmEasy",
        (
            "https://pharmeasy.in/sitemaps/"
            "sitemap-prescription-medicines.xml",
        ),
        frozenset({"pharmeasy.in", "www.pharmeasy.in"}),
        "specialist_retailer",
        100,
        r"/online-medicine-order/",
        sitemap_name_pattern=r"sitemap-prescription-medicine",
    ),
    Catalogue(
        "Chebu Health Products",
        ("https://hpa.chebupharma.com/sitemap.xml",),
        frozenset({"hpa.chebupharma.com"}),
        "specialist_retailer",
        102,
        r"/shop/product/",
        sitemap_name_pattern=r"sitemap",
    ),
    Catalogue(
        "Truemeds",
        ("https://www.truemeds.in/sitemap-medicines.xml",),
        frozenset({"truemeds.in", "www.truemeds.in"}),
        "specialist_retailer",
        100,
        r"/medicine/",
        sitemap_name_pattern=r"sitemap-medicines",
    ),
    Catalogue(
        "BuyMed",
        ("https://buymed.com.kh/sitemaps.xml",),
        frozenset({"buymed.com.kh", "www.buymed.com.kh"}),
        "specialist_retailer",
        98,
        r"/product/",
    ),
    Catalogue(
        "Trung Tam Thuoc",
        tuple(
            f"https://trungtamthuoc.com/sitemap_pro{index}.xml"
            for index in range(1, 11)
        ),
        frozenset({"trungtamthuoc.com", "www.trungtamthuoc.com"}),
        "specialist_retailer",
        96,
        r"^/(?!author(?:/|$)|news(?:/|$))[^/]+/?$",
        sitemap_name_pattern=r"sitemap_pro",
    ),
)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def sitemap_payload(xml_text: str) -> tuple[str, list[dict[str, Any]]]:
    """Return ``(kind, entries)`` for a sitemap index or URL set."""
    root = ET.fromstring(xml_text.lstrip("\ufeff"))
    kind = local_name(root.tag)
    entries: list[dict[str, Any]] = []
    if kind == "sitemapindex":
        for element in root:
            if local_name(element.tag) != "sitemap":
                continue
            location = next(
                (
                    pipeline.canonical_url(child.text)
                    for child in element
                    if local_name(child.tag) == "loc"
                ),
                "",
            )
            if location:
                entries.append({"page_url": location, "images": []})
        return kind, entries
    if kind != "urlset":
        return kind, entries
    for element in root:
        if local_name(element.tag) != "url":
            continue
        page_url = ""
        images: list[dict[str, str]] = []
        for child in element:
            name = local_name(child.tag)
            if name == "loc":
                page_url = pipeline.canonical_url(child.text)
                continue
            if name != "image":
                continue
            image_url = ""
            title_parts: list[str] = []
            for field in child:
                field_name = local_name(field.tag)
                if field_name == "loc":
                    image_url = pipeline.canonical_url(field.text)
                elif field_name in {"title", "caption"}:
                    title_parts.append(pipeline.compact_spaces(field.text))
            if image_url:
                images.append(
                    {
                        "image_url": image_url,
                        "title": pipeline.compact_spaces(" ".join(title_parts)),
                    }
                )
        if page_url:
            entries.append({"page_url": page_url, "images": images})
    return kind, entries


def allowed_catalogue_url(catalogue: Catalogue, url: str) -> bool:
    return pipeline.source_domain(url) in catalogue.allowed_domains


def product_page_url(catalogue: Catalogue, url: str) -> bool:
    if not allowed_catalogue_url(catalogue, url):
        return False
    path = unquote(urlsplit(url).path).lower()
    return bool(re.search(catalogue.page_path_pattern, path, re.I))


def child_sitemap_url(catalogue: Catalogue, url: str) -> bool:
    if not allowed_catalogue_url(catalogue, url):
        return False
    name = unquote(urlsplit(url).path).lower()
    return bool(re.search(catalogue.sitemap_name_pattern, name, re.I))


def url_lookup_tokens(url: str) -> set[str]:
    """Tokenize a catalogue URL cheaply before expensive identity checks.

    A large pharmacy sitemap can contain hundreds of thousands of URLs.  The
    pipeline's full Unicode/medicine normalizer is intentionally thorough but
    is wasteful for this first inverted-index lookup.  URL slugs are ASCII in
    the indexed catalogues, so a bounded regex tokenization is equivalent for
    candidate retrieval; exact medicine normalization still runs on every
    possible match below.
    """
    return set(re.findall(r"[a-z0-9]+", unquote(url).lower()))


def crawl_catalogue_sitemaps(
    catalogue: Catalogue,
    web: pipeline.WebClient,
    max_sitemaps: int,
) -> list[dict[str, Any]]:
    queue = list(catalogue.sitemap_urls)
    seen_sitemaps: set[str] = set()
    pages: dict[str, dict[str, Any]] = {}
    while queue and len(seen_sitemaps) < max_sitemaps:
        sitemap_url = queue.pop(0)
        canonical = pipeline.canonical_url(sitemap_url)
        if not canonical or canonical in seen_sitemaps:
            continue
        seen_sitemaps.add(canonical)
        try:
            final_url, xml_text = web.get_xml(canonical)
        except Exception:
            continue
        if not allowed_catalogue_url(catalogue, final_url):
            continue
        try:
            kind, entries = sitemap_payload(xml_text)
        except ET.ParseError:
            continue
        if kind == "sitemapindex":
            queue.extend(
                entry["page_url"]
                for entry in entries
                if child_sitemap_url(catalogue, entry["page_url"])
            )
            continue
        for entry in entries:
            page_url = entry["page_url"]
            if product_page_url(catalogue, page_url):
                pages.setdefault(page_url, entry)
    return list(pages.values())


def product_lookup(
    products: Iterable[pipeline.Product],
) -> tuple[dict[str, dict[str, pipeline.Product]], dict[str, list[str]]]:
    medicines = [product for product in products if product.group == "medicine"]
    token_map = {
        product.id: pipeline.medicine_core_name_tokens(product)
        for product in medicines
    }
    frequency = Counter(
        token for tokens in token_map.values() for token in set(tokens)
    )
    index: dict[str, dict[str, pipeline.Product]] = {}
    for product in medicines:
        tokens = token_map[product.id]
        if not tokens:
            continue
        # Index two rare tokens.  Multi-word brands can otherwise be missed
        # when a catalogue inserts a dosage-form word inside its slug.
        for token in sorted(
            set(tokens), key=lambda value: (frequency[value], -len(value), value)
        )[:2]:
            index.setdefault(token, {})[product.id] = product
    return index, token_map


def match_catalogue_pages(
    catalogue: Catalogue,
    entries: Iterable[dict[str, Any]],
    product_index: dict[str, dict[str, pipeline.Product]],
    product_tokens: dict[str, list[str]],
    allowed_product_ids: set[str] | None,
    max_pages_per_product: int,
) -> list[tuple[Catalogue, pipeline.Product, dict[str, Any]]]:
    output: list[tuple[Catalogue, pipeline.Product, dict[str, Any]]] = []
    per_product: Counter[str] = Counter()
    for entry in entries:
        page_url = entry["page_url"]
        evidence = unquote(page_url)
        observed_tokens = url_lookup_tokens(evidence)
        candidates: dict[str, pipeline.Product] = {}
        for token in observed_tokens:
            candidates.update(product_index.get(token, {}))
        observed_measurements = pipeline.measurements(evidence)
        for product in candidates.values():
            if allowed_product_ids is not None and product.id not in allowed_product_ids:
                continue
            if per_product[product.id] >= max_pages_per_product:
                continue
            expected_name_tokens = set(product_tokens.get(product.id, []))
            if expected_name_tokens and not expected_name_tokens.issubset(
                observed_tokens
            ):
                continue
            manufacturer = pipeline.normalized_text(product.manufacturer)
            if catalogue.manufacturer_markers and not any(
                marker in manufacturer for marker in catalogue.manufacturer_markers
            ):
                continue
            expected_measurements = pipeline.expected_product_measurements(product)
            if (
                not pipeline.medicine_name_evidence(product, evidence)
                or (
                    expected_measurements
                    and observed_measurements
                    and pipeline.measurements_conflict(
                        expected_measurements, observed_measurements
                    )
                )
            ):
                continue
            output.append((catalogue, product, entry))
            per_product[product.id] += 1
    return output


def fetch_candidate_rows(
    matches: Iterable[tuple[Catalogue, pipeline.Product, dict[str, Any]]],
    web: pipeline.WebClient,
    workers: int,
) -> list[dict[str, Any]]:
    matches = list(matches)
    # Prime robots parsing before concurrent page reads to avoid duplicate
    # initialization races for several pages on the same origin.
    for page_url in dict.fromkeys(entry["page_url"] for _, _, entry in matches):
        web.robots_allowed(page_url)

    def fetch(
        item: tuple[Catalogue, pipeline.Product, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        catalogue, product, entry = item
        page_url = entry["page_url"]
        try:
            if not web.robots_allowed(page_url):
                return []
            response = web.request(
                "GET",
                page_url,
                headers={"Accept": "text/html,application/xhtml+xml"},
                attempts=2,
            )
            content_type = response.headers.get("content-type", "").lower()
            if "html" not in content_type or len(response.content) > 5 * 1024 * 1024:
                return []
            final_url, html = str(response.url), response.text
        except Exception:
            return []
        if not allowed_catalogue_url(catalogue, final_url):
            return []
        page_evidence = pipeline.medicine_page_identity_excerpt(product, html)
        if not (
            pipeline.medicine_name_evidence(product, page_evidence)
            and pipeline.medicine_identity_evidence(product, page_evidence)
        ):
            return []
        rule = {
            "kind": catalogue.source_kind,
            "rights_basis": RIGHTS_BASIS,
            "rights_verified": False,
            "priority": catalogue.priority,
        }
        candidates = pipeline.extract_page_candidates(
            product, final_url, html, rule
        )
        rows: list[dict[str, Any]] = []
        seen_images: set[str] = set()
        for candidate in candidates:
            if (
                candidate.image_url in seen_images
                or not pipeline.relevant_medicine_page_image(product, candidate)
            ):
                continue
            seen_images.add(candidate.image_url)
            rows.append(
                {
                    "product_id": product.id,
                    "source_page_url": final_url,
                    "source_kind": catalogue.source_kind,
                    "rights_basis": RIGHTS_BASIS,
                    "rights_verified": False,
                    "page_primary_image": candidate.page_primary_image,
                    "priority": max(catalogue.priority, candidate.priority),
                    "width": candidate.declared_width,
                    "height": candidate.declared_height,
                    "title": pipeline.compact_spaces(
                        " ".join([candidate.title, page_evidence])
                    ),
                    "images": [candidate.image_url],
                }
            )
        return rows

    output: list[dict[str, Any]] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [executor.submit(fetch, item) for item in matches]
        for future in as_completed(futures):
            output.extend(future.result())
            completed += 1
            if completed % 100 == 0 or completed == len(matches):
                print(
                    json.dumps(
                        {
                            "matched_pages_processed": completed,
                            "matched_pages_total": len(matches),
                        }
                    ),
                    flush=True,
                )
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for row in output:
        unique[(row["product_id"], row["images"][0])] = row
    return sorted(
        unique.values(),
        key=lambda row: (
            row["product_id"],
            -int(row["priority"]),
            row["source_page_url"],
            row["images"][0],
        ),
    )


def missing_minimum_product_ids(
    products: Iterable[pipeline.Product],
) -> set[str] | None:
    products = list(products)
    env = {
        **pipeline.load_dotenv(pipeline.REPO_ROOT / ".env.local"),
        **os.environ,
    }
    url = pipeline.compact_spaces(
        env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    key = pipeline.compact_spaces(
        env.get("SUPABASE_SECRET_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        return None
    publisher = pipeline.SupabasePublisher(url, key, 60.0)
    try:
        live_ids = publisher.live_product_ids()
        positions = publisher.gallery_positions(
            {
                product.id: pipeline.MIN_IMAGES_PER_PRODUCT
                for product in products
                if product.id in live_ids
            }
        )
    finally:
        publisher.close()
    return {
        product.id
        for product in products
        if product.id in live_ids
        and len(positions.get(product.id, set())) < pipeline.MIN_IMAGES_PER_PRODUCT
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=pipeline.DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--timeout", type=float, default=25.0)
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--request-delay", type=float, default=0.08)
    parser.add_argument("--max-sitemaps", type=int, default=80)
    parser.add_argument("--max-pages-per-product", type=int, default=3)
    parser.add_argument(
        "--all-products",
        action="store_true",
        help="Index completed products too; default is Supabase products below 3.",
    )
    parser.add_argument(
        "--catalogue",
        action="append",
        default=[],
        help="Only run a named catalogue; may be repeated.",
    )
    args = parser.parse_args()

    selected = list(CATALOGUES)
    if args.catalogue:
        wanted = {value.casefold() for value in args.catalogue}
        selected = [item for item in selected if item.name.casefold() in wanted]
        if len(selected) != len(wanted):
            known = ", ".join(item.name for item in CATALOGUES)
            raise pipeline.PipelineError(f"Unknown catalogue; expected one of: {known}")

    products = pipeline.load_products(args.dataset)
    allowed_ids = None if args.all_products else missing_minimum_product_ids(products)
    product_index, product_tokens = product_lookup(products)
    web = pipeline.WebClient(
        pipeline.DEFAULT_CACHE,
        args.timeout,
        args.request_delay,
    )
    try:
        for catalogue in selected:
            for root_url in catalogue.sitemap_urls:
                web.robots_allowed(root_url)
        catalogue_entries: dict[str, list[dict[str, Any]]] = {}
        with ThreadPoolExecutor(max_workers=min(len(selected), 10)) as executor:
            futures = {
                executor.submit(
                    crawl_catalogue_sitemaps,
                    catalogue,
                    web,
                    args.max_sitemaps,
                ): catalogue
                for catalogue in selected
            }
            for future in as_completed(futures):
                catalogue = futures[future]
                entries = future.result()
                catalogue_entries[catalogue.name] = entries
                print(
                    json.dumps(
                        {
                            "catalogue": catalogue.name,
                            "product_urls": len(entries),
                        }
                    ),
                    flush=True,
                )
        matches: list[tuple[Catalogue, pipeline.Product, dict[str, Any]]] = []
        for catalogue in selected:
            matches.extend(
                match_catalogue_pages(
                    catalogue,
                    catalogue_entries.get(catalogue.name, []),
                    product_index,
                    product_tokens,
                    allowed_ids,
                    args.max_pages_per_product,
                )
            )
        rows = fetch_candidate_rows(matches, web, args.workers)
    finally:
        web.close()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(rows, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "catalogues": len(selected),
                "missing_products": len(allowed_ids) if allowed_ids is not None else None,
                "matched_pages": len(matches),
                "candidate_images": len(rows),
                "matched_products": len({row["product_id"] for row in rows}),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
