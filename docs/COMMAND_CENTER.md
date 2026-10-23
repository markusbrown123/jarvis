# JARVIS command center

One window for the Roblox studio, Automaton and finance research, with JARVIS
on top. Everything shown comes from a real source; anything that isn't
connected says so instead of showing a placeholder.

## Run it

```bash
jarvis              # start (installs changed dependencies first), open http://localhost:5173 in Chrome
jarvis stop         # stop
jarvis logs         # follow ~/Library/Logs/jarvis.log
jarvis setup-claude # forward Claude Code's status line + hooks (usage %, session activity)
jarvis setup-claude --remove   # undo exactly that
jarvis watch        # the live terminal feed, in colour, in this Terminal window
jarvis setup-phone telegram|pushover|remove   # phone tokens into the Keychain
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
he greets you right after it. Write mode is unchanged: start the bridge yourself with
`node scripts/start.mjs --writes`, then run `jarvis` to open the window.

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
- **Two arms** swing to the zone that just sent or received work and dock when idle.
- **Racks** blink with activity; the **back screen** shows the latest studio render.
- **Panels** over the room: Business & money (each figure with its source and
  age), Terminal (filters incl. Errors; narrows to the selection), Needs
  Markus, Running, and a detail panel for whatever is selected.

It opens in **Talk** mode (`J`): sat at the console, seen over the chair,
looking out across the desk and its monitors to the room (with a shallow
depth of field on High and Ultra), and the whole conversation on the left
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
| Roblox | `queue/tasks.json`, `publish/places.json`, `evidence/playtests/*.md`, `assets/logos/*` in `markusbrown123/traderedge` (branch in `~/.jarvis/projects.json`) | Read with `git fetch` into a private ref and `git show` — never checks out or changes anything. Uses your clone if one exists, else a blob-less copy in `~/.jarvis/repos`. Tasks → jobs, `human` → Needs Markus, history → activity, renders → asset previews. |
| Automaton | Local repo (git state, `AI_TASK_BOARD.md`), `portfolio_sites` status columns and `leads.sale_stage` via Supabase's public anon key (read from the repo at run time), a GET of automaton.llc | Never reads `generated_html`; never publishes, emails or calls. |
| Finance | Health of master-hub (`:8501`) and Futures Trader Scout (`:8000`), repo revisions, TradingView widgets | Monitoring only. No broker, positions or P&L exist, and none are shown. |
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

- **Set up:** `jarvis setup-phone telegram` (bot token from @BotFather) and
  `jarvis setup-phone pushover` (User Key + app token from pushover.net). Tokens go
  into the login Keychain (`jarvis-telegram`, `jarvis-pushover-user`,
  `jarvis-pushover-token`) — never a file or the repo. `jarvis setup-phone remove`
  deletes them.
- **Pair:** Settings → Phone → Pair my phone, then send the `/start <code>` it shows
  to your bot. Only that chat is answered; other chats are ignored and logged. Five
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

## Security

- The bridge listens on `127.0.0.1` only (`JARVIS_BIND` to change, on purpose).
- `/api/*` needs the page's own origin or `Authorization: Bearer <~/.jarvis/token>`.
- Hook, status line and worker payloads are data. Nothing in one is executed.
- No secret is in the frontend. Supabase is read with the public anon key the
  site already ships; service keys stay in Netlify.

## Voice behaviour

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
- **Spoken announcements / quiet hours** for important blockers.
- **Real-hardware voice timing** has to be measured on the Mac.
