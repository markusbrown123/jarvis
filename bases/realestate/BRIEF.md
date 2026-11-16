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
- [x] Higgsfield as a provider in the harness — from its official API docs (docs.higgsfield.ai; keys from cloud.higgsfield.ai; write-ups disagree on its auth and endpoints, so go by the docs), add it to `compare.py` and `MODELS.md` beside the others — its own DoP model, and Kling or Seedance through it if its catalogue has them, which could let one Higgsfield key stand in for the fal and Runway keys — costed per 30 s listing, and dry-run tested; no paid call until Markus has put the key in the Keychain and said go. Done 2026-10-26 from its official SDKs (MODELS.md): `higgsfield:dop-turbo` / `dop-standard`, tested against a stand-in server; the price per clip is `HF_USD_PER_CLIP` from his plan, and with it unset nothing is sent
- [ ] Re-run `compare.py` with the Higgsfield key or `FAL_KEY` / `RUNWAYML_API_SECRET` set, on real photos, and fill in the quality half of the scorecard — everything short of the paid calls is ready (`preflight.py`, `--shots`/`--max-spend` trial, `review.py` strips); waiting on a key and on photos Markus has the right to use (waiting on Markus)
- [ ] Snap shot durations to whole seconds — ten 3s shots bill 30s not 35s: Kling $3.92 → $3.36, Runway $1.75 → $1.50 (Seedance's 4s minimum means fewer, longer shots instead)
- [ ] Run the three-shot capped trial (`preflight.py` prints the command; about $0.60 Runway, $1.34 Kling, $2.90 Seedance) — also the first proof the paid requests are accepted
- [ ] Render the 9:16 cut with its own camera move instead of centre-cropping the 16:9 one (`motion.py --portrait` already does this; `edit.py` doesn't use it yet)
- [x] `walkthrough` script: a folder of photos in, an MP4 out — `walkthrough.py`, with a review page
- [x] Automated delivery: a listing's photos dropped in its folder → shot plan, motion, edit and QC run on their own → a review page for Markus to approve before anything goes to the agent — `inbox.py`, run by JARVIS every five minutes from ~/RealEstate/Inbox, onto his Needs list
- [ ] Voiceover: a script from the listing's verified facts only, read by ElevenLabs (key in the Keychain), mixed into both cuts
- [ ] A sample reel for outreach, from photos Markus has the right to use
- [ ] A list of 20 local agents (Markus does the contacting)
- [ ] Price and terms
- [x] Agent booking page: the sample, what's included, and a 15-minute demo call booked through the same scheduler as the Automaton site — built in the site kit (`bases/sites/kit/public/walkthroughs/`); its sample is made from illustrations until the reel exists, the price goes on once it's set; live when Markus puts the kit up
- [x] Agent question bot on that page: price, turnaround and what to send, answered from the price sheet, handing off to a booking — the site kit's assistant, from `bases/sites/kit/sites/walkthroughs.mjs`
- [ ] Outreach drafts: a short personalised first email for each agent on the list, held for Markus (never sent)

## Rules
- Facts come from the listing and the agent. No invented sizes, features, views or neighbourhood claims.
- The property is shown as it is: no added rooms, no hidden defects. Anything virtually staged or AI-made is said to be, to the agent and wherever the platform or MLS requires it.
- Client photos and details stay out of git (a client folder outside the repo).
- Nothing is sent to an agent or posted without Markus.

## Status
2026-10-26 — Higgsfield wired in (its official SDKs' protocol, tested against a stand-in), one command from photos to both cuts, and an inbox JARVIS renders on his own; the agents' page and its assistant built in the site kit. Waiting on Markus: the Higgsfield key and per-clip price, photos he has the right to use, and putting the kit live.

## From Markus
- 2026-10-26: Use Higgsfield for the walkthrough videos. Focus on real estate and premium client websites, with setting up bots, meetings and automation.
