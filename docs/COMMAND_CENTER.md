# JARVIS command center

One window for the Roblox studio, Automaton and finance research, with JARVIS
on top. Everything shown comes from a real source; anything that isn't
connected says so instead of showing a placeholder.

## Run it

```bash
jarvis              # start in write mode (installs changed dependencies first), link the phone the
                    # first time, show what's running, open http://localhost:5173 in Chrome
jarvis --safe       # the same, read-only: he looks things up but can't act
jarvis stop         # stop
jarvis logs         # follow ~/Library/Logs/jarvis.log
jarvis setup-claude # forward Claude Code's status line + hooks (usage %, session activity)
jarvis setup-claude --remove   # undo exactly that
jarvis watch        # the live terminal feed, in colour, in this Terminal window
jarvis setup-phone telegram|pushover|remove   # phone tokens into the Keychain
jarvis remote       # talk to him live from your iPhone over Tailscale (jarvis remote off to undo)
```

**Start-up.** The intro runs a real systems check the moment the window opens —
bridge, brain (model, effort, read-only or write access), voice (ElevenLabs or
browser), microphone, command center, phone link, graphics card — with a short
briefing beside it (what needs you, what's running, spend this month, Claude
allowance). Then any of these brings him up: say **"Jarvis"** (or "wake up"),
**any key**, a **click**, a **double clap** — or nothing: with *Start by himself*
on (default) he counts down 3-2-1 and boots on his own whenever Chrome allows the
page to make sound, which it does once the microphone is allowed for it. Esc holds
the countdown. While he powers up, the intro shows the real steps (sound, brain
link, microphone, voice loop), then fades into the station. If he was started
hands-free and Chrome still holds his voice, a notice asks for one key press and
he greets you right after it.

**One command.** `jarvis` is the only thing to run. It starts him in **write mode**
(he can act: files, shell, browser, phone, sending; `jarvis --safe` for read-only,
and if he's already running in the other mode it restarts him in the one asked
for). The first time, it offers to link your phone right there in the terminal
(a Telegram bot token, then a `/start` code to send it); the paired chat is kept,
so the same chat works on every start after that. Then it prints a status board —
brain, write mode, voice, phone, urgent alerts, Claude Code forwarding — with the
command that fixes anything not set up, and opens the window. Started by the clap
(no terminal), it asks nothing.

## Station

The landing view (`0`, or **Station** in the nav): a 3D control room built in
code — no downloaded models — where every light and moving part is live state:

- **The console** in the middle: a raised platform with a wide command desk,
  a command chair and four holo monitors (Systems, Zones, Work, Business) —
  modelled in Blender and textured with Cycles-baked 4K maps. Its light strips
  are JARVIS's state (blue standby, orange listening, violet thinking, cyan
  speaking, brighter with his voice), the desk's holo pads go amber when
  something needs you, a ring leaves the platform when a job completes, and a
  red segment lights on an error.
- **Six zones on pads** round it — Roblox (one cube per game), Automaton (site
  globe, pipeline stage pillars, lead dots), Finance (service terminal, monitoring
  only), Jobs (queued → running → done rail), Needs Markus (a beacon per item),
  Jarvis Core (a pylon per capability). The pad and the deck light round it show
  the zone's state; anything that can't be read is drawn as unavailable, never
  filled in.
- **Connections** from the console to each zone flow, pulse, break or flash
  with what is really happening; packets travel them as events land.
- **The build bay** straight ahead of the desk: a holo-table where each job
  is a tower rising floor by floor as it reports its steps, with a crane
  lowering the next floor; queued jobs are empty plots, finished ones stand
  lit, failed ones fall in.
- **Drones** — 5-inch FPV quads and tiny whoops, modelled in Blender
  (`tools/blender/fpv.py`) and flown like FPV drones — fly the station's
  real deliveries (work out to a zone, a finished job to the build bay, new
  leads in from outside through the open glass), carry data from a zone to
  the console when its live data changes, hover over zones that are busy or
  need you, and circle the console while JARVIS works. Their docks rise out
  of the floor to launch them. At the desk, nothing flies across the view. The floor plates round the console lift
  in a wave while JARVIS listens or speaks.
