# Real estate AI video walkthroughs

## What
Turn a listing's photos (and floor plan) into a smooth video walkthrough with a voiceover, for real estate agents: a clip they can put on the listing, on Instagram and on YouTube. Sold per listing, or monthly to a busy agent.

## Goal
One paying agent. Before that: three test listings, and a delivery time of under a day per listing. Price is set after the tests, once the real cost per listing is known.

## How it works
1. **Intake**: photos, address, the listing's own facts (beds, baths, size, features), the agent's branding.
2. **Shot plan**: the order of rooms, and a camera move for each photo.
3. **Motion**: each photo becomes a few seconds of camera movement — an image-to-video model, tried on the same photos side by side first (cost per clip, realism, whether rooms stay the same room).
4. **Edit**: stitch, colour, captions, the agent's branding, music (licensed or generated only) — `ffmpeg`.
5. **Voiceover**: a script from the verified facts only; ElevenLabs, whose key stays in the Keychain.
6. **Deliver**: 16:9 and 9:16 cuts and a thumbnail, to the agent for approval. Nothing is posted before they've approved it.

## First milestones
- [x] 10 photos of one property → a 30-second clip, from two or three models, compared — harness built and run; the free control clip is rendered, the three paid models are costed but need a key (see `MODELS.md`, `out/demo-001/scorecard.md`)
- [ ] Re-run `compare.py` with `FAL_KEY` / `RUNWAYML_API_SECRET` set, on real photos, and fill in the quality half of the scorecard — everything short of the paid calls is ready (`preflight.py`, `--shots`/`--max-spend` trial, `review.py` strips); waiting on a key and on photos Markus has the right to use (waiting on Markus)
- [ ] Snap shot durations to whole seconds — ten 3s shots bill 30s not 35s: Kling $3.92 → $3.36, Runway $1.75 → $1.50 (Seedance's 4s minimum means fewer, longer shots instead)
- [ ] Run the three-shot capped trial (`preflight.py` prints the command; about $0.60 Runway, $1.34 Kling, $2.90 Seedance) — also the first proof the paid requests are accepted
- [ ] Render the 9:16 cut with its own camera move instead of centre-cropping the 16:9 one (`motion.py --portrait` already does this; `edit.py` doesn't use it yet)
- [ ] `walkthrough` script: a folder of photos in, an MP4 out
- [ ] A sample reel for outreach, from photos Markus has the right to use
- [ ] A list of 20 local agents (Markus does the contacting)
- [ ] Price and terms

## Rules
- Facts come from the listing and the agent. No invented sizes, features, views or neighbourhood claims.
- The property is shown as it is: no added rooms, no hidden defects. Anything virtually staged or AI-made is said to be, to the agent and wherever the platform or MLS requires it.
- Client photos and details stay out of git (a client folder outside the repo).
- Nothing is sent to an agent or posted without Markus.

## Status
2026-10-25 — Still waiting on keys and real photos for the paid-model quality half; prep done: vendor schemas checked (fixed wrong Seedance endpoint, Kling field name and clip lengths, so a 30 s listing is $1.75 / $3.92 / $9.68 not $2.50 / $5.60 / $8.47), trial/cap/resume/Keychain support and an eyes-on review sheet added.
