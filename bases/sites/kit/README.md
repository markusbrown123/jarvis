# Automaton site kit

The backend and the drop-in widget that make a premium site sell for its owner: an assistant
that answers visitors from the business's own facts, calls booked straight into the calendar
(Cal.com), every lead kept, and a feed JARVIS reads to draft the follow-up for Markus to approve.
Nothing is ever emailed or texted from here.

| Path | What |
|---|---|
| `netlify/functions/chat.mjs` | `POST /api/chat` — the assistant (Claude Opus 5.5, low effort, server-side fallbacks on). Daily caps per visitor and per site. |
| `netlify/functions/lead.mjs` | `POST /api/lead` — a visitor's details (email or phone), with the chat that led to it. Hidden trap field for bots. |
| `netlify/functions/booking.mjs` | `POST /api/booking?site=…` — Cal.com's webhook (booked, rescheduled, cancelled), signature checked, kept once per booking. |
| `netlify/functions/feed.mjs` | `GET /api/feed?since=…` — what's come in, for JARVIS. Needs `KIT_ADMIN_KEY`. |
| `netlify/functions/site.mjs` | `GET /api/site?site=…` — what the widget shows (never the assistant's instructions). |
| `netlify/functions/close.mjs` | `/c/<token>` — a client's agreement (accept with their name → Stripe Checkout), then `/c/<token>/start`, the intake form. Plain HTML, no scripts. |
| `netlify/functions/stripe.mjs` | `POST /api/stripe` — Stripe's webhook, signature checked; records the payment once. |
| `netlify/functions/admin.mjs` | `/api/admin/clients` — JARVIS creates and updates clients (`KIT_ADMIN_KEY`). Price can't change once agreed. |
| `lib/agreement.mjs`, `lib/clients.mjs` | The website services agreement (versioned by hash), and client records in Blobs. |
| `sites/*.mjs` | One file per site: its facts, greeting, suggestions, allowed origins. The assistant answers only from `facts`. |
| `public/kit/widget.js` | The widget. One script tag on any allowed site. |
| `public/index.html` | Automaton Premium's page. |
| `public/walkthroughs/` | The listing walkthrough page for agents (its sample tour is made from illustrations, `tools/rooms.py`). |
| `dev.mjs` | Local preview: the pages and the real handlers, leads kept in memory. |

## Try it locally

```bash
cd bases/sites/kit
npm install
KIT_FAKE_MODEL=1 node dev.mjs           # canned answers, no key, no cost → http://localhost:8888
ANTHROPIC_API_KEY=… node dev.mjs         # the real assistant
npm test                                 # the API, end to end, against a stand-in model
```

## Put it live (Markus, at the Mac)

1. **Netlify site.** From this folder: `npx netlify-cli login`, `npx netlify-cli init` (a new
   site; build command none, publish `public`, functions `netlify/functions`). Netlify Blobs needs
   no setup. Check `automaton-/NETLIFY_COST_GUARDRAILS.md` against the plan first.
2. **Its settings** (Site configuration → Environment variables, or `npx netlify-cli env:set NAME value`):

   | Variable | |
   |---|---|
   | `ANTHROPIC_API_KEY` | the assistant's key (console.anthropic.com). Without it the widget still takes details. |
   | `KIT_ADMIN_KEY` | a long random string (`openssl rand -hex 24`); JARVIS uses it to read the feed |
   | `CAL_WEBHOOK_SECRET` | the secret you give Cal.com's webhook (`openssl rand -hex 24`) |
   | `BOOKING_URL_AUTOMATON` | the Cal.com link for a discovery call, e.g. `https://cal.com/automaton/discovery` |
   | `BOOKING_URL_WALKTHROUGHS` | the Cal.com link for a walkthrough demo |
   | `KIT_SALT` | optional: any random string, for hashing visitors' addresses |
   | `KIT_CHAT_PER_VISITOR`, `KIT_CHAT_PER_DAY` | optional caps on assistant replies (40 a visitor, 400 a site, a day) |

3. **Deploy:** `npx netlify-cli deploy --prod`. Note the site's address (`https://<name>.netlify.app`, or a domain).
4. **Cal.com** (see `../MEETINGS.md` for why Cal.com): two event types, "Discovery call" and
   "Walkthrough demo", 15 minutes, connected to your calendar. On each, Webhooks → new webhook:
   URL `https://<kit>/api/booking?site=automaton` (or `site=walkthroughs`), triggers Booking
   created, rescheduled and cancelled, secret = `CAL_WEBHOOK_SECRET`.
5. **JARVIS**: give him the kit's address and key (Keychain service names `KIT_URL` and
   `KIT_ADMIN_KEY`, or the same environment variables). He reads the feed every few minutes,
   drafts a reply to each new lead and booking, and puts it on your Needs list to approve.
6. **On automaton.llc** (a change to the `automaton-` repo, so on a branch and through its task
   board): `<script src="https://<kit>/kit/widget.js" data-site="automaton" defer></script>`
   before `</body>`. A client site gets its own `sites/<client>.mjs` and its own `data-site`.

## Closing and client sites (Markus, once)

| Variable | |
|---|---|
| `STRIPE_SECRET_KEY` | a **restricted** key (Stripe → Developers → API keys → Create restricted key) with only Checkout Sessions: write. Never the full secret key. |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → Add endpoint `https://<kit>/api/stripe`, event `checkout.session.completed`; copy its signing secret (`whsec_…`). |
| `RESEND_API_KEY`, `KIT_NOTIFY_FROM` | to send each client their site's enquiries (resend.com, a verified sending domain, e.g. `Automaton <leads@automaton.llc>`). Without them enquiries still reach you through JARVIS. |
| `KIT_LEGAL_NAME`, `KIT_GOVERNING_STATE` | Automaton's legal name and state, as they should appear in the agreement. |

Have a lawyer read `lib/agreement.mjs` and the client-site privacy policy and terms (`../sitegen/copy.mjs`) once before the first real client: they're careful plain-language templates, not legal advice.

## What it costs to run

The assistant is Claude Opus 5.5 at low effort ($4 per million input tokens, $20 per million
output). A reply reads about 1,500 tokens (the facts and the chat so far) and writes a few hundred,
so roughly 1 to 2 cents a reply; the default caps hold a site to 400 replies a day. Refusals
are re-run on another model server-side (`fallbacks: "default"`), so a visitor isn't left
without an answer. Netlify Functions and Blobs fit the free tier at small-business traffic;
check the plan's limits before a busy client goes live.

## Rules it keeps

- Answers only from the site's `facts`; a price or promise that isn't written there, it won't make.
- Never sends anything: leads and bookings wait for Markus, through JARVIS.
- No key or secret in the page; the functions hold them.
- Visitors are told it's an AI assistant. Their address is stored only as a salted hash.
