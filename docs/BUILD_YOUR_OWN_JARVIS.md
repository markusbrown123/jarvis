# Build your own JARVIS

A blueprint you hand to Claude Code. It builds a personal command center that runs and manages your projects: you talk to it or type to it, it answers from real data about each project, runs work in the background in each project's folder, and asks you before anything leaves your computer.

---

## Part 1: for you (2 minutes)

**What you end up with**

- A voice assistant in a browser window. You say "Hey Jarvis, what needs me today?" and it answers out loud. Typing works too.
- A dashboard with each project's real status (site up, tests passing, last commit and so on), a "Needs you" list of things only you can decide, background jobs, and an activity feed.
- Background jobs: "fix the failing test in the shop app and tell me when it's done" starts a Claude Code session in that project's folder.
- Autopilot, if you want it: each project has a short brief with milestones, and it works through them one at a time, within limits you set. Anything outward (sending, deploying, paying) comes back to you as a Needs item.
- Optional extras: phone chat (Telegram), urgent alerts that ring through Do Not Disturb (Pushover), a phone app over your own private network (Tailscale), memory of what you've told it, and the ability to improve its own code on a branch for you to review.

**What it costs**

- It runs on your own Claude Code login, on your own computer, for your own use, so there's no API key and no extra bill.
- Background jobs and autopilot use your plan's allowance, so they're capped (Phase 4). A Max plan is best if you want a lot of background work.
- ElevenLabs voice is an optional paid add-on. The browser's own voices are free.
- If you ever turn this into something other people log into with their Claude accounts, switch to an API key: subscription logins are for personal use.

**What you need**

- Claude Code installed and logged in (`claude` works in a terminal).
- Node 20.19+ or 22.12+, git, and Chrome or Edge.
- A Mac is easiest (Keychain for keys, keeping the machine awake, start at login).
  - Linux works fine.
  - On Windows, use WSL2.
- Optional:
  - An ElevenLabs key, for a natural voice and better speech recognition.
  - A Telegram bot.
  - A Pushover account.
  - Tailscale.

**How to use this file**

1. Make an empty folder (for example `~/jarvis`), run `git init` in it, and put this file there as `BLUEPRINT.md`.
2. Run `claude` in that folder and say: **"Read BLUEPRINT.md and start Phase 0."**
3. It interviews you first about your projects and your rules, then builds one phase at a time.
   - At the end of each phase it shows you how to try it. Say "next phase" when you're happy.
   - Every phase works on its own, so you can stop as soon as it's useful. Phases 0 to 3 are already a good assistant.
4. Once Phase 1 works, push the folder to a **private** GitHub repo so you have history to roll back to.

You never paste a password or key into the chat. When a key is needed, it gives you a command that stores it in your Keychain yourself.

**Tips**

- **Keep milestones concrete.** "Add a contact form that emails me through a server function" works; "make the site better" doesn't.
- **Turn autopilot on for one project first**, and watch your usage for a few days.
- **Tell it when it gets something wrong.** It saves the correction as a lesson and follows it from then on.
- **Chrome's built-in speech recognition sends audio to Google.** If that bothers you, use ElevenLabs or a local Whisper model instead.

---

## Part 2: for Claude Code (the build brief)

You are building a personal command center for one person, called "the owner" below. It runs and manages the owner's own projects.

- Build it in the phases below, in order.
- At the end of each phase:
  - run that phase's checks and commit;
  - show the owner how to try it, in a few lines.
- Don't start the next phase until the owner says so.

### How to work

- **Phase 0 comes first.** Don't write code until the owner's answers are saved.
- **Check the installed library, not your memory.** The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) changes often. Read its README and type definitions in `node_modules` before you use an option. Do the same for Vite, React and Three.js.
- **Keep the code style simple.** The bridge is plain JavaScript modules (`.mjs`). The browser side is TypeScript + React + Vite.
- **Every module gets a test.** Use `node --test`, with no network in tests: stub `fetch`, and point the data folder at a temp directory through `JARVIS_DATA_DIR`.
- **Checks before every commit.**
  - Lint (`oxlint`), typecheck (`tsc -b`), build (`vite build`) and tests must all pass.
  - Commit per phase, on a branch. Never force-push or rewrite history.
- **Real data only.** Everything on screen comes from a real source. If a source isn't connected, the panel says "Not connected" and why. Never use placeholder numbers or invented status.
- **Keep `README.md` current:** how to run it, every environment variable, and every file in the data folder.
- **Ask the owner about their choices; decide the engineering yourself.** Owner choices include what "healthy" means for a project and how they want to be reached.

