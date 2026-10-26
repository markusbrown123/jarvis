# Image-to-video models for listing walkthroughs

What we need from stage 3 of the pipeline: hand a model one listing
photograph, get back a few seconds of believable camera movement, with the
room unchanged. That last part is the whole job. A model that produces a
gorgeous clip of a *different* kitchen is worse than useless here — the
brief's first rule is that the property is shown as it is.

## The shortlist

Six backends are wired up in `motion.py`. Five are paid models; one is
the control.

| Backend | Model | $/s | Clip lengths (whole seconds) | Why it's on the list |
|---|---|---:|---|---|
| `kenburns` | ffmpeg `zoompan` | 0.00 | any | The control. Pan and zoom on the real photo. Cannot invent anything, costs nothing, runs offline. |
| `runway:gen4-turbo` | Runway Gen-4 Turbo | 0.05 | 2–10s | Cheapest per second and the shortest minimum clip. |
| `fal:kling-3-pro` | Kling 3.0 Pro (1080p) | 0.112 | 3–15s | Cheap, 1080p, start/end-frame control. $0.168/s with audio on, which is the API default, so the request switches it off. |
| `fal:seedance-2-fast` | Seedance 2.0 Fast (720p) | 0.2419 | 4–15s | The one generally recommended for animating a *given* photo without restyling it. Most expensive, and its 4s minimum pushes a ten-shot plan to 40s. |
| `higgsfield:dop-turbo` | Higgsfield DoP Turbo | per clip | the model's own | Markus's pick. Higgsfield's camera-motion model, built for exactly this ask; one key also reaches the rest of its catalogue. |
| `higgsfield:dop-standard` | Higgsfield DoP Standard | per clip | the model's own | DoP's best-quality tier, for the hero shots if Turbo falls short. |

Also looked at and left out for now:

- **Veo 3.1** — $0.20/s without audio, $0.40/s with, at 720p or 1080p, and
  fixed 4/6/8-second clips. Strong model, but four times Kling's price for
  a job where the camera move is the entire ask. Worth a look only if the
  cheaper models fail the room-consistency test.
- **Seedance 2.0 Standard** ($0.3024/s) and **Seedance 2.5** (from $0.22/s
  at 480p) — the Fast tier is the right place to start.
- **Runway Gen-4.5** — $0.12/s, the flagship; same 5s/10s constraint as
  Turbo. The upgrade path from Turbo if Turbo's quality isn't there.

## The thing that actually drives cost: the shortest clip

*Corrected 2026-10-25.* Earlier drafts of this file, from the public
round-ups, said Runway and Kling only generate 5s or 10s clips and Seedance
3-12s. The vendors' own schemas say otherwise: Runway Gen-4 Turbo takes any
whole second 2-10 (changelog, 8 Oct 2025); Kling 3.0 Pro takes 3-15 and
Seedance 2.0 Fast 4-15 (fal's OpenAPI schemas, which list `duration` as a
string enum). So the "two thirds of the spend is thrown away" finding was
wrong. The remaining waste is rounding up to whole seconds and Seedance's
4s floor.

A 30-second plan of ten shots (2.7-3.3s each, rounded up), at today's
prices (`compare.py` / `preflight.py` compute this for any plan):

| Backend | Billed | Wasted | Cost per listing |
|---|---:|---:|---:|
| ffmpeg Ken Burns | 30s | — | $0.00 |
| Runway Gen-4 Turbo | 35s | 5s | $1.75 |
| Kling 3.0 Pro | 35s | 5s | $3.92 |
| Seedance 2.0 Fast | 40s | 10s | $9.68 |

What follows:

1. **Snap shots to whole seconds** (a milestone). Ten 3s shots bill 30s on
   Runway and Kling: $1.50 and $3.36. Seedance cannot go under 4s a shot,
   so for it the lever is fewer, longer shots: six 5s shots is 30s, $7.26.
2. **The shot plan is still the real pricing lever**, and whether a
   six-shot walkthrough sells a house as well as a ten-shot one is a
   question for the test listings, not a spreadsheet.
3. **Quality decides.** On cost alone Runway wins by a wide margin; the
   quality half of the scorecard is the open question.

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

## What is verified, and what is not

