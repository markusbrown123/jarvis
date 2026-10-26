# Pipeline — how to run it

Five scripts, each runnable on its own. `compare.py` chains them.

```bash
python3 make_test_photos.py                    # 10 synthetic frames -> photos/demo
python3 compare.py                             # the whole milestone-1 comparison
python3 compare.py --dry-run                   # cost it without spending anything
```

Everything lands in `out/<listing_id>/`, which is git-ignored. So are
`photos/` and `listings/` — client photos and details stay out of the repo.

## The stages

| Script | In | Out |
|---|---|---|
| `make_test_photos.py` | `fixtures/listing-demo.json` | 10 synthetic 3:2 frames. Not photographs — stand-ins so the pipeline runs with no client material. |
| `shotplan.py` | listing JSON + photo folder | `shotplan.json`: camera move, duration and model prompt per photo, summing exactly to the target length. |
| `motion.py` | shot plan | one clip per shot + `manifest.json` with billed seconds and cost. `--backend kenburns` is free and offline. |
| `edit.py` | shot plan + clips | `walkthrough-16x9.mp4`, `walkthrough-9x16.mp4`, `thumbnail.jpg`. Trims model clips back to planned length. |
| `qc.py` | shot plan + clips | `qc.json`: opening SSIM vs the source photo, drift, motion-spike ratio. |
| `compare.py` | listing | all of the above per backend, plus side-by-side videos and `scorecard.md`. `--shots 3 5 7` runs a cheap trial on a few shots; `--max-spend 4` caps the dollars. Finished shots are never re-paid. |
| `review.py` | a `compare.py` output folder | `review/shot-NN.jpg` (source photo + frames across each model's clip) and `review/review.md`, the eyes-on checklist. `compare.py` calls it. |
| `preflight.py` | listing + photo folder | Checks tools, keys and photos, prices a trial and a full run, prints the commands. Spends nothing. |
| `walkthrough.py` | a folder of photos (and optionally `listing.json`) | The whole pipeline in one command: plan, motion, edit, QC, and `walkthrough/review.html` beside the photos. Rooms come from the file names when there's no listing file; iPhone HEIC is converted. |
| `inbox.py` | `~/RealEstate/Inbox/<listing>/` | Renders every listing folder once it's settled (3+ photos, untouched 5 min), again if its photos change. JARVIS runs it on his own. |

## The everyday path

```bash
python3 walkthrough.py ~/RealEstate/Inbox/12-elm-road                 # free Ken Burns cut
python3 walkthrough.py ~/RealEstate/Inbox/12-elm-road \
    --backend higgsfield:dop-turbo --max-spend 5                        # Higgsfield, capped
```

Or let it run itself: drop a folder of photos into `~/RealEstate/Inbox/`
and JARVIS renders it within a few minutes and puts it on his Needs list
to review. Set in JARVIS's environment:

| Variable | Default | |
|---|---|---|
| `WALKTHROUGH_INBOX` | `~/RealEstate/Inbox` | where listing folders go |
| `WALKTHROUGH_BACKEND` | `kenburns` (free) | e.g. `higgsfield:dop-turbo` |
| `WALKTHROUGH_MAX_SPEND` | `5` | dollars per listing, for a paid backend |
| `WALKTHROUGH_SETTLE_MIN` | `5` | minutes untouched before a folder counts as ready |

## Keys

Read from the environment, else the macOS Keychain (generic password whose service is the variable name, e.g. `security add-generic-password -s FAL_KEY -a $USER -w`), never from a file here:

- `HF_KEY` — Higgsfield (`higgsfield:*` backends), as `key-id:key-secret`
  (`security add-generic-password -s HF_KEY -a $USER -w 'KEY_ID:KEY_SECRET'`),
  plus `HF_USD_PER_CLIP`, the dollar price of one clip on your plan — with it
  unset Higgsfield is costed as "?" and never called. See `MODELS.md`.
- `FAL_KEY` — Seedance, Kling (`fal:*` backends)
- `RUNWAYML_API_SECRET` — Runway (`runway:*` backends)

Without a key a backend is **simulated**: it writes the exact request it
would have sent and what it would have cost, and renders nothing. So
`compare.py` always produces a full cost table, and only ever spends money
on backends whose key is present.

## Using real photos

Point it at a folder outside the repo, with a listing JSON whose `shots`
list the filenames in the order they should appear:

```bash
python3 compare.py --listing ~/listings/elm-road.json --photos ~/listings/elm-road/photos
```

Nothing is uploaded or sent anywhere except to the model API of a backend
you have given a key for. Output is local, for Markus to look at.
