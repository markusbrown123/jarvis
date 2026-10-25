#!/usr/bin/env python3
"""Generate a synthetic 10-photo property set so the pipeline can be run
end-to-end without any client photos.

These are NOT photographs. They are flat, labelled stand-ins at real listing
dimensions (3:2, 2048x1365) with a one-point-perspective room suggestion, so
that framing, camera moves, crops, stitching and QC can all be exercised and
measured. Swap in real photos (same filenames) to get a real comparison.

    python3 make_test_photos.py --out photos/demo
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 2048, 1365

# room -> (wall, floor, accent) — distinct enough that drift between two
# different rooms is obvious to both the eye and the QC numbers.
PALETTES = {
    "exterior front": ((188, 205, 219), (122, 132, 120), (92, 74, 58)),
    "hallway":        ((226, 221, 212), (150, 112, 78),  (60, 62, 68)),
    "living room":    ((232, 228, 220), (158, 120, 84),  (76, 94, 112)),
    "kitchen":        ((238, 238, 236), (176, 174, 170), (40, 46, 52)),
    "dining area":    ((230, 224, 212), (158, 120, 84),  (118, 86, 62)),
    "main bedroom":   ((224, 219, 214), (166, 130, 96),  (108, 116, 128)),
    "second bedroom": ((230, 226, 219), (166, 130, 96),  (134, 140, 126)),
    "bathroom":       ((228, 233, 235), (206, 208, 210), (70, 92, 104)),
    "garden":         ((176, 198, 214), (108, 138, 92),  (96, 110, 76)),
}
FALLBACK = ((228, 226, 222), (160, 140, 120), (80, 86, 94))

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/inter/InterDisplay-SemiBold.ttf",
    "/usr/share/fonts/truetype/inter/Inter-SemiBold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _font(size: int):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def _vertical_gradient(top, bottom, w, h):
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return img.resize((w, h))


def _shade(rgb, factor):
    return tuple(max(0, min(255, round(c * factor))) for c in rgb)


def render(room: str, label: str, index: int) -> Image.Image:
    wall, floor, accent = PALETTES.get(room, FALLBACK)
    horizon = int(H * (0.72 if room in ("exterior front", "garden") else 0.66))

    img = _vertical_gradient(_shade(wall, 1.04), _shade(wall, 0.9), W, H)
    d = ImageDraw.Draw(img, "RGBA")

    # ground plane
    d.rectangle([0, horizon, W, H], fill=_shade(floor, 1.0))
    d.rectangle([0, horizon, W, H], fill=(255, 255, 255, 14))

    # one-point perspective: vanishing point shifted per photo so each frame
    # has a different composition (and so pans/tilts read differently).
    vx = int(W * (0.34 + 0.32 * ((index * 0.37) % 1.0)))
    vy = horizon

    if room in ("exterior front", "garden"):
        # a facade / hedge block instead of interior walls
        bw, bh = int(W * 0.46), int(H * 0.44)
        bx = vx - bw // 2
        d.rectangle([bx, horizon - bh, bx + bw, horizon], fill=_shade(accent, 1.0))
        d.rectangle([bx, horizon - bh, bx + bw, horizon - bh + 18],
                    fill=_shade(accent, 0.7))
        for i in range(3):
            ww = int(bw * 0.17)
            wx = bx + int(bw * (0.14 + i * 0.29))
            wy = horizon - int(bh * 0.74)
            d.rectangle([wx, wy, wx + ww, wy + int(bh * 0.3)],
                        fill=(206, 222, 230), outline=_shade(accent, 0.5), width=6)
    else:
        # side walls converging on the vanishing point
        back_w, back_h = int(W * 0.34), int(H * 0.40)
        bx0, bx1 = vx - back_w // 2, vx + back_w // 2
        by0, by1 = vy - back_h, vy
        d.polygon([(0, 0), (bx0, by0), (bx0, by1), (0, H)], fill=_shade(wall, 0.84))
        d.polygon([(W, 0), (bx1, by0), (bx1, by1), (W, H)], fill=_shade(wall, 0.93))
        d.rectangle([bx0, by0, bx1, by1], fill=_shade(wall, 1.06))
        # a window on the back wall, and a floor object for parallax
        d.rectangle([bx0 + back_w // 5, by0 + back_h // 6,
                     bx1 - back_w // 5, by0 + back_h // 2],
                    fill=(214, 228, 236), outline=_shade(accent, 0.6), width=5)
        ow, oh = int(W * 0.17), int(H * 0.13)
        ox = vx - ow // 2 + int(W * 0.1)
        d.rectangle([ox, horizon - oh // 3, ox + ow, horizon + oh],
                    fill=_shade(accent, 1.0))
        # floorboard lines, converging — gives the QC a real structure to track
        for i in range(1, 9):
            x = int(W * i / 9)
            d.line([(x, H), (vx, vy)], fill=_shade(floor, 0.84), width=3)

    # corner vignette, so brightness is not uniform (zoompan crops get tested)
    vign = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vign)
    vd.ellipse([-W // 3, -H // 3, W + W // 3, H + H // 3], fill=90)
    img = Image.composite(img, Image.new("RGB", (W, H), (0, 0, 0)),
                          vign.point(lambda v: 165 + v // 2))

    # label — big enough to survive a 9:16 centre crop
    d = ImageDraw.Draw(img, "RGBA")
    f1, f2 = _font(86), _font(44)
    d.rectangle([0, H - 210, W, H], fill=(0, 0, 0, 120))
    d.text((70, H - 180), label, font=f1, fill=(255, 255, 255, 235))
    d.text((70, H - 78), "synthetic test frame — not a photograph",
           font=f2, fill=(255, 255, 255, 170))
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listing", default="fixtures/listing-demo.json")
    ap.add_argument("--out", default="photos/demo")
    args = ap.parse_args()

    listing = json.loads(pathlib.Path(args.listing).read_text())
    outdir = pathlib.Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    for i, shot in enumerate(listing["shots"]):
        label = shot["room"].title()
        img = render(shot["room"], label, i)
        path = outdir / shot["file"]
        img.save(path, "JPEG", quality=88)
        print(f"wrote {path}")

    print(f"\n{len(listing['shots'])} frames in {outdir} ({W}x{H})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
