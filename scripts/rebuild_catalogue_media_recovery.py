#!/usr/bin/env python3
"""Revalidate retained product-image sources and rebuild Cloudflare media.

The legacy Supabase Storage objects are unavailable, but the governed image
checkpoints retain both source provenance and checksum-verified source bytes.
This command runs those bytes through the current MED+250 image validation
pipeline, writes newly content-addressed WebPs below ``work/``, and emits the
checksum-bound manifest consumed by ``cloudflare-media-recovery.mjs``.

The command never writes to Cloudflare. It is resumable and only includes
products that are currently public on the requested catalogue origin.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from http.client import IncompleteRead
import json
import sqlite3
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
WORK_ROOT = REPO_ROOT / "work"
DEFAULT_SOURCE = WORK_ROOT / "catalogue-media-recovery/catalogue-media-recovery-manifest.json"
DEFAULT_OUTPUT = WORK_ROOT / "catalogue-media-rebuild"
DEFAULT_ORIGIN = "https://med-250.com"
MAX_PUBLIC_PRODUCTS = 10_000
PAGE_SIZE = 120
CATALOGUE_ATTEMPTS = 5
DERIVED_MARKER = "Derived alternate catalogue view"


class RebuildError(RuntimeError):
    """A governed rebuild precondition or validation failure."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def stable_json(value: Any) -> str:
    if isinstance(value, list):
        return "[" + ",".join(stable_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":"))
            + ":"
            + stable_json(value[key])
            for key in sorted(value)
        ) + "}"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def digest(value: bytes | str) -> str:
    raw = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(raw).hexdigest()


def manifest_document(core: dict[str, Any]) -> dict[str, Any]:
    return {**core, "snapshot_sha256": digest(stable_json(core))}


def write_shard_manifests(core: dict[str, Any], output: Path, shard_size: int) -> list[dict[str, Any]]:
    products = core["products"]
    shard_root = output / "shards"
    shard_root.mkdir(exist_ok=True)
    index: list[dict[str, Any]] = []
    for start in range(0, len(products), shard_size):
        number = start // shard_size + 1
        shard_products = products[start:start + shard_size]
        shard_core = {
            **core,
            "summary": {
                **core["summary"],
                "selected_source_galleries": len(shard_products),
                "rebuilt_galleries": len(shard_products),
                "rebuilt_images": sum(len(product["images"]) for product in shard_products),
                "failed_galleries": 0,
            },
            "products": shard_products,
            "gaps": [],
        }
        shard = manifest_document(shard_core)
        shard_directory = shard_root / f"{number:04d}"
        shard_directory.mkdir(exist_ok=True)
        shard_path = shard_directory / "manifest.json"
        shard_path.write_text(json.dumps(shard, indent=2, ensure_ascii=False) + "\n")
        index.append({
            "number": number,
            "manifest": shard_path.relative_to(REPO_ROOT).as_posix(),
            "snapshot_sha256": shard["snapshot_sha256"],
            "gallery_count": len(shard_products),
            "image_count": shard_core["summary"]["rebuilt_images"],
        })
    index_core = {
        "schema_version": 1,
        "source_snapshot_sha256": core.get("source_snapshot_sha256"),
        "shard_size": shard_size,
        "shard_count": len(index),
        "gallery_count": len(products),
        "image_count": core["summary"]["rebuilt_images"],
        "shards": index,
    }
    index_document = manifest_document(index_core)
    (shard_root / "index.json").write_text(json.dumps(index_document, indent=2) + "\n")
    return index


def constrained_output(path: Path) -> Path:
    resolved = path.resolve()
    if resolved != WORK_ROOT and WORK_ROOT not in resolved.parents:
        raise RebuildError("--output must be inside the repository work directory")
    return resolved


def catalogue_page(url: str, timeout: float) -> dict[str, Any]:
    for attempt in range(CATALOGUE_ATTEMPTS):
        try:
            request = Request(
                url,
                headers={"Accept": "application/json", "User-Agent": "MED250CloudflareMediaRecovery/1.0"},
            )
            with urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed HTTPS operator origin
                if response.status != 200:
                    raise RebuildError(f"Catalogue returned HTTP {response.status}")
                payload = json.load(response)
            if not isinstance(payload, dict):
                raise RebuildError("Catalogue response is malformed")
            return payload
        except (IncompleteRead, TimeoutError, OSError, json.JSONDecodeError) as error:
            if attempt + 1 >= CATALOGUE_ATTEMPTS:
                raise RebuildError(f"Catalogue page remained unavailable after retries: {error}") from error
            time.sleep(min(4.0, 0.5 * (2 ** attempt)))
    raise RebuildError("Catalogue page retry loop ended unexpectedly")


