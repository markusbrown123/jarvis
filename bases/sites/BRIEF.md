# High-end client websites (Automaton)

## What
Custom, high-end websites for clients — personal brands and small businesses — made by the Automaton pipeline and finished by Claude Code. Public site: automaton.llc.

## Where the work is
Repos on GitHub under `markusbrown123`: `automaton-` (the app and pipeline), `auto` (client work, with the `website-standards` skill), `premium-client-redesigns`, and `narrativa-site`. JARVIS's Automaton page shows the site's health, the pipeline by stage and the leads, from the live data.

## How a site gets made
Each client site follows the `website-standards` skill in `auto`: size the job, direct it, build it, render it at phone, tablet and desktop widths with `playwright-cli`, audit the changed files with `web-design-guidelines`. High end means it looks designed — a real point of view, real type, real photographs — not a template.

## Focus
Premium client websites that come with the selling built in: a bot that answers and qualifies visitors, meetings booked straight from the site, and the follow-up after it automated, so a lead turns into a call without Markus chasing it.

## First milestones
- [ ] Where it stands — read `automaton-` (`PIPELINE.md`, `AI_TASK_BOARD.md`, the builder, the Netlify functions), `auto` and `premium-client-redesigns`, and write `STATE.md` here: what a client site goes through today from lead to delivery, what works, what's half-built, and the three changes that would most help land premium clients
- [ ] Meetings: discovery calls booked straight from automaton.llc — compare Cal.com and Calendly (price, embed, webhooks, calendar sync) in `MEETINGS.md`, then build the booking section and its confirmation page here, ready to drop into the site; the scheduler account is Markus's
- [ ] Lead bot: a chat assistant for automaton.llc that answers from a written FAQ (services, price ranges, timelines), qualifies the lead and offers a call — its model calls go through a server function, never a key in the page; tested here against a local copy of the page
- [ ] Follow-up automation: when a lead comes in or books, the next steps drafted — a reply, a reminder before the call, a Needs item for Markus — as a Netlify function ready for review; drafts only, nothing sent
- [ ] Premium site playbook: the `website-standards` loop as a checklist, and one showcase rebuild of a real client site from `premium-client-redesigns` to that bar, rendered at phone, tablet and desktop
- [ ] Packages and proposal: three tiers (a site; a site with the bot and booking; a site with the bot, booking and follow-up), what's in each, and a one-page proposal template — the prices are Markus's call
- [ ] Bot, booking and follow-up added to the client site template, so each premium site can ship with them

## Rules
- `automaton-`'s `CLAUDE.md` governs work there, including: no secrets in front-end code or docs; extra care with email, Stripe, Supabase, Twilio, SendGrid, Gmail and Netlify, with the risk explained first; and asking before anything that touches production or live customers.
- The Caller desktop layout (V10.8) is left alone.
- Nothing is emailed, texted, deployed or charged by JARVIS without Markus.
- JARVIS's runs work in this folder and only read the Automaton repos. A change meant for one of them is made in a separate worktree on a local branch (`jarvis/<what>`), never in Markus's own checkout and never pushed — a push can start paid Netlify builds — and goes on his Needs list to review and merge. The repo's `AI_TASK_BOARD.md` is read first: files another active task claims are left alone.
- Leads' and clients' details stay out of git.

## Status
2026-10-26 — JARVIS starts building it: the milestones above, a run at a time alongside the other projects. The live site, pipeline and leads are on the Automaton page.

## From Markus
- 2026-10-26: Focus on real estate and premium client websites, with setting up bots, meetings and automation.
