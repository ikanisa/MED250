#!/usr/bin/env python3
"""Inventory recoverable catalogue media from retained local checkpoints.

The command is read-only unless ``--output`` is supplied. It never contacts
Supabase, Cloudflare, or any other provider. A written manifest is allowed only
below the repository's git-ignored ``work/`` directory because it can be large.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import quote


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHECKPOINT_DIR = REPO_ROOT / "data/product-images"
DEFAULT_CACHE_DIR = DEFAULT_CHECKPOINT_DIR / "cache"
SOURCE_PROJECT_REF = "uskfnszcdqpcfrhjxitl"
LEGACY_MEDIA_ROOT = (
    f"https://{SOURCE_PROJECT_REF}.supabase.co/storage/v1/object/public/"
    "product-images/v1"
)
CHECKPOINT_TABLE = "product_image_runs"
MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024
MAX_PAYLOAD_BYTES = 2 * 1024 * 1024


class RecoveryError(RuntimeError):
    """Safe operator-facing catalogue recovery error."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def cache_path(cache_dir: Path, url: str) -> Path:
    return cache_dir / sha256_bytes(url.encode("utf-8"))


def relative_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError as error:
        raise RecoveryError(f"Recovery evidence is outside the repository: {path}") from error


def valid_image_bytes(content: bytes) -> bool:
    return (
        content.startswith(b"\xff\xd8\xff")
        or content.startswith(b"\x89PNG\r\n\x1a\n")
        or (content.startswith(b"RIFF") and content[8:12] == b"WEBP")
        or (len(content) >= 12 and content[4:8] == b"ftyp")
    )


def read_cached_image(path: Path) -> tuple[str, int] | None:
    if not path.is_file():
        return None
    content = path.read_bytes()
    if not 1_000 <= len(content) <= 12 * 1024 * 1024 or not valid_image_bytes(content):
        return None
    return sha256_bytes(content), len(content)


def checkpoint_rows(checkpoint_dir: Path) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    latest: dict[str, dict[str, Any]] = {}
    counts = {"checkpoint_files": 0, "published_rows": 0, "unreadable_checkpoints": 0}
    for database in sorted(checkpoint_dir.glob("*.sqlite3")):
        if not database.is_file() or database.stat().st_size == 0:
            continue
        if database.stat().st_size > MAX_CHECKPOINT_BYTES:
            counts["unreadable_checkpoints"] += 1
            continue
        connection: sqlite3.Connection | None = None
        try:
            connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
            connection.row_factory = sqlite3.Row
            present = connection.execute(
                "select 1 from sqlite_master where type = 'table' and name = ?",
                (CHECKPOINT_TABLE,),
            ).fetchone()
            if not present:
                continue
            counts["checkpoint_files"] += 1
            rows = connection.execute(
                "select product_id, updated_at, payload "
                "from product_image_runs where status = 'published'"
            )
            for row in rows:
                counts["published_rows"] += 1
                product_id = str(row["product_id"] or "").strip()
                updated_at = str(row["updated_at"] or "").strip()
                payload = str(row["payload"] or "")
                if (
                    not product_id
                    or len(product_id) > 80
                    or len(payload.encode("utf-8")) > MAX_PAYLOAD_BYTES
                ):
                    continue
                prior = latest.get(product_id)
                if prior is None or updated_at > prior["updated_at"]:
                    latest[product_id] = {
                        "product_id": product_id,
                        "updated_at": updated_at,
                        "payload": payload,
                        "checkpoint": relative_path(database),
                    }
        except (OSError, sqlite3.Error):
            counts["unreadable_checkpoints"] += 1
        finally:
            if connection is not None:
                connection.close()
    return latest, counts


def image_record(
    product_id: str,
    position: int,
    row: dict[str, Any],
    updated_at: str,
    cache_dir: Path,
) -> dict[str, Any]:
    content_sha256 = str(row.get("content_sha256") or "").strip().lower()
    source_image_url = str(row.get("image_url") or "").strip()
    source_page_url = str(row.get("source_page_url") or "").strip()
    if (
        len(content_sha256) != 64
        or any(character not in "0123456789abcdef" for character in content_sha256)
        or not source_image_url.startswith("https://")
        or not source_page_url.startswith("https://")
    ):
        raise RecoveryError(f"Incomplete image evidence for {product_id} position {position}")

    legacy_url = (
        f"{LEGACY_MEDIA_ROOT}/{quote(product_id, safe='-_')}/"
        f"{content_sha256}-{position}.webp"
    )
    processed_cache = cache_path(cache_dir, legacy_url)
    processed_evidence = read_cached_image(processed_cache)
    exact_processed = bool(
        processed_evidence and processed_evidence[0] == content_sha256
    )
    source_cache = cache_path(cache_dir, source_image_url)
    source_evidence = read_cached_image(source_cache)
    if source_evidence is None:
        raise RecoveryError(f"Source image bytes are missing for {product_id} position {position}")

    return {
        "product_id": product_id,
        "position": position,
        "r2_key": f"catalogue/{product_id}/{content_sha256}-{position}.webp",
        "content_sha256": content_sha256,
        "perceptual_hash": str(row.get("perceptual_hash") or "").strip().lower() or None,
        "source_page_url": source_page_url,
        "source_image_url": source_image_url,
        "source_domain": str(row.get("source_domain") or "").strip().lower() or None,
        "source_kind": str(row.get("source_kind") or "").strip() or None,
        "rights_basis": str(row.get("rights_basis") or "").strip() or None,
        "width": 1400,
        "height": 1400,
        "quality_score": f"{float(row.get('quality_score') or 0):.2f}",
        "background_removed": True,
        "checked_at": updated_at,
        "legacy_public_url": legacy_url,
        "recovery_status": "exact_processed_bytes" if exact_processed else "source_rebuild_required",
        "exact_cache_path": relative_path(processed_cache) if exact_processed else None,
        "exact_byte_count": processed_evidence[1] if exact_processed and processed_evidence else None,
        "source_cache_path": relative_path(source_cache),
        "source_cache_sha256": source_evidence[0],
        "source_byte_count": source_evidence[1],
    }