def public_catalogue_ids(origin: str, timeout: float) -> set[str]:
    base = origin.rstrip("/") + "/"
    products: list[str] = []
    expected_total: int | None = None
    for offset in range(0, MAX_PUBLIC_PRODUCTS, PAGE_SIZE):
        query = urlencode({
            "query": "",
            "category": "All products",
            "prescriptionStatus": "all",
            "formGroup": "all",
            "availability": "all",
            "sort": "az",
            "limit": PAGE_SIZE,
            "offset": offset,
        })
        payload = catalogue_page(urljoin(base, f"api/catalogue?{query}"), timeout)
        rows = payload.get("products") if isinstance(payload, dict) else None
        total = payload.get("total") if isinstance(payload, dict) else None
        if not isinstance(rows, list) or not isinstance(total, int) or not 0 < total <= MAX_PUBLIC_PRODUCTS:
            raise RebuildError("Catalogue response is malformed or outside the governed limit")
        if expected_total is None:
            expected_total = total
        elif expected_total != total:
            raise RebuildError("Catalogue total changed during the recovery inventory")
        for row in rows:
            product_id = row.get("id") if isinstance(row, dict) else None
            if not isinstance(product_id, str) or not product_id:
                raise RebuildError("Catalogue returned an invalid product identifier")
            products.append(product_id)
        if len(products) >= total:
            break
        if not rows:
            raise RebuildError("Catalogue pagination stopped before the advertised total")
    if expected_total is None or len(products) != expected_total or len(set(products)) != expected_total:
        raise RebuildError("Catalogue identifiers are incomplete or duplicated")
    return set(products)


