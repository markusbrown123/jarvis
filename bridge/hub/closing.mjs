/**
 * Closing an interested business and launching their site, one page per business:
 * /api/close/<sig>/<lead> (signed, opened from Needs). Each outward step is a button Markus
 * presses there; nothing is published, sent or charged otherwise.
 *
 *   share      publish the preview as its own Netlify site (unindexed) so he can text the link
 *   agreement  create the client in the site kit with the plan and price → the link they open
 *              to read and accept the agreement and pay (Stripe Checkout)
 *   (kit)      agreed → paid → intake form: each arrives on the kit feed (sitekit.mjs → onEvent)
 *   build      on intake, the live site is built from their own words (sitegen, live mode)
 *   publish    deploy the live site to Netlify, point the kit's form at it, send its enquiries
 *              to the owner, and give Markus the DNS steps for their domain
 */
import { spawnSync } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fromLead } from '../../bases/sites/engine/lib/business.mjs'
import { deploy } from '../../bases/sites/engine/lib/netlify.mjs'
import { TRADES } from '../../bases/sites/engine/lib/score.mjs'
import { build, check, rebase } from '../../bases/sites/sitegen/sitegen.mjs'
import { engineStore, previewUrl } from './leadengine.mjs'
import { secret } from './phone.mjs'
import * as hub from './store.mjs'

export const deps = { fetch: (...a) => fetch(...a), deploy }
const PROJECT = 'automaton'
const kit = () => ({ url: (secret('KIT_URL', 'KIT_URL') ?? '').replace(/\/$/, ''), key: secret('KIT_ADMIN_KEY', 'KIT_ADMIN_KEY') })
const netlifyToken = () => secret('NETLIFY_AUTH_TOKEN', 'NETLIFY_AUTH_TOKEN')
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

const sign = (id) => createHmac('sha256', hub.apiToken()).update(`close:${id}`).digest('hex').slice(0, 32)
export const closeUrl = (id) => `/api/close/${sign(id)}/${encodeURIComponent(id)}`

async function kitAdmin(method, body, query = '') {
  const { url, key } = kit()
  if (!url || !key) throw new Error('the site kit isn\'t connected (KIT_URL and KIT_ADMIN_KEY, HOME_SETUP step 4)')
  const res = await deps.fetch(`${url}/api/admin/clients${query}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`site kit ${res.status}: ${out.error ?? 'request failed'}`)
  return out
}

const save = (lead) => {
  const st = engineStore()
  st.putLead(lead)
  st.save()
  return st.lead(lead.id)
}

// ---- the steps

export async function sharePreview(id) {
  const l = engineStore().lead(id)
  if (!l?.preview?.dir) throw new Error('no preview built for this business')
  const out = await deps.deploy({ token: netlifyToken(), dir: l.preview.dir, siteId: l.shared?.siteId ?? null, name: `preview-${slug(l.name)}-${randomBytes(3).toString('hex')}` })
  const lead = save({ id, shared: { siteId: out.siteId, url: out.url, at: new Date().toISOString() } })
  hub.activity({ source: 'jarvis', project: PROJECT, title: `Preview for ${l.name} is shareable: ${out.url}`, level: 'success' })
  return lead
}

export async function prepareAgreement(id, { plan = 'launch', oneTimeUsd = 299, monthlyUsd = 0 } = {}) {
  const l = engineStore().lead(id)
  if (!l) throw new Error('no such business')
  if (!['launch', 'premium'].includes(plan)) throw new Error('plan is launch or premium')
  const cents = (usd) => Math.round(Number(usd) * 100)
  if (!(cents(oneTimeUsd) >= 0 && cents(monthlyUsd) >= 0) || cents(oneTimeUsd) + cents(monthlyUsd) <= 0) throw new Error('give a price')
  const c = l.client?.id
    ? await kitAdmin('POST', { id: l.client.id, plan, oneTimeCents: cents(oneTimeUsd), monthlyCents: cents(monthlyUsd) })
    : await kitAdmin('POST', { name: l.name, plan, oneTimeCents: cents(oneTimeUsd), monthlyCents: cents(monthlyUsd), contact: { phone: l.phoneDisplay ?? l.phone }, leadId: l.id })
  const lead = save({ id, stage: 'closing', client: { id: c.id, token: c.token, plan: c.plan, oneTimeCents: c.oneTimeCents, monthlyCents: c.monthlyCents, agreementUrl: `${kit().url}/c/${c.token}`, status: c.status } })
  hub.upsertItem({
    id: `leads:agreement:${id}`,
    source: 'jarvis',
    project: PROJECT,
    title: `Send ${l.name} their agreement link`.slice(0, 140),
    why: `${c.plan === 'premium' ? 'Premium' : 'Launch'}: $${(c.oneTimeCents / 100).toFixed(0)} one time${c.monthlyCents ? ` + $${(c.monthlyCents / 100).toFixed(0)}/month` : ''}. They read it, agree with their name, and pay by card; then a short form asks for their details.`,
    instructions: 'Send it the way they agreed to be contacted (text or email), with a line in your own words. I\'ll tell you when they\'ve agreed, paid, and filled in the form.',
    priority: 'P1',
    state: 'open',
    actions: [{ kind: 'copy', label: 'Copy the agreement link', value: lead.client.agreementUrl }, { kind: 'open', label: 'Close page', url: closeUrl(id) }],
  })
  return lead
}

/** Their intake answers + what Google says → the facts the live site is built from. */
export function businessFrom(lead, client, { netlifyName }) {
  const f = client.intake?.fields ?? {}
  const services = String(f.services ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((line) => {
      const [name, ...rest] = line.split(/\s*[:–—-]\s+/)
      return { name: name.slice(0, 80), description: rest.join(' ').slice(0, 240) }
    })
  const base = fromLead(lead)
  return {
    ...base,
    name: f.business || lead.name,
    telephone: f.phone || lead.phone,
    privacyContact: f.email,
    about: f.about,
    services,
    areaServed: String(f.areas ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12),
    hoursText: f.hours ? f.hours.split('\n').map((s) => s.trim()).filter(Boolean) : base.hoursText,
    license: f.license || undefined,
    insured: f.insured === 'yes',
    url: f.domain ? `https://${f.domain}` : `https://${netlifyName}.netlify.app`,
    type: TRADES[lead.trade]?.schema ?? 'HomeAndConstructionBusiness',
  }
}

