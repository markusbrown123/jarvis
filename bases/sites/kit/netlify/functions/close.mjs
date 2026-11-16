/**
 * A client's own pages, reached from the one link Markus sends them: /c/<token>.
 *
 *   GET  /c/<token>          the agreement for their plan and price, with an "I agree" form
 *   POST /c/<token>/agree    records the acceptance (name, email, the text's version, when),
 *                            then sends them to Stripe Checkout to pay
 *   GET  /c/<token>/start    after paying: the intake form (their real facts for the site)
 *   POST /c/<token>/start    stores the intake; JARVIS builds the site from it
 *
 * Plain HTML forms, no scripts. The token is the only key, 32 random hex characters.
 * Everything a client typed is escaped wherever it's shown.
 */
import { createHash } from 'node:crypto'
import { agreement, PLANS, versionOf } from '../../lib/agreement.mjs'
import { byToken, putClient } from '../../lib/clients.mjs'
import { clean } from '../../lib/http.mjs'
import { addEvent } from '../../lib/store.mjs'

export const deps = { fetch: (...a) => fetch(...a) }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; base-uri 'none'"
const HEADERS = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`

const page = (title, body, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#16181d;background:#f6f7f9}main{max-width:44rem;margin:0 auto;padding:1.5rem 1.1rem 4rem;background:#fff;min-height:100vh}
h1{font-size:1.7rem;line-height:1.2}h2{font-size:1.1rem;margin-top:1.6rem}label{display:block;font-weight:600;margin:1rem 0 .3rem}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.65rem .75rem;border:1px solid #9aa1ab;border-radius:.4rem;min-height:46px}
.check{display:flex;gap:.6rem;align-items:flex-start;font-weight:400}.check input{width:auto;min-height:auto;margin-top:.35rem}button{font:inherit;font-weight:700;background:#1f4fbf;color:#fff;border:0;border-radius:.45rem;padding:.8rem 1.4rem;min-height:48px;margin-top:1.2rem;cursor:pointer}
.note{background:#eef4ff;border-radius:.5rem;padding:.8rem 1rem}.small{font-size:.9rem;color:#4b5260}.err{color:#a3261b;font-weight:600}</style></head>
<body><main>${body}</main></body></html>`,
    { status, headers: HEADERS },
  )
const notFound = () => page('Link not found', '<h1>This link isn\'t valid</h1><p>Check the link you were sent, or reply to the message it came in.</p>', 404)

async function readForm(req) {
  const text = await req.text()
  if (text.length > 20_000) throw Object.assign(new Error('too large'), { status: 413 })
  return Object.fromEntries(new URLSearchParams(text))
}

