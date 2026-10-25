#!/usr/bin/env python3
"""The eyes-on half of the comparison.

SSIM and drift (qc.py) say how far a clip wandered from the photograph, not
whether the result looks like a believable, honest walkthrough. This builds
one image per shot — the source photo, then one row per model with frames at
0 / 25 / 50 / 75 / 100 % of the clip — so a person (or a vision model) can
judge the same moment across all models at a glance, and a review.md with the
questions to answer for each.

    python3 review.py --out out/elm-road        # after compare.py has run
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

TILE_W, TILE_H, LABEL_H = 384, 216, 26
POINTS = [0.0, 0.25, 0.5, 0.75, 1.0]

QUESTIONS = [
    ("same room", "Same room, same layout and fittings from first to last frame?"),
    ("nothing added", "Nothing invented: no new furniture, people, windows or views?"),
    ("nothing lost", "Nothing hidden or removed: marks, damage, clutter still there?"),
    ("geometry", "Walls, doors and edges stay straight; no melting or wobble?"),
    ("light", "Exposure and colour steady; no flicker or time-of-day change?"),
    ("motion", "The camera move is smooth, slow and the one that was asked for?"),
]


def duration(path: pathlib.Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def frame(path: pathlib.Path, t: float, dst: pathlib.Path) -> bool:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.3f}",
                    "-i", str(path), "-frames:v", "1", str(dst)])
    return dst.exists()


def tile(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    scale = max(TILE_W / img.width, TILE_H / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)))
    l, t = (img.width - TILE_W) // 2, (img.height - TILE_H) // 2
    return img.crop((l, t, l + TILE_W, t + TILE_H))


def label(draw: ImageDraw.ImageDraw, x: int, y: int, text: str) -> None:
    draw.rectangle((x, y, x + TILE_W, y + LABEL_H), fill=(20, 20, 20))
    draw.text((x + 8, y + 7), text, fill=(240, 240, 240))


def strips(plan: dict, entries: list[dict], outdir: pathlib.Path) -> list[str]:
    dst_dir = outdir / "review"
    dst_dir.mkdir(exist_ok=True)
    rendered = [e for e in entries if not e["manifest"]["simulated"]]
    written = []
    with tempfile.TemporaryDirectory() as td:
        tmp = pathlib.Path(td)
        for shot in plan["shots"]:
            rows = []
            for e in rendered:
                clip = pathlib.Path(e["shot_dir"]) / f"shot-{shot['index']:02d}.mp4"
                if not clip.exists():
                    continue
                d = duration(clip)
                tiles = []
                for k, pt in enumerate(POINTS):
                    t = max(0.0, min(d - 0.05, d * pt))
                    f = tmp / f"{e['backend'].replace(':', '-')}-{shot['index']}-{k}.png"
                    if frame(clip, t, f):
                        tiles.append((f"{pt * 100:.0f}%", tile(Image.open(f))))
                if tiles:
                    rows.append((e["label"], tiles))
            if not rows:
                continue
            ncols = 1 + len(POINTS)
            img = Image.new("RGB", (ncols * TILE_W,
                                    len(rows) * (TILE_H + LABEL_H)), (0, 0, 0))
            draw = ImageDraw.Draw(img)
            src = tile(Image.open(shot["path"]))
            for r, (name, tiles) in enumerate(rows):
                y = r * (TILE_H + LABEL_H)
                label(draw, 0, y, "source photo")
                img.paste(src, (0, y + LABEL_H))
                for c, (pct, t) in enumerate(tiles, start=1):
                    label(draw, c * TILE_W, y, f"{name}  {pct}")
                    img.paste(t, (c * TILE_W, y + LABEL_H))
            dst = dst_dir / f"shot-{shot['index']:02d}.jpg"
            img.save(dst, quality=88)
            written.append(str(dst))

    md = ["# Eyes-on review", "",
          "Open each `shot-NN.jpg` here. Row = one model; first tile is the "
          "photograph that was handed in, then frames across the clip. "
          "Score each cell Y / N / ? and note anything odd. A shot fails "
          "outright if a model adds or removes anything (BRIEF.md rules).", ""]
    for e in rendered:
        md += [f"## {e['label']}", "",
               "| Shot | Room | " + " | ".join(q[0] for q in QUESTIONS) +
               " | Usable? |",
               "|---|---|" + "---|" * (len(QUESTIONS) + 1)]
        for shot in plan["shots"]:
            md.append(f"| {shot['index']} | {shot['room']} | " +
                      " | ".join("" for _ in QUESTIONS) + " | |")
        md.append("")
    md += ["## Questions", ""] + [f"- **{n}** — {q}" for n, q in QUESTIONS]
    (dst_dir / "review.md").write_text("\n".join(md) + "\n")
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    outdir = pathlib.Path(args.out)
    plan = json.loads((outdir / "shotplan.json").read_text())
    entries = []
    for d in sorted(outdir.glob("shots-*")):
        m = d / "manifest.json"
        if m.exists():
            man = json.loads(m.read_text())
            entries.append({"backend": man["backend"], "label": man["label"],
                            "shot_dir": str(d), "manifest": man})
    done = strips(plan, entries, outdir)
    print(f"{len(done)} review strips in {outdir / 'review'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