export async function buildLive(id) {
  const st = engineStore()
  const l = st.lead(id)
  if (!l?.client?.id) throw new Error('no client yet')
  const c = await kitAdmin('GET', null, `?id=${encodeURIComponent(l.client.id)}`)
  if (!c.intake) throw new Error('their intake form isn\'t in yet')
  const netlifyName = l.live?.name ?? `${slug(c.intake.fields.business || l.name)}-${randomBytes(2).toString('hex')}`
  const b = businessFrom(l, c, { netlifyName })
  const missing = check(b)
  const dir = join(st.dir, 'clients', l.client.id, 'site')
  if (missing.length) {
    save({ id, live: { ...(l.live ?? {}), name: netlifyName, missing } })
    return { missing }
  }
  build(b, { mode: 'live', outDir: dir, kit: { url: kit().url, site: l.client.id } })
  // The copy check from the website skills, when this Mac has them (~/auto).
  const checker = join(homedir(), 'auto/.claude/skills/local-service-copy/scripts/copy-check.mjs')
  const copy = existsSync(checker) ? spawnSync(process.execPath, [checker, dir], { encoding: 'utf8', timeout: 60000 }).stdout.trim().split('\n').at(-1) : 'copy check not available here'
  const lead = save({ id, stage: 'site_ready', live: { ...(l.live ?? {}), name: netlifyName, dir, url: b.url, domain: c.intake.fields.domain || null, notifyEmail: c.intake.fields.email, builtAt: new Date().toISOString(), copy, missing: [] } })
  hub.upsertItem({
    id: `leads:review:${id}`,
    source: 'jarvis',
    project: PROJECT,
    title: `Review ${b.name}'s site, then publish`.slice(0, 140),
    why: `Built from their intake form: ${b.services.length} services, ${b.areaServed.length} towns, privacy, terms and accessibility pages. Copy check: ${copy}.`,
    instructions: 'Read every page as the owner would. If it\'s right, press Publish on the close page; if not, tell me what to change.',
    priority: 'P1',
    state: 'open',
    actions: [{ kind: 'open', label: 'Look at the site', url: `${closeUrl(id)}/site/` }, { kind: 'open', label: 'Close page', url: closeUrl(id) }],
  })
  return { lead }
}

