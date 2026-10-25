#!/usr/bin/env python3
"""Milestone 1 — run the same 10 photos through every backend and score them.

    python3 compare.py                      # whatever keys are set; rest dry-run
    python3 compare.py --backends kenburns fal:kling-3-pro
    python3 compare.py --dry-run            # cost the run without spending

Writes, under out/<listing>/:
    shotplan.json                 the plan every backend was given
    shots-<backend>/              per-shot clips, manifest.json, qc.json
    <backend>/walkthrough-*.mp4   the 30s cuts, 16:9 and 9:16
    compare-shot-<n>.mp4          the same shot from every backend, side by side
    scorecard.md                  the comparison, with cost and QC
"""
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys

import edit
import motion
import qc
import shotplan

DEFAULT_BACKENDS = ["kenburns", "fal:seedance-2-fast", "fal:kling-3-pro",
                    "runway:gen4-turbo"]


def slug(backend: str) -> str:
    return backend.replace(":", "-")


def side_by_side(entries: list[dict], index: int, dst: pathlib.Path) -> bool:
    """One shot from each backend that really rendered, in a row."""
    clips = []
    for e in entries:
        p = pathlib.Path(e["shot_dir"]) / f"shot-{index:02d}.mp4"
        if p.exists():
            clips.append((e["label"], p))
    if len(clips) < 2:
        return False

    tile_w, tile_h = 640, 360
    ff = edit.font_file()
    inputs, filters, labels = [], [], []
    for i, (label, path) in enumerate(clips):
        inputs += ["-i", str(path)]
        cap = (f",drawtext=fontfile={ff}:text='{edit.esc(label)}':x=14:y=12"
               f":fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55"
               f":boxborderw=10") if ff else ""
        filters.append(
            f"[{i}:v]scale={tile_w}:{tile_h}:force_original_aspect_ratio=increase,"
            f"crop={tile_w}:{tile_h},fps=30,setsar=1{cap}[v{i}]")
        labels.append(f"[v{i}]")
    filters.append(f"{''.join(labels)}hstack=inputs={len(clips)}[out]")

    cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs,
           "-filter_complex", ";".join(filters), "-map", "[out]",
           "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
           "-shortest", str(dst)]
    subprocess.run(cmd, check=True)
    return True


