#!/usr/bin/env python3
"""Stage 4 — edit. The per-shot clips become one walkthrough.

Trims each shot to its planned length (models hand back fixed 5s or 10s
clips, so this is where the clip gets back to its 30s plan), normalises
frame rate and pixel format, adds a room caption, and cuts a 16:9 master
and a 9:16 vertical.

    python3 edit.py --plan out/demo/shotplan.json \
        --shots out/demo/shots-kenburns --out out/demo/kenburns
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

FPS = 30
ASPECTS = {"16x9": (1920, 1080), "9x16": (1080, 1920)}
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/inter/InterDisplay-SemiBold.ttf",
    "/usr/share/fonts/truetype/inter/Inter-SemiBold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def font_file() -> str | None:
    for p in FONT_CANDIDATES:
        if pathlib.Path(p).exists():
            return p
    return None


def probe_duration(path: pathlib.Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True).stdout.strip()
    return float(out)


def esc(text: str) -> str:
    """Escape for ffmpeg drawtext."""
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")


def normalise(src: pathlib.Path, dst: pathlib.Path, duration: float,
              w: int, h: int, caption: str | None) -> None:
    """Trim to `duration`, fit to w x h by centre crop, caption, re-encode."""
    chain = [
        f"scale={w}:{h}:force_original_aspect_ratio=increase",
        f"crop={w}:{h}",
        f"fps={FPS}",
    ]
    ff = font_file()
    if caption and ff:
        pad = round(h * 0.055)
        size = round(h * 0.040)
        # fade the caption out over the last second of the shot
        alpha = (f"if(lt(t,{max(duration - 1.0, 0.1):.2f}),1,"
                 f"max(0,1-(t-{max(duration - 1.0, 0.1):.2f})))")
        chain.append(
            f"drawtext=fontfile={ff}:text='{esc(caption)}'"
            f":fontcolor=white:fontsize={size}"
            f":x={pad}:y=h-{pad}-text_h"
            f":shadowcolor=black@0.55:shadowx=2:shadowy=2"
            f":alpha='{alpha}'")
    chain.append("format=yuv420p")

    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-i", str(src), "-t", f"{duration:.3f}",
           "-vf", ",".join(chain),
           "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-r", str(FPS), str(dst)]
    subprocess.run(cmd, check=True)


def concat(parts: list[pathlib.Path], dst: pathlib.Path) -> None:
    listing = dst.parent / (dst.stem + "-concat.txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", str(listing), "-c", "copy", str(dst)], check=True)
    listing.unlink()


def thumbnail(src: pathlib.Path, dst: pathlib.Path, at: float = 1.0) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{at}", "-i", str(src),
         "-frames:v", "1", "-q:v", "2", str(dst)], check=True)


def build(plan: dict, shotdir: pathlib.Path, outdir: pathlib.Path,
          captions: bool = True) -> dict:
    manifest_path = shotdir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    by_index = {s["index"]: s for s in manifest.get("shots", [])}

    outdir.mkdir(parents=True, exist_ok=True)
    work = outdir / "work"
    work.mkdir(exist_ok=True)

    missing = []
    for shot in plan["shots"]:
        entry = by_index.get(shot["index"], {})
        src = entry.get("output") or (shotdir / f"shot-{shot['index']:02d}.mp4")
        if not src or not pathlib.Path(src).exists():
            missing.append(shot["index"])

    if missing:
        return {"ok": False,
                "reason": f"no clip for shot(s) {missing} in {shotdir}",
                "missing_shots": missing}

    results = {"ok": True, "shot_dir": str(shotdir), "outputs": {}}
    for name, (w, h) in ASPECTS.items():
        parts = []
        for shot in plan["shots"]:
            entry = by_index.get(shot["index"], {})
            src = pathlib.Path(entry.get("output")
                               or shotdir / f"shot-{shot['index']:02d}.mp4")
            have = probe_duration(src)
            want = min(shot["duration_s"], have)
            if have + 0.05 < shot["duration_s"]:
                print(f"    ! shot {shot['index']} is {have:.2f}s but the plan "
                      f"wants {shot['duration_s']:.2f}s — using {want:.2f}s")
            dst = work / f"{name}-{shot['index']:02d}.mp4"
            normalise(src, dst, want, w, h,
                      shot["room"].title() if captions else None)
            parts.append(dst)

        final = outdir / f"walkthrough-{name}.mp4"
        concat(parts, final)
        dur = probe_duration(final)
        results["outputs"][name] = {"path": str(final), "duration_s": round(dur, 2)}
        print(f"  {name}: {final} ({dur:.2f}s)")

    master = pathlib.Path(results["outputs"]["16x9"]["path"])
    thumb = outdir / "thumbnail.jpg"
    thumbnail(master, thumb)
    results["outputs"]["thumbnail"] = str(thumb)
    results["target_duration_s"] = plan["target_duration_s"]
    (outdir / "edit.json").write_text(json.dumps(results, indent=2) + "\n")
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default="out/demo/shotplan.json")
    ap.add_argument("--shots", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-captions", action="store_true")
    args = ap.parse_args()

    plan = json.loads(pathlib.Path(args.plan).read_text())
    res = build(plan, pathlib.Path(args.shots), pathlib.Path(args.out),
                captions=not args.no_captions)
    if not res["ok"]:
        print(f"edit skipped: {res['reason']}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