export async function publish(id) {
  const l = engineStore().lead(id)
  if (!l?.live?.dir || l.stage !== 'site_ready' && l.stage !== 'won') throw new Error('build and review the site first')
  const out = await deps.deploy({ token: netlifyToken(), dir: l.live.dir, siteId: l.live.siteId ?? null, name: l.live.name, customDomain: l.live.domain })
  const origins = [out.url, ...(l.live.domain ? [`https://${l.live.domain}`, `https://www.${l.live.domain}`] : [])].map((o) => o.replace(/\/$/, ''))
  await kitAdmin('POST', { id: l.client.id, origins, notifyEmail: l.live.notifyEmail, status: 'live' })
  const lead = save({ id, stage: 'won', live: { ...l.live, siteId: out.siteId, netlifyUrl: out.url, publishedAt: new Date().toISOString() } })
  for (const it of [`leads:review:${id}`, `leads:close:${id}`, `leads:agreement:${id}`]) if (hub.getItem(it)?.state !== 'resolved') hub.upsertItem({ id: it, state: 'resolved' }, { fromSource: false })
  hub.upsertItem({
    id: `leads:live:${id}`,
    source: 'jarvis',
    project: PROJECT,
    title: `${l.name} is live at ${out.url}${l.live.domain ? `: point ${l.live.domain} at it` : ''}`.slice(0, 140),
    why: `Enquiries from the site now go to ${l.live.notifyEmail} and to your feed.`,
    instructions: l.live.domain
      ? `At their domain registrar (they log in, or share access): an A record for ${l.live.domain} → 75.2.60.5, and a CNAME for www → ${out.url.replace(/^https?:\/\//, '')}. Netlify issues the HTTPS certificate on its own once the DNS is through (minutes to a few hours). Then send the owner the link.`
      : `They have no domain yet: the site works at ${out.url}. If they buy one, tell me and I'll connect it.`,
    priority: 'P2',
    state: 'open',
    actions: [{ kind: 'open', label: 'Open the live site', url: out.url }, { kind: 'copy', label: 'Copy the link', value: out.url }],
  })
  hub.activity({ source: 'jarvis', project: PROJECT, title: `Published ${l.name}: ${out.url}`, level: 'success' })
  return lead
}

/** Kit feed events about a client (sitekit.mjs passes them here). */
export async function onEvent(e) {
  const st = engineStore()
  const l = Object.values(st.leads()).find((x) => x.client?.id === e.ref)
  const name = l?.name ?? e.record?.name ?? e.ref
  if (!l) {
    hub.activity({ source: 'jarvis', project: PROJECT, title: `Client ${name}: ${e.type}`, level: 'info' })
    return
  }
  save({ id: l.id, client: { ...l.client, status: e.type } })
  const words = { agreed: `${name} accepted the agreement${e.record?.acceptance?.name ? ` (${e.record.acceptance.name})` : ''}`, paid: `${name} paid${e.record?.payment?.amountCents ? ` $${(e.record.payment.amountCents / 100).toFixed(2)}` : ''}`, intake: `${name} sent their details` }
  hub.activity({ source: 'jarvis', project: PROJECT, title: words[e.type] ?? `${name}: ${e.type}`, level: 'success' })
  if (e.type === 'paid' && hub.getItem(`leads:agreement:${l.id}`)?.state !== 'resolved') hub.upsertItem({ id: `leads:agreement:${l.id}`, state: 'resolved' }, { fromSource: false })
  if (e.type === 'intake') {
    try {
      const r = await buildLive(l.id)
      if (r.missing?.length)
        hub.upsertItem({ id: `leads:review:${l.id}`, source: 'jarvis', project: PROJECT, title: `${name}'s details are incomplete`, why: `Still needed: ${r.missing.join(', ')}.`, instructions: 'Ask them, then tell me and I\'ll rebuild.', priority: 'P2', state: 'open', actions: [{ kind: 'open', label: 'Close page', url: closeUrl(l.id) }] })
    } catch (err) {
      hub.activity({ source: 'jarvis', project: PROJECT, title: `Couldn't build ${name}'s site: ${err.message}`, level: 'warn' })
    }
  }
}

// ---- the close page

const HEAD = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const SITE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'self'"
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' }