- **The house** is a round glass pavilion on a sea cliff, Malibu-style:
  travertine floors round a black marble stage, concrete behind, a curved
  glass wall opening onto a terrace with an infinity pool — modelled in
  Blender with its light ray-traced in Cycles (`tools/blender/lair.py`).
  Outside is the real sky for this moment where you are: the sun and moon
  where they really are, sunsets, stars, and the actual weather (clouds,
  rain on the glass, storms), over a live sea with boats and jet skis, in a
  bay of sandstone cliffs and chaparral hills with houses and the coast road.
  Round it, the rest of the estate after Tony Stark's: stacked white disc
  pavilions (one cantilevered over the cliff on a column), a helipad with a
  sweeping ramp, the drive, a lawn with palms and cypresses.

Each time it opens, the station plays an **opening flight**, like a game's
loading screen: letterboxed, with the place, time and weather, Cycles-rendered
stills of the estate and the drones pan and crossfade while the house loads;
then it cuts to the live scene and flies in over the waves, up over the estate,
through the open glass and round the room to the desk. Any key or a click
skips it.

The stills and the drone renders are made with the Blender Agent Skills
(`github.com/EL4CTEO/blender-skills`: time of day, rendering, geometry-nodes
scatter, look-dev turntables, asset QA). With a checkout of them:

```
.bpy/bin/python tools/blender/showcase.py --skills ~/blender-skills      # aerial, night → public/station/loading/ (--shots cliff for the spare)
```
- **Panels** over the room: Business & money (each figure with its source and
  age), Terminal (filters incl. Errors; narrows to the selection), Needs
  Markus, Running, and a detail panel for whatever is selected.

It opens in **Talk** mode (`J`): sat at the console, seen over the chair,
looking out across the desk and its monitors to the room and the sea (with
a gentle depth of field on High and Ultra), and the whole conversation on the left
with a line to type to him. **Walk** (`F`) gets you up: first person,
`W A S D` and the mouse, `E` to sit back down at the console or open the
zone you're facing.

To rebuild the console's model and textures, see `tools/blender/console.py`.

Click anything (or a panel row) to focus it; hover for a tooltip. Camera
presets, Reset (`R`), Connections View (`L`), and **Talk / Command /
Cinematic / Walk** (`J` / `C` / `F`) sit under the clock. Cinematic pulls the camera back and drifts round the
whole station with a live caption strip — the same data, not a screensaver.
The full element-by-element mapping is in [STATION.md](STATION.md).

Graphics: **Low** (for battery), **High** (shadows, reflective floor), **Ultra**
(wider soft shadows, 4096 shadow maps, ambient occlusion, full-res reflections,
grain, lens fringing) — switch on the station's top bar or in Settings. A
performance monitor lowers the resolution if frames drop, and if a setting ever
draws a blank frame (or the GPU resets) the station steps down a level by itself
and says so; the 3D scene starts once he's powered up.

## Terminal

`7`, the station's left panel, or `jarvis watch` in Terminal: one line per thing
happening — what you said and JARVIS's answer, every tool he uses, each
background-job step, your Claude Code sessions' tool use (tool + file name +
description — never commands or file contents), phone messages, studio events.
Filters: Voice · Jobs · Code · Phone · Studio. Typing at the prompt talks to JARVIS.
Memory only; the Activity log stays the durable record.

## Layout

| Area | What it shows |
|---|---|
| Top bar | JARVIS's real input state, command-center link, model, 5-hour allowance |
| Left | Station · Overview · Roblox · Finance · Automaton · Needs Markus · Jobs · Terminal · Activity · Settings, plus active jobs |
| Overview | Constellation of live project state around the core, and a strip: running, changed, latest render, needs you, allowance |
| Right | Needs Markus queue: what, why, where, what's ready, how it's verified, what resumes |
| Bottom | Transcript · the voice visualizer (centred; under the core on the overview) · text box, Talk / Finish / Stop talking / Cancel reply / Mic, talk mode |
| `Voice view` / `I` | Immersive view: nebula, filaments, live words |

Colours mean one thing everywhere: violet working, amber needs you, red
failed, cyan healthy, grey dashed not connected.

