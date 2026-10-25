# Image-to-video models for listing walkthroughs

What we need from stage 3 of the pipeline: hand a model one listing
photograph, get back a few seconds of believable camera movement, with the
room unchanged. That last part is the whole job. A model that produces a
gorgeous clip of a *different* kitchen is worse than useless here — the
brief's first rule is that the property is shown as it is.

## The shortlist

Four backends are wired up in `motion.py`. Three are paid models; the
fourth is the control.

| Backend | Model | $/s | Clip lengths | Why it's on the list |
|---|---|---:|---|---|
| `kenburns` | ffmpeg `zoompan` | 0.00 | any | The control. Pan and zoom on the real photo. Cannot invent anything, costs nothing, runs offline. |
| `runway:gen4-turbo` | Runway Gen-4 Turbo | 0.05 | 5s or 10s | Cheapest per second of the three. |
| `fal:kling-3-pro` | Kling 3.0 Pro (1080p) | 0.112 | 5s or 10s | Cheap, 1080p, start/end-frame control. |
| `fal:seedance-2-fast` | Seedance 2.0 Fast (720p) | 0.2419 | 3–12s | The one generally recommended for animating a *given* photo without restyling it; also the only one that can generate a 3s clip, which matters more than the headline price (below). |

Also looked at and left out for now:

- **Veo 3.1** — $0.20/s without audio, $0.40/s with, at 720p or 1080p, and
  fixed 4/6/8-second clips. Strong model, but four times Kling's price for
  a job where the camera move is the entire ask. Worth a look only if the
  cheaper models fail the room-consistency test.
- **Seedance 2.0 Standard** ($0.3024/s) and **Seedance 2.5** (from $0.22/s
  at 480p) — the Fast tier is the right place to start.
- **Runway Gen-4.5** — $0.12/s, the flagship; same 5s/10s constraint as
  Turbo. The upgrade path from Turbo if Turbo's quality isn't there.

## The thing that actually drives cost: fixed clip lengths

A 30-second walkthrough from 10 photos wants shots of roughly three
seconds. Most of these models do not generate three-second clips. Runway
and Kling generate 5s or 10s, full stop — so ten shots bill **50 seconds**
to produce 30 seconds of finished video. Two thirds of what you pay for is
trimmed off in the edit.

What that does to a listing, at today's prices (`compare.py` computes this
for whatever plan you give it):

| Backend | Billed | Wasted | Cost per listing |
|---|---:|---:|---:|
| ffmpeg Ken Burns | 30s | — | $0.00 |
| Runway Gen-4 Turbo | 50s | 20s | $2.50 |
| Kling 3.0 Pro | 50s | 20s | $5.60 |
| Seedance 2.0 Fast | 35s | 5s | $8.47 |

Three things follow.

1. **Seedance's per-second price is less bad than it looks, but it is
   still the most expensive.** It bills 35s where the others bill 50s,
   because it can generate 3-second clips — the 5s wasted is only the hero
   shots rounding from 3.33s up to 4s. That closes the gap with Kling from
   116% to 51%. It does not close it.
2. **Rounding is free money left behind.** The plan currently asks for
   2.67s and 3.33s shots. Snapping those to whole seconds would take
   Seedance from 35 billed seconds to 30, saving $1.21 a listing for no
   change anyone can see. Worth doing in `shotplan.py`.
3. **The shot plan is the real pricing lever.** Six 5-second shots instead
   of ten 3-second ones bills 30 seconds on Runway or Kling and wastes
   nothing — $1.50 and $3.36 a listing, less than half. It also means
   using six of the ten photos. Whether a six-shot walkthrough sells a
   house as well as a ten-shot one is a question for the test listings,
   not for a spreadsheet; `shotplan.py` can produce either.

Model generation also isn't free in time: these run roughly 1–3 minutes of
wall clock per clip, so a listing is 10–30 minutes of waiting. Well inside
the brief's under-a-day target, but it has to be a queue, not something an
agent sits and watches.

## How they're being judged

Not on a vibe. `qc.py` measures three things per shot, and
`compare.py` tables them per backend:

- **Opening SSIM** — does the first generated frame still match the
  photograph the agent sent in? This is the room-consistency test. A model
  that redecorates before it moves scores low here, and that is a
  disqualification, not a style note.
- **Drift** — how far the last frame has moved from the first. Only
  meaningful next to the control on the same shot, because a camera move
  lowers it on its own.
- **Jump ratio** — worst single-frame change against the typical one.
  Catches morphing, warping and flicker that a mean would hide.

The control's numbers on the demo set (mean opening SSIM 0.917, drift
0.904, worst jump 2.1×) are the floor. A paid model that doesn't clear
them is being paid to make the video worse.

## What the prompt does

The prompt in `shotplan.py` describes the camera move and nothing else, and
then spends most of its length forbidding changes: no added or moved
furniture, no people, no change to what's through the windows, no change of
time of day or weather, no cuts. This is the cheapest available defence
against the model inventing a feature the listing doesn't have — which
would be both a bad video and, on an MLS, a real problem.

## Caveat on these prices

Every price here is from the public October 2026 pricing round-ups below,
not from the vendors' own documentation. The sandbox this was built in
can't reach several vendor domains. **Confirm the numbers against each
vendor's pricing page before quoting a price to an agent**, and re-run
`compare.py --dry-run`, which recomputes the whole cost table from the
`MODELS` dict in `motion.py` — one place to edit.

Sources:
- [Image and Video Generation API Pricing in October 2026 — developersdigest](https://www.developersdigest.tech/blog/image-video-generation-api-pricing-2026)
- [Best AI Video Models Sept 2026: Ranked by Price per Second — teamday.ai](https://www.teamday.ai/blog/best-ai-video-models-2026)
- [10 Best Image-to-Video APIs in 2026 — fal.ai](https://fal.ai/learn/tools/best-image-to-video-apis-2026)
- [Seedance 2.0 vs. Veo 3.1 — fal.ai](https://fal.ai/learn/tools/seedance-2-0-vs-veo-3-1)
- [AI Video Generation API Pricing in 2026 — apiframe.ai](https://apiframe.ai/blog/ai-video-api-pricing-2026)
