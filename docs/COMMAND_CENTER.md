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
```

Click **INITIALISE** once per page load (the browser needs one click before it
will play sound). Write mode is unchanged: start the bridge yourself with
`node scripts/start.mjs --writes`, then run `jarvis` to open the window.

## Layout

| Area | What it shows |
|---|---|
| Top bar | JARVIS's real input state, command-center link, model, 5-hour allowance |
| Left | Overview · Roblox · Finance · Automaton · Needs Markus · Activity · Settings, plus active jobs |
| Overview | Constellation of live project state around the core, and a strip: running, changed, latest render, needs you, allowance |
| Right | Needs Markus queue: what, why, where, what's ready, how it's verified, what resumes |
| Bottom | Input state ("You paused — still listening"), level meter, transcript, text box, Talk / Finish / Stop talking / Cancel reply / Mic, talk mode |
| `Voice view` / `I` | Immersive view: nebula, filaments, live words |

Colours mean one thing everywhere: violet working, amber needs you, red
failed, cyan healthy, grey dashed not connected.

Keys (never while typing): `1`–`7` sections · `[` `]` collapse panels · `I`
voice view · `⌘K` command palette · `Space` talk · `Enter` finish speaking ·
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