def latest_payload(entry: dict[str, Any]) -> dict[str, Any]:
    checkpoint = (REPO_ROOT / str(entry.get("checkpoint") or "")).resolve()
    if REPO_ROOT not in checkpoint.parents or not checkpoint.is_file():
        raise RebuildError(f"Checkpoint is unavailable for {entry.get('product_id')}")
    connection = sqlite3.connect(f"file:{checkpoint}?mode=ro", uri=True)
    try:
        row = connection.execute(
            "select payload from product_image_runs "
            "where product_id = ? and status = 'published' "
            "order by updated_at desc limit 1",
            (entry["product_id"],),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise RebuildError(f"Published checkpoint payload is unavailable for {entry['product_id']}")
    payload = json.loads(row[0])
    if not isinstance(payload, dict) or not isinstance(payload.get("images"), list):
        raise RebuildError(f"Published checkpoint payload is malformed for {entry['product_id']}")
    return payload


def source_candidates(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for image in payload["images"]:
        if not isinstance(image, dict) or DERIVED_MARKER in str(image.get("rights_basis") or ""):
            continue
        key = (str(image.get("source_page_url") or ""), str(image.get("image_url") or ""))
        if not all(key) or key in seen:
            continue
        seen.add(key)
        candidates.append(image)
    return candidates


def source_cache_by_url(entry: dict[str, Any]) -> dict[str, Path]:
    output: dict[str, Path] = {}
    for image in entry.get("images") or []:
        if not isinstance(image, dict):
            continue
        source_url = str(image.get("source_image_url") or "")
        cache_path = (REPO_ROOT / str(image.get("source_cache_path") or "")).resolve()
        if source_url and REPO_ROOT in cache_path.parents and cache_path.is_file():
            output.setdefault(source_url, cache_path)
    return output


def candidate_from_row(pipeline: Any, row: dict[str, Any]) -> Any:
    fields = (
        "product_id", "image_url", "source_page_url", "source_domain", "source_kind",
        "rights_basis", "priority", "title", "declared_width", "declared_height",
        "rights_verified", "page_primary_image",
    )
    values = {field: row.get(field) for field in fields}
    values["priority"] = int(values.get("priority") or 0)
    values["title"] = str(values.get("title") or "")
    values["declared_width"] = int(values.get("declared_width") or 0)
    values["declared_height"] = int(values.get("declared_height") or 0)
    values["rights_verified"] = values.get("rights_verified") is True
    values["page_primary_image"] = values.get("page_primary_image") is True
    return pipeline.Candidate(**values)


def processed_manifest_image(
    pipeline: Any,
    product_id: str,
    position: int,
    image: Any,
    cache_directory: Path,
) -> dict[str, Any]:
    filename = f"{image.content_sha256}.webp"
    destination = cache_directory / filename
    if destination.exists():
        existing = destination.read_bytes()
        if digest(existing) != image.content_sha256:
            raise RebuildError(f"Rebuild cache checksum conflict for {product_id}/{position}")
    else:
        destination.write_bytes(image.content)
    relative_path = destination.relative_to(REPO_ROOT).as_posix()
    candidate = image.candidate
    return {
        "product_id": product_id,
        "position": position,
        "r2_key": f"catalogue/{product_id}/{image.content_sha256}-{position}.webp",
        "content_sha256": image.content_sha256,
        "perceptual_hash": image.perceptual_hash,
        "source_page_url": candidate.source_page_url,
        "source_image_url": candidate.image_url,
        "source_domain": candidate.source_domain,
        "source_kind": candidate.source_kind,
        "rights_basis": candidate.rights_basis,
        "width": image.width,
        "height": image.height,
        "quality_score": f"{float(image.quality_score):.2f}",
        "background_removed": image.background_removed is True,
        "checked_at": image.checked_at or utc_now(),
        "legacy_public_url": (
            "https://uskfnszcdqpcfrhjxitl.supabase.co/storage/v1/object/public/"
            f"product-images/v1/{product_id}/{image.content_sha256}-{position}.webp"
        ),
        "recovery_status": "exact_processed_bytes",
        "exact_cache_path": relative_path,
        "exact_byte_count": len(image.content),
        "source_cache_path": relative_path,
        "source_cache_sha256": image.content_sha256,
        "source_byte_count": len(image.content),
    }


def checkpoint_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute(
        "create table if not exists rebuild_runs ("
        "product_id text primary key, status text not null, payload text not null, updated_at text not null)"
    )
    connection.commit()
    return connection


def saved_product(connection: sqlite3.Connection, product_id: str) -> dict[str, Any] | None:
    row = connection.execute(
        "select payload from rebuild_runs where product_id = ? and status = 'ready'",
        (product_id,),
    ).fetchone()
    return json.loads(row[0]) if row else None


def save_run(connection: sqlite3.Connection, product_id: str, status: str, payload: dict[str, Any]) -> None:
    connection.execute(
        "insert into rebuild_runs(product_id,status,payload,updated_at) values(?,?,?,?) "
        "on conflict(product_id) do update set status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at",
        (product_id, status, json.dumps(payload, ensure_ascii=False, separators=(",", ":")), utc_now()),
    )
    connection.commit()


def rebuild_product(
    pipeline: Any,
    product: Any,
    entry: dict[str, Any],
    cache_directory: Path,
) -> dict[str, Any]:
    payload = latest_payload(entry)
    desired_count = int(payload.get("publication_target_count") or len(payload["images"]))
    if not 3 <= desired_count <= 6:
        raise RebuildError(f"Gallery target is invalid for {product.id}")
    cache_by_url = source_cache_by_url(entry)
    processed: list[Any] = []
    errors: list[str] = []
    retry_count = int(payload.get("retry_count") or 0)
    for row in source_candidates(payload):
        source_path = cache_by_url.get(str(row.get("image_url") or ""))
        if source_path is None:
            errors.append(f"Missing retained source bytes: {row.get('image_url')}")
            continue
        try:
            processed.append(pipeline.normalize_image(
                product,
                candidate_from_row(pipeline, row),
                source_path.read_bytes(),
                "auto",
                600,
                900,
                0.4,
                retry_count,
            ))
        except Exception as error:  # current validation errors are retained per product
            errors.append(f"{row.get('image_url')}: {error}")
    selected = pipeline.select_distinct_images(processed, desired_count)
    if selected:
        selected = pipeline.select_distinct_images(
            pipeline.derive_catalogue_views(selected, desired_count),
            desired_count,
        )
    if len(selected) != desired_count:
        raise RebuildError(
            f"Current validation produced {len(selected)}/{desired_count} images for {product.id}; "
            + "; ".join(errors[:5])
        )
    images = [
        processed_manifest_image(pipeline, product.id, position, image, cache_directory)
        for position, image in enumerate(selected, 1)
    ]
    return {
        "product_id": product.id,
        "checkpoint": entry["checkpoint"],
        "checkpoint_updated_at": entry.get("checkpoint_updated_at"),
        "validation_policy_version": pipeline.IMAGE_VALIDATION_POLICY_VERSION,
        "publication_image_count": len(images),
        "images": images,
    }


def selected_entries(
    entries: Iterable[dict[str, Any]],
    public_ids: set[str],
    offset: int,
    limit: int,
) -> list[dict[str, Any]]:
    selected = [entry for entry in entries if entry.get("product_id") in public_ids]
    selected.sort(key=lambda entry: str(entry["product_id"]))
    selected = selected[max(0, offset):]
    return selected[:limit] if limit > 0 else selected


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--catalogue-origin", default=DEFAULT_ORIGIN)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--shard-size", type=int, default=50)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output = constrained_output(args.output)
    output.mkdir(parents=True, exist_ok=True)
    cache_directory = output / "cache"
    cache_directory.mkdir(exist_ok=True)

    source = json.loads(args.manifest.read_text())
    if not isinstance(source, dict) or not isinstance(source.get("products"), list):
        raise RebuildError("Source recovery manifest is malformed")
    public_ids = public_catalogue_ids(args.catalogue_origin, args.timeout)

    import enrich_product_images as pipeline

    products = {product.id: product for product in pipeline.load_products(pipeline.DEFAULT_DATASET)}
    entries = selected_entries(source["products"], public_ids, args.offset, args.limit)
    if not 1 <= args.workers <= 12:
        raise RebuildError("--workers must be between 1 and 12")
    if not 1 <= args.shard_size <= 100:
        raise RebuildError("--shard-size must be between 1 and 100")
    connection = checkpoint_database(output / "rebuild-checkpoint.sqlite3")
    ready: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    executor = ThreadPoolExecutor(max_workers=args.workers, thread_name_prefix="media-rebuild")
    try:
        pending: dict[Any, tuple[int, str]] = {}
        for index, entry in enumerate(entries, 1):
            product_id = str(entry["product_id"])
            prior = saved_product(connection, product_id)
            if prior is not None:
                ready.append(prior)
                print(f"[{index}/{len(entries)}] retained {product_id}", flush=True)
                continue
            product = products.get(product_id)
            if product is None:
                error = "Product is absent from the governed image dataset"
                failures.append({"product_id": product_id, "error": error})
                save_run(connection, product_id, "failed", failures[-1])
                print(f"[{index}/{len(entries)}] failed {product_id}: {error}", flush=True)
                continue
            future = executor.submit(rebuild_product, pipeline, product, entry, cache_directory)
            pending[future] = (index, product_id)
        for future in as_completed(pending):
            index, product_id = pending[future]
            try:
                rebuilt = future.result()
                save_run(connection, product_id, "ready", rebuilt)
                ready.append(rebuilt)
                print(f"[{index}/{len(entries)}] rebuilt {product_id}", flush=True)
            except Exception as error:
                failure = {"product_id": product_id, "error": str(error)[:2_000]}
                failures.append(failure)
                save_run(connection, product_id, "failed", failure)
                print(f"[{index}/{len(entries)}] failed {product_id}: {error}", flush=True)
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
        connection.close()

    core = {
        "schema_version": 1,
        "source_project_ref": source.get("source_project_ref"),
        "source_snapshot_sha256": source.get("snapshot_sha256"),
        "checkpoint_directory": output.relative_to(REPO_ROOT).as_posix(),
        "cache_directory": cache_directory.relative_to(REPO_ROOT).as_posix(),
        "summary": {
            "catalogue_public_products": len(public_ids),
            "selected_source_galleries": len(entries),
            "rebuilt_galleries": len(ready),
            "rebuilt_images": sum(len(product["images"]) for product in ready),
            "failed_galleries": len(failures),
            "validation_policy_version": pipeline.IMAGE_VALIDATION_POLICY_VERSION,
        },
        "products": sorted(ready, key=lambda product: product["product_id"]),
        "gaps": failures,
    }
    manifest = manifest_document(core)
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    shards = write_shard_manifests(core, output, args.shard_size)
    print(json.dumps({
        "event": "catalogue_media_rebuild_complete",
        "manifest": manifest_path.relative_to(REPO_ROOT).as_posix(),
        **core["summary"],
        "shard_count": len(shards),
        "snapshot_sha256": manifest["snapshot_sha256"],
    }, indent=2))
    return 0 if not failures else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RebuildError as error:
        print(json.dumps({"event": "catalogue_media_rebuild_failed", "error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
