# Automaton lead-to-launch system: handoff prompt

> Give this whole file to the person (or Claude Code session) taking over. It explains what
> was built, how and why, what's verified, and exactly how to set it up and push it live.
> It contains no secrets. **Keep it private**: section 8 describes security problems in the
> live Automaton app that are not fixed yet. Never put it in the public repos (`auto`,
> `premium-client-redesigns`).

---

## 0. Your job

You're taking over a system Markus (the owner of Automaton) had built. It finds local trade businesses that need a website,
picks the best, builds each a preview site, and hands Markus 2–3 at a time to call. When one says
yes, it handles the agreement, the payment, the client's details, building the full site (with
legal pages) and publishing it. All of it is built and tested on branches. **Nothing is live yet.**

Work in this order:

1. Read sections 1–5. Run the tests in section 6 and confirm the counts match.
2. Walk Markus through section 7, one step at a time. Each step that touches production waits
   for Markus's explicit yes.
3. Do the first live run with tiny limits (section 7, step H), and watch it.
4. Then fix the open security issues in section 8, starting with 8.1, each as its own task.

After every task, report: files changed, commands and tests run, commit hash, risks, and what
should be merged next.

## 1. Rules you must follow

- **People make every phone call.** The system prepares each call (who, why, script, preview) and
  Markus dials. Never add automated, AI-voiced or prerecorded calling. The FCC ruled in 2024 that
  AI voices count as "artificial" under the TCPA. Calling a mobile number that way needs prior
  written consent, and many sole traders use their cell as the business line. That's
  $500–1,500 per call in exposure.
- **Nothing outward without Markus's explicit yes**: sending email or texts, posting, deploying,
  publishing, charging, changing DNS, applying database migrations, merging to `main`. Ask one
  action at a time, in plain words, saying what it changes.
- **Secrets live only in** the Mac Keychain (JARVIS), Netlify environment variables (the site
  kit, automaton.llc) and Supabase secrets. Never in git, front-end code, docs or chat.
  `auto` and `premium-client-redesigns` are **public** repositories.
- **Each repo's `CLAUDE.md` wins.** In `automaton-`:
  - Read `AI_TASK_BOARD.md` first.
  - Claim one task and edit only its allowed files.
  - Keep patches small.
  - Never redo the V10.8 Caller desktop layout (commit `7d7dc25`).
  - Use Opus for risky Supabase work.
- **Branches**: all current work is on `claude/git-implementation-pcuq00` in each repo. Push
  there or to a new branch. `main` only with Markus's explicit approval for that push.
- **Leads' and clients' personal details never go in git.** The one exception: a client's public
  business facts, which the site kit needs.
- **Do-Not-Call is permanent**, and calls happen only in the business's own hours (enforced in code).

## 2. The business

Automaton (automaton.llc) builds websites for local service businesses: plumbers, roofers,
HVAC, electricians, paving and the like.

- **Launch**: $299 one time, a custom site live within about 48 hours of approval, and nothing
  to pay unless they like the preview.
- **Premium**: priced on a call. It adds an AI assistant on the site (answering after hours and
  taking details), calls booked into a calendar, and drafted follow-ups.

JARVIS is Markus's own assistant, a Node bridge plus React dashboard running on their Mac. It
runs background work, keeps a "Needs Markus" list (also on the phone), and talks by voice.
The new system runs inside JARVIS, with a small Netlify backend (the "site kit") for anything
the public touches.

## 3. The repositories