### The rules (put these in the repo's `CLAUDE.md` in Phase 0)

1. **Nothing leaves the machine without the owner.**
   - That covers sending, emailing, texting, posting, deploying, publishing, paying and pushing to a default branch.
   - None of it happens unless the owner says so in that conversation.
   - Outward actions are buttons or explicit spoken confirmations, never side effects of something else.
2. **Read-only by default.** The assistant starts unable to:
   - write files;
   - run shell commands;
   - call any tool whose name says it changes something.

   Writes are a deliberate switch (a launcher flag), and the screen always shows which mode it's in.
3. **Secrets live only in the OS keychain or the environment.** They never go in the repo, a config file, the browser, logs or the chat. The browser never holds an API key: it calls the bridge, and the bridge holds the key.
4. **Local only.**
   - The bridge and the page listen on `127.0.0.1`.
   - Every API call carries a local token.
   - The phone reaches it only through a private network (Tailscale serve), never the public internet.
5. **Honest output.** Figures come with their source. Unknown is "unknown". Nothing is made up.
6. **People are contacted by people.** If a project involves calling or texting people, the assistant prepares and the owner sends. In the US, automated or AI-voiced calls and texts to mobiles need prior written consent (TCPA).
7. **Tests with every module.** No phase is done with red tests.

### Architecture

```
Browser "face" (React + Vite)                 Node "bridge" (bridge/server.mjs)
  wake word, mic, voice detection   <-- WS -->   Claude Agent SDK  query()
  speech to text, text to speech                 permission gate   canUseTool
  dashboard, panels                 <-- HTTP --> hub: store, sources, jobs, needs
                                                 its own tools (in-process MCP)
                                                 ~/.jarvis/  (state, events, memory)
```

- **Claude runs through the bridge.**
  - The bridge runs the Claude Agent SDK, which runs Claude Code headless with the owner's existing login.
  - Model and effort come from environment variables (`JARVIS_MODEL`, `JARVIS_EFFORT`) with sensible defaults.
- **The bridge's own gate is the only authority.**
  - Pass `settingSources: []` so that no Claude Code settings file grants anything: the owner's normal allow rules and hooks don't load.
  - The bridge's `canUseTool` gate decides every tool call.
- **Tools.**
  - The bridge's own tools are in-process MCP servers, built with the SDK's helpers and zod schemas.
  - The owner's existing MCP servers (from `~/.claude.json`) can be passed through, behind the same gate.

**Data folder:** everything lives in `~/.jarvis/` (overridable with `JARVIS_DATA_DIR`).

- The folder is mode 700 and its files are mode 600.
- Writes are atomic: write a temp file, then rename it.
- None of it goes in git.

| File | What |
|---|---|
| `token` | Random 32-byte secret for the local API |
| `owner.json` | The owner's answers from Phase 0 |
| `projects.json` | Projects and their sources |
| `state.json` | Needs, jobs, settings |
| `events.jsonl` | Append-only activity |
| `conversation.jsonl` | What was said |
| `memory.json` | Facts and lessons |
| `cache/` | Snapshots from sources |

---

### Phase 0: interview and skeleton

Ask the owner these in one message, numbered, so they can answer briefly:

1. Their name, the assistant's name (JARVIS or anything else) and the wake word.
2. Their operating system.
3. Their projects. For each one:
   - a short name and what it is;
   - where it lives: a local folder, a GitHub repo, a website, a database, a spreadsheet, or nothing yet;
   - what "healthy" means for it: site up, tests green, orders today, a recent commit, and so on.
4. Anything the assistant must never do for them, beyond the rules above.
5. Which extras they want:
   - a natural voice (ElevenLabs);
   - phone chat (Telegram);
   - urgent alerts (Pushover);
   - a phone app (Tailscale);
   - 3D visuals.
6. Their quiet hours, and how they'd like to be reached.

Then build the skeleton:

- **Folders:** a Vite + React + TypeScript app at the root, plus `bridge/`, `bridge/hub/`, `bridge/test/` and `bases/`.
- **`CLAUDE.md`:** the rules above, plus the owner's own rules.
- **Docs and examples:**
  - `README.md`;
  - `projects.example.json`;
  - `.gitignore` covering `node_modules`, `dist`, `.env*` and `out/`.