Checked on 2026-10-25 against the vendors' own pages: the fal endpoint ids
and request fields for Seedance and Kling (their OpenAPI schemas: Seedance
`bytedance/seedance-2.0/fast/image-to-video` with `image_url`; Kling
`fal-ai/kling-video/v3/pro/image-to-video` with `start_image_url`, and no
`resolution` field), the allowed durations for all three, Runway's $0.01 a
credit and 5 credits a second, and Seedance's $0.2419/s.

Not verified: Kling's $0.112/s comes from fal's published numbers as
relayed by round-ups; Runway's `ratio` value `1280:720` and the
`X-Runway-Version` header (`2024-11-06`) are as the code had them and could
not be confirmed from the docs pages reachable here. **No paid request has
ever been sent**, so the first trial (three shots, capped) is also the
test that the requests are accepted. Confirm prices on each vendor's page
before quoting an agent.

Sources:
- [Image and Video Generation API Pricing in October 2026 — developersdigest](https://www.developersdigest.tech/blog/image-video-generation-api-pricing-2026)
- [Best AI Video Models Sept 2026: Ranked by Price per Second — teamday.ai](https://www.teamday.ai/blog/best-ai-video-models-2026)
- [10 Best Image-to-Video APIs in 2026 — fal.ai](https://fal.ai/learn/tools/best-image-to-video-apis-2026)
- [Seedance 2.0 vs. Veo 3.1 — fal.ai](https://fal.ai/learn/tools/seedance-2-0-vs-veo-3-1)
- [AI Video Generation API Pricing in 2026 — apiframe.ai](https://apiframe.ai/blog/ai-video-api-pricing-2026)
- [Seedance 2.0 Fast image-to-video — fal.ai](https://fal.ai/models/bytedance/seedance-2.0/fast/image-to-video/api)
- [Kling Video v3 Pro image-to-video — fal.ai](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api)
- [Runway API pricing](https://docs.dev.runwayml.com/guides/pricing/) and [API changelog](https://docs.dev.runwayml.com/api-details/api_changelog/)

## Higgsfield

Wired up 2026-10-26 from Higgsfield's **official SDKs** — the Node package
`@higgsfield/client` 0.2.6 and the Python package `higgsfield-client` 0.2.0,
read from npm and PyPI — because its docs site wasn't reachable from the
machine that did the work. What the SDKs settle:

- **Auth**: `Authorization: Key <key id>:<key secret>` against
  `https://api.higgsfield.ai`. Keys come from cloud.higgsfield.ai. Here they
  are read from `HF_KEY` (`id:secret`), or `HF_API_KEY` + `HF_API_SECRET`,
  or the Keychain service `HF_KEY` — never a file.
- **Photos**: uploaded first — `POST /files/generate-upload-url` with the
  content type returns an `upload_url` (PUT the bytes, no API key on that
  request) and the `public_url` the model reads.
- **Generation**: `POST /v1/image2video/dop` with `{"model": "dop-turbo" |
  "dop-lite" | "dop-standard", "prompt", "input_images": [{"type":
  "image_url", "image_url"}]}` returns a `request_id` and `status_url`.
- **Status**: poll the `status_url` — `queued`, `in_progress`, `completed`
  (with `video.url`), `failed` and `nsfw` (both refunded), `canceled`.

What they don't settle, and the first real run must:

- **Price.** Higgsfield bills credits per clip, and what a credit costs
  depends on the plan. Set `HF_USD_PER_CLIP` (and `HF_USD_PER_CLIP_STANDARD`)
  to the dollar price of one clip on Markus's plan. Until it's set, the
  harness costs Higgsfield as "?" and **never calls it**, so no run is ever
  uncosted or past its `--max-spend` cap.
- **Clip length and resolution** are the model's own; `edit.py` trims each
  clip to the shot plan, so a longer clip costs nothing extra in the cut.
- **Other models through the same key** (Kling, Seedance and others in its
  catalogue at cloud.higgsfield.ai/explore) take their own endpoint and
  fields; add one as a backend once its schema is read from the console.

Tested against a stand-in server speaking the same protocol: upload,
generate, poll, download, the cap, the unpriced refusal, a wrong key, and a
re-run that doesn't re-pay finished shots.