Keys (never while typing): `0` station · `1`–`9` sections · `[` `]` collapse panels · `I`
voice view · in the station `J` talk, `F` walk (then `W A S D`, `E`), `C` cinematic, `R` reset view, `L` connections ·
`⌘K` command palette · `Space` talk · `Enter` finish speaking ·
`M` mic on/off · `Esc` stand down · `D` diagnostics · `T` audio test.

## Where the data comes from

| Project | Source | Notes |
|---|---|---|
| Roblox | `queue/tasks.json`, `publish/places.json`, `evidence/playtests/*.md`, `assets/logos/*` in `markusbrown123/traderedge` (branch in `~/.jarvis/projects.json`) | Read with `git fetch` into a private ref and `git show` — never checks out or changes anything. Uses your clone if one exists, else a blob-less copy in `~/.jarvis/repos`. Tasks → jobs, `human` → Needs Markus, history → activity, renders → asset previews. Each game's **gallery** lists `evidence/` (world renders and 4K, maps, every UI screen by device, 4K UI, characters, creatures, props, logo/icon mock-ups) by name from git; a picture is copied out of git into `~/.jarvis/cache` only when it's opened. Studio-wide pictures (people pilot, style bible, blind tests) sit under the game list. |
| Automaton | Local repo (git state, `AI_TASK_BOARD.md`), `portfolio_sites` status columns and `leads.sale_stage` via Supabase's public anon key (read from the repo at run time), a GET of automaton.llc, and a GET of each deployed site's published URL (at most every 30 min) | Never reads `generated_html`; never publishes, emails or calls. **Deployed** is what the pipeline recorded; **publicly verified** means the URL answered and the page shows the business's name (else *wrong page* or *not answering*). Two failed checks in a row → activity + a Needs Markus item that clears itself when the site passes; Refresh re-checks every site now. |
| Finance | Health of master-hub (`:8501`) and Futures Trader Scout (`:8000`), repo revisions, TradingView widgets; master-hub's `findings` and `equity_points` (its `HUB_DATABASE_URL`, else `masterhub.db`) and the Scout's `trader_profiles`, `live_streams` and `sources` (`data/scout.db`, or the app's under Application Support), opened read-only | Monitoring only. No broker or account exists; findings are labelled review-only research, equity curves paper trades (realized only), rankings other people's public results. **Start / Stop** runs each service from its own `.venv` (`streamlit run dashboard/app.py`, `uvicorn app.main:app`), logging to `~/.jarvis/logs/`; JARVIS only stops what he started, and a missing venv shows the one-time setup command instead. |
| Claude usage | Status line `rate_limits` (via `jarvis setup-claude`), JARVIS's own `rate_limit_event` and per-request usage | Missing windows show "unavailable", never full. A passed reset shows "needs a fresh reading". The cost figure is Claude Code's list-price estimate, not a bill. |
| Claude sessions | Claude Code hooks (via `jarvis setup-claude`) | Tool names and their descriptions only — never commands, files or prompts. A permission prompt becomes a Needs Markus item that sends you to the session; nothing is approved from the dashboard. |

State lives in `~/.jarvis/`: `state.json` (snapshot), `events.jsonl`
(history), `projects.json` (paths and links — edit freely), `token` (local
API secret, mode 600), `cache/` (renders), `repos/`.

## JARVIS and the hub

JARVIS answers project questions from the same data (`hub_overview`,
`hub_project`), moves the dashboard ("show me Sky Spire"), and runs long work
as **background jobs** (`job_start`): separate agent sessions in the
project's folder, behind the same read-only/write gate. Talking over him,
"stop" and "cancel reply" never touch them; "cancel that task" or the job's
cancel shows *cancellation requested* until the session has really stopped.

## The desk: Claude Code and ideas

Sat at the desk in the station (Talk), two tabs sit beside the conversation
(details in STATION.md):

- **Claude Code** — real sessions (the Agent SDK's Claude Code: same agent,
  same tools) in a project folder: JARVIS's own repo, Automaton, the Roblox
  studio, the finance services or home. They stream to the desk as they work,
  replies resume the same session, Stop aborts the turn. The bridge's one gate
  decides what runs: with write mode on it edits and runs commands; read-only
  (`jarvis --safe`), whatever would change something waits at the desk for
  Allow once / Deny. The project's CLAUDE.md goes into the prompt; its settings
  files are not loaded, so their allow rules can't get round the gate. Like
  background jobs, it never sends, deploys, publishes or pays unless asked in
  that session. API: `POST /api/code/start {project, prompt}`,
  `/api/code/:id/send|stop|approve|close`; updates on `/api/stream` as `code`.
- **Ideas** — `~/.jarvis/ideas.json`. Typed at the desk or said to JARVIS
  (`idea_save`); he develops them on request (`idea_develop`: notes, state) and
  can hand one to Claude Code (`desk_code`). API: `GET/POST /api/ideas`,
  `POST /api/ideas/:id` (update), `/api/ideas/:id/delete`; updates on
  `/api/stream` as `ideas`.

## The streams of work

Six things Markus is building, each with a **base** in `bases/` (see `bases/README.md`): real estate AI video walkthroughs, a faceless YouTube automation channel, high-end client websites (Automaton), Roblox games and servers for kids, MNQ trading and the portfolio through QuantVue (Finance — monitoring only), and an AI virtual influencer, always labelled as AI. A base's `BRIEF.md` says what it is, how it works, the first milestones, the rules and the status.

- JARVIS knows them: a short list is in his prompt, `streams` gives each one's status, and `stream_brief` reads the whole brief before he advises on or starts work on one.
- The three new ones (`realestate`, `youtube`, `influencer`) are projects of their own: Ideas, desk Claude Code sessions and background jobs can target them, and run in `bases/<project>` with that folder's `CLAUDE.md`. They show under Jarvis Core in the station. The other three are the existing Automaton, Roblox and Finance projects.
- The Ideas board starts with one idea per stream, pointing at its base (once; delete one and it stays deleted).
- Finance: QuantVue is Quant View, and the page lists where Markus trades (QuantVue, Tradovate, the TradingView MNQ chart) as links. Nothing is connected: no orders, no invented positions or P&L.
- Rules in every brief hold, and a few are fixed: nothing is sent, posted, published, deployed or paid without Markus; the influencer is always disclosed as AI and stays inside Instagram's rules; a Roblox game for kids doesn't lean on them to spend.

## Building JARVIS himself

Ask him to add to or change himself — a gesture, a project, a page — and it
gets built, two ways (he picks; say "here" or "the cloud" to choose):

- **Here, at his desk** (`self_build`): Claude Code in his own repo builds it
  while you watch in the desk's Claude Code tab, checks it (tsc, oxlint,
  build), commits, and pushes to his branch so the cloud has it too. Page
  changes reload by themselves; for anything in the bridge, "restart yourself"
  (`jarvis restart`).