| Repo | Visibility | Branch with the work | What it is |
|---|---|---|---|
| `markusbrown123/jarvis` | private | `claude/git-implementation-pcuq00` (main is far behind; JARVIS on the Mac runs this branch) | JARVIS. The new system is in `bases/sites/` (engine, sitegen, kit) and `bridge/hub/` (leadengine, closing). |
| `markusbrown123/automaton-` | private | `claude/git-implementation-pcuq00` (one commit on top of main) | The live automaton.llc app: static pages and Netlify Functions in `netlify-deploy/`, Supabase. Security fixes only from this project. |
| `markusbrown123/auto` | **public** | `claude/git-implementation-pcuq00` (no `main`; the default branch is `claude/website-standards-practices-hdv8f1`) | Website skills for Claude Code (`.claude/skills/`): site-audit, local-seo, local-service-copy, site-kit, website-standards. |
| `markusbrown123/premium-client-redesigns` | **public** | `claude/git-implementation-pcuq00` | Spec redesigns (A-1 Sealcoating). Not part of the pipeline; see 8.6. |

The commits from this project:

- `jarvis`:
  - `88ea2c1`: engine and site generator.
  - `cbe147c`: JARVIS runs the engine.
  - `74a7829`: closing and launch.
  - `4ef919d`: research notes and the kit page fixes.
  - Earlier: `8fd1bf2` (site kit), `bf5a082` (JARVIS reads the kit feed), `f7383e6` (autopilot).
- `automaton-`: `ebba009`, security lockdown.
- `auto`: `08931b0`, `7871e65`, `0dfe307`, the skills.
- `premium-client-redesigns`: `7e11101`, `da9f331`, A-1 fixes.

## 4. How it works

```
 Google Places ──► engine: discover ─► check website ─► score ─► shortlist 25 ─► preview site each
                                                                                      │
 Markus ◄── Needs item + call sheet (script, findings, preview, outcome buttons) ◄── batch of 2–3
   │ calls himself
   ▼
 outcome ─► Do-Not-Call / not interested / no answer ×3 / callback (snoozed to the time) / INTERESTED
                                                                                      │
 close page (JARVIS) ─► [publish preview link] ─► [create agreement link] ──► site kit /c/<token>
                                                                                      │
             client: reads agreement ─► agrees (typed name) ─► Stripe Checkout ─► intake form
                                                                                      │
 kit feed ─► JARVIS: build live site from their answers (sitegen) ─► Markus reviews ─► [Publish]
                                                                                      │
                     Netlify site + their domain; the form posts to the kit ─► enquiries go to the owner
```

`[brackets]` mark a button Markus presses. Nothing outward happens without one.

### 4.1 Lead engine: `jarvis/bases/sites/engine/` (Node 20+, no dependencies)

| File | Does |
|---|---|
| `lib/places.mjs` | Google Places API (New) Text Search (`POST places.googleapis.com/v1/places:searchText`, `X-Goog-FieldMask`). It enforces a per-run request cap through `budget()`. Each request is about $0.032–0.035 after 1,000 free a month. |
| `lib/sitecheck.mjs` | Fetches each business's website and classifies it: none / social / parked / broken / weak / ok. "Weak" lists the problems (not https, no mobile layout, old copyright year, no tap-to-call, slow). It only fetches public addresses: private, loopback and link-local are refused at every redirect, which prevents SSRF. |
| `lib/score.mjs` | `score = need (0–50) + value (0–32) + fit (0–12)`, with a plain-English reason per point. Excludes: not operating, no phone, chains/franchises (regex), Do-Not-Call, already contacted by Automaton. Also holds the `TRADES` table (search phrase, ticket size, schema.org type). |
| `lib/batch.mjs` | `shortlist()` keeps the 25 best. `nextBatch()` opens 2–3, and only after the previous batch is all final. `recordOutcome()`: no answer ×3 becomes unreached; do_not_call goes on the DNC list. `callWindow()`: Mon–Fri 8–6, Sat 9–1 in the business's time zone (from its state), never Sunday. |
| `lib/brief.mjs` | The call sheet (HTML, no scripts). It has the opener ("This is Markus with Automaton…"), questions, objection answers, close, ground rules, and the outcome form. |
| `lib/business.mjs` | Lead → facts for the site generator (public listing data only). |
| `lib/netlify.mjs` | Deploys a folder through the Netlify API using file digests: creates the site, sends SHA-1s, uploads only the files Netlify asks for, waits until ready, and sets a custom domain. |
| `lib/store.mjs` | JSON files in `~/.jarvis/leads/` (mode 0600, atomic writes): `leads.json`, `batches.json`, `dnc.json`, `contacted.json`, `log.jsonl` (searches with cost, calls, batches), `previews/<random 32 hex>/`. |
| `engine.mjs` | Steps, each safe to re-run: `discover`, `check`, `rescore`, `previews`, `run`. |
| `cli.mjs` | `node cli.mjs discover --area "Trenton, NJ" --trades plumbing,roofing --max-requests 30`, `run`, `status`, `sheet <id>`, `outcome <id> <outcome> "note"`, `dnc <phone>`, `import-contacted <csv>`. |

