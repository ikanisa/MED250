#!/usr/bin/env python3
"""Publish clearly-labelled generated galleries for residual medicines.

This is the bounded last-resort path for registered medicines that still have
no validated packshot after official-source discovery.  It renders catalogue
fields onto one reviewed, unbranded carton template, stores the immutable
generated source artifact, derives the catalogue's distinct final views, and
publishes them atomically.  Every database row identifies the image as a
generated illustration rather than manufacturer packaging.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import textwrap
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable

import enrich_product_images as pipeline


DEFAULT_TEMPLATE = (
    pipeline.REPO_ROOT
    / "assets/product-images/generated-fallback/medicine-carton-template-v1.png"
)
DEFAULT_CHECKPOINT = (
    pipeline.REPO_ROOT
    / "data/product-images/checkpoint-generated-medicine-fallback.sqlite3"
)
DEFAULT_REPORT = (
    pipeline.REPO_ROOT
    / "data/product-images/report-generated-medicine-fallback.json"
)
BOLD_FONT = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
REGULAR_FONT = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
RIGHTS_BASIS = (
    "Deterministically generated MED+250 illustrative catalogue image from "
    "registered product fields; not manufacturer packaging and not suitable "
    "for visual medicine identification. The reviewed template, exact fields, "
    "and immutable generated source artifact are retained for traceability."
)
SOURCE_KIND = "generated_catalogue"
CANVAS_SIZE = 1400


def meaningful_lines(values: Iterable[str]) -> list[str]:
    return [
        pipeline.compact_spaces(value)
        for value in values
        if pipeline.meaningful(value)
    ]


def bounded_label(value: str, limit: int) -> str:
    value = pipeline.compact_spaces(value)
    if len(value) <= limit:
        return value
    prefix = value[: max(1, limit - 1)].rsplit(" ", 1)[0].rstrip(" ,;/")
    return (prefix or value[: max(1, limit - 1)]) + "…"


def fit_wrapped_text(
    draw: Any,
    text: str,
    box: tuple[int, int, int, int],
    *,
    font_path: Path,
    maximum_size: int,
    minimum_size: int,
    fill: tuple[int, int, int, int],
    spacing: int = 8,
) -> int:
    from PIL import ImageFont

    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    for size in range(maximum_size, minimum_size - 1, -2):
        font = ImageFont.truetype(str(font_path), size)
        approximate_chars = max(8, round(width / max(1, size * 0.56)))
        lines = textwrap.wrap(
            pipeline.compact_spaces(text),
            width=approximate_chars,
            break_long_words=True,
            break_on_hyphens=True,
        ) or [""]
        rendered = "\n".join(lines)
        bounds = draw.multiline_textbbox(
            (left, top), rendered, font=font, spacing=spacing
        )
        if bounds[2] - bounds[0] <= width and bounds[3] - bounds[1] <= height:
            draw.multiline_text(
                (left, top),
                rendered,
                font=font,
                fill=fill,
                spacing=spacing,
                align="left",
            )
            return bounds[3]
    raise pipeline.PipelineError(f"Generated label text does not fit: {text[:80]}")


def render_generated_source(product: pipeline.Product, template_path: Path) -> bytes:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        raise pipeline.PipelineError(
            "Install requirements-product-images.txt first"
        ) from error
    if not template_path.is_file():
        raise pipeline.PipelineError(f"Generated fallback template is missing: {template_path}")
    with Image.open(template_path) as source:
        template = source.convert("RGBA")
    if template.getchannel("A").getbbox() is None:
        raise pipeline.PipelineError("Generated fallback template has no visible object")
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (255, 255, 255, 0))
    template.thumbnail((CANVAS_SIZE, CANVAS_SIZE), Image.Resampling.LANCZOS)
    canvas.alpha_composite(
        template,
        ((CANVAS_SIZE - template.width) // 2, (CANVAS_SIZE - template.height) // 2),
    )
    draw = ImageDraw.Draw(canvas, "RGBA")
    digest = hashlib.sha256(product.id.encode("utf-8")).digest()
    accent = (42 + digest[0] % 90, 82 + digest[1] % 90, 135 + digest[2] % 80, 255)
    # The reviewed template's front panel occupies this conservative rectangle.
    draw.rounded_rectangle((475, 250, 1015, 1135), radius=18, fill=(255, 255, 255, 238))
    draw.rounded_rectangle((475, 250, 1015, 330), radius=18, fill=accent)
    draw.rectangle((475, 300, 1015, 330), fill=accent)
    draw.text(
        (505, 271),
        "MED+250 CATALOGUE",
        font=ImageFont.truetype(str(BOLD_FONT), 25),
        fill=(255, 255, 255, 255),
    )
    y = fit_wrapped_text(
        draw,
        bounded_label(product.name, 140),
        (505, 355, 985, 570),
        font_path=BOLD_FONT,
        maximum_size=60,
        minimum_size=8,
        fill=(22, 38, 62, 255),
        spacing=8,
    )
    generic = bounded_label(
        " • ".join(meaningful_lines([product.generic]))
        or ("REGISTERED MEDICINE" if product.group == "medicine" else "CATALOGUE PRODUCT"),
        100,
    )
    y = max(590, y + 18)
    y = fit_wrapped_text(
        draw,
        generic,
        (505, y, 985, 770),
        font_path=REGULAR_FONT,
        maximum_size=34,
        minimum_size=10,
        fill=(44, 57, 73, 255),
        spacing=7,
    )
    details = [
        bounded_label(value, 50)
        for value in meaningful_lines([product.strength, product.form, product.pack_size])
    ]
    if details:
        y = max(795, y + 18)
        fit_wrapped_text(
            draw,
            "\n".join(details),
            (505, y, 985, 935),
            font_path=BOLD_FONT,
            maximum_size=31,
            minimum_size=10,
            fill=(27, 83, 128, 255),
            spacing=8,
        )
    manufacturer = pipeline.compact_spaces(product.manufacturer)
    if manufacturer:
        fit_wrapped_text(
            draw,
            manufacturer,
            (505, 955, 985, 1035),
            font_path=REGULAR_FONT,
            maximum_size=22,
            minimum_size=12,
            fill=(75, 83, 92, 255),
            spacing=4,
        )
    draw.rounded_rectangle((505, 1055, 985, 1115), radius=12, fill=(151, 44, 44, 245))
    draw.text(
        (538, 1072),
        "ILLUSTRATIVE — NOT ACTUAL PACKAGING",
        font=ImageFont.truetype(str(BOLD_FONT), 19),
        fill=(255, 255, 255, 255),
    )
    buffer = io.BytesIO()
    canvas.save(
        buffer,
        format="WEBP",
        lossless=False,
        quality=95,
        method=3,
        exact=True,
    )
    return buffer.getvalue()


def processed_source(
    product: pipeline.Product,
    content: bytes,
    source_url: str,
) -> pipeline.ProcessedImage:
    from PIL import Image
    import imagehash

    with Image.open(io.BytesIO(content)) as image:
        image.load()
        if image.mode != "RGBA" or image.getchannel("A").getbbox() is None:
            raise pipeline.PipelineError("Generated source is not a transparent product image")
        perceptual_hash = str(imagehash.phash(image.convert("RGB"), hash_size=8))
        width, height = image.size
    candidate = pipeline.Candidate(
        product_id=product.id,
        image_url=source_url,
        source_page_url=source_url,
        source_domain=pipeline.source_domain(source_url),
        source_kind=SOURCE_KIND,
        rights_basis=RIGHTS_BASIS,
        priority=1,
        title=(
            f"Illustrative generated catalogue image for {product.name}; "
            "not actual manufacturer packaging"
        ),
        declared_width=width,
        declared_height=height,
        rights_verified=False,
        page_primary_image=True,
    )
    return pipeline.ProcessedImage(
        candidate=candidate,
        content=content,
        width=width,
        height=height,
        quality_score=90.0,
        content_sha256=hashlib.sha256(content).hexdigest(),
        perceptual_hash=perceptual_hash,
        background_removed=True,
        extension="webp",
        checked_at=pipeline.utc_now(),
    )


def publish_one(
    product: pipeline.Product,
    desired_count: int,
    template_path: Path,
    supabase_url: str,
    supabase_secret: str,
    timeout: float,
) -> dict[str, Any]:
    publisher = pipeline.SupabasePublisher(supabase_url, supabase_secret, timeout)
    try:
        content = render_generated_source(product, template_path)
        source_url = publisher.upload_source_artifact(
            product.id,
            content,
            extension="webp",
            content_type="image/webp",
            label="illustrative-generated-product-v1",
        )
        source = processed_source(product, content, source_url)
        images = pipeline.select_distinct_images(
            pipeline.derive_catalogue_views([source], desired_count),
            desired_count,
        )
        if len(images) != desired_count:
            raise pipeline.PipelineError(
                f"Generated source produced only {len(images)}/{desired_count} distinct views"
            )
        for position, image in enumerate(images, 1):
            publisher.upload(product.id, position, image)
        publication = publisher.publish(product.id, images)
        return {
            "product_id": product.id,
            "name": product.name,
            "status": "published",
            "image_count": desired_count,
            "source_url": source_url,
            "publication": publication,
        }
    finally:
        publisher.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=pipeline.DEFAULT_DATASET)
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--target-images", type=int, default=pipeline.TARGET_IMAGE_COUNT)
    parser.add_argument("--workers", type=int, default=10)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--product-id", action="append", default=[])
    parser.add_argument(
        "--all-product-groups",
        action="store_true",
        help="Generate fallbacks for every product group below three images.",
    )
    parser.add_argument("--preview", type=Path)
    args = parser.parse_args()
    if not 1 <= args.workers <= 20:
        raise pipeline.PipelineError("--workers must be between 1 and 20")

    products = pipeline.load_products(args.dataset)
    products_by_id = {product.id: product for product in products}
    if args.preview:
        if not args.product_id:
            raise pipeline.PipelineError("--preview requires --product-id")
        product = products_by_id.get(args.product_id[0])
        if product is None:
            raise pipeline.PipelineError("Preview product was not found")
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        args.preview.write_bytes(render_generated_source(product, args.template))
        print(json.dumps({"preview": str(args.preview), "product_id": product.id}))
        return 0

    env = {**pipeline.load_dotenv(pipeline.REPO_ROOT / ".env.local"), **os.environ}
    supabase_url = pipeline.compact_spaces(
        env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    supabase_secret = pipeline.compact_spaces(
        env.get("SUPABASE_SECRET_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not supabase_url or not supabase_secret:
        raise pipeline.PipelineError("Supabase publication credentials are required")

    inspector = pipeline.SupabasePublisher(supabase_url, supabase_secret, args.timeout)
    try:
        live_ids = inspector.live_product_ids()
        expected = {
            product.id: pipeline.MIN_IMAGES_PER_PRODUCT
            for product in products
            if product.id in live_ids
        }
        positions = inspector.gallery_positions(expected)
    finally:
        inspector.close()
    selected_ids = set(args.product_id)
    selected = [
        product
        for product in products
        if product.id in live_ids
        and (args.all_product_groups or product.group == "medicine")
        and len(positions.get(product.id, set())) < pipeline.MIN_IMAGES_PER_PRODUCT
        and (not selected_ids or product.id in selected_ids)
    ]
    if args.limit > 0:
        selected = selected[: args.limit]
    targets = pipeline.allocate_image_targets(sorted(live_ids), args.target_images)
    checkpoint = pipeline.CheckpointStore(args.checkpoint)
    pending: list[pipeline.Product] = []
    skipped = 0
    for product in selected:
        prior = checkpoint.get(product.id)
        if (
            prior
            and prior.get("status") == "published"
            and int(prior.get("payload", {}).get("image_count") or 0)
            == targets[product.id]
        ):
            skipped += 1
        else:
            pending.append(product)

    summary: dict[str, Any] = {
        "selected_products": len(selected),
        "pending": len(pending),
        "skipped": skipped,
        "published": 0,
        "failed": 0,
        "published_images": 0,
        "source_kind": SOURCE_KIND,
        "failures": [],
    }
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(
                    publish_one,
                    product,
                    targets[product.id],
                    args.template,
                    supabase_url,
                    supabase_secret,
                    args.timeout,
                ): product
                for product in pending
            }
            completed = 0
            for future in as_completed(futures):
                product = futures[future]
                completed += 1
                try:
                    result = future.result()
                    checkpoint.put(product.id, "published", result)
                    summary["published"] += 1
                    summary["published_images"] += int(result["image_count"])
                    print(
                        f"[{completed}/{len(pending)}] published-generated "
                        f"{product.id} {product.name}",
                        flush=True,
                    )
                except Exception as error:
                    failure = {
                        "product_id": product.id,
                        "name": product.name,
                        "error": str(error),
                    }
                    checkpoint.put(product.id, "incomplete", failure)
                    summary["failed"] += 1
                    summary["failures"].append(failure)
                    print(
                        f"[{completed}/{len(pending)}] failed-generated "
                        f"{product.id}: {error}",
                        flush=True,
                    )
    finally:
        checkpoint.close()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2))
    return 0 if summary["failed"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