- **In the cloud** (`cloud_build`): he files a GitHub issue on his repo,
  labelled `jarvis-build`, with the brief. A scheduled Claude Code session in
  the cloud (the "JARVIS cloud builds" scheduled task, hourly) picks up open
  ones you opened, builds and tests them — screenshots included — pushes to
  his branch, comments and closes the issue; if something's unclear or risky
  it asks on the issue instead (label `jarvis-question`; answer there and it
  carries on). Each request shows in Jobs: queued, working, needs you, done —
  done reaches your phone. Then "update yourself" (`jarvis update`) brings it
  in.

Needs the GitHub CLI signed in on this Mac, once: `brew install gh` and
`gh auth login`. Nothing is ever pushed to main.

## Memory and learning

JARVIS remembers across restarts, reloads and `jarvis stop` — in read-only mode too
(write mode is only about changing files and running commands on the Mac).

- **Conversation log:** every exchange, voice and phone, is kept in
  `~/.jarvis/conversation.jsonl`. Each new session starts with the last few days of it.
- **Facts:** when you tell him how something is set up, a decision, a goal or a name, he
  saves one short sentence (`memory_save`). Every session starts with all of them.
  A near-identical fact on the same topic replaces the old one, so "make it 12, not 10"
  updates rather than duplicates.
- **Lessons:** when you correct him or something fails, he writes the rule to follow next
  time (`learn_lesson`); lessons are put first in every session.