function agreementPage(c, error = '') {
  const sections = agreement(c)
  const plan = PLANS[c.plan] ?? PLANS.launch
  const accepted = c.acceptance
  return page(
    `${c.name}: website agreement`,
    `<p class="small">Website agreement · ${esc(plan.label)} plan</p><h1>${esc(c.name)}</h1>
${c.payment?.status === 'paid' ? `<p class="note">Paid, thank you. <a href="/c/${esc(c.token)}/start">Tell us about your business</a> so we can build the site.</p>` : ''}
${accepted && c.payment?.status !== 'paid' ? `<p class="note">You agreed on ${esc(new Date(accepted.at).toDateString())} as ${esc(accepted.name)}. The payment hasn't come through yet.</p>` : ''}
${sections.map(([h, ps]) => `<h2>${esc(h)}</h2>${ps.length > 1 ? `<ul>${ps.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : `<p>${esc(ps[0])}</p>`}`).join('\n')}
${
  c.payment?.status === 'paid'
    ? ''
    : `<form method="post" action="/c/${esc(c.token)}/agree">
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  <label for="name">Your full name</label><input id="name" name="name" autocomplete="name" required maxlength="100" value="${esc(accepted?.name ?? '')}">
  <label for="email">Email (for your receipt)</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" value="${esc(accepted?.email ?? '')}">
  <label class="check"><input type="checkbox" name="agree" value="yes" required> I agree to this agreement on behalf of ${esc(c.name)}, and I'm allowed to.</label>
  <button type="submit">I agree${c.oneTimeCents || c.monthlyCents ? ` and pay ${esc(money(c.oneTimeCents || c.monthlyCents))}${c.monthlyCents && c.oneTimeCents ? ` + ${esc(money(c.monthlyCents))}/month` : c.monthlyCents ? '/month' : ''}` : ''}</button>
  <p class="small">Payment is taken by Stripe; we never see your card.</p>
</form>`
}`,
  )
}

/** A Stripe Checkout session for the agreed price; null when Stripe isn't set up. */
async function checkout(c, origin) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !(c.oneTimeCents || c.monthlyCents)) return null
  const p = new URLSearchParams()
  const plan = PLANS[c.plan] ?? PLANS.launch
  let i = 0
  if (c.oneTimeCents) {
    p.set(`line_items[${i}][price_data][currency]`, 'usd')
    p.set(`line_items[${i}][price_data][product_data][name]`, `${plan.label} website for ${c.name}`.slice(0, 120))
    p.set(`line_items[${i}][price_data][unit_amount]`, String(c.oneTimeCents))
    p.set(`line_items[${i}][quantity]`, '1')
    i++
  }
  if (c.monthlyCents) {
    p.set(`line_items[${i}][price_data][currency]`, 'usd')
    p.set(`line_items[${i}][price_data][product_data][name]`, `${plan.label} hosting and features`.slice(0, 120))
    p.set(`line_items[${i}][price_data][unit_amount]`, String(c.monthlyCents))
    p.set(`line_items[${i}][price_data][recurring][interval]`, 'month')
    p.set(`line_items[${i}][quantity]`, '1')
  }
  p.set('mode', c.monthlyCents ? 'subscription' : 'payment')
  p.set('client_reference_id', c.id)
  p.set('metadata[client]', c.id)
  if (c.monthlyCents) p.set('subscription_data[metadata][client]', c.id)
  else p.set('payment_intent_data[metadata][client]', c.id)
  if (c.acceptance?.email) p.set('customer_email', c.acceptance.email)
  p.set('success_url', `${origin}/c/${c.token}/start?paid=1`)
  p.set('cancel_url', `${origin}/c/${c.token}`)
  const res = await deps.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: p.toString(),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || !out.url) throw new Error(`stripe ${res.status}: ${out?.error?.message ?? 'no session'}`)
  return out
}

function intakePage(c, error = '') {
  const i = c.intake?.fields ?? {}
  const v = (k, d = '') => esc(i[k] ?? d)
  return page(
    `${c.name}: about your business`,
    `<h1>Tell us about ${esc(c.name)}</h1>
<p>This is what your website will say, so it should be in your words. Ten minutes is plenty; we'll tidy it up and show you before anything goes live.</p>
${c.intake ? '<p class="note">We have your answers. You can change them below and send again.</p>' : ''}
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/c/${esc(c.token)}/start">
<label for="business">Business name, exactly as customers know it</label><input id="business" name="business" required maxlength="100" value="${v('business', c.name)}">
<label for="phone">Phone number for the site</label><input id="phone" name="phone" type="tel" required maxlength="40" value="${v('phone', c.contact?.phone ?? '')}">
<label for="email">Email where enquiries from the site should go</label><input id="email" name="email" type="email" required maxlength="254" value="${v('email', c.acceptance?.email ?? '')}">
<label for="about">About you: how long you've been doing this, who does the work, what you're proud of</label><textarea id="about" name="about" rows="5" required maxlength="2000">${v('about')}</textarea>
<label for="services">Your services, one per line (e.g. "Water heaters: repair and replacement, tank and tankless")</label><textarea id="services" name="services" rows="6" required maxlength="2000">${v('services')}</textarea>
<label for="areas">Towns you work in, separated by commas</label><input id="areas" name="areas" required maxlength="400" value="${v('areas')}">
<label for="hours">Your hours (optional)</label><textarea id="hours" name="hours" rows="3" maxlength="400">${v('hours')}</textarea>
<label for="license">License number (optional, shown on the site)</label><input id="license" name="license" maxlength="120" value="${v('license')}">
<label class="check"><input type="checkbox" name="insured" value="yes"${i.insured === 'yes' ? ' checked' : ''}> We're insured (we'll say so on the site)</label>
<label for="domain">Your web address, if you have one (e.g. garciaplumbing.com)</label><input id="domain" name="domain" maxlength="120" value="${v('domain')}">
<p class="small">Photos: reply to the message you got this link in with your best job photos (before/after, your team, your trucks). Real photos make people call.</p>
<label class="check"><input type="checkbox" name="confirm" value="yes" required> This is accurate, and we own or have permission to use anything we send for the site.</label>
<button type="submit">Send</button>
</form>`,
  )
}

