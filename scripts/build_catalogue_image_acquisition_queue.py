#!/usr/bin/env python3
"""Build the live, evidence-ready MED+250 product-image acquisition queue."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = (
    REPO_ROOT
    / "outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/"
    "corrected-catalog-dataset-2026-07-15.json"
)
DEFAULT_OUTPUT = REPO_ROOT / "work/catalogue-media-acquisition/queue"
DEFAULT_ORIGIN = "https://med-250.com"
PAGE_SIZE = 120


class QueueError(RuntimeError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def public_products(origin: str, timeout: float) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    expected: int | None = None
    for offset in range(0, 10_000, PAGE_SIZE):
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
        request = Request(
            f"{origin.rstrip('/')}/api/catalogue?{query}",
            headers={"Accept": "application/json", "User-Agent": "MED250ImageAcquisitionQueue/1.0"},
        )
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - operator-selected HTTPS origin
            payload = json.load(response)
        page = payload.get("products") if isinstance(payload, dict) else None
        total = payload.get("total") if isinstance(payload, dict) else None
        if not isinstance(page, list) or not isinstance(total, int):
            raise QueueError("Catalogue response is malformed")
        if expected is None:
            expected = total
        elif expected != total:
            raise QueueError("Catalogue total changed during queue construction")
        rows.extend(item for item in page if isinstance(item, dict))
        if len(rows) >= total:
            break
    if expected is None or len(rows) != expected:
        raise QueueError(f"Catalogue pagination returned {len(rows)}/{expected or 0} products")
    if len({str(row.get('id') or '') for row in rows}) != len(rows):
        raise QueueError("Catalogue returned duplicate product identifiers")
    return rows


def canonical_rows(dataset: Path) -> dict[str, dict[str, Any]]:
    payload = json.loads(dataset.read_text(encoding="utf-8"))
    rows = [
        *(payload.get("consumer_products") or []),
        *(payload.get("fda_medicines") or []),
    ]
    return {
        str(row["id"]): row
        for row in rows
        if isinstance(row, dict) and row.get("id")
    }


def missing_gallery(row: dict[str, Any]) -> bool:
    urls = row.get("image_urls")
    return not row.get("image_url") and (not isinstance(urls, list) or not urls)


def queue_row(public: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    product_id = str(public.get("id") or "")
    group = "consumer" if product_id.startswith("AMZ-") else "medicine"
    preferred_route = "partner_website" if group == "consumer" else "official_manufacturer"
    if group == "medicine" and source.get("local_technical_representative"):
        preferred_route += "_then_representative"
    return {
        "product_id": product_id,
        "group": group,
        "preferred_route": preferred_route,
        "product_name": source.get("product_name") or source.get("brand_name") or public.get("brand_name"),
        "brand_name": source.get("brand_name") or public.get("brand_name"),
        "generic_name": source.get("generic_name") or public.get("generic_name"),
        "strength": source.get("strength") or public.get("strength"),
        "dosage_form": source.get("dosage_form") or public.get("dosage_form"),
        "pack_size": source.get("pack_size") or public.get("pack_size"),
        "registration_number": source.get("registration_number"),
        "asin": source.get("asin"),
        "manufacturer": source.get("manufacturer") or public.get("manufacturer"),
        "manufacturer_country": source.get("manufacturer_country"),
        "marketing_authorization_holder": source.get("marketing_authorization_holder"),
        "local_technical_representative": source.get("local_technical_representative"),
        "source_url": source.get("amazon_product_url") or source.get("source_url"),
        "is_orderable": public.get("is_orderable") is True,
        "shot_requirements": "front;back;side-or-detail;white-background;label-legible;no-promotional-overlay",
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    columns = list(rows[0]) if rows else ["product_id"]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def write_group_batches(
    path: Path,
    groups: dict[str, list[str]],
    queue_by_id: dict[str, dict[str, Any]],
    group_field: str,
) -> None:
    rows = []
    for name, ids in sorted(groups.items(), key=lambda item: (-len(item[1]), item[0])):
        rows.append({
            group_field: name,
            "product_count": len(ids),
            "product_ids": " ".join(ids),
            "registration_numbers": " | ".join(
                str(queue_by_id[product_id].get("registration_number") or "")
                for product_id in ids
            ),
        })
    write_csv(path, rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default=DEFAULT_ORIGIN)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()
    output = args.output.resolve()
    permitted = (REPO_ROOT / "work/catalogue-media-acquisition").resolve()
    if output != permitted and permitted not in output.parents:
        raise QueueError("--output must be inside work/catalogue-media-acquisition")
    output.mkdir(parents=True, exist_ok=True)

    source = canonical_rows(args.dataset)
    live = public_products(args.origin, args.timeout)
    queue = [
        queue_row(row, source.get(str(row.get("id") or ""), {}))
        for row in live
        if missing_gallery(row)
    ]
    queue.sort(key=lambda row: (row["group"], row["product_id"]))
    consumers = [row for row in queue if row["group"] == "consumer"]
    medicines = [row for row in queue if row["group"] == "medicine"]
    representatives: dict[str, list[str]] = {}
    manufacturers: dict[str, list[str]] = {}
    for row in medicines:
        representative = str(row.get("local_technical_representative") or "UNASSIGNED").strip()
        manufacturer = str(row.get("manufacturer") or "UNASSIGNED").strip()
        representatives.setdefault(representative, []).append(row["product_id"])
        manufacturers.setdefault(manufacturer, []).append(row["product_id"])

    write_csv(output / "all-missing-products.csv", queue)
    write_csv(output / "consumer-partner-acquisition.csv", consumers)
    write_csv(output / "medicine-official-source-acquisition.csv", medicines)
    queue_by_id = {row["product_id"]: row for row in queue}
    write_group_batches(
        output / "representative-request-batches.csv",
        representatives,
        queue_by_id,
        "local_technical_representative",
    )
    write_group_batches(
        output / "manufacturer-request-batches.csv",
        manufacturers,
        queue_by_id,
        "manufacturer",
    )
    (output / "consumer-product-ids.txt").write_text("".join(f"{row['product_id']}\n" for row in consumers))
    (output / "medicine-product-ids.txt").write_text("".join(f"{row['product_id']}\n" for row in medicines))
    report = {
        "generated_at": now(),
        "catalogue_origin": args.origin,
        "active_products": len(live),
        "missing_gallery_products": len(queue),
        "consumer_products": len(consumers),
        "medicine_products": len(medicines),
        "orderable_products": sum(row["is_orderable"] for row in queue),
        "non_orderable_products": sum(not row["is_orderable"] for row in queue),
        "representative_groups": len(representatives),
        "manufacturer_groups": len(manufacturers),
        "representatives": [
            {"name": name, "product_count": len(ids), "product_ids": ids}
            for name, ids in sorted(representatives.items(), key=lambda item: (-len(item[1]), item[0]))
        ],
        "manufacturers": [
            {"name": name, "product_count": len(ids), "product_ids": ids}
            for name, ids in sorted(manufacturers.items(), key=lambda item: (-len(item[1]), item[0]))
        ],
    }
    (output / "queue-summary.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key not in {"representatives", "manufacturers"}}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except QueueError as error:
        print(json.dumps({"event": "catalogue_image_queue_failed", "error": str(error)}))
        raise SystemExit(1)
