#!/usr/bin/env python3
"""Prefetch one bounded public-image query for missing medicine products.

The persistent publisher deliberately performs deep discovery product by
product.  That is robust but slow for the residual catalogue.  This helper
selects only live Supabase products below the three-image minimum that have no
exact cached candidate, performs one query per independent public image index
concurrently, and hydrates at most one exact-brand listing page.  It writes a
normal provenance-retaining source manifest; every image is still subjected to
the publisher's OCR, strength/form/pack, quality, background, and dedupe gates.
"""

from __future__ import annotations

import argparse
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from pathlib import Path
from typing import Any, Iterable

import build_catalog_sitemap_candidate_manifest as catalog_builder
import enrich_product_images as pipeline


DEFAULT_OUTPUT = (
    pipeline.REPO_ROOT
    / "data/product-images/prefetched-missing-search-candidates.json"
)
DEFAULT_EXACT_MANIFEST = (
    pipeline.REPO_ROOT
    / "data/product-images/cached-exact-medicine-candidates.json"
)


def manifest_product_ids(paths: Iterable[Path]) -> set[str]:
    output: set[str] = set()
    for path in paths:
        if not path.exists():
            continue
        for row in pipeline.iter_records(path):
            product_id = pipeline.compact_spaces(row.get("product_id"))
            if product_id:
                output.add(product_id)
    return output


def candidate_manifest_row(candidate: pipeline.Candidate) -> dict[str, Any]:
    values = asdict(candidate)
    return {
        "product_id": values["product_id"],
        "source_page_url": values["source_page_url"],
        "source_kind": values["source_kind"],
        "rights_basis": values["rights_basis"],
        "rights_verified": values["rights_verified"],
        "page_primary_image": values["page_primary_image"],
        "priority": values["priority"],
        "width": values["declared_width"],
        "height": values["declared_height"],
        "title": values["title"],
        "images": [values["image_url"]],
    }


def write_candidate_manifest(
    path: Path,
    candidates_by_product: dict[str, list[pipeline.Candidate]],
) -> int:
    """Atomically checkpoint discovered candidates for immediate reuse."""
    rows = [
        candidate_manifest_row(candidate)
        for product_id in sorted(candidates_by_product)
        for candidate in candidates_by_product[product_id]
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(
        json.dumps(rows, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
    return len(rows)


def useful_direct_seed(
    product: pipeline.Product,
    candidate: pipeline.Candidate,
) -> bool:
    evidence = pipeline.compact_spaces(
        " ".join(
            [candidate.title, candidate.source_page_url, candidate.image_url]
        )
    )
    if not pipeline.medicine_name_evidence(product, evidence):
        return False
    expected = pipeline.expected_product_measurements(product)
    # Hostnames can contain unit-like brand text (for example, ``1mg.com``).
    # Prefer the human-readable result title for dose/pack comparison and use
    # URL text only when the provider supplied no measurable title evidence.
    observed = pipeline.measurements(candidate.title) or pipeline.measurements(evidence)
    if expected and observed and pipeline.measurements_conflict(expected, observed):
        return False
    return bool(
        pipeline.exact_medicine_listing_seed(product, candidate)
        or pipeline.candidate_identity_score(product, candidate) >= 0.55
        or pipeline.critical_identity_coverage(product, evidence) >= 0.5
    )


def discover_product_candidates(
    product: pipeline.Product,
    web: pipeline.WebClient,
    retry_tier: int,
    max_candidates: int,
    provider: str = "all",
) -> list[pipeline.Candidate]:
    if provider == "brave":
        searched = pipeline.brave_image_candidates(
            product,
            web,
            retry_count=retry_tier,
            query_limit=1,
        )
    else:
        searched = pipeline.parallel_public_image_candidates(
            product,
            web,
            retry_count=retry_tier,
            query_limit=1,
            include_duckduckgo=True,
        )
    hydrated = pipeline.hydrate_exact_medicine_listing_candidates(
        product,
        searched,
        web,
        page_limit=1,
        allow_brand_only_seed=True,
    )
    eligible = [
        candidate
        for candidate in searched
        if useful_direct_seed(product, candidate)
    ]
    eligible.extend(hydrated)
    ranked = pipeline.ranked_candidate_variants(product, eligible)
    output: list[pipeline.Candidate] = []
    seen: set[str] = set()
    for candidate in ranked:
        canonical = pipeline.canonical_url(candidate.image_url)
        if not canonical or canonical in seen:
            continue
        seen.add(canonical)
        output.append(candidate)
        if len(output) >= max_candidates:
            break
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=pipeline.DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--exact-manifest",
        type=Path,
        action="append",
        default=[],
        help="Manifest whose product IDs should be skipped; may be repeated.",
    )
    parser.add_argument("--retry-tier", type=int, default=1)
    parser.add_argument("--provider", choices=("all", "brave"), default="all")
    parser.add_argument("--workers", type=int, default=18)
    parser.add_argument("--max-candidates-per-product", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--request-delay", type=float, default=0.5)
    parser.add_argument(
        "--include-products-with-cached-candidates",
        action="store_true",
    )
    args = parser.parse_args()

    if args.retry_tier < 0:
        raise pipeline.PipelineError("--retry-tier must be non-negative")
    products = pipeline.load_products(args.dataset)
    missing_ids = catalog_builder.missing_minimum_product_ids(products)
    if missing_ids is None:
        raise pipeline.PipelineError(
            "Supabase credentials are required to select below-three products"
        )
    exact_paths = args.exact_manifest or [DEFAULT_EXACT_MANIFEST]
    already_cached = (
        set()
        if args.include_products_with_cached_candidates
        else manifest_product_ids(exact_paths)
    )
    selected = [
        product
        for product in products
        if product.group == "medicine"
        and product.id in missing_ids
        and product.id not in already_cached
    ]

    web = pipeline.WebClient(
        pipeline.DEFAULT_CACHE,
        args.timeout,
        args.request_delay,
    )
    lock = threading.Lock()
    completed = 0
    found_products = 0

    def discover(product: pipeline.Product) -> tuple[str, list[pipeline.Candidate]]:
        return (
            product.id,
            discover_product_candidates(
                product,
                web,
                args.retry_tier,
                args.max_candidates_per_product,
                args.provider,
            ),
        )

    candidates_by_product: dict[str, list[pipeline.Candidate]] = {}
    try:
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            futures = [executor.submit(discover, product) for product in selected]
            for future in as_completed(futures):
                product_id, candidates = future.result()
                if candidates:
                    candidates_by_product[product_id] = candidates
                with lock:
                    completed += 1
                    found_products += bool(candidates)
                    if completed % 25 == 0 or completed == len(selected):
                        write_candidate_manifest(args.output, candidates_by_product)
                        print(
                            json.dumps(
                                {
                                    "processed": completed,
                                    "selected": len(selected),
                                    "products_with_candidates": found_products,
                                }
                            ),
                            flush=True,
                        )
    finally:
        web.close()

    candidate_images = write_candidate_manifest(args.output, candidates_by_product)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "retry_tier": args.retry_tier,
                "provider": args.provider,
                "selected_products": len(selected),
                "matched_products": len(candidates_by_product),
                "candidate_images": candidate_images,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
