# Script template

Written 2026-10-26. This is the shape every video script takes, the rules a script is checked
against, and the tools that check it and hand it to the next stages. The format is built for
niche 1 in `NICHES.md` ("I built X with AI" build logs) and the website before-and-after series
that runs inside it; the look and voice come from `BRAND.md`.

## Use it

```
python3 tools/new_script.py plumber-site --series redesign --number 01 --title "A plumber's site, rebuilt"
#  -> scripts/plumber-site/script.md   (every blank is marked TODO)
python3 tools/script_lint.py scripts/plumber-site/script.md           # report
python3 tools/script_lint.py scripts/plumber-site/script.md --emit    # + out/scripts/plumber-site/
python3 tools/test_script_lint.py                                      # checks the checker
```

`--emit` only writes once there are no errors. It produces, in git-ignored `out/scripts/<slug>/`:

| File | For which stage |
|---|---|
| `voice.txt` | Voice: narration only, source tags removed, one paragraph per beat. Goes to ElevenLabs as is. |
| `shots.json` | Visuals and edit: every shot with its beat, the picture wanted, the voice line, sources, estimated start and length, and the lower-third text for each step. |
| `description.txt` | Upload: title, estimated chapters, standing footer, sources, tools, disclosure. The one-line `SUMMARY:` is written by hand after the edit. |

Timings are estimates from word count. The voice stage should re-time `shots.json` from the real
audio, and the chapters in the description must be re-checked after the edit.

Scripts live in `scripts/<slug>/script.md` and are committed; `tools/fixtures/ok.md` is an
invented example that exists only so the linter has something that must pass.

## The shape

One narrator, first person, about the build. Six beats; the middle one repeats.

| Beat | Job | Budget | Checked |
|---|---|---|---|
| **HOOK** | Show the finished result in the first second. One concrete number (hours, files, cost). What was at stake. No greeting. | at most 20 s, aim 15; at most 45 words, aim 35 | error over the limits; warning if no number |
| **PROMISE** | What was built, the one rule it was built under, what you will see. | under 25 s | warning |
| **STEP 1..n** (3 to 6) | One stage of the build each: what was asked or done, and what happened. Each gets a lower-third, so the video has visible structure. The heading must carry a name: `## STEP 2: First draft`. | one picture change about every 10 s | warning above 28 words on one picture |
| **THE BREAK** | What actually went wrong, at real speed, how it was found, how it was fixed. This is the content; a scripted AI channel can't fake it. Required. | at least a tenth of the runtime | missing = error; under 8% = warning |
| **PAYOFF** | The result with what it cost, how long it took, and what is still not right. | | |
| **NEXT** | One sentence on the next real build. Only promise what is already planned. | under 20 s | warning |

Order is enforced. For the `redesign` series, put the "before" shot in the HOOK and the "after" in
the PAYOFF, and use the steps for the three or four changes that made the difference.

### Script format

Markdown with a small front matter. Inside each `## ` beat, a shot starts with `SCREEN:` and then
has `VO:` (what the voice says, wrapped lines continue it), optional `ON-SCREEN:` (text drawn on
the picture) and `DUR:` seconds (for shots without voice, such as a sped-up build, or to hold a
shot longer than its voice line). `NOTE:` lines and `<!-- -->` comments are ignored. Every fact in
a `VO:` line carries a tag like `[S1]`, defined under `## SOURCES`:

```
S1: first-party | where it lives: repo path, commit, log, session note
S2: https://example.com/page | page title | accessed 2026-10-26
```

First-party sources are Markus's own work: they count as a source and they go in the description
as "My own work".

## What is checked, and why

**Hard rules (errors; nothing is emitted until they pass)**
- Beats present and in order; at least two steps; steps named. Structure is what keeps videos
  from becoming near-identical, and the break is what makes each one different.
- Every line of narration has a picture above it. A voice over nothing is the "slideshow"
  look; and it forces `shots.json` to be complete for the visuals stage.
- Every `[S#]` resolves; every source is `first-party | pointer` or an https URL with a title and
  access date. The brief's rule: facts checked, sources in the description.
