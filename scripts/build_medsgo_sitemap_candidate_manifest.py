#!/usr/bin/env python3
"""Build exact medicine candidates from MedsGo's robots-advertised image sitemap."""

from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any

import enrich_product_images as pipeline


SITEMAP_URL = "https://medsgo.ph/images1.xml"
DEFAULT_OUTPUT = (
    pipeline.REPO_ROOT
    / "data/product-images/medsgo-sitemap-candidates.json"
)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def sitemap_entries(xml_text: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_text)
    output: list[dict[str, Any]] = []
    for url_element in root:
        if local_name(url_element.tag) != "url":
            continue
        page_url = ""
        images: list[dict[str, str]] = []
        for child in url_element:
            child_name = local_name(child.tag)
            if child_name == "loc":
                page_url = pipeline.canonical_url(child.text)
                continue
            if child_name != "image":
                continue
            image_url = ""
            title_parts: list[str] = []
            for field in child:
                field_name = local_name(field.tag)
                if field_name == "loc":
                    image_url = pipeline.canonical_url(field.text)
                elif field_name in {"title", "caption"}:
                    title_parts.append(pipeline.compact_spaces(field.text))
            if image_url and pipeline.image_urls_from_value(image_url):
                images.append(
                    {
                        "image_url": image_url,
                        "title": pipeline.compact_spaces(" ".join(title_parts)),
                    }
                )
        if page_url and images:
            output.append({"page_url": page_url, "images": images})
    return output


def build_manifest(dataset: Path, xml_text: str) -> list[dict[str, Any]]:
    entries = sitemap_entries(xml_text)
    output: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
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

    for entry in entries:
        for image in entry["images"]:
            evidence = pipeline.compact_spaces(
                " ".join(
                    [
                        image["title"],
                        entry["page_url"],
                        image["image_url"],
                    ]
                )
            )
            observed_tokens = pipeline.normalized_text(evidence).split()
            candidate_products: dict[str, pipeline.Product] = {}
            for lookup_key in set(observed_tokens):
                candidate_products.update(product_index.get(lookup_key, {}))
            observed_measurements = pipeline.measurements(evidence)
            for product in candidate_products.values():
                expected_measurements = pipeline.expected_product_measurements(
                    product
                )
                key = (product.id, image["image_url"])
                if (
                    key in seen
                    or not pipeline.medicine_name_evidence(product, evidence)
                    or not pipeline.medicine_identity_evidence(product, evidence)
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
                seen.add(key)
                output.append(
                    {
                        "product_id": product.id,
                        "source_page_url": entry["page_url"],
                        "source_kind": "specialist_retailer",
                        "rights_basis": (
                            "Public MedsGo pharmacy image sitemap listing; exact "
                            "source product and image URLs retained for traceability; "
                            "reuse rights not independently verified."
                        ),
                        "rights_verified": False,
                        "page_primary_image": True,
                        "priority": 92,
                        "title": image["title"],
                        "images": [image["image_url"]],
                    }
                )
    output.sort(
        key=lambda row: (
            row["product_id"],
            row["source_page_url"],
            row["images"][0],
        )
    )
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=pipeline.DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    web = pipeline.WebClient(pipeline.DEFAULT_CACHE, args.timeout, 0.2)
    try:
        final_url, xml_text = web.get_xml(SITEMAP_URL)
    finally:
        web.close()
    if pipeline.source_domain(final_url) != "medsgo.ph":
        raise pipeline.PipelineError("MedsGo sitemap redirected off-domain")
    rows = build_manifest(args.dataset, xml_text)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(rows, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "candidates": len(rows)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
