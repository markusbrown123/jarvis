# YouTube faceless automation channel

## What
A channel without a presenter, run mostly by a pipeline: topic, script, voice, visuals, edit, thumbnail, and an upload held for review.

## Goal
Pick the niche, publish one pilot video made end to end by the pipeline, then a weekly rhythm. Watch what the numbers say before making it faster.

## How it works
1. **Niche**: five candidates, scored — evergreen, enough real source material, ad-friendly, a gap Markus can fill, easy to automate without becoming samey.
2. **Topic and script**: researched with sources kept; a structure that holds attention (hook, payoff, what's next).
3. **Voice**: ElevenLabs, key in the Keychain.
4. **Visuals**: generated or licensed footage, stills with motion, diagrams, screen captures — whatever fits the niche.
5. **Edit**: `ffmpeg` or a scripted editor: captions, music (licensed or generated), pacing.
6. **Thumbnail and title**: a few options each; one is chosen.
7. **Upload**: private or scheduled, for Markus to approve. JARVIS doesn't publish.
8. **Learn**: views, watch time, retention — what to do more of.

## First milestones
- [x] Niche shortlist of five, with the reasoning — `NICHES.md` (2026-10-25); Markus picks
- [x] Channel name and look — `BRAND.md` + `brand/brand.json` + `tools/make_brand.py` (2026-10-25); Markus picks the name from the five
- [x] Script template — `SCRIPT.md` + `templates/script.md` + `tools/new_script.py` / `script_lint.py` (2026-10-26); the lint output feeds the voice and visuals stages
- [ ] One pilot video, end to end
- [ ] Read YouTube's own Help pages on AI disclosure and inauthentic content, and confirm `SCRIPT.md`'s Disclosure section (this machine couldn't open them)
- [ ] A weekly check of the numbers
- [ ] Check the handle is free and re-render the look under the chosen name (one field in `brand/brand.json`)
- [ ] Channel trailer: 45 seconds, the same look, what the channel is and what turns up weekly
- [ ] Series plan: how the build logs and the website redesigns alternate week to week

## Rules
- Each video has real value of its own: researched, with a point of view. YouTube's rules on repetitive, mass-produced content apply.
- Realistic synthetic or altered content is disclosed with YouTube's setting for it.
- Footage, images and music are original, licensed or generated; nothing ripped.
- Facts are checked, and the sources are in the description.
- Channel logins never go in a file.

## Status
Script template done (2026-10-26): `SCRIPT.md` defines the six-beat shape, `tools/script_lint.py` checks a script and emits `voice.txt`, `shots.json` and `description.txt`, with a self-test. Still waiting on Markus for the niche and the channel name; nothing built or uploaded. Next: the pilot video.