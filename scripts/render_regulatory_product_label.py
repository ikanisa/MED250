#!/usr/bin/env python3
"""Place an exact regulator-published label on a transparent bottle render.

This utility is intentionally deterministic. It does not synthesize or rewrite
label content: the selected rectangle is copied pixel-for-pixel from a rendered
regulatory document, resized as one image, and placed on a neutral catalogue
bottle silhouette. The pipeline still performs OCR, medicine identity,
strength, form, pack-size, quality, and background checks on the result.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence


def parse_crop(value: str) -> tuple[int, int, int, int]:
    try:
        left, top, right, bottom = (int(item) for item in value.split(","))
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError(
            "crop must be four comma-separated integers: left,top,right,bottom"
        ) from error
    if min(left, top) < 0 or right <= left or bottom <= top:
        raise argparse.ArgumentTypeError("crop coordinates are invalid")
    return left, top, right, bottom


def render_bottle(
    source_path: Path,
    output_path: Path,
    crop: tuple[int, int, int, int],
    canvas_size: int = 1400,
) -> None:
    from PIL import Image, ImageDraw, ImageFilter

    source = Image.open(source_path).convert("RGBA")
    left, top, right, bottom = crop
    if right > source.width or bottom > source.height:
        raise ValueError(
            f"crop {crop} exceeds source dimensions {source.width}x{source.height}"
        )
    label = source.crop(crop)

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 0))
    scale = canvas_size / 1400

    def box(values: Sequence[int]) -> tuple[int, int, int, int]:
        return tuple(round(value * scale) for value in values)  # type: ignore[return-value]

    shadow = Image.new("RGBA", canvas.size, (255, 255, 255, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse(box((325, 1200, 1075, 1325)), fill=(18, 25, 35, 78))
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(30 * scale)))
    canvas.alpha_composite(shadow)

    bottle = Image.new("RGBA", canvas.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(bottle)
    draw.rounded_rectangle(
        box((455, 105, 945, 280)),
        radius=round(42 * scale),
        fill=(226, 230, 235, 255),
        outline=(167, 176, 187, 255),
        width=max(2, round(5 * scale)),
    )
    for x in range(round(475 * scale), round(930 * scale), max(1, round(22 * scale))):
        draw.line(
            ((x, round(125 * scale)), (x, round(255 * scale))),
            fill=(180, 187, 197, 150),
            width=max(1, round(3 * scale)),
        )
    draw.rounded_rectangle(
        box((335, 235, 1065, 1260)),
        radius=round(95 * scale),
        fill=(246, 247, 249, 255),
        outline=(181, 188, 198, 255),
        width=max(2, round(5 * scale)),
    )
    # Fixed highlights preserve a neutral bottle shape while leaving the label
    # untouched and ensuring the silhouette survives background extraction.
    draw.rounded_rectangle(
        box((365, 280, 425, 1185)),
        radius=round(28 * scale),
        fill=(255, 255, 255, 105),
    )
    draw.rounded_rectangle(
        box((985, 300, 1035, 1170)),
        radius=round(24 * scale),
        fill=(205, 211, 220, 115),
    )
    canvas.alpha_composite(bottle)

    target_width = round(650 * scale)
    target_height = round(label.height * target_width / label.width)
    if target_height > round(690 * scale):
        target_height = round(690 * scale)
        target_width = round(label.width * target_height / label.height)
    label = label.resize((target_width, target_height), Image.Resampling.LANCZOS)
    label_x = (canvas.width - target_width) // 2
    label_y = round(405 * scale)
    canvas.alpha_composite(label, (label_x, label_y))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", optimize=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--crop", required=True, type=parse_crop)
    parser.add_argument("--canvas-size", type=int, default=1400)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not 800 <= args.canvas_size <= 2400:
        raise SystemExit("--canvas-size must be between 800 and 2400")
    render_bottle(args.source, args.output, args.crop, args.canvas_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
