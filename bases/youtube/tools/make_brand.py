#!/usr/bin/env python3
"""Render the channel's look from brand/brand.json into out/brand/.

Everything here is drawn from scratch with Pillow - no stock art, no fonts
beyond the two OFL-licensed families noted in brand.json. Re-run it after any
change to brand.json (name, handle, colours) and the whole set re-renders.

    python3 tools/make_brand.py [--thumb-title "..."] [--thumb-kicker "..."]

Sizes follow YouTube's own specs (see BRAND.md for the sources):
  banner      2560 x 1440, safe area 1546 x 423 centred, under 6 MB
  avatar       800 x 800
  thumbnail   1280 x 720, under 2 MB
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out" / "brand"
BRAND = json.loads((ROOT / "brand" / "brand.json").read_text())
C = BRAND["palette"]
F = BRAND["fonts"]


def font(key: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(F[key], size)


def text_size(draw: ImageDraw.ImageDraw, s: str, f) -> tuple[int, int]:
    l, t, r, b = draw.textbbox((0, 0), s, font=f)
    return r - l, b - t


# --- shared texture ---------------------------------------------------------


def grid(img: Image.Image, step: int, colour: str, width: int = 1) -> None:
    """The blueprint grid that sits under everything. Quiet, not decorative."""
    d = ImageDraw.Draw(img, "RGBA")
    w, h = img.size
    for x in range(0, w + step, step):
        d.line([(x, 0), (x, h)], fill=colour, width=width)
    for y in range(0, h + step, step):
        d.line([(0, y), (w, y)], fill=colour, width=width)


def glow(img: Image.Image, cx: int, cy: int, r: int, colour: str, alpha: int) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rgb = tuple(int(colour[i : i + 2], 16) for i in (1, 3, 5))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgb + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.55))
    img.alpha_composite(layer)


def progress_bar(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, done: float) -> None:
    """The one recurring motif: a build that is partly finished."""
    d.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, fill=C["line"])
    d.rounded_rectangle([x, y, x + int(w * done), y + h], radius=h // 2, fill=C["signal"])


# --- the mark ---------------------------------------------------------------


def draw_mark(size: int) -> Image.Image:
    """A square bracket half-filled: a job in progress, readable at 24 px."""
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = s * 0.17
    stroke = max(2, int(s * 0.085))
    box = [pad, pad, s - pad, s - pad]

    # bracket: full left edge, stubs top and bottom, open right side
    d.rounded_rectangle(box, radius=s * 0.1, outline=C["paper"], width=stroke)
    # cut the right edge back out to leave the bracket open
    cut = s * 0.26
    d.rectangle([box[2] - stroke * 1.4, box[1] + cut, box[2] + stroke, box[3] - cut],
                fill=(0, 0, 0, 0))

    # the fill: lower-left to mid, the "built so far"
    inset = pad + stroke * 1.9
    inner_h = (box[3] - inset) - inset
    fill_top = box[3] - inset - inner_h * 0.52
    d.rounded_rectangle([inset, fill_top, s - inset - stroke * 0.6, box[3] - inset],
                        radius=s * 0.03, fill=C["signal"])
    return img


def avatar() -> None:
    s = 800
    img = Image.new("RGBA", (s, s), C["ink"])
    grid(img, 50, "#1B2430")
    glow(img, int(s * 0.72), int(s * 0.82), int(s * 0.45), C["signal"], 46)
    mark = draw_mark(int(s * 0.62))
    img.alpha_composite(mark, ((s - mark.width) // 2, (s - mark.height) // 2))
    img.convert("RGB").save(OUT / "avatar-800.png")
    img.resize((98, 98), Image.LANCZOS).convert("RGB").save(OUT / "avatar-98.png")
    img.resize((24, 24), Image.LANCZOS).convert("RGB").save(OUT / "avatar-24.png")

    # watermark: the mark alone on transparency, for the video corner
    wm = draw_mark(150)
    wm.save(OUT / "watermark-150.png")


# --- banner -----------------------------------------------------------------


def banner() -> None:
    w, h = 2560, 1440
    safe_w, safe_h = 1546, 423
    img = Image.new("RGBA", (w, h), C["ink"])
    grid(img, 80, "#161E29")
    glow(img, int(w * 0.5), int(h * 0.5), 820, C["signal"], 30)
    glow(img, int(w * 0.18), int(h * 0.3), 500, "#1E6BFF", 22)
    d = ImageDraw.Draw(img, "RGBA")

    sx, sy = (w - safe_w) // 2, (h - safe_h) // 2

    mark = draw_mark(230)
    img.alpha_composite(mark, (sx, sy + (safe_h - mark.height) // 2 - 14))

    tx = sx + mark.width + 54
    f_name = font("display", 118)
    d.text((tx, sy + 92), BRAND["name"].upper(), font=f_name, fill=C["paper"])

    f_tag = font("mono_regular", 42)
    d.text((tx, sy + 236), BRAND["tagline"], font=f_tag, fill=C["muted"])

    f_meta = font("mono", 34)
    d.text((tx, sy + 312), "NEW BUILD EVERY WEEK", font=f_meta, fill=C["signal"])
    progress_bar(d, tx, sy + 372, 520, 12, 0.62)

    img.convert("RGB").save(OUT / "banner-2560x1440.png", quality=92)
    # the same art cropped to what desktop and mobile actually show
    img.crop(((w - 2560) // 2, (h - 423) // 2, (w + 2560) // 2, (h + 423) // 2)) \
        .convert("RGB").save(OUT / "banner-crop-desktop.png")
    img.crop((sx, sy, sx + safe_w, sy + safe_h)).convert("RGB").save(OUT / "banner-crop-mobile.png")

    # a proof sheet with the safe area drawn on, to check before uploading
    proof = img.copy()
    pd = ImageDraw.Draw(proof, "RGBA")
    pd.rectangle([sx, sy, sx + safe_w, sy + safe_h], outline=C["ok"], width=4)
    pd.text((sx + 10, sy - 48), "SAFE AREA 1546 x 423 - all devices",
            font=font("mono", 32), fill=C["ok"])
    proof.convert("RGB").save(OUT / "banner-proof.png")


# --- thumbnails -------------------------------------------------------------


def wrap(d, s: str, f, max_w: int) -> list[str]:
    words, lines, cur = s.split(), [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if text_size(d, trial, f)[0] <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def thumbnail(path: pathlib.Path, kicker: str, title: str, stat: str,
              variant: str = "split") -> None:
    """One thumbnail grammar, three variants. Rules in BRAND.md:
    big left-aligned title, one orange word of emphasis handled by the caller
    using *asterisks*, a mono kicker, and room on the right for the build shot.
    """
    w, h = 1280, 720
    img = Image.new("RGBA", (w, h), C["ink"])
    grid(img, 40, "#161E29")
    d = ImageDraw.Draw(img, "RGBA")

    if variant == "split":
        # right two-fifths: a placeholder plate for the screen recording still
        px = int(w * 0.58)
        d.rectangle([px, 0, w, h], fill=C["panel"])
        d.line([(px, 0), (px, h)], fill=C["line"], width=4)
        glow(img, int(w * 0.82), int(h * 0.55), 300, C["signal"], 40)
        d = ImageDraw.Draw(img, "RGBA")
        d.text((px + 40, h - 78), "[ build shot goes here ]",
               font=font("mono_regular", 26), fill=C["muted"])
        text_w = px - 96
    else:
        glow(img, int(w * 0.85), int(h * 0.8), 420, C["signal"], 34)
        d = ImageDraw.Draw(img, "RGBA")
        text_w = int(w * 0.74)

    # kicker
    d.text((56, 56), kicker.upper(), font=font("mono", 34), fill=C["signal"])

    # title: shrink to fit at most three lines
    size = 104
    while size > 56:
        f = font("display", size)
        lines = wrap(d, title, f, text_w)
        if len(lines) <= 3:
            break
        size -= 6
    f = font("display", size)
    lines = wrap(d, title, f, text_w)
    lh = int(size * 1.08)
    y = 132
    for line in lines:
        x = 56
        for i, word in enumerate(line.split()):
            emph = word.startswith("*") and word.endswith("*")
            shown = word.strip("*")
            d.text((x, y), shown, font=f, fill=C["signal"] if emph else C["paper"])
            x += text_size(d, shown + " ", f)[0]
        y += lh

    # footer: the motif plus one number
    progress_bar(d, 56, h - 92, 300, 12, 0.62)
    if stat:
        d.text((56, h - 70), stat, font=font("mono", 36), fill=C["paper"])
    mark = draw_mark(74)
    img.alpha_composite(mark, (w - 104, h - 104))

    img.convert("RGB").save(path, quality=90, optimize=True)


def thumbnails(title: str, kicker: str) -> None:
    thumbnail(OUT / "thumb-A-split.jpg", kicker, title, "4 HOURS, 0 HANDS", "split")
    thumbnail(OUT / "thumb-B-full.jpg", kicker, title, "4 HOURS, 0 HANDS", "full")
    thumbnail(OUT / "thumb-C-question.jpg", "DOES IT WORK?",
              "What it got *wrong* on the first run", "", "full")


# --- end card and lower third ----------------------------------------------


def end_card() -> None:
    w, h = 1920, 1080
    img = Image.new("RGBA", (w, h), C["ink"])
    grid(img, 60, "#161E29")
    glow(img, w // 2, h // 2, 620, C["signal"], 26)
    d = ImageDraw.Draw(img, "RGBA")
    mark = draw_mark(150)
    img.alpha_composite(mark, (120, 100))
    d.text((120, 290), "NEXT BUILD", font=font("mono", 40), fill=C["signal"])
    d.text((120, 346), "Subscribe and it turns up\nwhen it is finished.",
           font=font("display_semibold", 84), fill=C["paper"], spacing=18)
    # two 16:9 slots for YouTube's end-screen video elements
    for i, x in enumerate((1020, 1480)):
        d.rounded_rectangle([x, 620, x + 400, 620 + 225], radius=12,
                            outline=C["line"], width=4)
        d.text((x + 16, 620 + 190), f"[ video slot {i + 1} ]",
               font=font("mono_regular", 24), fill=C["muted"])
    d.text((120, 940), f"{BRAND['handle']}  -  sources in the description",
           font=font("mono_regular", 34), fill=C["muted"])
    img.convert("RGB").save(OUT / "end-card-1920x1080.png")


def lower_third() -> None:
    w, h = 1920, 1080
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    x, y = 110, 820
    d.rounded_rectangle([x, y, x + 880, y + 150], radius=10, fill=(11, 14, 19, 225))
    d.rectangle([x, y, x + 10, y + 150], fill=C["signal"])
    d.text((x + 40, y + 28), "STEP 03", font=font("mono", 32), fill=C["signal"])
    d.text((x + 40, y + 74), "The part that broke", font=font("display_semibold", 50),
           fill=C["paper"])
    img.save(OUT / "lower-third-1920x1080.png")


def caption_sample() -> None:
    """How burned-in captions should look: one line, centre, high contrast."""
    w, h = 1920, 1080
    img = Image.new("RGBA", (w, h), (20, 26, 35, 255))
    d = ImageDraw.Draw(img, "RGBA")
    f = font("display_semibold", 56)
    line = "and it shipped while I was asleep"
    tw, th = text_size(d, line, f)
    bx, by = (w - tw) // 2, 880
    d.rounded_rectangle([bx - 32, by - 22, bx + tw + 32, by + th + 30], radius=12,
                        fill=(11, 14, 19, 205))
    d.text((bx, by), line, font=f, fill=C["paper"])
    img.convert("RGB").save(OUT / "caption-style.png")


def contact_sheet() -> None:
    files = ["banner-crop-desktop.png", "thumb-A-split.jpg", "thumb-B-full.jpg",
             "thumb-C-question.jpg", "end-card-1920x1080.png", "caption-style.png"]
    tiles, tw = [], 640
    for name in files:
        im = Image.open(OUT / name).convert("RGB")
        tiles.append(im.resize((tw, max(1, round(tw * im.height / im.width))), Image.LANCZOS))
    cols = 2
    rows = math.ceil(len(tiles) / cols)
    rh = max(t.height for t in tiles) + 20
    sheet = Image.new("RGB", (cols * (tw + 20) + 20, rows * rh + 20), C["ink"])
    for i, t in enumerate(tiles):
        sheet.paste(t, (20 + (i % cols) * (tw + 20), 20 + (i // cols) * rh))
    sheet.save(OUT / "contact-sheet.png")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--thumb-title", default="I let it build a *whole* website overnight")
    p.add_argument("--thumb-kicker", default="Build log 01")
    a = p.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    avatar()
    banner()
    thumbnails(a.thumb_title, a.thumb_kicker)
    end_card()
    lower_third()
    caption_sample()
    contact_sheet()

    print(f"name: {BRAND['name']}  handle: {BRAND['handle']}")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:34s} {f.stat().st_size / 1024:8.1f} KB")


if __name__ == "__main__":
    main()
