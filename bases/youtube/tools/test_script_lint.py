#!/usr/bin/env python3
"""Self-test for script_lint.py: the good fixture passes and each known mistake is caught.

    python3 tools/test_script_lint.py
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LINT = ROOT / "tools" / "script_lint.py"
GOOD = (ROOT / "tools" / "fixtures" / "ok.md").read_text()

CASES = [  # (what is broken, edit, text the report must contain)
    ("greeting hook", ("This page did not exist four hours ago.", "Hey, welcome to the channel, this page did not exist four hours ago."), "greeting"),
    ("banned phrase", ("Next week the same pipeline", "In today's video, next week the same pipeline"), "banned phrase"),
    ("undefined source", ("before writing anything. [S1]", "before writing anything. [S9]"), "no S9 is defined"),
    ("no number sourced", ("It read eleven files before writing anything. [S1]", "It read 11 files before writing anything."), "no [S#] tag"),  # a warning, not an error
    ("duplicate break", ("## NEXT", "## THE BREAK"), "appears 2 times"),
    ("voice without picture", ("SCREEN: The finished page loading in a browser\n", ""), "no SCREEN"),
    ("todo left in", ("One folder, one rule", "TODO one folder, one rule"), "placeholder"),
    ("bad source", ("S1: first-party | fixture only, nothing real", "S1: someone said so"), "must start with"),
    ("hook too long", ("Nobody typed it.", "Nobody typed it, and nobody checked it, and nobody was awake while the machine kept going through every file in the folder until it ran out of things to read."), "hook is"),
]


def run(text: str) -> tuple[int, str]:
    p = ROOT / "out" / "_lint_test.md"
    p.parent.mkdir(exist_ok=True)
    p.write_text(text)
    r = subprocess.run([sys.executable, str(LINT), str(p)], capture_output=True, text=True)
    p.unlink()
    return r.returncode, r.stdout + r.stderr


def main() -> int:
    bad = 0
    code, out = run(GOOD)
    print(("ok   " if code == 0 else "FAIL ") + "good fixture passes")
    bad += code != 0
    for name, (a, b), expect in CASES:
        assert a in GOOD, f"test setup: '{a}' not in fixture"
        code, out = run(GOOD.replace(a, b, 1))
        hit = (code == 1 or "WARN" in out and expect in out) and expect in out
        print(("ok   " if hit else "FAIL ") + f"catches: {name}")
        if not hit:
            bad += 1
            print(out)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
