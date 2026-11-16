/**
 * The call sheet: one page per business in a batch, for Markus to read before dialling and
 * to record how it went. Plain HTML and forms, no scripts and nothing loaded from elsewhere.
 *
 * The script is honest by construction: say who you are and why you're calling in the first
 * sentence, ask before sending anything, take "don't call" as final, and never claim to be
 * Google or promise rankings. Calls aren't recorded.
 */
import { callWindow } from './batch.mjs'
import { TRADES } from './score.mjs'

export const OFFER = {
  launch: '$299 one time, no monthly fee: a custom site, live within about 48 hours of approval, and nothing to pay unless they like the preview.',
  premium: 'Premium (the site plus an assistant that answers visitors after hours, books calls into their calendar and drafts follow-ups) is priced on a short call.',
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The words, as data, so the same script shows in the sheet and in JARVIS's chat. */
export function script(lead) {
  const trade = TRADES[lead.trade]?.label ?? 'trade'
  const where = lead.city ? ` around ${lead.city}` : ''
  const finding = {
    none: "you don't have a website yet",
    social: 'people searching for you land on a social page rather than your own site',
    parked: 'your web address shows a placeholder page right now',
    broken: "your website isn't loading at the moment",
    weak: (lead.site?.notes?.[0] ?? 'your site could be working harder for you').replace(/\.$/, '').replace(/^It /, 'your site '),
    ok: 'you already have a site, and I had an idea for getting more calls out of it',
  }[lead.site?.status ?? 'none']
  return {
    opener: `Hi, is this the owner of ${lead.name}? This is Markus with Automaton. We build websites for ${trade} companies${where}. I'll be quick: I noticed ${finding}, so I put together a rough idea of a site for ${lead.name}. Could I text or email you the link to have a look? It's free, and there's no obligation.`,
    questions: [
      'Where do most of your jobs come from right now: referrals, Google, something else?',
      lead.site?.status === 'ok'
        ? 'When someone finds you after hours, what happens: do they leave a message, or call the next company?'
        : 'When someone Googles you and doesn\'t find a site, do you think some of them call the next company?',
      'If a website did one thing for you, what would it be: more calls, look more established, or take quote requests while you\'re on a job?',
    ],
    objections: [
      ['"I get enough work from referrals."', 'That\'s a good place to be. The site is mostly so referrals who look you up find something that backs up what they heard. Can I send the preview anyway? Thirty seconds to look.'],
      ['"I already have a website."', lead.site?.status === 'ok' ? 'It\'s a decent one. What I made adds after-hours answering and booking. Worth a look?' : `You do. I just noticed ${finding}. The preview shows what it could look like. Can I send it?`],
      ['"How much is it?"', OFFER.launch + ' ' + OFFER.premium],
      ['"Just send me some info."', 'Happy to. Is this the best number to text, or would you rather email? (Write down which, and only send there.)'],
      ['"Not interested."', 'No problem at all, thanks for your time. Would it be all right to check back in a few months? (If no, mark Do not call.)'],
      ['"Don\'t call me again."', 'Understood, I\'ll take you off our list. Sorry to bother you. (Mark Do not call right away.)'],
      ['"Is this a robot / are you recording?"', 'No, it\'s me, Markus, and the call isn\'t recorded.'],
    ],
    close: 'Great. I\'ll send the link to [number or email they chose] in the next few minutes. When\'s a good time for a five-minute follow-up after you\'ve looked: tomorrow morning or afternoon?',
    rules: [
      'Say who you are and why you\'re calling in the first sentence.',
      'Only send the preview where they said you could, and write that down.',
      '"Don\'t call" is final: mark it before you hang up.',
      'The preview is built from their public Google listing. Say so if asked. Don\'t claim it\'s finished or that it will rank them on Google.',
    ],
  }
}

/**
 * The sheet as HTML. `previewUrl` is where Markus can open the preview himself; `outcomeUrl`
 * (optional) is where the outcome form posts. Without it the sheet shows the CLI command.
 */
export function sheet(lead, { batch, previewUrl, outcomeUrl, now = new Date() } = {}) {
  const s = script(lead)
  const w = callWindow(lead, now)
  const reasons = (lead.score?.reasons ?? []).filter((r) => r.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 4)
  const tel = lead.phone ? `<a class="call" href="tel:${esc(lead.phone)}">Call ${esc(lead.phoneDisplay ?? lead.phone)}</a>` : ''
  const outcomes = [
    ['interested', 'Interested'],
    ['callback', 'Call back at…'],
    ['not_interested', 'Not interested'],
    ['no_answer', 'No answer'],
    ['voicemail', 'Left voicemail'],
    ['wrong_number', 'Wrong number'],
    ['do_not_call', 'Do not call'],
  ]
  const form = outcomeUrl
    ? `<form method="post" action="${esc(outcomeUrl)}">
  <label>Notes (what they said, where they want the link sent)<textarea name="note" rows="3" maxlength="1000"></textarea></label>
  <label>Call back at (their time) <input type="datetime-local" name="callbackAt"></label>
  <div class="outcomes">${outcomes.map(([v, l]) => `<button name="outcome" value="${v}"${v === 'do_not_call' ? ' class="dnc"' : ''}>${l}</button>`).join('')}</div>
</form>`
    : `<p class="mono">node bases/sites/engine/cli.mjs outcome ${esc(lead.id)} &lt;${outcomes.map(([v]) => v).join('|')}&gt; "note"</p>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>Call sheet: ${esc(lead.name)}</title>
<style>
:root{--ink:#14161a;--soft:#5b6270;--line:#e3e6ea;--bg:#fff;--ok:#0f7a3d;--warn:#a15c00;--accent:#1f5fd6}
@media (prefers-color-scheme:dark){:root{--ink:#eef0f3;--soft:#a3aab6;--line:#2b3038;--bg:#121418;--ok:#5bd38a;--warn:#f0b44c;--accent:#7aa7ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:46rem;margin:0 auto;padding:1.25rem 1rem 3rem}h1{font-size:1.6rem;margin:.2rem 0}h2{font-size:1rem;text-transform:none;margin:1.6rem 0 .4rem;border-top:1px solid var(--line);padding-top:1rem}
.meta{color:var(--soft)}.when{font-weight:600;color:${w.open ? 'var(--ok)' : 'var(--warn)'}}
.call{display:inline-block;margin:.6rem 0;padding:.7rem 1.1rem;border-radius:.5rem;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:1.1rem}
a{color:var(--accent)}blockquote{margin:.4rem 0;padding:.6rem .9rem;border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 7%,transparent)}
li{margin:.25rem 0}dt{font-weight:600;margin-top:.5rem}dd{margin:0 0 .3rem}
form label{display:block;margin:.6rem 0}textarea,input{width:100%;font:inherit;padding:.5rem;border:1px solid var(--line);border-radius:.4rem;background:transparent;color:inherit}
.outcomes{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.6rem}.outcomes button{font:inherit;padding:.55rem .9rem;border-radius:.45rem;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer;min-height:44px}
.outcomes .dnc{border-color:#c0392b;color:#c0392b}.mono{font-family:ui-monospace,monospace;font-size:.85rem;word-break:break-all}
</style></head><body><main>
<p class="meta">${batch ? `Batch ${esc(batch.n)} · ` : ''}${esc(TRADES[lead.trade]?.label ?? lead.category ?? '')}${lead.city ? ` · ${esc(lead.city)}, ${esc(lead.state ?? '')}` : ''} · score ${esc(lead.score?.total ?? '–')}</p>
<h1>${esc(lead.name)}</h1>
<p class="when">${w.open ? `Good time to call: it's ${esc(w.theirTime)} there.` : `Not now: it's ${esc(w.theirTime)} there. Next window ${esc(w.next ?? 'Monday')}.`}</p>
${tel}
<p class="meta">${esc(w.tip)}</p>

<h2>Why them</h2>
<ul>${reasons.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>

<h2>What we found</h2>
<ul>${(lead.site?.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<dl>
${lead.website ? `<dt>Their site</dt><dd><a href="${esc(lead.website)}" rel="noreferrer noopener" target="_blank">${esc(lead.website)}</a></dd>` : ''}
${lead.mapsUrl ? `<dt>Google listing</dt><dd><a href="${esc(lead.mapsUrl)}" rel="noreferrer noopener" target="_blank">${lead.rating ? `${esc(lead.rating)}★, ` : ''}${esc(lead.reviews ?? 0)} reviews</a></dd>` : ''}
${lead.address ? `<dt>Address</dt><dd>${esc(lead.address)}</dd>` : ''}
${lead.hours?.length ? `<dt>Hours</dt><dd>${lead.hours.map(esc).join('<br>')}</dd>` : ''}
</dl>

<h2>The preview we made</h2>
${previewUrl ? `<p><a href="${esc(previewUrl)}" target="_blank" rel="noreferrer">Open the preview</a>: look through it before you call, so you can describe it.</p>` : '<p>Not built yet.</p>'}

<h2>Opening (first 15 seconds)</h2>
<blockquote>${esc(s.opener)}</blockquote>
<h2>If they're open to it</h2>
<ol>${s.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
<h2>What they might say</h2>
<dl>${s.objections.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl>
<h2>Close</h2>
<blockquote>${esc(s.close)}</blockquote>
<h2>Ground rules</h2>
<ul>${s.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>

<h2>How it went</h2>
${form}
</main></body></html>`
}