### 4.2 Site generator: `jarvis/bases/sites/sitegen/`

`build(business, { mode: 'preview' | 'live', outDir, kit })` writes a complete static site:

- **Pages**: home, services, about, contact, privacy, terms, accessibility, 404.
- **Files**: `robots.txt`, `sitemap.xml` (live), `_headers` (Netlify security headers), CSS, a small JS file, SVG favicon.
- **Strict CSP**: no inline script or style, nothing third-party. `connect-src` allows only the kit.
- **JSON-LD** on every page: LocalBusiness subtype, `areaServed`, and opening hours parsed from Google's hours lines.
- **Preview mode**: a "Preview made by Automaton" bar, noindex, robots disallow, form switched off, and "this is where … goes" boxes instead of invented content.
- **Live mode** refuses to build until `check(business)` passes: name, phone, https URL, towns, about text in the owner's words, services, and a privacy contact. The form posts to the kit with the client's id.
- `copy.mjs` holds:
  - **Trade service lists**: they describe the service only, never claims like "best" or "fast".
  - **Accent colours**: each passes 4.5:1 contrast with white text.
  - **Legal templates**: plain-language privacy policy, terms and accessibility statement.
- `rebase(html, root)` serves a built site under a sub-path (JARVIS's signed links).

A sample live site audits at 0 FAIL on all 7 pages with `site-audit --local` (phone LCP about 1.2 s).

### 4.3 Site kit: `jarvis/bases/sites/kit/` (Netlify Functions v2 + Netlify Blobs)

| Endpoint | Purpose |
|---|---|
| `/api/chat`, `/api/site`, `/kit/widget.js` | The Premium assistant widget: answers only from a site's facts, with daily caps. |
| `/api/lead` | Form and chat leads. Origin allowlist per site, hidden `website` bot trap. For a published client, it emails the enquiry to the owner (escaped) when Resend is configured. |
| `/api/booking?site=` | Cal.com webhook (HMAC checked). |
| `/api/feed` | What's new, for JARVIS (Bearer `KIT_ADMIN_KEY`): leads, bookings, agreed / paid / intake. |
| `/api/admin/clients` | JARVIS creates and updates paying clients (admin key). Price and plan are locked once agreed; origins must be https. |
| `/c/<token>` | The client's agreement page (plan and price from `lib/agreement.mjs`). They accept with their typed name; the text's SHA-256 is stored as the version. Then Stripe Checkout. |
| `/c/<token>/start` | After payment: the intake form, their real facts for the site. |
| `/api/stripe` | Stripe webhook: signature checked with a 5-minute tolerance; records a payment once. |

The tokens are 32 random hex characters. Every page is plain HTML with a strict CSP, noindex and no scripts.

### 4.4 Inside JARVIS: `jarvis/bridge/`

- `hub/leadengine.mjs`:
  - **Schedule**: runs the free steps every 20 minutes, and a capped Places search weekly or on request.
  - **Needs**: each business in the open batch is a Needs item with Call sheet / Preview / Call links.
  - **Signed paths**: `/api/leads/<sig>/<lead>/sheet|outcome|preview/…`, signed with an HMAC of JARVIS's API token, so they open on the phone without the dashboard token.
  - **Follow-ups**: callbacks become an item snoozed to the agreed time, read in the business's time zone with that date's offset (DST-safe).
- `hub/closing.mjs`:
  - **Close page**: `/api/close/<sig>/<lead>`, with buttons for share preview, agreement and publish.
  - **Kit events**: handles agreed / paid / intake from the kit feed.
  - **Build**: builds the live site from the intake (and runs the copy check if `~/auto` has the skills).
  - **Publish**: deploys to Netlify, points the kit's origin list at the site, sets `notifyEmail`, and posts DNS steps (A record → 75.2.60.5, CNAME www → the netlify.app host) on Needs.
- `hub/sitekit.mjs` reads the kit feed every 3 minutes. Client events go to `closing`; enquiries on clients' own sites are only logged, because the owner receives those.
- `hub/api.mjs` routes `/api/leads/` and `/api/close/` before the auth gate; the signed paths are their own auth.
- **Voice tools** (`hub/tools.mjs`): `leads_status`, `leads_outcome`, `leads_setup` (towns and trades), `leads_search_now`, `close_prepare`.
- **Prompt** (`server.mjs`): tells JARVIS the rules: never call, text or email a business, and record "don't call" at once.

### 4.5 Website skills: `auto/.claude/skills/` (public repo)

- `site-audit`: real-browser launch check. SEO, throttled-phone LCP/CLS, axe WCAG 2.2, tap targets. It waits for LCP to settle and saves the rendered HTML so the other checks work on JavaScript sites.
- `local-seo`: `business.json` → JSON-LD, meta tags, NAP, sitemap; `verify` checks built pages against the facts.
- `local-service-copy`: trade copy rules; `copy-check` flags placeholders, filler, unsourced claims and vague buttons.
- `site-kit`: adding the kit to a client site.
- `website-standards`: the workflow that chains them.

JARVIS's background runs read these by full path (`~/auto/.claude/skills/…`).

### 4.6 What changed in the live Automaton app (`automaton-`, commit `ebba009`)

- **Staff token now required.** These functions now require the staff token
  (`x-data-token` = `DATA_VIEW_TOKEN`, via the new `_lib/auth.js`, which fails closed). No page
  calls them today, so the UI is unaffected.
  - `send-manager-email`: was an open email relay.
  - `dispatch-followup`: could text or email real leads with no login.
  - `seamless-enrich`, `copilot-suggest`: spend paid API keys.
  - `caller-transcript`.
  - `twilio-voice-token`: was open to anyone, a toll-fraud risk.
- `twiml-voice` dials +1 (US/Canada) numbers only.
- `track-click`: its `?url=` redirect is limited to allowed hosts.
- `site-lead` escapes visitor input in its email and drops bot-trap submissions.
- **Migration** `supabase/migrations/20261027_consent_dnc_score_service_only.sql` makes the consent,
  DNC and score RPCs service-role only. Before, the public anon key could lift a Do-Not-Call.
  **Not applied yet.**
- Tests: `qa/security-endpoints.test.cjs` (9/9; 0/9 on the old code). The board entry is
  `security-open-endpoints-lockdown`.

### 4.7 Security model in one paragraph

Keys stay server-side: the Keychain, Netlify env, Supabase secrets. Anything a browser opens is one of:

- **A signed path**: JARVIS's HMAC.
- **An unguessable token**: the client links.
- **An admin bearer key**: the kit feed and admin API.
- **Signature-checked**: the Stripe and Cal.com webhooks.

Every public form checks the origin, has a bot trap and length limits, and escapes everything
it echoes. Every page carries a strict CSP; previews and sheets add noindex and no-store.

Lead data stays on Markus's Mac (0600); client records live in the kit's Blobs, reachable only with the
admin key or the client's own token. One client can't see another's data: lookups are by their
own token or id, and site forms are tied to their own origins.

## 5. How it was built, and why

1. **Research.** Two agents read public skill repos and practitioner forums: Hacker News, the Local Search Forum, ContractorTalk, BrightLocal and Whitespark surveys. Reddit blocks the tools. Findings are in `jarvis/bases/sites/RESEARCH.md` and became the website skills:
   - tap-to-call kept on screen;
   - recent, dated, real reviews;
   - phone and form on every service page;
   - no doorway city pages;
   - human calls only;
   - answer leads fast.
2. **Skills tested on a real site** (A-1 Sealcoating). That surfaced bugs in the tools themselves: LCP read too early, hidden slider slides flagged, JavaScript-only pages unreadable. They were fixed before the engine was built on them.
3. **A read-only audit of the existing Automaton app** (two agents). It showed lead discovery was a manual browser scanner, the generator needed a human in the browser, and there was no contract, Checkout session, multi-page publish or legal pages. It also found the critical open endpoints, which were fixed first.
4. **Why the new system lives in JARVIS rather than Automaton's Supabase:**
   - The live `leads` schema isn't in the repo (it has drifted).
   - The `leads` table is readable with the public key.
   - Other agents hold most Automaton files on the task board.

   So a self-contained engine on Markus's Mac, with data that never leaves it, was safer. A one-way bridge into the Automaton CRM can come later (see 8.1).
5. **Previews from Google's public listing only.** No photos are copied (Google's terms forbid storing them), nothing is invented, and every page says "Preview".
6. **Batches of 2–3, opened only when the last is finished**, so each call is researched and unhurried. That's the quality bar Markus asked for.
7. **Closing in the kit (Netlify)**, because the client must reach it from anywhere, while JARVIS stays private on Markus's Mac and Tailscale. Every outward step is a button so nothing happens without Markus.
8. **Tests at every step**, with all outside services stubbed to their documented request and response formats.

