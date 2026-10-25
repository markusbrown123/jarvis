#!/usr/bin/env python3
"""Check a script against the channel's template, and hand it to the next stages.

    python3 tools/script_lint.py scripts/<slug>/script.md           # report only
    python3 tools/script_lint.py scripts/<slug>/script.md --emit    # also write out/scripts/<slug>/

Exit code 0 = no errors (warnings allowed), 1 = errors. --emit refuses to write while there
are errors. The rules and the reasons for each are in SCRIPT.md.

Emitted files (out/scripts/<slug>/):
  voice.txt        narration only, tags removed, one paragraph per beat - for the voice stage
  shots.json       every shot with beat, picture, voice, estimated start/length, sources
  description.txt  summary slot, estimated chapters, sources, tools, disclosure, standing footer
Timings are estimates from word count; the voice stage re-times them from the real audio.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from dataclasses import dataclass, field

ROOT = pathlib.Path(__file__).resolve().parent.parent

BANNED = [  # BRAND.md "Words" plus the filler that makes a channel read as templated
    "in today's video", "in this video", "insane", "crazy", "game-changer", "game changer",
    "mind-blowing", "you won't believe", "smash that", "like and subscribe",
    "don't forget to subscribe", "without further ado", "welcome back", "hey guys",
    "let's dive in", "let's jump in", "buckle up",
]
BEAT_ORDER = ["HOOK", "PROMISE", "STEP", "THE BREAK", "PAYOFF", "NEXT"]
SERIES = {"build-log", "redesign"}
SYNTH = {"none", "voice", "footage", "voice+footage"}
FOOTER = (
    "Built by a pipeline that researches, writes, voices, edits and thumbnails each video;\n"
    "every build in it is real and the code is mine. Narration is a synthetic voice."
)
TAG = re.compile(r"\[(S\d+)\]")


@dataclass
class Shot:
    beat: str
    line: int
    screen: str = ""
    vo: list[str] = field(default_factory=list)
    on_screen: str = ""
    dur: float = 0.0
    has_screen: bool = True

    @property
    def vo_text(self) -> str:
        return " ".join(self.vo).strip()

    def words(self) -> int:
        return len(re.findall(r"[\w'’$£%.,-]+", TAG.sub("", self.vo_text)))


@dataclass
class Beat:
    name: str  # normalised: HOOK, STEP, ...
    title: str  # as written
    line: int
    shots: list[Shot] = field(default_factory=list)


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, line: int | None, msg: str) -> None:
        self.errors.append(f"line {line}: {msg}" if line else msg)

    def warn(self, line: int | None, msg: str) -> None:
        self.warnings.append(f"line {line}: {msg}" if line else msg)


def parse(text: str, rep: Report):
    lines = text.splitlines()
    meta: dict[str, str] = {}
    i = 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            m = re.match(r"^(\w+):\s*(.*?)(?:\s+#.*)?$", lines[i])
            if m:
                meta[m.group(1)] = m.group(2).strip()
            i += 1
        i += 1
    else:
        rep.err(1, "missing front matter (--- ... ---)")

    beats: list[Beat] = []
    sources: dict[str, tuple[int, str]] = {}
    cur_beat: Beat | None = None
    cur_shot: Shot | None = None
    in_sources = False
    in_comment = False
    last_field = None  # 'vo' | 'screen' | 'on' | None

    for n in range(i, len(lines)):
        ln = n + 1
        raw = lines[n]
        s = raw.strip()
        if in_comment:
            if "-->" in s:
                in_comment = False
            continue
        if s.startswith("<!--"):
            if "-->" not in s:
                in_comment = True
            continue
        if not s:
            last_field = None
            continue
        if s.startswith("## "):
            title = s[3:].strip()
            norm = title.split(":")[0].strip().upper()
            if re.fullmatch(r"STEP\s*\d+", norm):
                norm = "STEP"
            in_sources = norm == "SOURCES"
            cur_shot = None
            last_field = None
            if in_sources:
                cur_beat = None
            else:
                if norm not in BEAT_ORDER:
                    rep.err(ln, f"unknown beat '{title}' (expected {', '.join(BEAT_ORDER)} or SOURCES)")
                cur_beat = Beat(norm, title, ln)
                beats.append(cur_beat)
            continue
        if in_sources:
            m = re.match(r"^(S\d+):\s*(.+)$", s)
            if m:
                if m.group(1) in sources:
                    rep.err(ln, f"{m.group(1)} defined twice")
                sources[m.group(1)] = (ln, m.group(2))
            else:
                rep.err(ln, f"unreadable source line: {s[:60]}")
            continue
        if cur_beat is None:
            rep.err(ln, "text before the first '## ' beat")
            continue
        m = re.match(r"^(SCREEN|VO|ON-SCREEN|DUR|NOTE):\s*(.*)$", s)
        if m:
            key, val = m.group(1), m.group(2)
            if key == "NOTE":
                last_field = None
                continue
            if key == "SCREEN":
                cur_shot = Shot(cur_beat.name, ln, screen=val)
                cur_beat.shots.append(cur_shot)
                last_field = "screen"
                continue
            if cur_shot is None:
                cur_shot = Shot(cur_beat.name, ln, has_screen=False)
                cur_beat.shots.append(cur_shot)
            if key == "VO":
                cur_shot.vo.append(val)
                last_field = "vo"
            elif key == "ON-SCREEN":
                cur_shot.on_screen = val
                last_field = "on"
            elif key == "DUR":
                try:
                    cur_shot.dur = float(val.rstrip("s "))
                except ValueError:
                    rep.err(ln, f"DUR must be seconds, got '{val}'")
                last_field = None
            continue
        # continuation line
        if cur_shot is not None and last_field == "vo":
            cur_shot.vo.append(s)
        elif cur_shot is not None and last_field == "screen":
            cur_shot.screen += " " + s
        else:
            rep.err(ln, f"line is not SCREEN:, VO:, ON-SCREEN:, DUR: or NOTE: -> {s[:60]}")
    return meta, beats, sources


def fmt(sec: float) -> str:
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def check(meta, beats, sources, rep: Report, text: str):
    # --- front matter
    for k in ("title", "series", "number", "target_minutes", "voice_wpm", "synthetic",
              "studio_ai_toggle", "tools"):
        if k not in meta or not meta[k]:
            rep.err(None, f"front matter is missing '{k}'")
    if meta.get("series") and meta["series"] not in SERIES:
        rep.err(None, f"series must be one of {sorted(SERIES)}")
    if meta.get("synthetic") and meta["synthetic"] not in SYNTH:
        rep.err(None, f"synthetic must be one of {sorted(SYNTH)}")
    if meta.get("studio_ai_toggle") and meta["studio_ai_toggle"] not in ("yes", "no"):
        rep.err(None, "studio_ai_toggle must be yes or no")
    if meta.get("title") and len(meta["title"]) > 70 and "TODO" not in meta["title"]:
        rep.warn(None, f"title is {len(meta['title'])} characters; YouTube cuts titles near 60-70")
    try:
        target = float(meta.get("target_minutes", ""))
    except ValueError:
        target = 0.0
    try:
        wpm = float(meta.get("voice_wpm", "150"))
    except ValueError:
        wpm = 150.0
        rep.err(None, "voice_wpm must be a number")

    # --- placeholders
    for n, line in enumerate(text.splitlines(), 1):
        if re.search(r"\bTODO\b|\bXXX\b|\bTBD\b|\[\.\.\.\]|\.\.\.\]", line) and not line.strip().startswith("<!--"):
            if "TODO" in line and line.strip().startswith("#"):
                continue
            rep.err(n, f"unfinished placeholder: {line.strip()[:70]}")

    # --- structure
    names = [b.name for b in beats]
    order_idx = [BEAT_ORDER.index(n) for n in names if n in BEAT_ORDER]
    if order_idx != sorted(order_idx):
        rep.err(None, "beats are out of order; expected HOOK, PROMISE, STEP..., THE BREAK, PAYOFF, NEXT")
    for need in ("HOOK", "PROMISE", "THE BREAK", "PAYOFF", "NEXT"):
        c = names.count(need)
        if c == 0:
            rep.err(None, f"missing beat: {need}")
        elif c > 1:
            rep.err(None, f"beat {need} appears {c} times")
    steps = [b for b in beats if b.name == "STEP"]
    if len(steps) < 2:
        rep.err(None, f"needs at least 2 STEP beats (has {len(steps)}); 3-6 is the aim")
    elif len(steps) > 7:
        rep.warn(None, f"{len(steps)} steps is a lot; merge or cut so each one earns a lower third")
    for b in beats:
        if not b.shots:
            rep.err(b.line, f"beat '{b.title}' has no shots")
    for b in steps:
        if ":" not in b.title or not b.title.split(":", 1)[1].strip():
            rep.err(b.line, "STEP needs a name, e.g. '## STEP 1: Pointing it at the repo' (it becomes the lower third)")

    # --- shots
    all_shots = [s for b in beats for s in b.shots]
    for s in all_shots:
        if not s.has_screen:
            rep.err(s.line, "voice or text with no SCREEN: line above it; every line of narration needs a picture")
        elif not s.screen.strip():
            rep.err(s.line, "empty SCREEN:")
        if not s.vo_text and s.dur <= 0:
            rep.err(s.line, "shot has no VO and no DUR; it has no length")
        if s.words() > 28:
            rep.warn(s.line, f"{s.words()} words (~{s.words() / wpm * 60:.0f} s) on one picture; change the picture about every 10 s")

    # --- timing
    t = 0.0
    beat_time: dict[str, float] = {}
    vo_total = 0.0
    for b in beats:
        bt = 0.0
        for s in b.shots:
            v = s.words() / wpm * 60
            vo_total += v
            d = max(v + (0.4 if s.vo else 0), s.dur)
            s.start, s.length = t + bt, d  # type: ignore[attr-defined]
            bt += d
        beat_time[b.name] = beat_time.get(b.name, 0) + bt
        t += bt
    total = t
    if target and total:
        lo, hi = target * 60 * 0.8, target * 60 * 1.2
        if not lo <= total <= hi:
            rep.warn(None, f"estimated runtime {fmt(total)} is outside +/-20% of the {target:g}-minute target")
    if total and vo_total / total > 0.95:
        rep.warn(None, "narration fills almost the whole runtime; leave room for work shown without commentary (DUR: shots)")

    hook = next((b for b in beats if b.name == "HOOK"), None)
    if hook:
        hw = sum(s.words() for s in hook.shots)
        if hw > 45:
            rep.err(hook.line, f"hook is {hw} words; the limit is 45, the aim is 35 or fewer")
        elif hw > 35:
            rep.warn(hook.line, f"hook is {hw} words; aim for 35 or fewer")
        if beat_time.get("HOOK", 0) > 20:
            rep.err(hook.line, f"hook runs about {beat_time['HOOK']:.0f} s; the limit is 20, the aim is 15")
        hv = " ".join(s.vo_text for s in hook.shots)
        if not re.search(r"\d", hv):
            rep.warn(hook.line, "hook has no number; the format promises a concrete one (hours, files, cost)")
        first = TAG.sub("", hv).strip().lower()
        if re.match(r"^(hi|hello|hey|welcome|so|today|in this)\b", first):
            rep.err(hook.line, "hook opens with a greeting or throat-clearing; open on the result")
    for name, cap in (("PROMISE", 25), ("NEXT", 20)):
        if beat_time.get(name, 0) > cap:
            rep.warn(None, f"{name} runs about {beat_time[name]:.0f} s; keep it under {cap}")
    brk = beat_time.get("THE BREAK", 0)
    if total and "THE BREAK" in names:
        share = brk / total
        if share < 0.08:
            rep.warn(None, f"THE BREAK is {share:.0%} of the runtime; it is the content, give it at least a tenth")

    # --- words
    full_vo = " ".join(s.vo_text for s in all_shots).lower()
    for phrase in BANNED:
        if phrase in full_vo:
            for s in all_shots:
                if phrase in s.vo_text.lower():
                    rep.err(s.line, f"banned phrase: '{phrase}' (BRAND.md, Words)")
    for s in all_shots:
        for sent in re.split(r"(?<=[.!?])\s+", TAG.sub("", s.vo_text)):
            w = len(sent.split())
            if w > 28:
                rep.warn(s.line, f"sentence of {w} words; short sentences read better aloud")
        if re.search(r"[A-Z]{4,}(?!\w)", TAG.sub("", s.vo_text)) and re.search(r"\b[A-Z]{5,}\b", s.vo_text):
            rep.warn(s.line, "ALL-CAPS word in narration; the voice may spell it out or shout it")

    # --- sources
    used: set[str] = set()
    for s in all_shots:
        tags = set(TAG.findall(s.vo_text))
        used |= tags
        for tg in tags:
            if tg not in sources:
                rep.err(s.line, f"cites {tg} but no {tg} is defined under SOURCES")
        figures = re.search(r"\d|\$|£|%", TAG.sub("", s.vo_text))
        if figures and not tags:
            rep.warn(s.line, "figures in narration with no [S#] tag; every number needs a source (first-party counts)")
    for k, (ln, val) in sources.items():
        parts = [p.strip() for p in val.split("|")]
        if parts[0] == "first-party":
            if len(parts) < 2 or not parts[1]:
                rep.err(ln, f"{k}: first-party needs a pointer, e.g. 'first-party | repo path or commit'")
        elif parts[0].startswith("http"):
            if not parts[0].startswith("https://"):
                rep.warn(ln, f"{k}: use https")
            if len(parts) < 3:
                rep.err(ln, f"{k}: URL sources need 'url | page title | accessed YYYY-MM-DD'")
        elif "TODO" not in val:
            rep.err(ln, f"{k}: must start with 'first-party' or an https URL")
        if k not in used:
            rep.warn(ln, f"{k} is defined but nothing cites it")

    # --- disclosure
    if meta.get("synthetic") in ("footage", "voice+footage") and meta.get("studio_ai_toggle") == "no":
        rep.warn(None, "generated footage is used but studio_ai_toggle is 'no'; tick YouTube's altered/synthetic setting if any of it looks real")

    return all_shots, total


def emit(slug: str, meta, beats, sources, shots, total):
    out = ROOT / "out" / "scripts" / slug
    out.mkdir(parents=True, exist_ok=True)

    paras = []
    for b in beats:
        p = " ".join(TAG.sub("", s.vo_text).strip() for s in b.shots if s.vo_text)
        p = re.sub(r"\s+", " ", re.sub(r"\s+([.,!?])", r"\1", p)).strip()
        if p:
            paras.append(p)
    (out / "voice.txt").write_text("\n\n".join(paras) + "\n")

    rows = []
    n = 0
    for b in beats:
        for s in b.shots:
            n += 1
            lt = None
            if b.name == "STEP":
                num = re.search(r"\d+", b.title.split(":")[0])
                lt = {"step": int(num.group()) if num else None, "name": b.title.split(":", 1)[1].strip()}
            rows.append({
                "id": n, "beat": b.name, "beat_title": b.title, "screen": s.screen.strip(),
                "on_screen": s.on_screen or None, "vo": TAG.sub("", s.vo_text).replace("  ", " ").strip(),
                "sources": sorted(set(TAG.findall(s.vo_text))), "lower_third": lt,
                "est_start": round(s.start, 1), "est_length": round(s.length, 1),
            })
    (out / "shots.json").write_text(json.dumps(
        {"meta": meta, "estimated_runtime_s": round(total, 1), "timing": "estimated from word count; re-time from the voice audio",
         "shots": rows}, indent=2) + "\n")

    chapters = ["0:00 " + ("Intro" if beats else "")]
    first_step_start = {}
    for b in beats:
        if b.shots:
            first_step_start[b.title] = b.shots[0].start
    for b in beats:
        if b.name == "STEP":
            chapters.append(f"{fmt(first_step_start[b.title])} {b.title.split(':', 1)[1].strip()}")
        elif b.name in ("THE BREAK", "PAYOFF"):
            chapters.append(f"{fmt(first_step_start[b.title])} {'What broke' if b.name == 'THE BREAK' else 'The result'}")
    src_lines = []
    for k, (_, v) in sorted(sources.items(), key=lambda kv: int(kv[0][1:])):
        parts = [p.strip() for p in v.split("|")]
        if parts[0] == "first-party":
            src_lines.append(f"- My own work: {parts[1]}")
        else:
            src_lines.append(f"- {parts[1]}: {parts[0]} (accessed {parts[2].replace('accessed', '').strip()})")
    synth = meta.get("synthetic", "voice")
    disclosure = {"none": "", "voice": "Narration is a synthetic voice.",
                  "footage": "Some footage is AI-generated.",
                  "voice+footage": "Narration is a synthetic voice and some footage is AI-generated."}[synth]
    footer = FOOTER if synth != "none" else FOOTER.split("\n")[0].replace(" Narration is a synthetic voice.", "")
    desc = [
        f"{meta.get('title', '')}", "",
        "SUMMARY: (two sentences, written after the edit; no claim not in the video)", "",
        "Chapters (estimated; re-time after the voice stage):", *chapters, "",
        footer, "", "Sources for this video:", *(src_lines or ["- (none)"]), "",
        f"Tools used: {meta.get('tools', '')}",
    ]
    if disclosure and disclosure not in footer:
        desc += ["", disclosure]
    (out / "description.txt").write_text("\n".join(desc) + "\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("script")
    ap.add_argument("--emit", action="store_true")
    a = ap.parse_args()
    path = pathlib.Path(a.script)
    text = path.read_text()
    rep = Report()
    meta, beats, sources = parse(text, rep)
    shots, total = check(meta, beats, sources, rep, text)

    words = sum(s.words() for s in shots)
    print(f"{path}: {words} spoken words, ~{fmt(total)} estimated runtime, "
          f"{len(sources)} sources, {len(shots)} shots")
    for b in beats:
        bt = sum(getattr(s, 'length', 0) for s in b.shots)
        print(f"  {b.title:<40} {fmt(bt)}")
    for w in rep.warnings:
        print("WARN ", w)
    for e in rep.errors:
        print("ERROR", e)
    print(f"{len(rep.errors)} error(s), {len(rep.warnings)} warning(s)")
    if rep.errors:
        return 1
    if meta.get("studio_ai_toggle") == "yes":
        print("REMINDER: tick 'altered or synthetic content' in YouTube Studio at upload.")
    if a.emit:
        slug = path.resolve().parent.name
        print("wrote", emit(slug, meta, beats, sources, shots, total))
    return 0


if __name__ == "__main__":
    sys.exit(main())