- **The owner's answers** go into `~/.jarvis/owner.json` and `~/.jarvis/projects.json`, not git.

**Check:** `npm run build` and `node --test` pass on the empty skeleton. Commit.

### Phase 1: talk to it (bridge, voice loop, permission gate)

**Bridge (`bridge/server.mjs`)**

- **Server and token.**
  - HTTP and WebSocket on `127.0.0.1:8788` (the `ws` package).
  - Generate `~/.jarvis/token` on first run.
  - Reject a request without the token: a query parameter for the page's WebSocket, `Authorization: Bearer` for HTTP.
  - Reject a request whose `Origin` isn't the page's own.
- **`GET /health`** returns `{ ok, tts, stt }` so the page knows which voice features exist. It reveals nothing else, so it needs no token.
- **Conversation.**
  - One conversation per connection: text in, a `query()` stream out.
  - Stream text as it arrives (partial messages) so speech can start on the first sentence.
  - Keep the session id and resume it for follow-ups.
  - A `stop` message aborts the turn through an AbortController. That's barge-in.
- **System prompt** covers:
  - who the owner is;
  - the assistant's manner (short, spoken-friendly answers, no markdown when speaking, says what it doesn't know);
  - today's date and local time;
  - the rules.
- **The gate**, `decideTool(name)`, used as `canUseTool`:
  - Read-only built-ins (Read, Glob, Grep, WebSearch, WebFetch): allowed.
  - Write built-ins (Write, Edit, Bash, NotebookEdit and the like): only when `JARVIS_ALLOW_WRITES=1`.
  - The assistant's own UI and hub tools: allowed. They draw on its own screen, and the jobs they start run behind this same gate.
  - Other MCP tools:
    - a name with an effectful verb (send, create, update, delete, post, write, push, merge, pay, charge, deploy, publish, book, cancel…) is writes-only;
    - a plain read verb (get, list, search, read, fetch, query) is allowed;
    - anything else is writes-only.
  - Unknown means denied.
  - A denial returns a message the assistant can say out loud: "I can't do that in read-only mode."
  - Even with writes on, Bash still refuses a short denylist:
    - `rm -rf` on broad paths;
    - `git push --force` and `git reset --hard`;
    - `curl … | sh`;
    - anything that reads `~/.ssh` or the keychain.
  - **Test the gate with a table of tool names.** It's the most important test in the project.

**Browser face (`src/`)**

- **Input order:** typing and a push-to-talk button first, then the wake word.
- **Voice detection:**
  - Local energy detection (VAD) on the mic: loudness over roughly 30 ms frames, against a noise floor that adapts.
  - Speech starts after about 150 ms of voice and ends after about 700 ms of silence.
- **Speech to text, best available:**
  1. ElevenLabs Scribe through the bridge's `/stt`, when the key exists.
  2. Otherwise the browser's `SpeechRecognition`. Chrome stops it silently, so restart it on `end` and keep a heartbeat.
- **Text to speech, best available:**
  1. ElevenLabs through the bridge's `/tts`, sentence by sentence as the text streams.
  2. Otherwise `speechSynthesis` with the best installed voice. Chrome loads its voice list asynchronously.
- **Barge-in:** if the owner starts talking while it's speaking, stop the audio and send `stop`.
- **Wake word:** "Hey [name]". The simplest way is matching the always-on recognizer's transcript. A dedicated engine (Porcupine, openWakeWord) can come later.
- **On screen:**
  - the state: idle, listening, thinking or speaking;
  - a badge that always says READ-ONLY or WRITES ON.
- **Long answers** go in a panel instead of being read out in full.

**Check:**

- "What time is it?" and "What's in my [project] folder?" get spoken answers.
- "Create a file" is politely refused in read-only mode.
- The gate tests are green.

Commit.

### Phase 2: the hub (needs, activity, jobs)

**Store (`bridge/hub/store.mjs`)**

- **Needs list** ("Needs [owner]"):
  - Each item is `{ id, project, priority, title, why, actions, state, created }`.
  - Priority is `P1` (blocking or urgent), `P2` (this week) or `P3` (when convenient).
  - Actions are buttons: open a link, copy a value, or tick something off.
  - Ids are stable, so the same issue is updated, never added twice.
- **Activity feed:** every job start and finish, need added or resolved, and source change, from `events.jsonl`.

**Jobs (`bridge/hub/runner.mjs`)**

