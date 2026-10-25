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

## Keys

Read from the environment, else the macOS Keychain (generic password whose service is the variable name, e.g. `security add-generic-password -s FAL_KEY -a $USER -w`), never from a file here:

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