## 6. Verify first

```bash
# jarvis (repo root), on claude/git-implementation-pcuq00
node --test bridge/test/*.test.mjs                 # expect: pass 9, fail 0
(cd bases/sites/engine && npm test)                # expect: pass 9, fail 0
(cd bases/sites/kit && npm install && npm test)    # expect: pass 15, fail 0  ("[chat] Error: boom" is an expected log)

# automaton- (repo root), on claude/git-implementation-pcuq00
node --test qa/security-endpoints.test.cjs         # expect: pass 9, fail 0
```

Read the diffs before merging: `git log --stat origin/main..HEAD` in `automaton-` (one commit),
and the four commits listed in section 3 for `jarvis`.

## 7. Setup and push: in this order, each step with Markus's yes

**A. Merge the Automaton security fix first.** It fixes holes that are open in production right now.

1. Merge `automaton-` `claude/git-implementation-pcuq00` into `main` (or open a PR for Markus to
   merge). Netlify deploys automaton.llc from `main`.
2. Check that `DATA_VIEW_TOKEN` is set in the automaton.llc Netlify environment (the Caller already uses it).
3. After the deploy, confirm the endpoints answer 401. Use dummy values, never a real lead:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://automaton.llc/.netlify/functions/send-manager-email -d '{}'   # 401
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://automaton.llc/twilio/voice-token -d '{}'                      # 401
   ```
4. Apply the migration: Supabase dashboard → SQL Editor → paste
   `supabase/migrations/20261027_consent_dnc_score_service_only.sql` → run. It's safe to re-run, and
   the rollback is in its header. Then check that Twilio inbound STOP/START still updates consent:
   it runs server-side with the service role, so it should.
5. **Change the DataForSEO password** (it's in `netlify-deploy/scanner.html`; see 8.2).

**B. Website skills (`auto`).** There is no `main`. Either make `claude/git-implementation-pcuq00`
the default branch, or merge it into `claude/website-standards-practices-hdv8f1`. On the Mac, the
`~/auto` checkout must be on a branch that has the skills.

**C. JARVIS (`jarvis`).** The Mac runs the `claude/git-implementation-pcuq00` branch; `jarvis update`
pulls whatever branch is checked out. On the Mac: `jarvis update`, then `jarvis restart`. Keep
`main` as it is unless Markus wants it brought up to date (it's about 100 commits behind).

**D. Site kit on Netlify.** From `jarvis/bases/sites/kit`: run `npm install`, then
`npx netlify-cli init` (publish `public`, functions `netlify/functions`). Set these variables
(Site configuration → Environment variables, or `npx netlify-cli env:set NAME value`):

| Variable | What for | Where it comes from |
|---|---|---|
| `ANTHROPIC_API_KEY` | the Premium assistant | console.anthropic.com |
| `KIT_ADMIN_KEY` | JARVIS ↔ kit (feed, client admin) | `openssl rand -hex 24`; the same value goes in the Mac Keychain |
| `CAL_WEBHOOK_SECRET` | Cal.com booking webhook | `openssl rand -hex 24`; the same value goes in Cal.com |
| `BOOKING_URL_AUTOMATON`, `BOOKING_URL_WALKTHROUGHS` | booking links | Cal.com event types |
| `KIT_SALT` | hashing visitors' addresses (optional) | random |
| `STRIPE_SECRET_KEY` | creating Checkout sessions | Stripe → **restricted key**, with only "Checkout Sessions: write". **Start with test mode.** |
| `STRIPE_WEBHOOK_SECRET` | the `/api/stripe` signature | Stripe → Webhooks → endpoint `https://<kit>/api/stripe`, event `checkout.session.completed` |
| `RESEND_API_KEY`, `KIT_NOTIFY_FROM` | sending clients their site's enquiries | resend.com with a verified domain, e.g. `Automaton <leads@automaton.llc>` |
| `KIT_LEGAL_NAME`, `KIT_GOVERNING_STATE` | the agreement's parties and law | Markus |