function closePage(l, flash = '') {
  const c = l.client
  const step = (done, title, body) => `<section><h2>${done ? '✓ ' : ''}${esc(title)}</h2>${body}</section>`
  const btn = (action, label, extra = '') => `<form method="post"><input type="hidden" name="action" value="${action}">${extra}<button>${esc(label)}</button></form>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Close: ${esc(l.name)}</title>
<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;color:#14161a}main{max-width:42rem;margin:0 auto;padding:1.2rem 1rem 3rem}h1{font-size:1.5rem}h2{font-size:1.05rem;border-top:1px solid #e3e6ea;padding-top:1rem;margin-top:1.4rem}
button{font:inherit;font-weight:600;padding:.6rem 1rem;border-radius:.45rem;border:0;background:#1f5fd6;color:#fff;min-height:44px;cursor:pointer;margin-top:.5rem}input,select{font:inherit;padding:.45rem;border:1px solid #9aa1ab;border-radius:.4rem;min-height:40px}label{display:inline-block;margin:.3rem .8rem .3rem 0}
.flash{background:#e7f6ec;padding:.6rem .9rem;border-radius:.4rem}.err{background:#fdecea}.mono{font-family:ui-monospace,monospace;font-size:.85rem;word-break:break-all}</style></head><body><main>
<p><a href="/">← JARVIS</a></p><h1>Close: ${esc(l.name)}</h1>
${flash}
${step(!!l.shared, '1. Share the preview', l.shared ? `<p>Live preview (unindexed): <a href="${esc(l.shared.url)}" target="_blank" rel="noreferrer">${esc(l.shared.url)}</a></p><p class="mono">${esc(l.shared.url)}</p>` : `<p>Publishes the preview as its own Netlify site, so you can text them the link. It's marked as a preview and hidden from search.</p><p><a href="${esc(previewUrl(l.id))}" target="_blank" rel="noreferrer">Look at it first</a></p>${btn('share', 'Publish the preview link')}`)}
${step(!!c, '2. Agreement and payment', c ? `<p>${c.plan === 'premium' ? 'Premium' : 'Launch'}: $${(c.oneTimeCents / 100).toFixed(0)} one time${c.monthlyCents ? ` + $${(c.monthlyCents / 100).toFixed(0)}/month` : ''}. Status: <strong>${esc(c.status ?? 'sent')}</strong>.</p><p class="mono">${esc(c.agreementUrl)}</p>` : `<p>Creates their agreement page: they read it, agree with their name, pay by card (Stripe), then fill in a short form about their business.</p>${btn('agreement', 'Create the agreement link', `<label>Plan <select name="plan"><option value="launch">Launch</option><option value="premium">Premium</option></select></label><label>One time $ <input name="oneTime" value="299" inputmode="decimal" size="6"></label><label>Monthly $ <input name="monthly" value="0" inputmode="decimal" size="6"></label><br>`)}`)}
${step(['site_ready', 'won'].includes(l.stage), '3. Their site', l.live?.dir ? `<p><a href="${esc(closeUrl(l.id))}/site/" target="_blank" rel="noreferrer">Look at the site</a> (${esc(l.live.url)})${l.live.copy ? `. Copy check: ${esc(l.live.copy)}` : ''}.</p>` : l.live?.missing?.length ? `<p>Their details are missing: ${esc(l.live.missing.join(', '))}.</p>` : '<p>Built automatically when their form comes in.</p>')}
${step(l.stage === 'won', '4. Publish', l.stage === 'won' ? `<p>Live: <a href="${esc(l.live.netlifyUrl)}" target="_blank" rel="noreferrer">${esc(l.live.netlifyUrl)}</a>. Enquiries go to ${esc(l.live.notifyEmail)}.</p>` : l.stage === 'site_ready' ? `<p>Deploys it to Netlify, connects the contact form, and sends its enquiries to ${esc(l.live.notifyEmail)}.</p>${btn('publish', 'Publish the site')}` : '<p>After you\'ve reviewed the site.</p>')}
</main></body></html>`
}

async function readForm(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 4000) throw new Error('too large')
  }
  return Object.fromEntries(new URLSearchParams(body))
}

export async function serve(req, res, path) {
  const m = path.match(/^\/api\/close\/([0-9a-f]{32})\/([^/]+)(\/site(\/.*)?)?$/)
  if (!m) return false
  const [, sig, rawId, site, rest = '/'] = m
  let id = ''
  try {
    id = decodeURIComponent(rawId)
  } catch {}
  const no = () => (res.writeHead(404, { 'content-type': 'text/plain', ...HEAD }), res.end('not found'), true)
  if (!id || !timingSafeEqual(Buffer.from(sig), Buffer.from(sign(id)))) return no()
  const st = engineStore()
  st.reload()
  let l = st.lead(id)
  if (!l) return no()

  if (site && req.method === 'GET' && l.live?.dir) {
    const root = resolve(l.live.dir)
    let rel = '/'
    try {
      rel = decodeURIComponent(rest)
    } catch {
      return no()
    }
    let file = resolve(root, '.' + rel)
    if (file !== root && !file.startsWith(root + sep)) return no()
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file) || file.endsWith('_headers')) return no()
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    let body = readFileSync(file)
    if (type.startsWith('text/html')) body = rebase(body.toString('utf8'), `${closeUrl(id)}/site/`)
    res.writeHead(200, { ...HEAD, 'content-type': type, 'content-security-policy': SITE_CSP })
    res.end(body)
    return true
  }
  if (site) return no()

  let flash = ''
  if (req.method === 'POST') {
    try {
      const f = await readForm(req)
      if (f.action === 'share') l = await sharePreview(id)
      else if (f.action === 'agreement') l = await prepareAgreement(id, { plan: f.plan, oneTimeUsd: f.oneTime, monthlyUsd: f.monthly })
      else if (f.action === 'publish') l = await publish(id)
      else throw new Error('unknown action')
      flash = `<p class="flash">Done.</p>`
    } catch (e) {
      flash = `<p class="flash err">Couldn't do that: ${esc(e.message)}</p>`
      l = engineStore().lead(id)
    }
  }
  res.writeHead(200, HEAD)
  res.end(closePage(l, flash))
  return true
}
