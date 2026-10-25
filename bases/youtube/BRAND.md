# Channel name and look

Written 2026-10-25. Built for niche 1 in `NICHES.md` — "I built X with AI" build logs — with
niche 2 (website before-and-afters) running inside it as a recurring series, which is what the
shortlist recommended. Two things here: a **name shortlist Markus picks from**, and a **complete
visual identity** that is already built and rendered, parameterised so it re-renders under
whichever name he picks.

Render everything: `python3 tools/make_brand.py` → `out/brand/` (git-ignored).
The identity lives in one file: `brand/brand.json`. Change `name` and `handle` there, re-run.

---

## 1. The name

### What the name has to do

- **Faceless-safe.** No personal name, no invented presenter. The channel is the work, not a
  persona. This also keeps it clear of YouTube's tighter treatment of AI personas.
- **Say the format, not the tool.** "AI" in the name dates fast and buries the channel among
  thousands of AI-news channels. The format — one build, start to finish, done while you sleep —
  is what stays true in three years.
- **Hold both series.** Software builds *and* website redesigns have to fit under it without
  the name straining.
- **Short enough to read at 98 px** next to a video, and to say out loud.
- 3–30 characters, letters/numbers/`_`/`-`/`.`, can't start or end with a separator, must be
  globally unique — YouTube's handle rules.

### Shortlist, best fit first

| # | Name | Handle | Why | Against |
|---|------|--------|-----|---------|
| 1 | **Built Overnight** | `@builtovernight` | Says the whole promise in two words: it was not there, now it is, and nobody sat there doing it. Covers code and websites equally. Every title can be a variation ("Built overnight: a plumber's website"). Strong plain-English hook, no jargon, no expiry date. | Common phrase, so the handle may be gone; a redesign that takes four hours is still "overnight" in spirit but a pedant could poke it. |
| 2 | **The Build Log** | `@thebuildlog` | Exactly what the videos are: a record of a build, with what broke. Sober, trustworthy, ages perfectly. Invites a numbered series (Build Log 01, 02…). | Quieter — it describes rather than sells. Weaker on thumbnails against louder competition. Likely contested handle. |
| 3 | **Ship While I Sleep** | `@shipwhileisleep` | Most distinctive of the five and the most honest description of how JARVIS actually works. Instantly memorable; makes a good channel trailer line. | "Ship" is developer jargon — fine for niche 1, less obvious to the small-business owners niche 2 wants. Long-ish. |
| 4 | **Unattended** | `@unattended` | One word, striking, and precisely the point: machines working with nobody watching. Lots of visual room (the mark, an empty chair, a running progress bar). | Abstract — says nothing about building until you've seen one video. Single common words are nearly always taken as handles. |
| 5 | **Workbench** | `@workbench` | Warm, physical, implies craft rather than hype; would carry a channel that later branches into Roblox or hardware. | Generic, used by several products and tools; least ownable of the five. |

**Recommendation: 1, Built Overnight** — it carries the format, both series, and the thumbnails,
and it's the only one that is already a sentence a viewer could repeat. `brand/brand.json` is
filled in with it so the whole look is rendered and reviewable; it's one field to change.

**What I could not check.** Handle availability, and whether a channel or business already
trades under these names. The sandbox's proxy blocks `youtube.com` and `support.google.com`,
so I could not test `youtube.com/@handle` for a 404. A general web search turned up no YouTube
channel called "Built Overnight" or "The Build Log", but that is not proof. Markus should open
each handle as a URL before deciding, and do a quick trademark search for the one he picks.
Fallbacks if `@builtovernight` is gone, in order: `@builtovernight.tv`, `@overnightbuilds`,
`@builtwhileasleep`.

---

## 2. The look

One idea runs through all of it: **a workshop at night**. Dark, technical, quiet — and one
orange light on, the thing that is still working. Nothing stock, nothing decorative.

### Colour

| Role | Hex | Use |
|---|---|---|
| Ink | `#0B0E13` | Every background. Near-black with a blue cast, not pure black, so compression artefacts don't band. |
| Panel | `#141A23` | Second surface: thumbnail plates, caption bars, lower thirds. |
| Line | `#263141` | Grid, rules, empty parts of the progress bar. |
| Paper | `#F2F4F7` | All body and headline text. |
| Muted | `#8C98A8` | Secondary text, placeholders, source credits. |
| **Signal** | `#FF5A1F` | **The only accent.** One element per frame, never two. Used for the emphasised word, the kicker, the filled part of the bar. |
| OK | `#35D07F` | Used sparingly: a passing check, a "it worked" state. Never on thumbnails. |

Signal on Ink is a ~6:1 contrast; Paper on Ink is ~16:1 — both pass for text at thumbnail sizes
and on a phone.

### Type

- **Inter Display Black** — headlines and thumbnail titles. Tight, heavy, reads at 120 px wide
  on a phone.
- **Inter Display SemiBold** — on-screen captions and end card.
- **JetBrains Mono Bold** — kickers, numbers, labels, the handle. The mono is what makes it
  read as a build log rather than a vlog; it is the second-strongest brand cue after the orange.

Both are SIL Open Font Licence 1.1 — free to use commercially and to embed in video. Licence
noted in `brand/brand.json` so it stays checkable.

### The mark

An open square bracket, half filled from the bottom: a job that is partly built. It is the same
shape as the progress bar that appears in every thumbnail and every end card, so logo and motif
are one idea. It survives down to 24 px (checked by rendering it at 24 and looking at it), which
is the size YouTube shows next to a comment.

