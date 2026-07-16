#!/usr/bin/env python3
"""Merge complete pharmacy contact audit runs under the current safety policy."""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Sequence


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRAPER_PATH = REPO_ROOT / "scripts/scrape_pharmacy_contacts.py"
SPEC = importlib.util.spec_from_file_location("pharmacy_contact_policy", SCRAPER_PATH)
if not SPEC or not SPEC.loader:
    raise RuntimeError(f"Cannot load pharmacy contact policy from {SCRAPER_PATH}")
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


class MergeError(RuntimeError):
    pass


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_complete_audit(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise MergeError(f"Audit file not found: {path}")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [column for column in POLICY.AUDIT_COLUMNS if column not in (reader.fieldnames or [])]
        if missing:
            raise MergeError(f"{path} is missing audit columns: {', '.join(missing)}")
        rows = list(reader)
    if len(rows) != 725:
        raise MergeError(f"{path} must contain 725 rows; found {len(rows)}")
    serials = [int(row["source_serial"]) for row in rows]
    if sorted(serials) != list(range(1, 726)):
        raise MergeError(f"{path} does not contain each source serial from 1 through 725 exactly once")
    return rows


def source_identity(row: dict[str, str]) -> tuple[str, ...]:
    return tuple(row.get(column, "") for column in POLICY.SOURCE_COLUMNS)


def merge_audits(audits: Sequence[list[dict[str, str]]]) -> list[dict[str, Any]]:
    if len(audits) < 2:
        raise MergeError("At least two complete audit runs are required")
    indexed = [{int(row["source_serial"]): row for row in audit} for audit in audits]
    output: list[dict[str, Any]] = []
    for serial in range(1, 726):
        observations = [audit[serial] for audit in indexed]
        if len({source_identity(row) for row in observations}) != 1:
            raise MergeError(f"Source registry fields disagree for serial {serial}")
        merged: dict[str, Any] | None = None
        for observation in observations:
            merged = POLICY.sanitize_observation(
                POLICY.merge_observations(merged, observation)
            )
        output.append(merged or observations[0])
    return output


def summarize(rows: Sequence[dict[str, Any]], inputs: Sequence[Path], output: Path) -> dict[str, Any]:
    statuses: dict[str, int] = {}
    for row in rows:
        status = str(row.get("match_status") or "pending")
        statuses[status] = statuses.get(status, 0) + 1
    return {
        "schema_version": "1",
        "source_row_count": len(rows),
        "input_count": len(inputs),
        "input_sha256": {path.name: file_sha256(path) for path in inputs},
        "output": str(output),
        "output_sha256": file_sha256(output),
        "status_counts": dict(sorted(statuses.items())),
        "rows_with_public_phone_evidence": sum(
            bool(POLICY.extract_rwanda_phones(row.get("public_phone_numbers"))) for row in rows
        ),
        "rows_with_identity_valid_maps_phone": sum(
            bool(POLICY.extract_rwanda_phones(row.get("google_maps_phone_numbers"))) for row in rows
        ),
        "rows_with_resolved_identity_valid_maps_place": sum(
            "/maps/place/" in POLICY.clean_maps_url(row.get("google_maps_url")) for row in rows
        ),
        "rows_requiring_review_or_unmatched": sum(
            str(row.get("match_status") or "").startswith(("needs_review", "unmatched"))
            for row in rows
        ),
        "production_contacts_promoted": 0,
        "whatsapp_identities_created": 0,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Merge two or more complete pharmacy audits and reapply current identity safeguards"
    )
    parser.add_argument("--input", action="append", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--summary-output", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        rows = merge_audits([read_complete_audit(path) for path in args.input])
        POLICY.atomic_write_csv(args.output, rows, POLICY.AUDIT_COLUMNS)
        summary = summarize(rows, args.input, args.output)
        if args.summary_output:
            args.summary_output.parent.mkdir(parents=True, exist_ok=True)
            args.summary_output.write_text(
                json.dumps(summary, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    except (MergeError, OSError, csv.Error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
