#!/usr/bin/env python3
"""Start a new script from templates/script.md.

    python3 tools/new_script.py plumber-site --series redesign --number 01 --title "A plumber's site, rebuilt"

Creates scripts/<slug>/script.md. Refuses to overwrite an existing script.
"""
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", help="folder name, lowercase letters, digits and dashes")
    ap.add_argument("--series", choices=["build-log", "redesign"], default="build-log")
    ap.add_argument("--number", default="TODO")
    ap.add_argument("--title", default=None)
    ap.add_argument("--minutes", default="6")
    a = ap.parse_args()
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", a.slug):
        print("slug must be lowercase letters, digits and single dashes", file=sys.stderr)
        return 2
    dest = ROOT / "scripts" / a.slug / "script.md"
    if dest.exists():
        print(f"{dest} already exists; not overwriting", file=sys.stderr)
        return 1
    text = (ROOT / "templates" / "script.md").read_text()
    text = text.replace("series: build-log          # build-log | redesign",
                        f"series: {a.series}          # build-log | redesign")
    text = text.replace("number: TODO ", f"number: {a.number} ", 1)
    text = text.replace("target_minutes: 6 ", f"target_minutes: {a.minutes} ", 1)
    if a.title:
        text = re.sub(r"^title: .*$", f"title: {a.title}", text, count=1, flags=re.M)
    dest.parent.mkdir(parents=True)
    dest.write_text(text)
    print(dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