Rendered as: `avatar-800.png` (channel picture), `avatar-98.png`, `avatar-24.png` (legibility
proofs), `watermark-150.png` (transparent, for the video-player corner watermark).

### Banner

`banner-2560x1440.png`. Mark, name, tagline, "NEW BUILD EVERY WEEK", and the progress bar — all
inside the centred 1546 × 423 safe area, so nothing is cut off on a phone. `banner-proof.png`
draws that safe area on top so it can be checked before upload; `banner-crop-desktop.png` and
`banner-crop-mobile.png` show what each device actually displays.

### Thumbnail grammar

This is the part that decides whether the channel works, so it's a rule, not a template to
improvise around:

1. **Mono kicker, top left, orange** — the series and number ("BUILD LOG 01", "REDESIGN 04").
2. **Title, left-aligned, at most three lines**, Inter Display Black, auto-shrunk to fit.
   Exactly **one word in orange** — the word the video turns on. In the generator, mark it
   `*like this*`.
3. **One number, bottom left, in mono** — "4 HOURS, 0 HANDS", "£0 SPENT", "11 FILES". Concrete,
   and true.
4. **The progress bar** above it. Same bar, every time. This is the thing viewers recognise in
   a sidebar.
5. **Right 42%** is either a real still from the build (variant A, with a plate and a divider)
   or left empty with a glow (variant B). Never clip art, never a face, never an arrow, never
   a red circle.
6. **No more than six words** in the title on the image.

Three worked examples: `thumb-A-split.jpg`, `thumb-B-full.jpg`, `thumb-C-question.jpg`. All well
under YouTube's 2 MB limit. Re-run with your own text:

```
python3 tools/make_brand.py --thumb-kicker "Redesign 01" \
  --thumb-title "A plumber's site, rebuilt in *one* night"
```

### Motion and the rest of the frame

- **Captions**: burned-in, one line, centred, Inter Display SemiBold on a translucent Ink bar —
  `caption-style.png`. Most of this audience watches muted first.
- **Lower third**: `lower-third-1920x1080.png`. Orange spine, step number in mono, step name in
  Inter. Used to mark the stages of a build so the video has visible structure.
- **End card**: `end-card-1920x1080.png`, with two 16:9 slots positioned for YouTube's end-screen
  elements, the handle, and "sources in the description".
- **Pace**: cuts on the beat of the work, not on the beat of the music. Screen recordings sped
  up 4–8×, slowed to real time for the moment something breaks. The break is the content.
- **Music**: one instrumental bed per video, low and rhythmic, no vocals. Licensed or generated;
  the licence goes in the video's notes.
- **Voice**: ElevenLabs, one voice kept across all videos — calm, mid-pace, a documentary
  narrator rather than a hype channel. Writes and speaks in first person about the build
  ("I pointed it at the repo"), never pretending to be a person on camera.

### Words

- Plain English. Short sentences. No "insane", "crazy", "game-changer", no "in today's video".
- Say what it cost, what it took, and what went wrong. The channel's whole position is that
  these are real builds with real failures — that's what a scripted AI channel can't fake.
- **Every description ends with**: the sources used, the tools named, and the disclosure line
  when synthetic voice or generated footage is used. The AI-disclosure setting in YouTube Studio
  is ticked for any realistic generated content, per the brief's rules.

### Standing description footer

```
Built by a pipeline that researches, writes, voices, edits and thumbnails each video;
every build in it is real and the code is mine. Narration is a synthetic voice.

Sources for this video:
- …

Tools used: …
```

---

## 3. What is rendered

| File | What it's for |
|---|---|
| `avatar-800.png` | Channel profile picture (800 × 800) |
| `avatar-98.png`, `avatar-24.png` | Legibility proofs at the sizes YouTube really shows |
| `watermark-150.png` | Transparent player watermark |
| `banner-2560x1440.png` | Channel banner |
| `banner-proof.png` | The same with the safe area drawn on — check before upload |
| `banner-crop-desktop.png`, `banner-crop-mobile.png` | What each device shows |
| `thumb-A-split.jpg`, `thumb-B-full.jpg`, `thumb-C-question.jpg` | The three thumbnail variants |
| `end-card-1920x1080.png` | End card with end-screen slots |
| `lower-third-1920x1080.png` | Stage marker overlay |
| `caption-style.png` | The caption look, as a reference frame |
| `contact-sheet.png` | Everything on one page, for a quick look |

## 4. Specs these were built to

- Banner: recommended 2560 × 1440, minimum 2048 × 1152, max 6 MB, safe area 1546 × 423 centred
  (1235 × 338 on a minimum-size file).
- Profile picture: 800 × 800. Thumbnail: 1280 × 720, 16:9, under 2 MB, JPG/PNG/GIF.
- Handle: 3–30 characters; letters, numbers, `_`, `-`, `.`; can't start or end with a separator;
  changeable twice per 14 days.

Sources: [Social Sizes](https://socialsizes.io/youtube-cover-photo-size/),
[Fuser](https://fuser.studio/articles/youtube-banner-size),
[Canva](https://www.canva.com/sizes/youtube/),
[vidIQ on handles](https://vidiq.com/blog/post/youtube-handles/),
[Wild and Free Tools on handle rules](https://wildandfreetools.com/blog/youtube-handle-rules-characters-length/).
These are third-party summaries — Google's own Help Center pages are blocked from this machine.
They agree with each other, but confirm the banner and thumbnail limits in YouTube Studio at
upload time, where the real limits are enforced anyway.
