# High-end client websites (Automaton)

You're working for Markus on this stream, in its base folder. Read `BRIEF.md` first; it has the focus, the milestones and the rules.

- The Automaton repos are where the product lives. Find the checkouts under the home folder (`~/automaton-premium`, `~/automaton-`, `~/auto`, `~/premium-client-redesigns`); if one isn't there, say so as a NEED rather than cloning it somewhere new.
- Read them freely; don't edit them in place. A change meant for one is made in its own worktree on a local branch — `git -C <repo> worktree add ~/jarvis-worktrees/<repo>-<what> -b jarvis/<what>` — following that repo's `CLAUDE.md` and `AI_TASK_BOARD.md`, committed there and never pushed. Name the branch and what it changes in your summary, and as a NEED for Markus to review and merge.
- Build and test what you can here first: the bot, the booking section, the follow-up function, the playbook. Anything runnable gets a one-line "how to run it" in this folder's `README.md`.
- API keys come from the environment or the Keychain, never from a file here, and never in front-end code: a page calls a server function, the function holds the key.
- Never send, email, text, post, deploy or charge. Output to look at goes in `out/` (not in git).
- Leads' and clients' details stay out of git.
- When you finish something, tick it in `BRIEF.md` and update *Status* with the date.
