#!/usr/bin/env python3
"""A folder of listing photos in, a finished walkthrough out — one command.

    python3 walkthrough.py ~/RealEstate/Inbox/elm-road
    python3 walkthrough.py ~/RealEstate/Inbox/elm-road \
        --backend higgsfield:dop-turbo --max-spend 5

The folder holds the photos, played in file-name order, and optionally a
listing.json (the shape of fixtures/listing-demo.json) for the address, the
agent's branding and the room of each photo. Without one, rooms are read
from the file names ("03-kitchen.jpg"); iPhone HEIC photos are converted
with macOS `sips`.

Writes <folder>/walkthrough/ (or --out): both cuts, a thumbnail, qc.json,
result.json, and review.html — the cuts, the cost and anything QC flagged,
for Markus to look at before anything goes to an agent. Nothing is sent.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time

import edit
import motion
import qc
import shotplan

PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}
HEIC_EXT = {".heic", ".heif"}

# Room from a file name: the first rule whose word appears wins.
ROOM_WORDS = [
    ("exterior front", ("exterior", "front", "facade", "outside", "street", "curb")),
    ("garden", ("garden", "backyard", "yard", "patio", "pool", "deck", "terrace", "rear")),
    ("hallway", ("hall", "entry", "foyer", "entrance", "stair")),
    ("kitchen", ("kitchen",)),
    ("dining area", ("dining",)),
    ("living room", ("living", "lounge", "family", "sitting", "great")),
    ("bathroom", ("bath", "ensuite", "shower", "toilet", "powder")),
    ("main bedroom", ("primary", "master", "main")),
    ("bedroom", ("bed",)),
]
HERO_ROOMS = {"exterior front", "living room", "kitchen", "main bedroom", "garden"}


def natural(name: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def room_of(name: str) -> str:
    words = name.lower()
    for room, keys in ROOM_WORDS:
        if any(k in words for k in keys):
            return room
    return "room"


def photos_in(folder: pathlib.Path) -> list[pathlib.Path]:
    """The listing's photos, HEIC converted to JPEG (on a Mac) alongside."""
    out = []
    for p in sorted(folder.iterdir(), key=lambda p: natural(p.name)):
        ext = p.suffix.lower()
        if p.name.startswith(".") or not p.is_file():
            continue
        if ext in PHOTO_EXT:
            out.append(p)
        elif ext in HEIC_EXT:
            conv = folder / ".converted" / (p.stem + ".jpg")
            if not conv.exists() and shutil.which("sips"):
                conv.parent.mkdir(exist_ok=True)
                subprocess.run(["sips", "-s", "format", "jpeg", str(p), "--out",
                                str(conv)], capture_output=True)
            if conv.exists():
                out.append(conv)
            else:
                print(f"  ! {p.name}: HEIC needs macOS sips to convert; skipped")
    return out


def listing_for(folder: pathlib.Path, photos: list[pathlib.Path]) -> dict:
    """listing.json if there is one; otherwise one read from the file names."""
    given = folder / "listing.json"
    if given.exists():
        listing = json.loads(given.read_text())
        listing.setdefault("listing_id", folder.name)
        return listing
    shots, beds = [], 0
    for p in photos:
        room = room_of(p.stem)
        if room == "bedroom":
            room = "main bedroom" if beds == 0 else "second bedroom"
        if "bedroom" in room:
            beds += 1
        shots.append({"file": str(p.relative_to(folder)), "room": room})
    seen = set()
    for i, s in enumerate(shots):
        if i == 0 or (s["room"] in HERO_ROOMS and s["room"] not in seen):
            s["hero"] = True
        seen.add(s["room"])
    return {
        "listing_id": re.sub(r"[^a-z0-9]+", "-", folder.name.lower()).strip("-"),
        "address_line": folder.name,
        "target_duration_s": min(max(3 * len(shots), 15), 60),
        "shots": shots,
    }


def fingerprint(paths: list[pathlib.Path]) -> str:
    h = hashlib.sha256()
    for p in paths:
        st = p.stat()
        h.update(f"{p.name}:{st.st_size}:{int(st.st_mtime)}\n".encode())
    return h.hexdigest()[:16]


