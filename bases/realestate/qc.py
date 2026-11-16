#!/usr/bin/env python3
"""Stage 4b — QC. Numbers for the two questions the brief asks about motion:
is it realistic, and does the room stay the same room.

Three measurements per shot, all from ffmpeg, no extra dependencies:

  opening_ssim   SSIM between the clip's first frame and the source photo,
                 framed the same way. An image-to-video model is supposed to
                 start on the photo it was given. A low score means it
                 repainted the room before it ever moved the camera — the
                 single most useful tell for "is this still the property".

  drift          SSIM between the last frame and the first frame. A camera
                 move lowers this on its own, so it is only meaningful next
                 to the Ken Burns control on the same shot: the control is
                 pure camera movement, so anything much lower is the model
                 changing content as well as viewpoint.

  jump           Per-frame mean absolute difference. A steady gimbal move is
                 a flat line; morphing, flicker and warping show up as
                 spikes. Reported as median, max, and max/median — the ratio
                 is what catches a one-frame tear that an average hides.

    python3 qc.py --plan out/demo/shotplan.json --shots out/demo/shots-kenburns
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import statistics
import subprocess
import sys
import tempfile

# Thresholds. Deliberately loose — they flag a shot for a human to look at,
# they do not decide anything.
OPENING_SSIM_FLOOR = 0.85
JUMP_RATIO_CEILING = 3.0


def ff(args: list[str]) -> str:
    """Run ffmpeg, return stderr (where the filters report)."""
    return subprocess.run(["ffmpeg", "-y", "-loglevel", "info", *args],
                          capture_output=True, text=True).stderr


def frame(src: pathlib.Path, dst: pathlib.Path, when: str) -> bool:
    """Grab the first frame, or the last (when='last')."""
    if when == "first":
        args = ["-i", str(src), "-frames:v", "1", str(dst)]
    else:
        args = ["-sseof", "-0.2", "-i", str(src), "-update", "1",
                "-frames:v", "1", str(dst)]
    ff(args)
    return dst.exists() and dst.stat().st_size > 0


def ssim(a: pathlib.Path, b: pathlib.Path) -> float | None:
    """SSIM of two images, b resized and centre-cropped to match a."""
    out = ff(["-i", str(a), "-i", str(b), "-lavfi",
              # b (the reference photo, any size) is scaled to fill a's frame
              # and centre-cropped, so SSIM compares like with like.
              "[0:v]setsar=1[r];[1:v]setsar=1[d];"
              "[d][r]scale2ref=w=iw:h=ih:force_original_aspect_ratio=increase"
              "[ds][rs];[ds]crop=w=iw:h=ih[dc];[rs][dc]ssim",
              "-f", "null", "-"])
    m = re.search(r"All:\s*([0-9.]+)", out)
    return float(m.group(1)) if m else None


def jumps(src: pathlib.Path) -> list[float]:
    """Mean luma of the frame-to-frame difference, one value per frame."""
    out = ff(["-i", str(src), "-vf",
              "scale=480:-2,tblend=all_mode=difference,signalstats,"
              "metadata=print:key=lavfi.signalstats.YAVG",
              "-f", "null", "-"])
    return [float(v) for v in
            re.findall(r"lavfi\.signalstats\.YAVG=([0-9.]+)", out)]


def check_shot(clip: pathlib.Path, photo: pathlib.Path, tmp: pathlib.Path,
               index: int) -> dict:
    first = tmp / f"{index:02d}-first.png"
    last = tmp / f"{index:02d}-last.png"
    r: dict = {"index": index, "clip": str(clip)}

    if not frame(clip, first, "first") or not frame(clip, last, "last"):
        return {**r, "status": "error", "error": "could not read frames"}

    r["opening_ssim"] = ssim(first, photo)
    r["drift_ssim"] = ssim(first, last)

    vals = [v for v in jumps(clip) if v == v]
    if vals:
        med = statistics.median(vals) or 1e-6
        r["jump_median"] = round(med, 4)
        r["jump_max"] = round(max(vals), 4)
        r["jump_ratio"] = round(max(vals) / med, 2)

    flags = []
    if r.get("opening_ssim") is not None and r["opening_ssim"] < OPENING_SSIM_FLOOR:
        flags.append(f"opens off-photo (SSIM {r['opening_ssim']:.3f})")
    if r.get("jump_ratio", 0) > JUMP_RATIO_CEILING:
        flags.append(f"motion spike (max/median {r['jump_ratio']:.1f}x)")
    r["flags"] = flags
    r["status"] = "ok"
    for k in ("opening_ssim", "drift_ssim"):
        if r.get(k) is not None:
            r[k] = round(r[k], 4)
    return r


def run(plan: dict, shotdir: pathlib.Path) -> dict:
    mpath = shotdir / "manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
    by_index = {s["index"]: s for s in manifest.get("shots", [])}

    results = []
    with tempfile.TemporaryDirectory() as td:
        tmp = pathlib.Path(td)
        for shot in plan["shots"]:
            entry = by_index.get(shot["index"], {})
            clip = pathlib.Path(entry.get("output")
                                or shotdir / f"shot-{shot['index']:02d}.mp4")
            if not clip.exists():
                results.append({"index": shot["index"], "status": "missing"})
                continue
            res = check_shot(clip, pathlib.Path(shot["path"]), tmp, shot["index"])
            res["room"] = shot["room"]
            results.append(res)
            if res["status"] == "ok":
                print(f"  shot {res['index']:>2} {res['room']:<16} "
                      f"open {res.get('opening_ssim', 0):.3f}  "
                      f"drift {res.get('drift_ssim', 0):.3f}  "
                      f"jump {res.get('jump_ratio', 0):>5.1f}x  "
                      f"{'; '.join(res['flags']) or 'clean'}")

    ok = [r for r in results if r["status"] == "ok"]
    summary = {
        "shot_dir": str(shotdir),
        "backend": manifest.get("backend"),
        "measured": len(ok),
        "missing": len(results) - len(ok),
        "mean_opening_ssim": round(statistics.fmean(
            [r["opening_ssim"] for r in ok if r.get("opening_ssim") is not None]), 4)
            if ok else None,
        "mean_drift_ssim": round(statistics.fmean(
            [r["drift_ssim"] for r in ok if r.get("drift_ssim") is not None]), 4)
            if ok else None,
        "worst_jump_ratio": round(max(
            [r.get("jump_ratio", 0) for r in ok], default=0), 2),
        "flagged_shots": [r["index"] for r in ok if r["flags"]],
        "shots": results,
    }
    (shotdir / "qc.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default="out/demo/shotplan.json")
    ap.add_argument("--shots", required=True)
    args = ap.parse_args()
    plan = json.loads(pathlib.Path(args.plan).read_text())
    s = run(plan, pathlib.Path(args.shots))
    if s["measured"] == 0:
        print("no clips to measure", file=sys.stderr)
        return 1
    print(f"\nmean opening SSIM {s['mean_opening_ssim']}, "
          f"mean drift {s['mean_drift_ssim']}, "
          f"worst jump {s['worst_jump_ratio']}x, "
          f"{len(s['flagged_shots'])} shot(s) flagged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