- **A job is a background agent session:** `query()` with `cwd` set to the project's folder, behind the same gate, with its own abort controller.
- **Concurrency:** at most `JARVIS_MAX_JOBS` run at once (default 2). The rest queue.
- **Each job records:**
  - its prompt and project;
  - its status, and start and finish times;
  - a summary (the last thing it said);
  - its usage.
- **Control:**
  - Cancel works.
  - A line in a job's output that starts with `NEED:` becomes a Needs item.

**Tools and API**

- **Tools for the assistant:** `hub_status`, `needs_list`, `needs_add`, `needs_resolve`, `job_start`, `job_list`, `job_cancel` and `activity_recent`.
- **The dashboard** gets the same operations under `/api/`, with the token.

**Dashboard**

- An overview card per project.
- Needs, P1 first, with their action buttons.
- Jobs.
- Activity.
- Usage:
  - per-request use from the SDK;
  - the plan's 5-hour and weekly use, where the installed versions expose it (the SDK's rate-limit messages, or Claude Code's status-line input forwarded to the bridge).

**Check:**

- Start a job ("list the TODOs in [project]"). It appears, finishes and shows a summary.
- A `NEED:` line becomes an item.
- A long job can be cancelled.
- Tests cover store upserts, and the runner's queue and cancel with a stubbed `query()`.

Commit.

### Phase 3: project sources (real data only)

Each project in `projects.json` is `{ id, name, folder?, repo?, sources: [...] }`.

Each adapter:

- is read-only;
- returns `{ ok, at, data }` or `{ ok: false, at, error }`;
- is cached in `cache/` with a time-to-live;
- shows its age on the dashboard ("2 min ago").

**Adapters**

| Source | What it reads, and how |
|---|---|
| git | Fetch into a private ref (`refs/jarvis/remote/*`) so the owner's branches and working tree are never touched. Reads the last commit, ahead/behind, uncommitted changes and branches. |
| GitHub | Through `gh` if it's logged in, reads only: open PRs, failing checks, issues. |
| Website | A `GET` with a timeout: status, response time, days until the TLS certificate expires. |
| Database | Opened read-only (SQLite `?mode=ro`, or a read-only Postgres role), running only named queries the owner approved. |
| Tests | The project's test command, run as a job; records pass or fail. |
| Anything else | A small adapter file in `bridge/hub/sources/`. |

**Rules**

- No adapter writes.
- Every fetch has a timeout and a size cap.
- A failing source shows its error; it doesn't break the dashboard.

**Sources raise needs.** For example:

- the site is down: P1;
- a check is failing: P2;
- the certificate expires within 14 days: P2.

**Tools:** `project_list` and `project_status(id)`.

**Check:**

- Every project shows real values with timestamps.
- A broken source (a bad URL) says so.
- "How's [project]?" is answered from the data.

Commit.

### Phase 4: bases, briefs and autopilot

Each project gets a base: `bases/<id>/BRIEF.md` and `bases/<id>/CLAUDE.md` (templates at the end).

**Tools**

- `project_brief(id)`.
- `project_note(id, text)`: adds the owner's note under "From [owner]".
- `project_work(id, task)`: a job in the project's folder, with the brief as context.
- `project_autopilot(id, on|off)`.

**Autopilot (`bridge/hub/autopilot.mjs`)** runs on a timer.

- **When it starts work:** for each project with autopilot on, with no job running and its gap passed, it starts a job on the next unticked milestone. The job gets the brief and the base's `CLAUDE.md`.
- **The job's standing instructions:**
  - Work on a branch or worktree.
  - Run the checks and commit.
  - Never push, deploy or send.
  - When finished, tick the milestone and add a dated line to Status.
  - Write `NEED: …` for anything only the owner can do.
  - Mark the milestone "(waiting on …)" when it's blocked on the owner, or write `BLOCKED: …` when it can't go on.
- **Limits:**
  - At most 2 projects at once (configurable).
  - A gap per project (default 2 hours).
  - At most one start every 5 minutes.
  - Skipped while the plan's 5-hour use is over 70%. If that number isn't available, use a daily job cap instead.
  - Off entirely in read-only mode, and during quiet hours unless the owner says otherwise.
- **Reporting:** every start and finish goes to Activity; every failure goes to Needs.

**Check:**

- A test project whose brief has two milestones: autopilot ticks the first, records a NEED, and respects the gap.
- The scheduler is unit-tested with a fake clock.