def build_manifest(checkpoint_dir: Path, cache_dir: Path) -> dict[str, Any]:
    latest, checkpoint_counts = checkpoint_rows(checkpoint_dir)
    products: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    summary = {
        **checkpoint_counts,
        "latest_product_publications": len(latest),
        "complete_galleries": 0,
        "complete_gallery_images": 0,
        "exact_processed_cache_images": 0,
        "exact_processed_complete_galleries": 0,
        "source_cache_complete_galleries": 0,
        "generated_or_incomplete_metadata_galleries": 0,
        "invalid_gallery_evidence": 0,
    }

    for product_id in sorted(latest):
        entry = latest[product_id]
        try:
            payload = json.loads(entry["payload"])
        except json.JSONDecodeError:
            gaps.append({"product_id": product_id, "reason": "invalid_checkpoint_json"})
            summary["invalid_gallery_evidence"] += 1
            continue
        images = payload.get("images") if isinstance(payload, dict) else None
        if not isinstance(images, list) or not 3 <= len(images) <= 6:
            reason = (
                "generated_gallery_requires_deterministic_rebuild"
                if isinstance(payload, dict)
                and str(payload.get("source_url") or "").startswith("https://")
                else "missing_complete_image_metadata"
            )
            gaps.append({
                "product_id": product_id,
                "reason": reason,
                "checkpoint": entry["checkpoint"],
                "updated_at": entry["updated_at"],
                "reported_image_count": payload.get("image_count") if isinstance(payload, dict) else None,
            })
            summary["generated_or_incomplete_metadata_galleries"] += 1
            continue
        try:
            recovered = [
                image_record(
                    product_id,
                    position,
                    row,
                    entry["updated_at"],
                    cache_dir,
                )
                for position, row in enumerate(images, 1)
                if isinstance(row, dict)
            ]
            if len(recovered) != len(images):
                raise RecoveryError(f"Non-object image evidence for {product_id}")
        except (RecoveryError, OSError, ValueError) as error:
            gaps.append({
                "product_id": product_id,
                "reason": "invalid_or_missing_gallery_evidence",
                "detail": str(error)[:240],
                "checkpoint": entry["checkpoint"],
            })
            summary["invalid_gallery_evidence"] += 1
            continue
        exact_count = sum(
            image["recovery_status"] == "exact_processed_bytes" for image in recovered
        )
        summary["complete_galleries"] += 1
        summary["complete_gallery_images"] += len(recovered)
        summary["exact_processed_cache_images"] += exact_count
        summary["source_cache_complete_galleries"] += 1
        if exact_count == len(recovered):
            summary["exact_processed_complete_galleries"] += 1
        products.append({
            "product_id": product_id,
            "checkpoint": entry["checkpoint"],
            "checkpoint_updated_at": entry["updated_at"],
            "validation_policy_version": payload.get("validation_policy_version"),
            "publication_image_count": len(recovered),
            "images": recovered,
        })

    core = {
        "schema_version": 1,
        "source_project_ref": SOURCE_PROJECT_REF,
        "checkpoint_directory": relative_path(checkpoint_dir),
        "cache_directory": relative_path(cache_dir),
        "summary": summary,
        "products": products,
        "gaps": gaps,
    }
    snapshot_sha256 = sha256_bytes(
        json.dumps(
            core,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
    )
    return {**core, "snapshot_sha256": snapshot_sha256}


def approved_output(path: Path) -> Path:
    output = path.resolve()
    work_root = (REPO_ROOT / "work").resolve()
    try:
        output.relative_to(work_root)
    except ValueError as error:
        raise RecoveryError("--output must be inside the repository's git-ignored work/ directory") from error
    if output.suffix.lower() != ".json":
        raise RecoveryError("--output must be a JSON file")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint-dir", type=Path, default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    checkpoint_dir = args.checkpoint_dir.resolve()
    cache_dir = args.cache_dir.resolve()
    if not checkpoint_dir.is_dir() or not cache_dir.is_dir():
        raise RecoveryError("Checkpoint and cache directories must exist")
    manifest = build_manifest(checkpoint_dir, cache_dir)
    if args.output:
        output = approved_output(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "event": "catalogue_media_recovery_inventory",
        "output_written": bool(args.output),
        "snapshot_sha256": manifest["snapshot_sha256"],
        **manifest["summary"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RecoveryError as error:
        raise SystemExit(str(error)) from error
