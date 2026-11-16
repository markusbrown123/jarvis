#!/usr/bin/env python3
"""Stage 2 — shot plan.

Listing JSON in, a shot plan JSON out: for each photo, a camera move, a
duration, and the exact prompt that will be sent to an image-to-video model.

Two rules from BRIEF.md are enforced here, not left to the model:
  * the prompt describes camera movement only — never new rooms, new
    furniture, people, views out of windows, or a different time of day;
  * durations are chosen so the clip hits its target length exactly.

    python3 shotplan.py --listing fixtures/listing-demo.json \
        --photos photos/demo --out out/demo/shotplan.json
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

# Camera move per room type. Chosen the way a listing videographer would:
# lead into a space, reveal depth, finish wide.
MOVES = {
    "exterior front": "pull_out",
    "hallway":        "push_in",
    "living room":    "push_in_pan",
    "dining area":    "pan_right",
    "kitchen":        "pan_right",
    "main bedroom":   "push_in",
    "second bedroom": "pan_left",
    "bathroom":       "tilt_down",
    "garden":         "pull_out",
}
DEFAULT_MOVE = "push_in"

# How each move reads in plain English, for the model prompt.
MOVE_PHRASING = {
    "push_in":     "a slow, steady dolly push forward into the room",
    "pull_out":    "a slow, steady dolly pull backwards, revealing more of the frame",
    "pan_right":   "a slow, even pan to the right across the room",
    "pan_left":    "a slow, even pan to the left across the room",
    "tilt_down":   "a slow, even tilt downwards",
    "tilt_up":     "a slow, even tilt upwards",
    "push_in_pan": "a slow dolly push forward drifting gently to the right",
}

# The whole of the instruction that keeps the room the same room.
CONSTRAINTS = (
    "Camera movement only. The room, its layout, its furniture, its fittings "
    "and its lighting must stay exactly as they are in the photograph. "
    "Do not add, remove, move or restyle anything. No people, no pets, no "
    "moving objects. Do not change what is visible through windows. Do not "
    "change the time of day or the weather. No text, no watermark, no "
    "lens flare, no transition or cut — one continuous shot. Photoreal, "
    "static subject, locked exposure and white balance."
)

HERO_WEIGHT, NORMAL_WEIGHT = 1.25, 1.0
MIN_SHOT_S, MAX_SHOT_S = 2.0, 6.0


def plan_durations(shots: list[dict], target_s: float) -> list[float]:
    """Spread target_s across the shots, hero shots getting more, each
    clamped to what the motion models will actually generate."""
    weights = [HERO_WEIGHT if s.get("hero") else NORMAL_WEIGHT for s in shots]
    total_w = sum(weights)
    raw = [target_s * w / total_w for w in weights]
    durs = [round(min(max(d, MIN_SHOT_S), MAX_SHOT_S), 2) for d in raw]

    # Push the rounding/clamping remainder onto the shots that can still take
    # it, so the clip lands on target_s rather than near it.
    for _ in range(200):
        drift = round(target_s - sum(durs), 2)
        if abs(drift) < 0.01:
            break
        movable = [i for i, d in enumerate(durs)
                   if (drift > 0 and d < MAX_SHOT_S) or (drift < 0 and d > MIN_SHOT_S)]
        if not movable:
            break
        step = drift / len(movable)
        for i in movable:
            durs[i] = round(min(max(durs[i] + step, MIN_SHOT_S), MAX_SHOT_S), 2)
    durs[-1] = round(durs[-1] + (target_s - sum(durs)), 2)
    return durs


def build_prompt(room: str, move: str) -> str:
    return (f"Real estate interior video of this exact {room}. "
            f"{MOVE_PHRASING.get(move, MOVE_PHRASING[DEFAULT_MOVE])}, "
            f"at a constant speed, as if on a gimbal. {CONSTRAINTS}")


def build(listing: dict, photo_dir: pathlib.Path) -> dict:
    shots = listing["shots"]
    target = float(listing.get("target_duration_s", 30))
    durs = plan_durations(shots, target)

    planned, missing = [], []
    for shot, dur in zip(shots, durs):
        path = photo_dir / shot["file"]
        if not path.exists():
            missing.append(shot["file"])
        move = shot.get("move") or MOVES.get(shot["room"], DEFAULT_MOVE)
        planned.append({
            "index": len(planned) + 1,
            "file": shot["file"],
            "path": str(path),
            "room": shot["room"],
            "hero": bool(shot.get("hero")),
            "move": move,
            "duration_s": dur,
            "prompt": build_prompt(shot["room"], move),
        })

    if missing:
        raise FileNotFoundError(
            f"{len(missing)} photo(s) not in {photo_dir}: {', '.join(missing)}")

    return {
        "listing_id": listing["listing_id"],
        "target_duration_s": target,
        "planned_duration_s": round(sum(durs), 2),
        "shot_count": len(planned),
        "shots": planned,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listing", default="fixtures/listing-demo.json")
    ap.add_argument("--photos", default="photos/demo")
    ap.add_argument("--out", default="out/demo/shotplan.json")
    args = ap.parse_args()

    listing = json.loads(pathlib.Path(args.listing).read_text())
    plan = build(listing, pathlib.Path(args.photos))

    outp = pathlib.Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(plan, indent=2) + "\n")

    for s in plan["shots"]:
        print(f"  {s['index']:>2}. {s['room']:<16} {s['move']:<12} {s['duration_s']:>5.2f}s")
    print(f"\n{plan['shot_count']} shots, {plan['planned_duration_s']}s "
          f"(target {plan['target_duration_s']}s) -> {outp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
