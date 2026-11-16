# Your part, at the Mac

Everything else is built, tested and pushed. This is what only you can do: accounts, keys,
prices. About 45 minutes in all. Do it in order; each step says what it switches on.

Keys go in the Keychain (never in a file). Plain settings go in `~/.zshrc`. After changing
either, `jarvis restart` in a new Terminal window.

## 1. Update JARVIS — 2 min

```bash
jarvis update
```

Projects now shows four towers (Real estate, Sites, YouTube, Influencer).

The commands below use your jarvis folder; this finds it wherever it is:

```bash
J="$(cd "$(dirname "$(readlink -f "$(command -v jarvis)")")/.." && pwd)"; echo "$J"
```

## 2. Tools for the video pipeline — 5 min

```bash
brew install ffmpeg
pip3 install pillow
```

## 3. Real estate walkthroughs on Higgsfield — 10 min

1. **Key.** cloud.higgsfield.ai → API keys → create one (a key ID and a secret). Then:

   ```bash
   security add-generic-password -a "$USER" -s HF_KEY -w 'KEY_ID:KEY_SECRET'
   ```

2. **Price.** On your Higgsfield plan, work out what one DoP Turbo clip costs in dollars
   (credits per clip × what a credit costs you). Until this is set, nothing ever calls Higgsfield:

   ```bash
   echo 'export HF_USD_PER_CLIP=0.00   # ← your number' >> ~/.zshrc
   ```

3. **First real test, capped at $2.** Put 3–4 listing photos you have the right to use in a folder:

   ```bash
   mkdir -p ~/RealEstate/Inbox/test-listing      # copy the photos in, then:
   cd "$J/bases/realestate"
   python3 walkthrough.py ~/RealEstate/Inbox/test-listing --backend higgsfield:dop-turbo --max-spend 2
   open ~/RealEstate/Inbox/test-listing/walkthrough/review.html
   ```

   If anything's off, `walkthrough/render.log` and `MODELS.md` say what the API answered.

4. **Let it run itself.** When you like the result, JARVIS makes every listing with Higgsfield,
   never over $5 a listing:

   ```bash
   echo 'export WALKTHROUGH_BACKEND=higgsfield:dop-turbo' >> ~/.zshrc
   echo 'export WALKTHROUGH_MAX_SPEND=5' >> ~/.zshrc
   ```

   Then `jarvis restart` in a new Terminal. From then on: drop a listing's photos as a folder in
   `~/RealEstate/Inbox/`, and within about ten minutes it's on your Needs list with **Review it**
   (on the phone too). Without step 4 the inbox still works, with the free pan-and-zoom cut.

## 4. The websites' backend: the site kit — 20 min

1. **Anthropic API key** for the sites' assistant: console.anthropic.com → API keys. It's billed
   separately from your Claude plan; roughly 1–2 cents a reply, capped at 400 replies a site a day.
2. **Cal.com** (free): sign up, connect your calendar, make two 15-minute event types,
   *Discovery call* and *Walkthrough demo*. Copy both links.
3. **Put the kit on Netlify:**

   ```bash
   cd "$J/bases/sites/kit"
   npm install
   npx netlify-cli login
   npx netlify-cli init                 # a new site; publish directory: public
   openssl rand -hex 24                 # run it twice: one for each secret below
   npx netlify-cli env:set ANTHROPIC_API_KEY 'sk-ant-…'
   npx netlify-cli env:set KIT_ADMIN_KEY '<first random>'
   npx netlify-cli env:set CAL_WEBHOOK_SECRET '<second random>'
   npx netlify-cli env:set BOOKING_URL_AUTOMATON 'https://cal.com/<you>/discovery-call'
   npx netlify-cli env:set BOOKING_URL_WALKTHROUGHS 'https://cal.com/<you>/walkthrough-demo'
   npx netlify-cli deploy --prod
   ```

   It prints the site's address, `https://<name>.netlify.app`. That address shows the Premium page;
   `/walkthroughs/` is the agents' page.
4. **Cal.com webhooks.** On each event type → Webhooks → New: URL
   `https://<name>.netlify.app/api/booking?site=automaton` (on *Walkthrough demo*:
   `?site=walkthroughs`), secret = your `CAL_WEBHOOK_SECRET`, triggers: booking created,
   rescheduled, cancelled.