- No leftover `TODO` / `TBD` / `[...]`, so an unfinished template can never be voiced.
- Banned words and openers from `BRAND.md` ("insane", "game-changer", "in today's video",
  "welcome back" and similar filler), and a hook that starts with a greeting.
- Front matter complete, including `synthetic` and `studio_ai_toggle`, so disclosure is decided
  at writing time, not at upload.

**House guidelines (warnings; judgement calls the linter can't make)**
- A number in the narration with no source tag. Numbers are where invented detail creeps in.
- Runtime outside ±20% of `target_minutes`, narration filling over 95% of the runtime (work
  should sometimes be shown without commentary), sentences over 28 words, titles over 70
  characters, sources that nothing cites.

## Why these numbers

- **Pace, 150 words per minute.** Professional narration is usually given as 140–160 wpm, with
  150–160 for audiobooks and slower (130–145) for instructional material. 150 is the default in
  the front matter; change `voice_wpm` once the real ElevenLabs voice is picked and measured.
  Sources: [PromptVO](https://www.promptvo.com/blogs/whats-an-average-speaking-rate-how-many-words-per-minute-wpm-is-average-when-reading-an-audiobook-or-giving-a-presentation),
  [Parlixa](https://www.parlixa.com/blog/words-per-minute-voice-over),
  [VoxBooster](https://voxbooster.com/blog/speech-rate-statistics-2026/). These are commercial
  voice-over and speech-coaching sites, so treat it as a sensible default, not a standard.
- **A hook of 15–20 seconds.** YouTube Studio's retention report has an "Intro" figure: the share
  of viewers still watching after 30 seconds. Rule-of-thumb targets seen in creator guides (about
  70% good, 80% exceptional, under 50% at 10–15 s means the hook isn't working) come from vendor
  blogs, not from YouTube, so they are used here as things to *look at* in the first real
  numbers, not as promises. Sources:
  [Teleprompter.com](https://www.teleprompter.com/blog/youtube-audience-retention),
  [TubeAnalytics](https://www.tubeanalytics.net/blog/youtube-video-hook-first-30-seconds).
  The weekly check of numbers (a later milestone) should replace these with the channel's own.
- **The break is a tenth of the runtime, a picture change every ~10 s, 3–6 steps.** These are
  house rules from the brand's "the break is the content" idea, not researched figures. Keep them
  until the retention graph of a real video says otherwise.

## Disclosure

The template makes this a decision in the front matter:

- `synthetic: voice | footage | voice+footage | none` sets the disclosure line in the
  description. The standing footer already says the narration is a synthetic voice.
- `studio_ai_toggle: yes | no` is whether YouTube's "altered or synthetic content" setting must be
  ticked at upload. Per the brief it is ticked for any realistic generated content. Third-party
  summaries of YouTube's rule say the setting targets realistic content a viewer could mistake
  for real (a realistic synthetic person, a cloned voice, a fabricated real event), and does not
  cover script help, thumbnails, or clearly animated or unrealistic material. When unsure, say
  `yes`: over-disclosing costs nothing. The linter prints a reminder when it is `yes`.
- **Not confirmed:** I could not open YouTube's own Help page (`support.google.com/youtube/answer/14328491`
  appeared in search results, but this machine's fetches of Google help pages have been blocked
  before). The summaries are from [Air.io](https://air.io/en/youtube-glossary/what-is-youtubes-ai-content-disclosure-policy),
  [PPC Land](https://ppc.land/youtube-introduces-mandatory-disclosure-for-ai-content/) and
  [Hooklab](https://hooklab.co.uk/blog/youtube-disclosure-rules-for-ai-generated-likeness-and-synthetic-media).
  One of them mentions an on-player label for photorealistic AI content from May 2026; I did not
  verify that. Read the Help Center page before the pilot upload.

## What the template does not do

- It doesn't write the script. Topic research and drafting are the pilot video's job; this is
  the container and the checks. The pilot should be a real build of Markus's, so every number in
  it is first-party and traceable.
- It doesn't judge whether a claim is true, only that each one is tagged and the tag resolves.
  Someone still has to open the sources.
- Timings are estimates. Don't cut the edit to them.