def review_page(out: pathlib.Path, listing: dict, plan: dict, manifest: dict,
                cut: dict, checks: dict) -> pathlib.Path:
    """One page for Markus: both cuts, what it cost, what QC flagged."""
    e = html.escape
    by_index = {s["index"]: s for s in checks.get("shots", [])}
    rows = []
    for s, m in zip(plan["shots"], manifest["shots"]):
        q = by_index.get(s["index"], {})
        flags = "; ".join(q.get("flags", [])) or ("ok" if q else "—")
        rows.append(f"<tr><td>{s['index']}</td><td>{e(s['room'])}</td><td>{e(s['move'])}</td>"
                    f"<td>{s['duration_s']:.1f}s</td><td>{e(m['status'])}</td><td>{e(flags)}</td></tr>")
    cost = ("price not set" if manifest["cost_usd"] is None
            else f"${manifest['cost_usd']:.2f}")
    videos = ""
    if cut.get("ok"):
        videos = (
            '<div class="cuts"><figure><video controls playsinline preload="metadata" '
            'poster="thumbnail.jpg" src="walkthrough-16x9.mp4"></video><figcaption>16:9 — '
            'listing, YouTube</figcaption></figure><figure class="tall"><video controls '
            'playsinline preload="metadata" src="walkthrough-9x16.mp4"></video><figcaption>'
            '9:16 — Instagram, TikTok</figcaption></figure></div>')
    else:
        videos = f'<p class="warn">No cut: {e(cut.get("reason", "the clips did not render"))}</p>'
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(listing.get('address_line') or listing['listing_id'])} — walkthrough review</title>
<style>
:root {{ color-scheme: dark; --bg:#0b1220; --card:#121b2e; --line:#22314d; --text:#e8eefc; --muted:#93a4c3; --ok:#4ade80; --warn:#fbbf24; }}
* {{ box-sizing: border-box; }}
body {{ margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,sans-serif; }}
main {{ max-width:960px; margin:0 auto; }}
h1 {{ margin:0 0 4px; font-size:24px; }}
.meta {{ color:var(--muted); margin:0 0 20px; }}
.cuts {{ display:grid; grid-template-columns:minmax(0,3fr) minmax(0,1fr); gap:16px; align-items:start; }}
figure {{ margin:0; }} video {{ width:100%; border-radius:12px; background:#000; }}
figcaption {{ color:var(--muted); font-size:13px; margin-top:6px; }}
table {{ width:100%; border-collapse:collapse; margin-top:24px; font-size:14px; }}
th, td {{ text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); }}
th {{ color:var(--muted); font-weight:500; }}
.next {{ margin-top:24px; padding:14px 16px; border:1px solid var(--line); border-radius:12px; background:var(--card); }}
.warn {{ color:var(--warn); }}
@media (max-width:640px) {{ .cuts {{ grid-template-columns:1fr; }} .tall {{ max-width:260px; }} table {{ font-size:13px; }} }}
</style></head><body><main>
<h1>{e(listing.get('address_line') or listing['listing_id'])}</h1>
<p class="meta">{e(manifest['label'])} · {plan['shot_count']} shots · {plan['planned_duration_s']:.0f}s · cost {cost}{' · simulated, no clips' if manifest['simulated'] else ''}</p>
{videos}
<table><thead><tr><th>#</th><th>Room</th><th>Move</th><th>Length</th><th>Clip</th><th>QC</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<div class="next"><b>Before it goes to the agent:</b> watch both cuts for rooms that change, warped lines or anything added. Nothing has been sent. Anything AI-made is said to be, to the agent and wherever the platform or MLS requires it.</div>
</main></body></html>
"""
    path = out / "review.html"
    path.write_text(page)
    return path


def render(folder: pathlib.Path, backend: str = "kenburns",
           max_spend: float | None = None, out: pathlib.Path | None = None) -> dict:
    folder = folder.expanduser().resolve()
    out = (out or folder / "walkthrough").expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    photos = photos_in(folder)
    if len(photos) < 3:
        raise SystemExit(f"{folder}: {len(photos)} photo(s); a walkthrough needs at least 3")
    listing = listing_for(folder, photos)
    fp = fingerprint(photos + [p for p in [folder / "listing.json"] if p.exists()])

    plan = shotplan.build(listing, folder)
    (out / "shotplan.json").write_text(json.dumps(plan, indent=2) + "\n")

    # Clips are cached by shot number: a different set of photos must not
    # reuse them (they'd be the wrong rooms).
    shots_dir = out / f"shots-{backend.replace(':', '-')}"
    stamp = shots_dir / "photos.txt"
    if shots_dir.exists() and (not stamp.exists() or stamp.read_text() != fp):
        shutil.rmtree(shots_dir)
    shots_dir.mkdir(parents=True, exist_ok=True)
    stamp.write_text(fp)

    print(f"{listing['listing_id']}: {plan['shot_count']} shots, "
          f"{plan['planned_duration_s']}s, {backend}")
    manifest = motion.run(plan, backend, shots_dir, dry_run=False,
                          max_spend=max_spend)
    cut = ({"ok": False, "reason": "simulated: no key for " + backend}
           if manifest["simulated"] else edit.build(plan, shots_dir, out))
    stuck = [s for s in manifest["shots"] if s["status"] in ("unpriced", "over-cap", "error")]
    if not cut.get("ok") and stuck:
        why = stuck[0].get("error") or f"spending cap of ${max_spend:.2f} reached"
        cut["reason"] = f"{len(stuck)} shot(s) not made — {why}"
    checks = qc.run(plan, shots_dir) if cut.get("ok") else {}
    if checks:
        (out / "qc.json").write_text(json.dumps(checks, indent=2) + "\n")
    page = review_page(out, listing, plan, manifest, cut, checks)

    flagged = [s for s in checks.get("shots", []) if s.get("flags")]
    result = {
        "listing_id": listing["listing_id"],
        "address": listing.get("address_line"),
        "folder": str(folder),
        "fingerprint": fp,
        "backend": backend,
        "ok": bool(cut.get("ok")),
        "reason": None if cut.get("ok") else cut.get("reason"),
        "simulated": manifest["simulated"],
        "cost_usd": manifest["cost_usd"],
        "spent_usd": manifest["spent_usd"],
        "shots": plan["shot_count"],
        "duration_s": plan["planned_duration_s"],
        "qc_flagged": len(flagged),
        "review": str(page),
        "outputs": {k: (v["path"] if isinstance(v, dict) else v)
                    for k, v in cut.get("outputs", {}).items()},
        "finished_at": int(time.time()),
    }
    (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--backend", default="kenburns", choices=list(motion.MODELS))
    ap.add_argument("--max-spend", type=float, default=None,
                    help="dollars; never pay for more than this in this run")
    ap.add_argument("--out")
    args = ap.parse_args()
    if not shutil.which("ffmpeg"):
        print("ffmpeg is not installed (brew install ffmpeg)", file=sys.stderr)
        return 1
    r = render(pathlib.Path(args.folder), args.backend, args.max_spend,
               pathlib.Path(args.out) if args.out else None)
    print(f"\n{'done' if r['ok'] else 'not rendered'}: {r['review']}")
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
