#!/usr/bin/env python3
"""Before spending anything: is a real run ready, and what will it cost?

    python3 preflight.py --listing ~/listings/elm-road.json \
        --photos ~/listings/elm-road/photos

Checks ffmpeg, which API keys are present (environment or Keychain; the
values are never printed), the listing's photos (found, big enough, aspect),
then prices a cheap trial (three hero shots) and the full run per model and
prints the commands to run. Spends nothing and sends nothing.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import sys

from PIL import Image

import motion
import shotplan

MIN_LONG_EDGE = 1280


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listing", required=True)
    ap.add_argument("--photos", required=True)
    ap.add_argument("--trial-shots", type=int, nargs="+", default=None)
    args = ap.parse_args()
    problems = 0

    print("tools")
    ok = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
    print(f"  ffmpeg + ffprobe   {'ok' if ok else 'MISSING'}")
    problems += not ok

    print("\nkeys (environment or Keychain service of the same name)")
    for prov in ("fal", "runway"):
        have = bool(motion.get_key(prov))
        print(f"  {motion.ENV_KEYS[prov]:<22} {'present' if have else 'not set'}")

    print("\nphotos")
    listing = json.loads(pathlib.Path(args.listing).expanduser().read_text())
    folder = pathlib.Path(args.photos).expanduser()
    for s in listing["shots"]:
        f = folder / s["file"]
        if not f.exists():
            print(f"  {s['file']:<28} MISSING")
            problems += 1
            continue
        w, h = Image.open(f).size
        notes = []
        if max(w, h) < MIN_LONG_EDGE:
            notes.append(f"small (<{MIN_LONG_EDGE}px long edge)")
        if h > w:
            notes.append("portrait photo — will be cropped to 16:9")
        print(f"  {s['file']:<28} {w}x{h}  {'; '.join(notes) or 'ok'}")
        problems += bool(notes and "small" in notes[0])

    if problems:
        print(f"\n{problems} problem(s) above; fix before a paid run.")
        return 1

    plan = shotplan.build(listing, folder)
    heroes = [s["index"] for s in plan["shots"] if s.get("hero")][:3]
    trial = args.trial_shots or heroes or [s["index"] for s in plan["shots"]][:3]

    print("\ncost (whole seconds billed, audio off)")
    print(f"  {'':<24}{'trial ' + str(trial):<22}full walkthrough")
    for b, m in motion.MODELS.items():
        if m["provider"] == "local":
            continue
        def total(idx=None):
            return sum(motion.billable_seconds(m, s["duration_s"]) * m["price_per_s"]
                       for s in plan["shots"] if idx is None or s["index"] in idx)
        print(f"  {m['label']:<24}${total(trial):<21.2f}${total():.2f}")

    shots = " ".join(map(str, trial))
    print(f"""
next
  1. trial, three shots, capped:
       python3 compare.py --listing {args.listing} --photos {args.photos} \\
           --shots {shots} --max-spend 4
  2. open out/<listing_id>/review/shot-NN.jpg and out/<listing_id>/compare-shot-NN.mp4
  3. only if a model is worth it, the full run (finished shots are never re-paid):
       python3 compare.py --listing {args.listing} --photos {args.photos} \\
           --backends kenburns fal:kling-3-pro --max-spend 8
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