Then run `npx netlify-cli deploy --prod`. Note the kit's address, `https://<name>.netlify.app`,
and check the Netlify plan limits against `automaton-/NETLIFY_COST_GUARDRAILS.md`: each client
and each shared preview is its own Netlify site.

**E. Keys in the Mac Keychain** (`security add-generic-password -a "$USER" -s NAME -w 'VALUE'`), then `jarvis restart`:

| Name | What for |
|---|---|
| `KIT_URL`, `KIT_ADMIN_KEY` | JARVIS reads the kit's feed and creates clients |
| `GOOGLE_PLACES_API_KEY` | finding businesses. Google Cloud → enable "Places API (New)" → API key restricted to it. **Add a budget alert** (for example $10 a month). |
| `NETLIFY_AUTH_TOKEN` | publishing previews and client sites when Markus presses Publish (app.netlify.com → User settings → Applications) |

**F. Legal.** A lawyer reads `bases/sites/kit/lib/agreement.mjs` (the services agreement) and
`bases/sites/sitegen/copy.mjs` (the client sites' privacy policy, terms and accessibility statement) once.
They're careful plain-language templates, not legal advice. Then set `KIT_LEGAL_NAME` and `KIT_GOVERNING_STATE`.

**G. Keep Automaton's existing leads out.** Export the leads CSV from automaton.llc/data, then run
`node bases/sites/engine/cli.mjs import-contacted <file.csv>` in `jarvis`, so nobody is called twice.

**H. First live run, small.**

1. Ask Markus to say "Jarvis, look for roofers in Trenton, New Jersey" (one town, one trade).
2. Lower the cap to 5 in `~/.jarvis/leads/engine.config.json` (`"maxRequests": 5`).
3. Ask Markus to say "find leads now". Check `node bases/sites/engine/cli.mjs status` and `~/.jarvis/leads/log.jsonl` (cost).
4. Open a few call sheets and previews. Are the website verdicts right? Do the scores make sense?
5. Run the closing flow end to end **with Stripe in test mode** on a made-up client:
   1. create the agreement;
   2. agree;
   3. pay with card 4242 4242 4242 4242;
   4. fill in the intake;
   5. review the site;
   6. publish it to a throwaway Netlify site;
   7. send an enquiry from the published site and check that the email arrives.

   Delete the test Netlify site afterwards.
6. Then switch Stripe to live keys, raise the cap back to 30, and add the real towns and trades.

## 8. Open issues, most serious first

1. **The public anon key can read every row of `public.leads`.** It's in every automaton.llc
   page, and the rows hold names, phones, emails and notes. 7 pages read `leads` straight from
   the browser: `builder.html` in 5 places (e.g. :7419), `caller.html`, `data.html`, `manager.html`,
   `portfolio.html`, `scanner.html` and `survey.html`. Also:
   - `portfolio_sites` is anon-writable (`20260508_portfolio_sites.sql`).
   - `/p/<id>` serves generated HTML on the same origin where staff tokens sit in localStorage.

   The plan is on `AI_TASK_BOARD.md` as `leads-anon-read-lockdown`:
   1. Token-gated read endpoints.
   2. Switch the pages one at a time.
   3. Then enable RLS (service-role only).
   4. Serve previews from another origin.

   Coordinate with the active builder tasks.
2. **The DataForSEO password is hardcoded in `netlify-deploy/scanner.html`** and so is in git
   history. `deploy.sh` copies that page in from Markus's Dropbox copy of the scanner, so it has
   to come out there too. Change the password now and move it into the Cloudflare Worker's
   environment. The Worker's source isn't in the repo.
3. **Live integrations aren't verified yet**: Google Places, Stripe, the Netlify API and Resend
   were tested against stubs that follow their documented formats. Watch the first real runs
   (step H) and their logs.
4. **Legal templates need the review in step F** before the first real client.
5. **Other weak spots in Automaton**, not yet fixed:
   - One shared `DATA_VIEW_TOKEN` for all staff, kept in localStorage.
   - `x-caller-id` isn't verified.
   - The Supabase `twilio-token` edge function accepts anonymous sign-ins, and honours an `x-caller-identity` header naming any caller.
   - `twilio-outbound-voice` and `twilio-call-status` don't validate the Twilio signature.
   - `set-sale-stage` takes the role from the request.
   - Google-spending endpoints (`builder-place-*`) and `track-visit` have no auth.
   - The secret scanner's service_role check can never match.
6. **A-1 Sealcoating** (`premium-client-redesigns`, public):
   - Two commits of fixes aren't on `main`: SEO, speed, accessibility, and the estimate form.
   - The live estimate form is probably not registered with Netlify. Check Netlify → Forms for `a1-estimate`.
   - The "enhanced" hero photos are AI-altered versions of real jobs. That's a client decision to settle before promoting the site.
7. `premium-client-redesigns` lint: 39 errors were there before this work.
8. Not built: no AI calling (deliberate); no automatic outreach emails or texts (deliberate);
   job photos come by message, with no upload; the National DNC registry isn't scrubbed
   (B2B is exempt federally, but check state rules before calling outside New Jersey).

## 9. Day to day

- **Markus by voice:**
  - "Who do I call?" → `leads_status`.
  - "Garcia said yes, text the link to this number" → `leads_outcome`.
  - "Set Garcia up on Launch at $299" → `close_prepare`.
  - "Look for HVAC in Hamilton too" → `leads_setup`.
- **On Needs:** one item per business in the batch; a P1 item when someone is interested; a
  callback item that reappears at the agreed time; review and publish items; DNS steps after publishing.
- **Terminal:** `node bases/sites/engine/cli.mjs status | sheet <id> | outcome <id> <outcome> "note"`.

## 10. When something breaks

| Where to look | What it holds |
|---|---|
| `~/.jarvis/leads/log.jsonl` | every search with its cost and errors, every call, every batch |
| JARVIS Activity view | engine and closing events |
| Netlify → the kit site → Functions logs | `[close] checkout:`, `[lead] client email failed` |
| Stripe → Developers → Events / Webhooks | delivery attempts to `/api/stripe` |
| Netlify → the client site → Deploys | publish results |
| `node bases/sites/engine/cli.mjs status` | stages and Google spend so far |
