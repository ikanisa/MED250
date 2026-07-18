#!/usr/bin/env python3
"""Build an exact, provenance-retaining medicine manifest from search cache."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import enrich_product_images as pipeline


DEFAULT_OUTPUT = (
    pipeline.REPO_ROOT
    / "data/product-images/cached-exact-medicine-candidates.json"
)


def cached_bing_rows(
    cache_dir: Path,
    product: pipeline.Product,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen_queries: set[str] = set()
    for retry_count in range(4):
        for query in pipeline.product_image_search_queries(product, retry_count):
            if query in seen_queries:
                continue
            seen_queries.add(query)
            cache_path = cache_dir / (
                hashlib.sha256(f"bing:{query}".encode("utf-8")).hexdigest()
                + ".json"
            )
            try:
                rows = json.loads(cache_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                rows = []
            if isinstance(rows, list):
                output.extend(row for row in rows if isinstance(row, dict))
            duck_path = cache_dir / (
                hashlib.sha256(f"duckduckgo:{query}".encode("utf-8")).hexdigest()
                + ".json"
            )
            try:
                duck_payload = json.loads(duck_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                duck_payload = {}
            duck_rows = (
                duck_payload.get("results", [])
                if isinstance(duck_payload, dict)
                else []
            )
            for row in duck_rows:
                if not isinstance(row, dict):
                    continue
                output.append(
                    {
                        "purl": row.get("url"),
                        "murl": row.get("image"),
                        "t": row.get("title"),
                        "w": row.get("width"),
                        "h": row.get("height"),
                    }
                )
            yandex_path = cache_dir / (
                hashlib.sha256(f"yandex:{query}".encode("utf-8")).hexdigest()
                + ".json"
            )
            try:
                yandex_rows = json.loads(yandex_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                yandex_rows = []
            for row in yandex_rows if isinstance(yandex_rows, list) else []:
                if not isinstance(row, dict) or row.get("censored") is True:
                    continue
                snippet = row.get("snippet")
                if not isinstance(snippet, dict):
                    snippet = {}
                output.append(
                    {
                        "purl": snippet.get("url"),
                        "murl": row.get("origUrl"),
                        "t": snippet.get("title") or row.get("alt"),
                        "w": row.get("origWidth"),
                        "h": row.get("origHeight"),
                    }
                )
            serpapi_path = cache_dir / (
                hashlib.sha256(
                    f"serpapi-google-images:{query}".encode("utf-8")
                ).hexdigest()
                + ".json"
            )
            try:
                serpapi_payload = json.loads(
                    serpapi_path.read_text(encoding="utf-8")
                )
            except (OSError, json.JSONDecodeError):
                serpapi_payload = {}
            serpapi_rows = (
                serpapi_payload.get("images_results", [])
                if isinstance(serpapi_payload, dict)
                else []
            )
            for row in serpapi_rows:
                if not isinstance(row, dict) or row.get("unsafe") is True:
                    continue
                output.append(
                    {
                        "purl": row.get("link"),
                        "murl": row.get("original"),
                        "t": row.get("title"),
                        "w": row.get("original_width"),
                        "h": row.get("original_height"),
                    }
                )
    return output


def build_manifest(dataset: Path, cache_dir: Path) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for product in pipeline.load_products(dataset):
        if product.group != "medicine":
            continue
        for item in cached_bing_rows(cache_dir, product):
            page_url = pipeline.canonical_url(item.get("purl"))
            image_url = pipeline.canonical_url(item.get("murl"))
            title = pipeline.compact_spaces(item.get("t"))
            page_domain = pipeline.source_domain(page_url)
            evidence = " ".join([title, page_url, image_url])
            key = (product.id, image_url)
            if (
                not page_url
                or not image_url
                or not pipeline.image_urls_from_value(image_url)
                or key in seen
                or pipeline.domain_matches_any(
                    page_domain,
                    pipeline.NON_PRODUCT_LISTING_DOMAINS,
                )
                or not pipeline.medicine_name_evidence(product, evidence)
                or not pipeline.medicine_identity_evidence(product, evidence)
            ):
                continue
            seen.add(key)
            source_kind, priority = pipeline.inferred_source_kind(
                page_url,
                product,
            )
            output.append(
                {
                    "product_id": product.id,
                    "source_page_url": page_url,
                    "source_kind": source_kind,
                    "rights_basis": pipeline.AUTOMATED_PROVENANCE,
                    "rights_verified": False,
                    "page_primary_image": False,
                    "priority": priority,
                    "width": int(item.get("w") or 0),
                    "height": int(item.get("h") or 0),
                    "title": title,
                    "images": [image_url],
                }
            )
    output.sort(
        key=lambda row: (
            row["product_id"],
            -int(row["priority"]),
            row["source_page_url"],
            row["images"][0],
        )
    )
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=pipeline.DEFAULT_DATASET)
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=pipeline.DEFAULT_CACHE / "search",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    rows = build_manifest(args.dataset, args.cache_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(rows, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "candidates": len(rows)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
