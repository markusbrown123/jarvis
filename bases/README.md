# Bases

A base is the starting point for one stream of work: a `BRIEF.md` that says what it is, how it works, what comes first and what JARVIS must never do, with its status kept current. JARVIS reads them (`streams` and `stream_brief`) so "how's the YouTube channel?" or "what's next for the real estate videos?" is answered from here, not guessed.

Streams that have no repo of their own yet have a working folder here as well, with a `CLAUDE.md`: a Claude Code session started for that project at the desk runs in it.

| Stream | What | JARVIS project | Lives in |
|---|---|---|---|
| `realestate` | AI video walkthroughs of listings, sold to agents | `realestate` | `bases/realestate` |
| `youtube` | A faceless YouTube channel run by a pipeline | `youtube` | `bases/youtube` |
| `sites` | High-end custom websites for clients (Automaton) | `automaton` | the `automaton-`, `auto` and `premium-client-redesigns` repos |
| `roblox` | Roblox games and servers for kids, earning Robux | `roblox` | the `traderedge` repo (`MarkusRobloxStudio`) |
| `finance` | MNQ futures research and portfolio, through QuantVue — monitoring only | `finance` | `master-hub`, `futures-trader-scout` |
| `influencer` | An AI virtual influencer, labelled as AI | `influencer` | `bases/influencer` |

## Rules for every stream

- Nothing is sent, posted, published, deployed or paid unless Markus says so, in that session.
- No secrets in any file here, or in git: keys and logins live in the Keychain or the environment.
- Figures are only real ones, with where they came from. Nothing is made up.
- A brief's *Status* is edited by whoever moves the work along (JARVIS, or Claude Code at the desk), with the date.