5. **Tell JARVIS where it is:**

   ```bash
   security add-generic-password -a "$USER" -s KIT_URL -w 'https://<name>.netlify.app'
   security add-generic-password -a "$USER" -s KIT_ADMIN_KEY -w '<first random>'
   jarvis restart
   ```

6. **Test it.** Open the site, ask the assistant something, then put your own number in
   "Call me on ___ today". Within three minutes it's on your Needs list and your phone, with a
   reply drafted for you. Book a test call on Cal.com: a "Call booked" item appears the same way.

Before a busy client goes live, check Netlify's free-tier limits
(`automaton-/NETLIFY_COST_GUARDRAILS.md`).

## 5. The assistant on automaton.llc — 5 min, when you're ready

It's a change to the live site, so it goes through the `automaton-` repo on a branch, not straight
to production. Either add this before `</body>` on the pages you want it:

```html
<script src="https://<name>.netlify.app/kit/widget.js" data-site="automaton" defer></script>
```

or say "Jarvis, put the site kit's widget on automaton.llc on a branch" and review what he makes.

## 5b. Finding, calling and closing clients — 25 min

JARVIS finds trade businesses that need a site, keeps the best 25 with a preview site each, and
gives you 2–3 at a time to call (Needs → each has a call sheet with the script). You make every
call yourself; JARVIS never calls, texts or emails a business.

1. **Google Places key** (finding businesses): console.cloud.google.com → new project → enable
   "Places API (New)" → Credentials → Create API key → restrict it to Places API (New). Add a
   budget alert (Billing → Budgets, e.g. $10/month). Then:

   ```bash
   security add-generic-password -a "$USER" -s GOOGLE_PLACES_API_KEY -w 'YOUR_KEY'
   ```

   Each weekly search is capped at 30 requests (about $1, and Google gives 1,000 a month free).
2. **Where to look**: say "Jarvis, look for roofers, plumbers and HVAC companies in Trenton and
   Hamilton, New Jersey". Then "Jarvis, find leads now", or wait for the weekly run.
3. **Keep Automaton's own leads out**: export the leads list from automaton.llc/data as CSV, then
   `node bases/sites/engine/cli.mjs import-contacted ~/Downloads/<file>.csv` (in the jarvis folder).
4. **Netlify token** (publishing previews and client sites when you press Publish):
   app.netlify.com → User settings → Applications → New access token.

   ```bash
   security add-generic-password -a "$USER" -s NETLIFY_AUTH_TOKEN -w 'nfp_…'
   ```
5. **Stripe and email for the kit**: the four settings under "Closing and client sites" in
   `bases/sites/kit/README.md` (`npx netlify-cli env:set …`, then `npx netlify-cli deploy --prod`).
6. **Legal**: have a lawyer read the agreement (`bases/sites/kit/lib/agreement.mjs`) and the
   client-site privacy/terms text (`bases/sites/sitegen/copy.mjs`) once.

Then `jarvis restart`. The flow: call sheet → "Interested" → the close page (publish the preview
link, create the agreement link) → they agree, pay and fill in the form → JARVIS builds the site →
you review it and press Publish → it's live, and its enquiries go to the owner.

## 6. Decisions only you can make

Tell JARVIS by voice or on the project's card ("for the real estate one, the price is …"); it goes
into the brief and the next run uses it.

- **Premium's price.** The page and the assistant say "priced on a short call" until you set one.
- **Walkthrough pricing**, per listing and monthly.
- **A name** for the walkthrough service. "Listing Walkthroughs" is a placeholder
  (`bases/sites/kit/sites/walkthroughs.mjs`).
- **Photos you have the right to use**, for a real sample reel. The agent page's sample is
  made from illustrations until then.

## What then runs by itself

- **Real estate**: photos in the inbox → a walkthrough → your Needs list, to review and send yourself.
- **Sites**: every lead and booked call → your Needs list and phone, with a reply drafted.
- **Autopilot**: JARVIS builds real estate and the sites first, YouTube and the influencer
  alongside, each about every two hours, within your Claude allowance.
- **Leads**: a weekly capped search, the best 25 with previews, and 2–3 to call at a time on Needs.
- **Never without you**: nothing is sent, posted, deployed or paid.
