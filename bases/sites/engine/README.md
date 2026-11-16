# Lead engine

Finds local trade businesses that need a website, picks the best, builds each a rough preview
site, and hands Markus 2–3 at a time to call, with a researched call sheet for each. JARVIS runs
it on his own (`bridge/hub/leadengine.mjs`); this folder also works from a terminal.

```
discover (Google Places) → check their website → score → shortlist 25 → preview sites → batch of 2–3 → Markus calls → outcome
                                                                                                     ↘ interested → closing (../sitegen, ../kit)
```

## Run it

```bash
export GOOGLE_PLACES_API_KEY="$(security find-generic-password -s GOOGLE_PLACES_API_KEY -w)"
node cli.mjs discover --area "Trenton, NJ;Hamilton, NJ" --trades plumbing,roofing,hvac --max-requests 30
node cli.mjs run          # check sites, score, shortlist 25, build previews, open a batch
node cli.mjs status
node cli.mjs sheet pl_ChIJ…                      # the call sheet for one business
node cli.mjs outcome pl_ChIJ… interested "text the link to this number"
node cli.mjs import-contacted ~/Downloads/automaton-leads.csv   # never re-call Automaton's own leads
npm test                                          # (from bases/sites/engine) — no network
```

Settings live in `~/.jarvis/leads/engine.config.json` (`areas`, `trades`, `maxRequests`,
`shortlistSize`, `batchSize`). Trades: `plumbing, electrical, hvac, roofing, paving, remodeling,
landscaping, tree, concrete, fencing, garagedoor, pest, painting, pressure, cleaning`.

## What it costs

Only `discover` spends money: one Places Text Search request per 20 businesses, about
$0.032–0.035 each after Google's 1,000 free a month (2026 price list). Every run is capped
(`--max-requests`, default 30, so at most about $1) and every search is logged with its cost in
`log.jsonl`. Checking websites, scoring, previews and batches are free.

## Calling: the rules it's built around

- **A person makes every call.** The engine never dials, texts or emails. Automated or
  AI-voiced calls to mobile numbers need the owner's prior written consent under the TCPA
  (the FCC ruled in 2024 that AI voices count as "artificial"), and many sole traders list
  their cell as the business line. A live human call is the safe, and more professional, way.
- **Business hours in their own time zone** only (Mon–Fri 8–6, Sat 9–1, never Sunday), well
  inside the federal 8 am–9 pm window.
- **Do-Not-Call is permanent**: marking it adds the number to `dnc.json`, and that number is
  never shortlisted again. `import-contacted` keeps Automaton's existing leads out.
- **Consent before sending**: the script asks where to send the preview, and the sheet records
  it. Nothing is sent anywhere else.
- **Not recorded**, and the script says so if asked.
- Business-to-business calls are exempt from the federal Do-Not-Call registry, but a few states
  apply their own lists to business lines too. Before calling outside New Jersey, check that
  state's rules, or scrub the list against the registry.

## Data

Everything is in `~/.jarvis/leads/` (or `ENGINE_DIR`): `leads.json`, `batches.json`,
`dnc.json`, `contacted.json`, `log.jsonl` and `previews/`. Files are readable by Markus's user
only, and none of it goes in git. It's public business information from Google, plus our own
call notes. Previews live under a random 32-character folder name and are served by JARVIS
behind a signed link. They're marked "Preview" on every page, aren't indexed, and the form is off.

## After "interested"

The call sheet's Interested button opens a close page in JARVIS (`bridge/hub/closing.mjs`):
publish the preview as a shareable link, create the agreement link in the site kit (plan and price),
and follow the client through agreeing, paying (Stripe) and the intake form. The live site is then
built from their own answers (`../sitegen`, live mode) for Markus to review and publish to Netlify;
its form goes to the kit, which forwards enquiries to the owner. Each outward step is a button he
presses.