export default async (req) => {
  const url = new URL(req.url)
  const m = url.pathname.match(/^\/c\/([0-9a-f]{32})(?:\/(agree|start))?\/?$/)
  if (!m) return notFound()
  const c = await byToken(m[1])
  if (!c) return notFound()
  const step = m[2] ?? ''
  const origin = process.env.URL || url.origin

  if (req.method === 'GET' && step === '') return agreementPage(c)
  if (req.method === 'POST' && step === 'agree') {
    if (c.payment?.status === 'paid') return Response.redirect(`${origin}/c/${c.token}/start`, 303)
    let f
    try {
      f = await readForm(req)
    } catch {
      return agreementPage(c, 'That was too long to send.')
    }
    const name = clean(f.name, 100)
    const email = clean(f.email, 254).toLowerCase()
    if (f.agree !== 'yes' || name.length < 3 || !EMAIL.test(email)) return agreementPage(c, 'Please type your full name, a valid email, and tick the box to agree.')
    const sections = agreement(c)
    c.acceptance = {
      name,
      email,
      at: new Date().toISOString(),
      version: versionOf(sections),
      text: sections,
      from: createHash('sha256').update(`${process.env.KIT_SALT ?? 'automaton-kit'}:${req.headers.get('x-nf-client-connection-ip') ?? ''}`).digest('hex').slice(0, 16),
    }
    await putClient(c)
    await addEvent('agreed', c.id, c.id)
    try {
      const session = await checkout(c, origin)
      if (!session) return page('Agreed', `<h1>Thank you, ${esc(name)}</h1><p>We've recorded your agreement. We'll be in touch about payment, then send you a short form about your business.</p>`)
      c.checkout = { id: session.id, at: new Date().toISOString() }
      await putClient(c)
      return Response.redirect(session.url, 303)
    } catch (e) {
      console.error('[close] checkout:', e.message)
      return page('Agreed', `<h1>Thank you, ${esc(name)}</h1><p>We've recorded your agreement, but the payment page didn't open. We'll send you a payment link shortly.</p>`)
    }
  }
  if (step === 'start') {
    const free = !c.oneTimeCents && !c.monthlyCents
    if (c.payment?.status !== 'paid' && !free) {
      // Just back from Stripe: the webhook can land a moment later.
      if (url.searchParams.get('paid')) return page('Payment received', `<h1>Thank you</h1><p>Your payment is going through. This page will be ready in a minute: <a href="/c/${esc(c.token)}/start">open it again</a>.</p>`)
      return Response.redirect(`${origin}/c/${c.token}`, 303)
    }
    if (req.method === 'GET') return intakePage(c)
    if (req.method === 'POST') {
      let f
      try {
        f = await readForm(req)
      } catch {
        return intakePage(c, 'That was too long to send.')
      }
      const fields = {
        business: clean(f.business, 100),
        phone: clean(f.phone, 40),
        email: clean(f.email, 254).toLowerCase(),
        about: String(f.about ?? '').trim().slice(0, 2000),
        services: String(f.services ?? '').trim().slice(0, 2000),
        areas: clean(f.areas, 400),
        hours: String(f.hours ?? '').trim().slice(0, 400),
        license: clean(f.license, 120),
        insured: f.insured === 'yes' ? 'yes' : '',
        domain: clean(f.domain, 120).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      }
      const missing = ['business', 'phone', 'email', 'about', 'services', 'areas'].filter((k) => !fields[k])
      if (missing.length || f.confirm !== 'yes' || !EMAIL.test(fields.email) || fields.phone.replace(/\D/g, '').length < 10) {
        c.intake = { ...(c.intake ?? {}), fields: { ...(c.intake?.fields ?? {}), ...fields } }
        return intakePage(c, 'Please fill in every required field with a valid phone and email, and tick the last box.')
      }
      c.intake = { fields, at: new Date().toISOString() }
      await putClient(c)
      await addEvent('intake', c.id, c.id)
      return page('Thank you', `<h1>Got it, thank you</h1><p>We're building your site now and will send you a link to look at before it goes live.</p>`)
    }
  }
  return notFound()
}

export const config = { path: '/c/*' }