Commit.

### Phase 5: memory

- **Conversation log:** every turn is appended to `conversation.jsonl`, as text only. Anything that looks like a key or token is redacted first.
- **Memory tools:**
  - `memory_save(fact)`: things the owner states ("the shop is closed on Sundays"), saved with the date.
  - `learn_lesson(lesson)`: corrections ("keep PR summaries to three lines"). Lessons go into the system prompt.
  - `memory_recall(query)`: searches facts and recent conversation.
- **Automatic recall:** before each turn, the few best-matching facts are added to the context.
- **Forgetting:**
  - "Forget that" deletes.
  - A Memory page lists everything, with a delete button on each item.
- **Adaptive effort:** more effort for advice and plans, less for quick lookups.

**Check:** tell it a fact, restart, and ask about it. Commit.

### Phase 6: phone (optional, only what the owner chose)

**Telegram: two-way chat**

- **Token:** the bot token from @BotFather goes into the keychain.
- **Connection:** the bridge long-polls, so no port is opened.
- **Pairing:**
  - The terminal shows a one-time `/start <code>`.
  - Only the chat that sends it is answered. Other chats are ignored and logged.
  - Five wrong codes burn the code.
  - The pairing is kept in `~/.jarvis/phone.json`.
- **Messages** are full conversations behind the same gate.
  - Voice notes go through speech to text, and replies come back as text, plus a voice note when text to speech is set up.
  - `/status`, `/needs` and `/jobs` answer instantly, without the model.
- **Reports:**
  - jobs finishing or failing, and new P1 or P2 needs;
  - sent only after N minutes without dashboard input;
  - silent during quiet hours.

**Pushover: urgent alerts**

- Sent only when the owner asks, or when a job marked urgent fails.
- Emergency priority, which repeats until acknowledged.

**Phone app: Tailscale**

- **Serving:**
  - `tailscale serve` puts the page and the bridge on the computer's tailnet name over HTTPS. Never Funnel, never the public internet.
  - The bridge accepts a proxied request only when its `Tailscale-User-Login` header is the owner's login and its `Origin` is the computer's own tailnet name.
- **The app:**
  - A web app manifest, so the owner can use "Add to Home Screen".
  - A tap-to-start screen, because iOS needs a tap before audio.
  - An offline page for when the computer can't be reached.
  - A phone layout: one column, a bottom tab bar, a big Talk button.

**Links opened from the phone are signed.**

- The signature is `HMAC-SHA256(token, path)` in the URL, checked with a constant-time compare.
- The token itself never goes in a URL.

**Staying awake:** keep the computer awake while it runs (`caffeinate -i` on a Mac).

**Check:** pair, send `/status`, ask something by voice note, and receive a job report. Commit.

### Phase 7: the desk (Claude Code sessions and ideas)

- **Desk sessions.**
  - Start real Claude Code sessions in a project folder from the dashboard: `/api/code/start`, `send`, `stop` and `approve`.
  - When a session asks for permission, it shows up as something the owner can tap to approve or refuse.
- **Ideas board.**
  - `idea_save`: "idea: …" by voice.
  - `idea_develop`: a read-only job that researches the idea and writes a one-page plan.
  - `desk_code`: turns an idea into a session in a folder.
- **Optional Claude Code hooks.** Hooks in the owner's normal Claude Code forward permission prompts and finished sessions to the hub, so they appear as Needs and Activity.

### Phase 8: the launcher

`bin/jarvis`, added to the PATH:

- **Starting and stopping.**
  - `jarvis` starts the bridge and the page **read-only**, waits for `/health`, and opens a Chrome app window (`--app=http://127.0.0.1:5173`).
  - `jarvis --writes` starts with writes on, shown on screen. The owner can flip the default later, once they trust it.
  - `jarvis stop`, `restart`, `status` and `logs`.
- **Updating.** `jarvis update`:
  - pulls the current branch, carrying local changes over;
  - runs `npm ci` if the lockfile changed;
  - rebuilds and restarts.
- **Keys.** `jarvis setup-key <name>` asks for a key with hidden input and stores it in the keychain:
  - Mac: `security add-generic-password -U -s jarvis-<name> -a "$USER" -w`; read back with `security find-generic-password -w`.
  - Linux: `secret-tool`.
  - It never echoes the key.
- **Phone setup.**
  - `jarvis setup-phone telegram|pushover|remove`.
  - `jarvis remote` and `jarvis remote off` for Tailscale.
