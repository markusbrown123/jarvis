#!/usr/bin/env python3
"""Stage 3 — motion. One photo becomes a few seconds of camera movement.

Backends:
  kenburns   ffmpeg zoompan. No API, no cost, runs anywhere. The control.
  fal:<slug> an image-to-video model through fal.run (Seedance, Kling, Veo…).
  runway     Runway Gen-4 / Gen-4.5 through the Runway developer API.

Every backend writes shot-NN.mp4 plus a manifest.json with what it cost and
how long it took, so the comparison is like-for-like.

Without a key, or with --dry-run, the model backends do not call anything:
they write the exact request body they would have sent and the billed cost,
so the price of a run is known before a cent is spent.

    python3 motion.py --plan out/demo/shotplan.json --backend kenburns
    python3 motion.py --plan out/demo/shotplan.json --backend fal:seedance-2-fast --dry-run
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

FPS = 30
MASTER_W, MASTER_H = 1920, 1080

# ---------------------------------------------------------------------------
# Model registry.
#
# price_per_s and the allowed durations are from the public pricing round-ups
# cited in MODELS.md (October 2026). They have NOT been checked against each
# vendor's own docs from this machine — the sandbox proxy blocks several of
# those domains. Re-check before quoting a price to an agent.
#
# `durations` is what the model will actually generate. It is the whole cost
# story: a model that only does 5s clips bills 5s even when the shot plan
# wants 2.67s, so a 30s walkthrough from 10 photos bills 50s, not 30s.
# ---------------------------------------------------------------------------
MODELS = {
    "kenburns": {
        "label": "ffmpeg Ken Burns (control)",
        "provider": "local",
        "price_per_s": 0.0,
        "durations": None,          # any duration, exactly
        "resolution": "1080p",
        "notes": "No generated motion. Pan/zoom on the real photo; cannot "
                 "invent anything, so room consistency is perfect by "
                 "construction. The bar the models have to beat.",
    },
    "fal:seedance-2-fast": {
        "label": "Seedance 2.0 Fast",
        "provider": "fal",
        "endpoint": "https://fal.run/fal-ai/bytedance/seedance/v2/fast/image-to-video",
        "price_per_s": 0.2419,
        "durations": {"min": 3, "max": 12, "step": 1},
        "resolution": "720p",
        "notes": "Start/end-frame control; the model usually recommended for "
                 "animating a product or interior photo without restyling it.",
    },
    "fal:kling-3-pro": {
        "label": "Kling 3.0 Pro",
        "provider": "fal",
        "endpoint": "https://fal.run/fal-ai/kling-video/v3/pro/image-to-video",
        "price_per_s": 0.112,       # 1080p, 0.8 units/s at $0.14/unit
        "durations": {"choices": [5, 10]},
        "resolution": "1080p",
        "notes": "Cheapest of the three per second, but fixed 5s/10s clips, "
                 "so short shots are billed at 5s.",
    },
    "runway:gen4-turbo": {
        "label": "Runway Gen-4 Turbo",
        "provider": "runway",
        "endpoint": "https://api.dev.runwayml.com/v1/image_to_video",
        "model_id": "gen4_turbo",
        "price_per_s": 0.05,        # 5 credits/s
        "durations": {"choices": [5, 10]},
        "resolution": "720p",
        "notes": "Lowest headline price. Fixed 5s/10s, so the same 5s floor "
                 "applies.",
    },
}

ENV_KEYS = {"fal": "FAL_KEY", "runway": "RUNWAYML_API_SECRET", "local": None}


def billable_seconds(model: dict, wanted: float) -> float:
    """What the vendor actually charges for, given what the plan asked for."""
    d = model.get("durations")
    if not d:
        return round(wanted, 2)
    if "choices" in d:
        for c in sorted(d["choices"]):
            if c >= wanted - 1e-6:
                return float(c)
        return float(max(d["choices"]))
    step = d.get("step", 1)
    n = max(d["min"], min(d["max"], -(-wanted // step) * step))
    return float(n)


# ---------------------------------------------------------------------------
# ffmpeg Ken Burns
# ---------------------------------------------------------------------------
ZOOM = 1.18


def zoompan_expr(move: str, frames: int) -> tuple[str, str, str]:
    """(z, x, y) expressions. `on` is the output frame index.

    z is written out in full rather than fed back from `zoom`, so the move is
    perfectly linear and a half-second difference in duration does not change
    how far the camera travels per second.
    """
    t = f"(on/{max(frames - 1, 1)})"
    cx, cy = "(iw-iw/zoom)/2", "(ih-ih/zoom)/2"
    z_fixed = f"{ZOOM}"
    if move == "push_in":
        return (f"1+{ZOOM - 1:.3f}*{t}", cx, cy)
    if move == "pull_out":
        return (f"{ZOOM}-{ZOOM - 1:.3f}*{t}", cx, cy)
    if move == "pan_right":
        return (z_fixed, f"(iw-iw/zoom)*{t}", cy)
    if move == "pan_left":
        return (z_fixed, f"(iw-iw/zoom)*(1-{t})", cy)
    if move == "tilt_down":
        return (z_fixed, cx, f"(ih-ih/zoom)*{t}")
    if move == "tilt_up":
        return (z_fixed, cx, f"(ih-ih/zoom)*(1-{t})")
    if move == "push_in_pan":
        return (f"1+{ZOOM - 1:.3f}*{t}", f"(iw-iw/zoom)*(0.3+0.4*{t})", cy)
    return (f"1+{ZOOM - 1:.3f}*{t}", cx, cy)


def kenburns_shot(src: pathlib.Path, dst: pathlib.Path, move: str,
                  duration: float, w: int, h: int) -> None:
    frames = max(int(round(duration * FPS)), 2)
    z, x, y = zoompan_expr(move, frames)
    # Upscale well past the output first: zoompan samples at output
    # resolution, so zooming a 1080p intermediate softens the frame badly.
    vf = (
        f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,"
        f"crop={w * 2}:{h * 2},"
        f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={w}x{h}:fps={FPS},"
        f"format=yuv420p"
    )
    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-loop", "1", "-framerate", str(FPS), "-i", str(src),
           "-frames:v", str(frames), "-vf", vf,
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", str(dst)]
    subprocess.run(cmd, check=True)


# ---------------------------------------------------------------------------
# Hosted models
# ---------------------------------------------------------------------------
def data_uri(path: pathlib.Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def build_request(key: str, model: dict, shot: dict, billed: float) -> dict:
    """The request body, built the same way for dry-run and for real."""
    if model["provider"] == "fal":
        return {
            "prompt": shot["prompt"],
            "image_url": "<data-uri of " + shot["file"] + ">",
            "duration": int(billed),
            "resolution": model["resolution"],
            "generate_audio": False,
        }
    if model["provider"] == "runway":
        return {
            "model": model["model_id"],
            "promptImage": "<data-uri of " + shot["file"] + ">",
            "promptText": shot["prompt"],
            "duration": int(billed),
            "ratio": "1280:720",
        }
    raise ValueError(model["provider"])


def post_json(url: str, body: dict, headers: dict, timeout: int = 900) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def get_json(url: str, headers: dict, timeout: int = 60) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def download(url: str, dst: pathlib.Path) -> None:
    with urllib.request.urlopen(url, timeout=600) as r, open(dst, "wb") as f:
        f.write(r.read())


def hosted_shot(key: str, model: dict, shot: dict, dst: pathlib.Path,
                billed: float) -> dict:
    """Run one shot through a hosted model. Returns provider metadata."""
    provider = model["provider"]
    api_key = os.environ.get(ENV_KEYS[provider], "")
    if not api_key:
        raise RuntimeError(f"{ENV_KEYS[provider]} is not set")

    body = build_request(key, model, shot, billed)
    img = data_uri(pathlib.Path(shot["path"]))
    if provider == "fal":
        body["image_url"] = img
        headers = {"Authorization": f"Key {api_key}"}
        res = post_json(model["endpoint"], body, headers)
        url = (res.get("video") or {}).get("url") or res.get("video_url")
        if not url:
            raise RuntimeError(f"no video in fal response: {list(res)}")
        download(url, dst)
        return {"provider_response_keys": sorted(res)}

    # Runway: create a task, then poll it.
    body["promptImage"] = img
    headers = {"Authorization": f"Bearer {api_key}",
               "X-Runway-Version": "2024-11-06"}
    task = post_json(model["endpoint"], body, headers)
    task_id = task["id"]
    status_url = f"https://api.dev.runwayml.com/v1/tasks/{task_id}"
    for _ in range(240):
        time.sleep(5)
        st = get_json(status_url, headers)
        if st.get("status") == "SUCCEEDED":
            download(st["output"][0], dst)
            return {"task_id": task_id}
        if st.get("status") in ("FAILED", "CANCELLED"):
            raise RuntimeError(f"runway task {task_id}: {st.get('failure')}")
    raise RuntimeError(f"runway task {task_id} timed out")


# ---------------------------------------------------------------------------
def run(plan: dict, backend: str, outdir: pathlib.Path, dry_run: bool,
        portrait: bool = False) -> dict:
    if backend not in MODELS:
        raise SystemExit(f"unknown backend {backend!r}; "
                         f"one of: {', '.join(MODELS)}")
    model = MODELS[backend]
    outdir.mkdir(parents=True, exist_ok=True)
    w, h = (1080, 1920) if portrait else (MASTER_W, MASTER_H)

    key_name = ENV_KEYS[model["provider"]]
    have_key = model["provider"] == "local" or bool(os.environ.get(key_name or ""))
    simulate = dry_run or not have_key

    entries, cost, wall = [], 0.0, 0.0
    for shot in plan["shots"]:
        dst = outdir / f"shot-{shot['index']:02d}.mp4"
        billed = billable_seconds(model, shot["duration_s"])
        shot_cost = round(billed * model["price_per_s"], 4)
        cost += shot_cost
        entry = {
            "index": shot["index"], "file": shot["file"], "room": shot["room"],
            "move": shot["move"], "planned_s": shot["duration_s"],
            "billed_s": billed, "cost_usd": shot_cost, "output": str(dst),
        }

        t0 = time.time()
        if model["provider"] == "local":
            kenburns_shot(pathlib.Path(shot["path"]), dst, shot["move"],
                          shot["duration_s"], w, h)
            entry["status"] = "ok"
        elif simulate:
            entry["status"] = "dry-run"
            entry["request"] = build_request(backend, model, shot, billed)
            entry["output"] = None
        else:
            try:
                entry.update(hosted_shot(backend, model, shot, dst, billed))
                entry["status"] = "ok"
            except Exception as e:                       # keep the run going
                entry["status"] = "error"
                entry["error"] = f"{type(e).__name__}: {e}"
                entry["output"] = None
        entry["elapsed_s"] = round(time.time() - t0, 2)
        wall += entry["elapsed_s"]
        entries.append(entry)
        print(f"  shot {shot['index']:>2} {shot['room']:<16} "
              f"{entry['status']:<8} {entry['billed_s']:>4.1f}s billed "
              f"${shot_cost:.4f}  {entry['elapsed_s']:>6.1f}s")

    manifest = {
        "backend": backend,
        "label": model["label"],
        "provider": model["provider"],
        "resolution": model["resolution"],
        "price_per_s_usd": model["price_per_s"],
        "simulated": simulate,
        "key_present": have_key,
        "portrait": portrait,
        "shot_count": len(entries),
        "planned_total_s": round(sum(s["duration_s"] for s in plan["shots"]), 2),
        "billed_total_s": round(sum(e["billed_s"] for e in entries), 2),
        "cost_usd": round(cost, 4),
        "generation_wall_s": round(wall, 2),
        "shots": entries,
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default="out/demo/shotplan.json")
    ap.add_argument("--backend", required=True, choices=list(MODELS))
    ap.add_argument("--out")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--portrait", action="store_true")
    args = ap.parse_args()

    plan = json.loads(pathlib.Path(args.plan).read_text())
    outdir = pathlib.Path(args.out or
                          pathlib.Path(args.plan).parent /
                          ("shots-" + args.backend.replace(":", "-")))
    m = run(plan, args.backend, outdir, args.dry_run, args.portrait)
    tag = " (simulated — no key / dry run)" if m["simulated"] else ""
    print(f"\n{m['label']}: {m['billed_total_s']}s billed for "
          f"{m['planned_total_s']}s of clip, ${m['cost_usd']:.2f}{tag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
