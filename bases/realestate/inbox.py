#!/usr/bin/env python3
"""Listings dropped in the inbox become walkthroughs on their own.

    python3 inbox.py            # render whatever is ready, once
    python3 inbox.py --json     # the same, one JSON line per listing (JARVIS reads these)

The inbox is WALKTHROUGH_INBOX, else ~/RealEstate/Inbox. Each folder in it is
one listing: its photos, and optionally a listing.json. A folder is ready
once it holds at least 3 photos and nothing in it has changed for
WALKTHROUGH_SETTLE_MIN minutes (default 5), so a half-copied folder isn't
rendered. Each listing is rendered once, into <listing>/walkthrough/;
adding or changing photos renders it again. One that failed is retried only
when its photos change.

The free Ken Burns cut unless WALKTHROUGH_BACKEND names a model (e.g.
higgsfield:dop-turbo); a paid model never spends more than
WALKTHROUGH_MAX_SPEND dollars a listing (default 5), and never runs with its
price unset (HF_USD_PER_CLIP). Nothing is sent to anyone.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import pathlib
import sys
import time

import motion
import walkthrough

INBOX = pathlib.Path(os.environ.get("WALKTHROUGH_INBOX",
                                    "~/RealEstate/Inbox")).expanduser()
SETTLE_S = float(os.environ.get("WALKTHROUGH_SETTLE_MIN", "5")) * 60
BACKEND = os.environ.get("WALKTHROUGH_BACKEND", "kenburns")
MAX_SPEND = float(os.environ.get("WALKTHROUGH_MAX_SPEND", "5"))


def newest_change(folder: pathlib.Path) -> float:
    times = [p.stat().st_mtime for p in folder.iterdir()
             if p.is_file() and not p.name.startswith(".")]
    return max(times, default=0)


def state_of(folder: pathlib.Path) -> tuple[str, dict | None]:
    """waiting (not ready yet), done (rendered for these photos), failed, or ready."""
    try:
        photos = walkthrough.photos_in(folder)
    except OSError:
        return "waiting", None
    if len(photos) < 3:
        return "waiting", None
    if time.time() - newest_change(folder) < SETTLE_S:
        return "waiting", None
    fp = walkthrough.fingerprint(
        photos + [p for p in [folder / "listing.json"] if p.exists()])
    res_file = folder / "walkthrough" / "result.json"
    if res_file.exists():
        prev = json.loads(res_file.read_text())
        if prev.get("fingerprint") == fp and prev.get("backend") == BACKEND:
            return ("done" if prev.get("ok") else "failed"), prev
    return "ready", None


@contextlib.contextmanager
def lock():
    """One run at a time: JARVIS calls this every few minutes."""
    path = INBOX / ".inbox.lock"
    if path.exists():
        try:
            pid = int(path.read_text())
            os.kill(pid, 0)
            yield False
            return
        except (ValueError, ProcessLookupError, PermissionError):
            pass
    path.write_text(str(os.getpid()))
    try:
        yield True
    finally:
        path.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    say = (lambda d: print(json.dumps(d), flush=True)) if args.json else \
        (lambda d: print(f"{d['listing']:<32} {d['status']}"
                         + (f"  {d['result']['review']}" if d.get("result") else "")))

    if BACKEND not in motion.MODELS:
        print(f"WALKTHROUGH_BACKEND={BACKEND} isn't one of: {', '.join(motion.MODELS)}",
              file=sys.stderr)
        return 2
    if not INBOX.is_dir():
        if not args.json:
            print(f"no inbox at {INBOX} (make it, or set WALKTHROUGH_INBOX)")
        return 0

    with lock() as mine:
        if not mine:
            return 0
        for folder in sorted(p for p in INBOX.iterdir()
                             if p.is_dir() and not p.name.startswith(".")):
            status, prev = state_of(folder)
            if status != "ready":
                say({"listing": folder.name, "status": status,
                     **({"result": prev} if prev and status == "done" else {})})
                continue
            spend = MAX_SPEND if motion.MODELS[BACKEND]["provider"] != "local" else None
            log = io.StringIO()
            try:
                # The pipeline's progress goes to a log beside the cut, not the JSON stream.
                with contextlib.redirect_stdout(log):
                    result = walkthrough.render(folder, BACKEND, spend)
                status = "rendered" if result["ok"] else "failed"
            except (Exception, SystemExit) as e:          # one bad listing doesn't stop the rest
                status = "failed"
                result = {"ok": False, "reason": f"{type(e).__name__}: {e}",
                          "backend": BACKEND, "finished_at": int(time.time()),
                          "fingerprint": walkthrough.fingerprint(walkthrough.photos_in(folder)
                                                                 + [p for p in [folder / "listing.json"] if p.exists()])}
                out = folder / "walkthrough"
                out.mkdir(exist_ok=True)
                (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
            (folder / "walkthrough" / "render.log").write_text(log.getvalue())
            say({"listing": folder.name, "status": status, "result": result})
    return 0


if __name__ == "__main__":
    sys.exit(main())