- **First run** walks through whatever isn't set up yet.
- **Optional:** start at login (a launchd plist on Mac, a systemd user unit on Linux).

### Phase 9: it improves itself (optional)

- **`self_build(task)`**, a job in its own repo:
  - works on a branch `jarvis/<what>`, never the default branch;
  - makes the change, then runs lint, typecheck, build and tests;
  - commits, and pushes the branch only if the owner allowed it;
  - adds a Needs item for the owner to review and merge.
- **The gate and the rules stay with the owner.** A self-build job may not edit the permission gate or `CLAUDE.md`; those changes are made with the owner present.
- **Cloud option.** It files a GitHub issue labelled `jarvis-build`, and a scheduled Claude Code cloud session picks it up and opens a pull request.
- **Nightly review (`review.mjs`).**
  - It reads the week's conversation and saves lessons.
  - It files at most 2 build requests a night, as Needs items for the owner to approve.
  - It never merges anything.
- **Rollback:** the README explains `git revert` and `jarvis update` back to a known-good commit.

### Phase 10: make it look the part (optional)

- **Visuals.** A Three.js (react-three-fiber) core that reacts to voice level and state, with shaders and themes.
- **UI tools.** `ui_theme`, `ui_effect`, `ui_panel` and `ui_reset`, so "go dark" or "show me the shop's numbers" changes the screen.
- **A `display` tool** for rich content in a panel.
  - It's sanitised with DOMPurify, with a class allowlist and no scripts.
  - The page sends a strict Content-Security-Policy (`default-src 'self'`).
- **Web images and media come through a bridge proxy** (`/img?url=`) that blocks server-side request forgery (SSRF):
  - it resolves DNS first and refuses private and loopback addresses, checking every redirect too;
  - it allows only image and media types;
  - it caps the size.
- **A Low/High graphics setting.** Phones start on Low.

---

### Security checklist (before calling any phase done)

- [ ] No secret in git: `git grep -nE "sk-|ghp_|xox[bp]-|AKIA|BEGIN .*PRIVATE KEY"` is empty, and so is the same search over `dist/`.
- [ ] The bridge binds `127.0.0.1`. Every `/api` route and the WebSocket check the token; `Origin` is checked.
- [ ] The gate tests pass, and read-only mode provably can't write a file or run Bash.
- [ ] Every outward action needs an explicit action from the owner.
- [ ] HTML from the model or the web is sanitised, the CSP is set, and nothing unsanitised goes into `innerHTML`.
- [ ] URLs fetched on the owner's behalf go through the SSRF guard.
- [ ] Paths taken from a request are resolved and checked to stay inside their folder. A bad encoding is a 404, not a crash.
- [ ] `~/.jarvis` is mode 700 and its files are mode 600.
- [ ] Logs hold no tokens, no keys, and no other people's message bodies.

### Templates

**`bases/<id>/BRIEF.md`**

```markdown
# <Project name>

**What it is:** one or two lines.
**Where it lives:** folder / repo / site / data.
**Healthy means:** what the dashboard checks.

## Focus
What matters right now, in one short paragraph.

## Milestones
- [ ] A concrete step, with what "done" looks like
- [ ] The next one

## Rules
- Never …
- Ask before …

## Status
YYYY-MM-DD: where things stand (written by whoever moved the work along).

## From <owner>
Notes the owner adds by voice or text. Read on every run.
```

**`bases/<id>/CLAUDE.md`**

```markdown
You're working for <owner> on <project>, in its base folder. Read BRIEF.md first.

- The code lives in <path>. Work in a git worktree on a branch `jarvis/<what>`; commit, never push.
- Run <test command> before calling anything done.
- Keys come from the environment or the keychain, never from a file.
- Never send, post, deploy, publish or charge. Output to look at goes in out/ (not in git).
- For anything only <owner> can do, write a line starting `NEED:`.
- When you finish a milestone, tick it in BRIEF.md and update Status with the date.
```

### Done when

- The owner says "Hey [name], what needs me today?" and gets an answer from real data.
- Every project shows real status with its age, and disconnected sources say so.
- A background job can be started by voice. It runs in the project's folder, reports back, and can be cancelled.
- Autopilot, if wanted, moves one milestone at a time within its limits, and leaves every outward step as a Need.
- Read-only is the default, and the tests prove it blocks writes.
- The README explains everything, and all tests are green.
