#!/usr/bin/env python3
"""Build exact medicine candidates from MYDAWA's robots-advertised sitemap."""

from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import enrich_product_images as pipeline


SITEMAP_URL = "https://mydawa.com/sitemap.xml"
DEFAULT_OUTPUT = (
    pipeline.REPO_ROOT
    / "data/product-images/mydawa-sitemap-candidates.json"
)
RIGHTS_BASIS = (
    "Public MYDAWA registered-pharmacy product listing discovered from its "
    "robots-advertised sitemap; exact source product and image URLs retained "
    "for traceability; reuse rights not independently verified."
)


def sitemap_product_urls(xml_text: str) -> list[str]:
    root = ET.fromstring(xml_text.lstrip("\ufeff"))
    output: list[str] = []
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "loc":
            continue
        page_url = pipeline.canonical_url(element.text)
        if (
            page_url
            and pipeline.source_domain(page_url) == "mydawa.com"
            and "/products/" in page_url
        ):
            output.append(page_url)
    return list(dict.fromkeys(output))


def matched_product_pages(
    dataset: Path,
    xml_text: str,
    max_pages: int,
) -> list[tuple[pipeline.Product, str]]:
    medicines = [
        product
        for product in pipeline.load_products(dataset)
        if product.group == "medicine"
    ]
    product_tokens = {
        product.id: pipeline.medicine_core_name_tokens(product)
        for product in medicines
    }
    token_frequency = Counter(
        token
        for tokens in product_tokens.values()
        for token in set(tokens)
    )
    product_index: dict[str, dict[str, pipeline.Product]] = {}
    for product in medicines:
        tokens = product_tokens[product.id]
        if not tokens:
            continue
        rarest_token = min(
            tokens,
            key=lambda token: (token_frequency[token], -len(token), token),
        )
        product_index.setdefault(rarest_token, {})[product.id] = product

    output: list[tuple[pipeline.Product, str]] = []
    per_product: Counter[str] = Counter()
    for page_url in sitemap_product_urls(xml_text):
        evidence = pipeline.unquote(page_url)
        observed_tokens = set(pipeline.normalized_text(evidence).split())
        candidate_products: dict[str, pipeline.Product] = {}
        for token in observed_tokens:
            candidate_products.update(product_index.get(token, {}))
        observed_measurements = pipeline.measurements(evidence)
        for product in candidate_products.values():
            expected_measurements = pipeline.expected_product_measurements(product)
            if (
                per_product[product.id] >= 2
                or not pipeline.medicine_name_evidence(product, evidence)
                or (
                    expected_measurements
                    and observed_measurements
                    and pipeline.measurements_conflict(
                        expected_measurements,
                        observed_measurements,
                    )
                )
            ):
                continue
            output.append((product, page_url))
            per_product[product.id] += 1
            if max_pages > 0 and len(output) >= max_pages:
                return output
    return output


def build_manifest(
    dataset: Path,
    web: pipeline.WebClient,
    xml_text: str,
    max_pages: int,
    workers: int,
) -> tuple[list[dict[str, Any]], int]:
    product_pages = matched_product_pages(dataset, xml_text, max_pages)
    # Initialize and cache robots policy before concurrent reads.
    if not web.robots_allowed(SITEMAP_URL):
        raise pipeline.PipelineError("MYDAWA robots policy disallows its sitemap")

    def fetch_page(
        item: tuple[pipeline.Product, str],
    ) -> tuple[pipeline.Product, str, str] | None:
        product, page_url = item
        try:
            final_url, html = web.get_page(page_url)
        except Exception:
            return None
        if pipeline.source_domain(final_url) != "mydawa.com":
            return None
        return product, final_url, html

    fetched: list[tuple[pipeline.Product, str, str]] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [executor.submit(fetch_page, item) for item in product_pages]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                fetched.append(result)

    output: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    rule = {
        "kind": "specialist_retailer",
        "rights_basis": RIGHTS_BASIS,
        "rights_verified": False,
        "priority": 90,
    }
    for product, page_url, html in fetched:
        page_evidence = pipeline.medicine_page_identity_excerpt(product, html)
        if not (
            pipeline.medicine_name_evidence(product, page_evidence)
            and pipeline.medicine_identity_evidence(product, page_evidence)
        ):
            continue
        for candidate in pipeline.extract_page_candidates(
            product,
            page_url,
            html,
            rule,
        ):
            key = (product.id, candidate.image_url)
            if (
                key in seen
                or not pipeline.relevant_medicine_page_image(product, candidate)
            ):
                continue
            seen.add(key)
            output.append(
                {
                    "product_id": product.id,
                    "source_page_url": page_url,
                    "source_kind": "specialist_retailer",
                    "rights_basis": RIGHTS_BASIS,
                    "rights_verified": False,
                    "page_primary_image": candidate.page_primary_image,
                    "priority": max(90, candidate.priority),
                    "width": candidate.declared_width,
                    "height": candidate.declared_height,
                    "title": pipeline.compact_spaces(
                        " ".join([candidate.title, page_evidence])
                    ),
                    "images": [candidate.image_url],
                }
            )
    output.sort(
        key=lambda row: (
            row["product_id"],
            row["source_page_url"],
            row["images"][0],
        )
    )
    return output, len(product_pages)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=pipeline.DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--timeout", type=float, default=25.0)
    parser.add_argument("--max-pages", type=int, default=1000)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    web = pipeline.WebClient(pipeline.DEFAULT_CACHE, args.timeout, 0.15)
    try:
        final_url, xml_text = web.get_xml(SITEMAP_URL)
        if pipeline.source_domain(final_url) != "mydawa.com":
            raise pipeline.PipelineError("MYDAWA sitemap redirected off-domain")
        rows, matched_pages = build_manifest(
            args.dataset,
            web,
            xml_text,
            args.max_pages,
            args.workers,
        )
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
                "matched_pages": matched_pages,
                "candidates": len(rows),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