def scorecard(plan: dict, entries: list[dict], outdir: pathlib.Path,
              comparisons: list[str]) -> pathlib.Path:
    L: list[str] = []
    A = L.append
    A("# Motion model comparison — milestone 1")
    A("")
    A(f"Listing `{plan['listing_id']}` · {plan['shot_count']} photos · "
      f"target {plan['target_duration_s']:.0f}s · "
      f"plan totals {plan['planned_duration_s']:.2f}s.")
    A("")
    A("Every backend was given the identical shot plan: same photos, same "
      "order, same camera move per photo, same per-shot length, same prompt. "
      "`kenburns` is the control — ffmpeg pan-and-zoom on the real photograph, "
      "no generated pixels, no cost. A model has to be visibly better than it "
      "to be worth paying for.")
    A("")

    A("## Cost")
    A("")
    A("| Backend | $/s | Clip lengths | Billed for a 30s walkthrough | Cost | vs control |")
    A("|---|---:|---|---:|---:|---|")
    for e in entries:
        m = e["manifest"]
        mdl = motion.MODELS[e["backend"]]
        d = mdl.get("durations")
        if not d:
            dur = "any"
        elif "choices" in d:
            dur = " or ".join(f"{c}s" for c in d["choices"])
        else:
            dur = f"{d['min']}–{d['max']}s"
        extra = ""
        if m["billed_total_s"] > m["planned_total_s"] + 0.01:
            waste = m["billed_total_s"] - m["planned_total_s"]
            extra = f" ({waste:.0f}s of it thrown away)"
        delta = "—" if m["cost_usd"] == 0 else f"+${m['cost_usd']:.2f}"
        A(f"| {e['label']} | {m['price_per_s_usd']:.4f} | {dur} | "
          f"{m['billed_total_s']:.0f}s{extra} | "
          f"${m['cost_usd']:.2f} | {delta} |")
    A("")
    A("The fixed clip length is the thing to notice. A 30-second walkthrough "
      "from 10 photos wants shots of about three seconds. Models that only "
      "generate 5s or 10s clips bill 50s for those 30s — two thirds of the "
      "spend is footage the edit trims off. Either pay it, or cut the "
      "walkthrough to six 5-second shots instead of ten 3-second ones.")
    A("")

    A("## Quality")
    A("")
    A("| Backend | Opening SSIM vs photo | Drift first→last | Worst jump | Flagged | Status |")
    A("|---|---:|---:|---:|---:|---|")
    for e in entries:
        q = e.get("qc")
        m = e["manifest"]
        status = ("simulated — no key" if m["simulated"] else
                  "measured" if q and q["measured"] else "no clips")
        if q and q["measured"]:
            A(f"| {e['label']} | {q['mean_opening_ssim']:.3f} | "
              f"{q['mean_drift_ssim']:.3f} | {q['worst_jump_ratio']:.1f}x | "
              f"{len(q['flagged_shots'])} | {status} |")
        else:
            A(f"| {e['label']} | — | — | — | — | {status} |")
    A("")
    A("What the numbers mean, and their limits, is in `qc.py`. In short: "
      "**opening SSIM** is how closely the first generated frame still "
      "matches the photograph that was handed in — the clearest sign of a "
      "model repainting a room rather than filming it. **Drift** falls as "
      "the camera moves, so it is only readable against the control on the "
      "same shot. **Jump** is the worst single-frame change relative to the "
      "typical one; a gimbal move is flat, a morph spikes.")
    A("")
    A("The control does not score 1.000 on opening SSIM because a push-in "
      "starts already slightly inside the frame. That is the floor the "
      "models are measured against, not a defect.")
    A("")

    A("## Outputs")
    A("")
    for e in entries:
        o = e.get("edit", {}).get("outputs")
        if o:
            A(f"- **{e['label']}** — "
              f"`{o['16x9']['path']}` ({o['16x9']['duration_s']:.2f}s), "
              f"`{o['9x16']['path']}` ({o['9x16']['duration_s']:.2f}s)")
        else:
            A(f"- **{e['label']}** — no clip "
              f"({e.get('edit', {}).get('reason', 'not run')})")
    for c in comparisons:
        A(f"- side by side: `{c}`")
    A("")

    A("## Where this stands")
    A("")
    rendered = [e for e in entries if e.get("edit", {}).get("ok")]
    sim = [e for e in entries if e["manifest"]["simulated"]]
    A(f"{len(rendered)} of {len(entries)} backends produced a finished 30s "
      f"clip here. " +
      (f"{len(sim)} were costed but not run, for want of an API key "
       f"({', '.join(sorted({motion.ENV_KEYS[motion.MODELS[e['backend']]['provider']] for e in sim if motion.ENV_KEYS[motion.MODELS[e['backend']]['provider']]}))}). "
       if sim else ""))
    A("")
    A("Prices are from the October 2026 public round-ups cited in "
      "`MODELS.md` and have not been confirmed against each vendor's own "
      "documentation from this machine. Confirm before quoting an agent.")
    A("")
    path = outdir / "scorecard.md"
    path.write_text("\n".join(L) + "\n")
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listing", default="fixtures/listing-demo.json")
    ap.add_argument("--photos", default="photos/demo")
    ap.add_argument("--out", default=None)
    ap.add_argument("--backends", nargs="+", default=DEFAULT_BACKENDS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--compare-shots", nargs="*", type=int, default=[3, 5])
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        print("ffmpeg is not installed", file=sys.stderr)
        return 1

    listing = json.loads(pathlib.Path(args.listing).read_text())
    outdir = pathlib.Path(args.out or f"out/{listing['listing_id']}")
    outdir.mkdir(parents=True, exist_ok=True)

    print("shot plan")
    plan = shotplan.build(listing, pathlib.Path(args.photos))
    (outdir / "shotplan.json").write_text(json.dumps(plan, indent=2) + "\n")
    print(f"  {plan['shot_count']} shots, {plan['planned_duration_s']}s\n")

    entries = []
    for backend in args.backends:
        mdl = motion.MODELS[backend]
        print(f"{mdl['label']}  [{backend}]")
        shot_dir = outdir / f"shots-{slug(backend)}"
        manifest = motion.run(plan, backend, shot_dir, args.dry_run)

        entry = {"backend": backend, "label": mdl["label"],
                 "shot_dir": str(shot_dir), "manifest": manifest}
        if not manifest["simulated"]:
            entry["edit"] = edit.build(plan, shot_dir, outdir / slug(backend))
            entry["qc"] = qc.run(plan, shot_dir)
        else:
            entry["edit"] = {"ok": False, "reason": "simulated, no clips"}
        entries.append(entry)
        print()

    comparisons = []
    for n in args.compare_shots:
        dst = outdir / f"compare-shot-{n:02d}.mp4"
        if side_by_side(entries, n, dst):
            comparisons.append(str(dst))
            print(f"side by side, shot {n}: {dst}")

    card = scorecard(plan, entries, outdir, comparisons)
    print(f"\nscorecard: {card}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
