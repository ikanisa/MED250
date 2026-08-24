#!/usr/bin/env python3
"""Extract exact packshots from official manufacturer PDFs.

Some regional manufacturers publish their real product packs inside PDF
catalogue sheets rather than as standalone web images.  This builder downloads
only operator-reviewed official documents, renders the configured product crop,
stores that immutable source crop in Supabase, and emits a normal candidate
manifest.  The main image pipeline still performs its full OCR, strength, form,
quality, background-removal, and deduplication checks before publication.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import enrich_product_images as pipeline


DEFAULT_CONFIG = (
    pipeline.REPO_ROOT
    / "data/product-images/official-pdf-packshot-sources.json"
)
DEFAULT_OUTPUT = (
    pipeline.REPO_ROOT
    / "data/product-images/official-pdf-packshot-candidates.json"
)
RIGHTS_BASIS = (
    "Exact product pack cropped without textual alteration from an official "
    "manufacturer catalogue PDF; original document and immutable derived crop "
    "retained for traceability; reuse rights not independently verified."
)


@dataclass(frozen=True)
class PdfPackshot:
    product_id: str
    pdf_url: str
    crop: tuple[float, float, float, float]
    title: str
    asset_label: str
    page: int = 1
    priority: int = 126


def load_config(path: Path) -> list[PdfPackshot]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise pipeline.PipelineError("PDF packshot config must be a JSON array")
    output: list[PdfPackshot] = []
    for index, item in enumerate(raw, 1):
        if not isinstance(item, dict):
            raise pipeline.PipelineError(f"PDF packshot item {index} is invalid")
        product_id = pipeline.compact_spaces(item.get("product_id"))
        pdf_url = pipeline.canonical_url(item.get("pdf_url"))
        title = pipeline.compact_spaces(item.get("title"))
        asset_label = pipeline.compact_spaces(item.get("asset_label"))
        crop_value = item.get("crop")
        if (
            not product_id
            or not pdf_url
            or not title
            or not asset_label
            or not isinstance(crop_value, list)
            or len(crop_value) != 4
        ):
            raise pipeline.PipelineError(
                f"PDF packshot item {index} requires product_id, pdf_url, title, "
                "asset_label, and crop"
            )
        try:
            crop = tuple(float(value) for value in crop_value)
        except (TypeError, ValueError) as error:
            raise pipeline.PipelineError(
                f"PDF packshot item {index} has a non-numeric crop"
            ) from error
        left, top, right, bottom = crop
        if not (
            0 <= left < right <= 1
            and 0 <= top < bottom <= 1
            and (right - left) >= 0.12
            and (bottom - top) >= 0.12
        ):
            raise pipeline.PipelineError(
                f"PDF packshot item {index} crop must be normalized page coordinates"
            )
        output.append(
            PdfPackshot(
                product_id=product_id,
                pdf_url=pdf_url,
                crop=crop,  # type: ignore[arg-type]
                title=title,
                asset_label=asset_label,
                page=max(1, int(item.get("page") or 1)),
                priority=max(1, min(200, int(item.get("priority") or 126))),
            )
        )
    return output


def render_pdf_crop(pdf_content: bytes, source: PdfPackshot, dpi: int) -> bytes:
    try:
        from PIL import Image
    except ImportError as error:
        raise pipeline.PipelineError(
            "Install requirements-product-images.txt first"
        ) from error
    with tempfile.TemporaryDirectory(prefix="med250-pdf-packshot-") as directory:
        root = Path(directory)
        pdf_path = root / "source.pdf"
        output_prefix = root / "page"
        pdf_path.write_bytes(pdf_content)
        try:
            subprocess.run(
                [
                    "pdftoppm",
                    "-png",
                    "-singlefile",
                    "-r",
                    str(dpi),
                    "-f",
                    str(source.page),
                    "-l",
                    str(source.page),
                    str(pdf_path),
                    str(output_prefix),
                ],
                check=True,
                capture_output=True,
                timeout=90,
            )
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise pipeline.PipelineError(
                "pdftoppm could not render the official manufacturer PDF"
            ) from error
        page_path = output_prefix.with_suffix(".png")
        with Image.open(page_path) as page:
            page.load()
            left, top, right, bottom = source.crop
            crop = page.crop(
                (
                    round(page.width * left),
                    round(page.height * top),
                    round(page.width * right),
                    round(page.height * bottom),
                )
            ).convert("RGBA")
            if min(crop.size) < 500:
                raise pipeline.PipelineError(
                    f"Rendered packshot crop is too small: {crop.width}x{crop.height}"
                )
            output = io.BytesIO()
            crop.save(output, format="PNG", optimize=True)
            return output.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dataset", type=Path, default=pipeline.DEFAULT_DATASET)
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument(
        "--preview-dir",
        type=Path,
        help="Also write rendered source crops here for visual review.",
    )
    parser.add_argument(
        "--render-only",
        action="store_true",
        help="Render preview crops without uploading or writing a manifest.",
    )
    args = parser.parse_args()
    if not 180 <= args.dpi <= 450:
        raise pipeline.PipelineError("--dpi must be between 180 and 450")

    products = {product.id: product for product in pipeline.load_products(args.dataset)}
    sources = load_config(args.config)
    unknown = sorted({source.product_id for source in sources} - set(products))
    if unknown:
        raise pipeline.PipelineError(
            "Unknown PDF packshot product IDs: " + ", ".join(unknown)
        )

    env = {**pipeline.load_dotenv(pipeline.REPO_ROOT / ".env.local"), **os.environ}
    supabase_url = pipeline.compact_spaces(
        env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    supabase_secret = pipeline.compact_spaces(
        env.get("SUPABASE_SECRET_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    web = pipeline.WebClient(pipeline.DEFAULT_CACHE, args.timeout, 0.15)
    publisher = (
        None
        if args.render_only
        else pipeline.SupabasePublisher(supabase_url, supabase_secret, args.timeout)
    )
    rows: list[dict[str, Any]] = []
    try:
        for source in sources:
            if not web.robots_allowed(source.pdf_url):
                raise pipeline.PipelineError(
                    f"robots.txt does not permit {source.pdf_url}"
                )
            response = web.request(
                "GET",
                source.pdf_url,
                headers={"Accept": "application/pdf"},
                attempts=3,
            )
            pdf_content = bytes(response.content)
            if not pdf_content.startswith(b"%PDF-"):
                raise pipeline.PipelineError(
                    f"Official source did not return a PDF: {source.pdf_url}"
                )
            crop_content = render_pdf_crop(pdf_content, source, args.dpi)
            if args.preview_dir:
                args.preview_dir.mkdir(parents=True, exist_ok=True)
                (args.preview_dir / f"{source.product_id}.png").write_bytes(
                    crop_content
                )
            if args.render_only:
                print(
                    json.dumps(
                        {
                            "product_id": source.product_id,
                            "status": "source_artifact_rendered",
                        }
                    ),
                    flush=True,
                )
                continue
            assert publisher is not None
            crop_url = publisher.upload_source_artifact(
                source.product_id,
                crop_content,
                extension="png",
                content_type="image/png",
                label=source.asset_label,
            )
            rows.append(
                {
                    "product_id": source.product_id,
                    "source_page_url": source.pdf_url,
                    "source_kind": "manufacturer",
                    "rights_basis": RIGHTS_BASIS,
                    "rights_verified": False,
                    "page_primary_image": True,
                    "priority": source.priority,
                    # This is operator-reviewed text visibly present in the
                    # official source, never catalogue fields injected merely
                    # to make a candidate pass identity validation.
                    "title": source.title,
                    "images": [crop_url],
                    "source_document_sha256": hashlib.sha256(pdf_content).hexdigest(),
                    "source_crop_sha256": hashlib.sha256(crop_content).hexdigest(),
                    "source_page_number": source.page,
                    "source_crop": list(source.crop),
                }
            )
            print(
                json.dumps(
                    {
                        "product_id": source.product_id,
                        "status": "source_artifact_uploaded",
                    }
                ),
                flush=True,
            )
    finally:
        if publisher is not None:
            publisher.close()
        web.close()

    if args.render_only:
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(rows, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "candidate_images": len(rows)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except pipeline.PipelineError as error:
        print(json.dumps({"status": "failed", "error": str(error)}, indent=2))
        raise SystemExit(1)