- **Background jobs** start with his lessons and facts, end with `LESSON:` lines that are
  saved automatically, and their results go into the conversation log — so research
  builds on itself. "What did we find about …" searches all of it (`memory_recall`).
- **Quant View:** telling him what it is records it (`finance_set_quant_view`), links it on
  the Finance page and resolves the Needs Markus item.
- **Automatic recall:** older conversation and job findings that bear on what you just said
  are attached to your message before he sees it, so he answers from memory without
  stopping to search. Memory housekeeping is silent — no filler line, no working badge.
- **Thinking:** quick exchanges run at the configured effort (fast); advice, plans,
  analysis, trading and business questions switch that turn to deep reasoning
  (`JARVIS_DEEP_EFFORT`, default high); "think hard" goes deeper still. Background jobs
  run at `JARVIS_JOB_EFFORT` (default high). For advice he leads with a recommendation,
  the reasons with your numbers, and the next step — tied to your goals.
- Settings → **Memory** lists every lesson and fact (delete any, or add your own) and can
  clear the conversation log. Files: `~/.jarvis/memory.json`, `~/.jarvis/conversation.jsonl`.

## Business expenses

Finance → **Expenses** (and the station's Business panel). A plain ledger in
`~/.jarvis/expenses.json`; receipt photos kept in `~/.jarvis/receipts`.

- **By voice:** "Jarvis, I paid $19 for Netlify, Automaton hosting" → `expense_log`
  (amount, vendor, business, category, date). He confirms in one line and never
  guesses an amount — if it's unclear he asks. "What did I spend this month?" →
  `expense_report`. "That Netlify one was $21" → `expense_fix`.
- **By phone:** text a receipt photo to the JARVIS bot (add a caption like "office
  stuff for Automaton" if the business isn't obvious). He reads the vendor, total,
  date and currency, keeps the photo, and logs it — or asks if the total isn't legible.
- **On the dashboard:** month / last month / year totals, spend by business and by
  category, an add form, every entry with its receipt, delete, and **Download CSV**
  for your accountant.
- Businesses: automaton · roblox · trading · jarvis · personal · other. Categories:
  software · ai · hosting · marketing · contractors · equipment · office · travel ·
  meals · fees · education · other. Mixed currencies are flagged, never converted.
- Nothing here connects to a bank or card, imports anything, or pays anything.

## Phone

Telegram is the two-way line; Pushover is the urgent line. Both are optional.

- **Set up:** `jarvis` offers it the first time you run it; or any time,
  `jarvis setup-phone telegram` (bot token from @BotFather) and
  `jarvis setup-phone pushover` (User Key + app token from pushover.net). Tokens go
  into the login Keychain (`jarvis-telegram`, `jarvis-pushover-user`,
  `jarvis-pushover-token`) — never a file or the repo. `jarvis setup-phone remove`
  deletes them.
- **Pair:** `jarvis` shows a `/start <code>` in the terminal and waits for it, or
  Settings → Phone → Pair my phone; send the code to your bot. The pairing is kept
  (`~/.jarvis/phone.json`): the same chat works every time he starts. Only that chat is answered; other chats are ignored and logged. Five
  wrong codes burn the code.
- **Talk:** text or voice-note the bot. It is a real JARVIS conversation (same
  tools and permission gate, its own memory of the thread). Voice notes are
  transcribed with ElevenLabs Scribe and answered with a voice note in your voice
  plus text. `/status`, `/needs`, `/jobs` answer instantly without the model.
- **Reports:** JARVIS background jobs finishing or failing, new P1/P2 Needs Markus
  items, failed studio tasks — only after `awayMinutes` without dashboard input
  (or always, if chosen), silently during quiet hours. A job started with
  "text me when it's done" reports regardless.
- **Urgent:** `phone_notify(urgent)` — only when you ask, or when a job flagged
  urgent fails — sends Telegram plus a Pushover emergency (priority 2: repeats every
  60 s for up to 30 min until acknowledged). Allow Critical Alerts in the Pushover
  app so it rings through Do Not Disturb / silent.
- The bot long-polls from the Mac; no port is opened. State: `~/.jarvis/phone.json`.

## iPhone (live voice)

Talk to him from the iPhone the way you do at the desk, over your own Tailscale
network. Set up once:

1. Install Tailscale on the Mac and the iPhone, signed in to the same account;
   in the Tailscale admin console turn on **MagicDNS** and **HTTPS certificates**.
2. `jarvis remote` — runs `tailscale serve` for the page (`:5173`) and the bridge
   (`:8788`) on the Mac's tailnet name over HTTPS, records the name and your
   login in `~/.jarvis/remote.json`, and prints the address
   (`https://<mac>.<tailnet>.ts.net:5173`). The serve setting persists, so every
   `jarvis` start after that works from the phone too.
3. Open it in Safari on the iPhone, tap to start, allow the microphone.
   Share → Add to Home Screen keeps it one tap away.

Tailnet only — never Funnel, never the internet. The page finds the bridge on
the same name; the bridge accepts a request that came through Tailscale's
proxy only if it carries your own login (`Tailscale-User-Login`, which the
proxy sets) and, when it has an origin, that it's the Mac's own tailnet name.
`jarvis remote off` turns it off. Until it's set up, a P3 Needs Markus item
says how.

On the phone the dashboard is one column: the sections are a strip that
scrolls sideways (Needs Markus is its own tab, with its badge), and the bottom
bar is what he last said, a line to type, and Talk. A new phone starts on the
overview at Low graphics (the station at Ultra is more than Safari will hold);
the station is a tap away, with the conversation in the lower half and the
room above. Walk mode isn't offered on a touch screen. The page server listens
on 127.0.0.1 only, which is where `tailscale serve` sends the phone.

The phone can't reach a sleeping Mac, so `jarvis` keeps it awake while JARVIS
runs (`caffeinate`: no idle sleep, and none on the charger; the display still
sleeps, and closing the lid still sleeps the Mac). The status board's Awake row
says whether it's held.

## Security

- The bridge listens on `127.0.0.1` only (`JARVIS_BIND` to change, on purpose).
- `/api/*` needs the page's own origin or `Authorization: Bearer <~/.jarvis/token>`.
- Hook, status line and worker payloads are data. Nothing in one is executed.
- No secret is in the frontend. Supabase is read with the public anon key the
  site already ships; service keys stay in Netlify.

## Voice behaviour

- **He speaks up** when something important lands while you're at the station:
  a new P1 on Needs Markus ("Sir, something needs you: …"), and a background
  job you gave him finishing or failing. Once each (remembered across
  reloads), only while he's idle — never over a conversation — only with the
  window in view, and never in the phone's quiet hours (away, the phone has
  it). What was already there when he started is in the briefing, not
  repeated. Settings → *Say important things out loud* turns it off.

- Speech starts as soon as a text block ends (no wait for the turn's result).
- Resuming speech extends a held endpoint; continuing while he prepares an
  answer is joined to the request (never after a tool has run).
- "stop", "stop listening", "cancel that", "cancel that task" are handled
  locally. `M` / "stop listening" closes the microphone (light goes out).
- Talk modes: Auto, Hold (Space), Tap (Space). Enter finishes a thought.
- The built-in Mac microphone is preferred over an iPhone or AirPods.
- Settings → Voice shows median/p95 from this browser's own turns.

Simulated measurements (fake microphone, real model, Sonnet low effort, 5
questions): end of speech → first audio median 4.6 s before, 3.7 s after the
streaming fix. Real-microphone numbers appear in Settings once you use it.

## Rollback

```bash
cd ~/jarvis
git log --oneline            # pick the commit to return to
git checkout edadc0c         # the last version before the command center
jarvis setup-claude --remove # if you connected Claude Code
rm -rf ~/.jarvis             # forget hub state (optional)
```

## Not done yet

- **Live Roblox gameplay** needs a capture path from Roblox Studio on the
  Windows PC; the preview says so and shows the latest playtest report and
  committed renders instead.
- **Claude artifacts registry**, TradingView alert webhooks and broker
  monitoring aren't built; no broker or webhook source exists yet.
- **Checked only in a test browser** (software graphics, fake microphone):
  real-hardware voice timing, the iPhone over Tailscale, and the station's
  movement at full frame rate have to be confirmed on the Mac and the phone.
- **Finance numbers** were checked against stand-in databases with the real
  table layouts, not against your own master-hub and Scout data.
