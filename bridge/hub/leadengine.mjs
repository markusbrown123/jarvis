/**
 * Automaton's lead engine, run by JARVIS (bases/sites/engine).
 *
 * Every 20 minutes: check new businesses' websites, score, keep 25 on the shortlist, build
 * their preview sites, and open the next batch of 2–3 when the last is finished. Once a week
 * (or when Markus asks) it searches Google Places for more, inside the request cap.
 *
 * Each business in the open batch is a Needs item with its call sheet and preview: signed
 * links (/api/leads/<sig>/<lead>/…), so they open on the phone without the dashboard token.
 * The sheet's outcome buttons post back here. Interested → a P1 item to close; callback → an
 * item that comes back at the agreed time; Do not call → the number is never shortlisted again.
 *
 * JARVIS never calls, texts or emails a business: Markus makes every call himself.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { open, openBatch, recordOutcome, run } from '../../bases/sites/engine/engine.mjs'
import { callWindow, FINAL, OUTCOMES } from '../../bases/sites/engine/lib/batch.mjs'
import { sheet } from '../../bases/sites/engine/lib/brief.mjs'
import { TRADES } from '../../bases/sites/engine/lib/score.mjs'
import { rebase } from '../../bases/sites/sitegen/sitegen.mjs'
import { secret } from './phone.mjs'
import * as hub from './store.mjs'

const EVERY = 20 * 60000
const WEEK = 7 * 24 * 3600_000
const PROJECT = 'automaton'

let store = null
const S = () => (store ??= open(join(hub.DATA_DIR, 'leads')))
const cfgFile = () => join(S().dir, 'engine.config.json')
export function config() {
  try {
    return { areas: [], trades: [], maxRequests: 30, shortlistSize: 25, batchSize: 3, ...JSON.parse(readFileSync(cfgFile(), 'utf8')) }
  } catch {
    return { areas: [], trades: [], maxRequests: 30, shortlistSize: 25, batchSize: 3 }
  }
}
export function setConfig(patch) {
  const next = { ...config(), ...patch }
  writeFileSync(cfgFile(), JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}
const placesKey = () => secret('GOOGLE_PLACES_API_KEY', 'GOOGLE_PLACES_API_KEY') ?? secret('GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_API_KEY')

// ---- signed links
const sign = (leadId) => createHmac('sha256', hub.apiToken()).update(`lead:${leadId}`).digest('hex').slice(0, 32)
export const sheetUrl = (id) => `/api/leads/${sign(id)}/${encodeURIComponent(id)}/sheet`
export const previewUrl = (id) => `/api/leads/${sign(id)}/${encodeURIComponent(id)}/preview/`

// ---- Needs items
const trade = (l) => TRADES[l.trade]?.label ?? l.category ?? 'trade'
function sync() {
  const st = S()
  const batch = openBatch(st)
  for (const l of Object.values(st.leads())) {
    const callId = `leads:call:${l.id}`
    if (batch && l.batchId === batch.id && !FINAL.has(l.outcome)) {
      const w = callWindow(l)
      const top = (l.score?.reasons ?? []).filter((r) => r.pts > 0).sort((a, b) => b.pts - a.pts)[0]
      const tries = (l.calls ?? []).length
      hub.upsertItem({
        id: callId,
        source: 'jarvis',
        project: PROJECT,
        title: `Call ${l.name} (${trade(l)}, ${l.city ?? l.state}): batch ${batch.n}`.slice(0, 140),
        why: `${top?.text ?? 'On the shortlist.'} ${w.open ? `Good time now (${w.theirTime} there).` : `Next good time: ${w.next}.`}${tries ? ` Tried ${tries} time${tries > 1 ? 's' : ''}.` : ''}`,
        instructions: `Open the call sheet first: the script, what we found, and the outcome buttons are there. Look through the preview so you can describe it. Phone: ${l.phoneDisplay ?? l.phone}.`,
        priority: 'P2',
        state: 'open',
        actions: [
          { kind: 'open', label: 'Call sheet', url: sheetUrl(l.id) },
          { kind: 'open', label: 'Preview site', url: previewUrl(l.id) },
          { kind: 'open', label: 'Call', url: `tel:${l.phone}` },
        ],
      })
    } else if (hub.getItem(callId) && hub.getItem(callId).state !== 'resolved') {
      hub.upsertItem({ id: callId, state: 'resolved' }, { fromSource: false })
    }
    const last = (l.calls ?? []).at(-1)
    // Items whose moment has passed: a callback that happened, a close that's won or lost.
    for (const [prefix, stage] of [['leads:close:', 'interested'], ['leads:callback:', 'callback']]) {
      const it = hub.getItem(prefix + l.id)
      if (it && l.stage !== stage && it.state !== 'resolved') hub.upsertItem({ id: it.id, state: 'resolved' }, { fromSource: false })
    }
    if (l.stage === 'interested')
      hub.upsertItem({
        id: `leads:close:${l.id}`,
        source: 'jarvis',
        project: PROJECT,
        title: `${l.name} is interested: send the preview and set up the close`.slice(0, 140),
        why: `They said yes on the call${last?.note ? `: "${last.note}"` : ''}.`,
        instructions: 'Send the preview link only where they agreed (it\'s in your note). When you\'re ready to close, tell me and I\'ll prepare the agreement, the payment link and the intake questions for you to send.',
        priority: 'P1',
        state: 'open',
        actions: [
          { kind: 'open', label: 'Call sheet', url: sheetUrl(l.id) },
          { kind: 'open', label: 'Preview site', url: previewUrl(l.id) },
          { kind: 'open', label: 'Call', url: `tel:${l.phone}` },
        ],
      })
    if (l.stage === 'callback' && last?.callbackAt) {
      const at = new Date(last.callbackAt).getTime()
      hub.upsertItem({
        id: `leads:callback:${l.id}`,
        source: 'jarvis',
        project: PROJECT,
        title: `Call ${l.name} back (${new Date(last.callbackAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })})`.slice(0, 140),
        why: last.note ? `They asked for a call back: "${last.note}"` : 'They asked for a call back.',
        instructions: 'Same sheet, same preview. Mark the outcome on the sheet afterwards.',
        priority: 'P2',
        state: at > Date.now() ? 'snoozed' : 'open',
        snoozedUntil: at > Date.now() ? at : undefined,
        actions: [
          { kind: 'open', label: 'Call sheet', url: sheetUrl(l.id) },
          { kind: 'open', label: 'Call', url: `tel:${l.phone}` },
        ],
      })
    }
  }
}

function setupNeeds(cfg) {
  if (!cfg.areas.length || !cfg.trades.length)
    hub.upsertItem({
      id: 'leads:setup',
      source: 'jarvis',
      project: PROJECT,
      title: 'Tell me where to find leads: towns and trades',
      why: 'The lead engine is ready but has nowhere to search yet.',
      instructions: `Say e.g. "Jarvis, look for roofers, plumbers and HVAC companies in Trenton and Hamilton, New Jersey". Trades I know: ${Object.keys(TRADES).join(', ')}. Each weekly search is capped at ${cfg.maxRequests} Google requests (about $${(cfg.maxRequests * 0.035).toFixed(2)}).`,
      priority: 'P3',
      state: 'open',
    })
  else if (hub.getItem('leads:setup')?.state === 'open') hub.upsertItem({ id: 'leads:setup', state: 'resolved' }, { fromSource: false })
  if (cfg.areas.length && !placesKey())
    hub.upsertItem({
      id: 'leads:key',
      source: 'jarvis',
      project: PROJECT,
      title: 'Add a Google Places key so I can search for leads',
      why: 'Finding businesses uses Google Places (Text Search). Nothing is searched until there\'s a key.',
      instructions: 'console.cloud.google.com → APIs & Services → enable "Places API (New)" → Credentials → API key, restricted to Places API (New). Then in Terminal:\nsecurity add-generic-password -a "$USER" -s GOOGLE_PLACES_API_KEY -w \'YOUR_KEY\'\nand restart JARVIS. Set a budget alert on the Google Cloud project too.',
      priority: 'P2',
      state: 'open',
    })
  else if (hub.getItem('leads:key')?.state === 'open') hub.upsertItem({ id: 'leads:key', state: 'resolved' }, { fromSource: false })
}

let busy = false
let status = { ok: false, detail: 'not run yet' }
export const engineStatus = () => status

/** One pass. `discover` forces a (capped, paid) Places search now. */
export async function tick({ discover = false } = {}) {
  if (busy) return status
  busy = true
  try {
    const st = S()
    st.reload()
    const cfg = config()
    setupNeeds(cfg)
    const key = placesKey()
    const lastSearch = st.readLog().filter((e) => e.type === 'discover').at(-1)
    const due = key && cfg.areas.length && cfg.trades.length && (discover || !lastSearch || Date.now() - new Date(lastSearch.at).getTime() > WEEK)
    const out = await run(st, { ...cfg, key, discoverToo: !!due })
    sync()
    const leads = Object.values(st.leads())
    status = {
      ok: true,
      at: Date.now(),
      detail: `${leads.length} found, ${leads.filter((l) => ['shortlisted', 'preview_ready', 'in_batch'].includes(l.stage)).length} on the shortlist${out.batch?.status === 'open' ? `, batch ${out.batch.n} open` : ''}${out.discover ? `; searched (${out.discover.requests} requests, $${out.discover.usd})` : ''}`,
    }
    if (out.discover?.added) hub.activity({ source: 'jarvis', project: PROJECT, title: `Lead engine: ${out.discover.added} new businesses found ($${out.discover.usd})`, level: 'info' })
    return status
  } catch (e) {
    status = { ok: false, at: Date.now(), detail: e.message }
    console.warn('[hub] lead engine:', e.message)
    return status
  } finally {
    busy = false
  }
}

/** Record an outcome (from the sheet, or from Markus by voice). */
export function outcome(leadId, what, { note = '', callbackAt = null } = {}) {
  const st = S()
  const l = recordOutcome(st, leadId, what, { note, callbackAt: callbackAt || null, dnc: st.dnc })
  st.save()
  sync()
  hub.activity({ source: 'jarvis', project: PROJECT, title: `Call: ${l.name}, ${what.replace(/_/g, ' ')}`, level: what === 'interested' ? 'success' : 'info' })
  // The batch may have just finished: open the next one straight away.
  void tick()
  return l
}

/** A business by name or id, among the batch first, then everyone. */
export function findLead(text) {
  const st = S()
  const all = Object.values(st.leads())
  if (st.lead(text)) return st.lead(text)
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
  const n = norm(text)
  const batch = openBatch(st)
  const pool = [...all.filter((l) => batch?.leadIds.includes(l.id)), ...all.filter((l) => ['interested', 'callback'].includes(l.stage)), ...all]
  return pool.find((l) => norm(l.name) === n) ?? pool.find((l) => norm(l.name).includes(n)) ?? null
}

export function summary() {
  const st = S()
  const all = Object.values(st.leads())
  const by = {}
  for (const l of all) by[l.stage] = (by[l.stage] ?? 0) + 1
  const b = openBatch(st)
  const spent = st.readLog().filter((e) => e.type === 'discover').reduce((a, e) => a + (e.usd ?? 0), 0)
  return [
    `Lead engine: ${engineStatus().detail}.`,
    `Stages: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ') || 'none yet'}. Google spend so far: $${spent.toFixed(2)}.`,
    `Searching: ${config().areas.join('; ') || '(no towns set)'} for ${config().trades.join(', ') || '(no trades set)'}.`,
    b
      ? `Open batch ${b.n}: ${b.leadIds.map((id) => st.lead(id)).map((l) => `${l.name} (${trade(l)}, ${l.city}; ${l.outcome ?? (l.calls?.length ? `tried ${l.calls.length}×` : 'not called yet')}; ${callWindow(l).open ? 'good time now' : 'next: ' + callWindow(l).next})`).join('; ')}.`
      : 'No batch open.',
    ...all.filter((l) => l.stage === 'interested').map((l) => `Interested: ${l.name}.`),
  ].join('\n')
}

// ---- serving: GET …/sheet, POST …/outcome, GET …/preview/<path>
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' }
const SAFE = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'cache-control': 'private, no-store',
}
const CSP_SHEET = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
const CSP_PREVIEW = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'self'"

const notFound = (res) => (res.writeHead(404, { 'content-type': 'text/plain', ...SAFE }), res.end('not found'), true)

async function readForm(req, limit = 8000) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw new Error('too large')
  }
  return Object.fromEntries(new URLSearchParams(body))
}

/** True if it handled the request. */
export async function serve(req, res, path) {
  const m = path.match(/^\/api\/leads\/([0-9a-f]{32})\/([^/]+)\/(sheet|outcome|preview)(\/.*)?$/)
  if (!m) return false
  const [, sig, rawId, what, rest = '/'] = m
  let id = ''
  try {
    id = decodeURIComponent(rawId)
  } catch {}
  if (!id || !timingSafeEqual(Buffer.from(sig), Buffer.from(sign(id)))) return notFound(res)
  const st = S()
  st.reload()
  const lead = st.lead(id)
  if (!lead) return notFound(res)

  if (what === 'sheet' && req.method === 'GET') {
    const batch = st.batches().find((b) => b.id === lead.batchId)
    const html = sheet(lead, { batch, previewUrl: lead.preview ? previewUrl(id) : null, outcomeUrl: `/api/leads/${sig}/${encodeURIComponent(id)}/outcome` })
    const saved = new URL(req.url, 'http://x').searchParams.get('saved')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP_SHEET, ...SAFE })
    res.end(saved ? html.replace('<main>', `<main><p style="padding:.6rem .9rem;border-radius:.4rem;background:#e7f6ec;color:#0f5a2c">Saved: ${String(saved).replace(/[^a-z_]/g, '').replace(/_/g, ' ')}.</p>`) : html)
    return true
  }
  if (what === 'outcome' && req.method === 'POST') {
    let form
    try {
      form = await readForm(req)
    } catch {
      res.writeHead(413, SAFE)
      res.end()
      return true
    }
    if (!OUTCOMES.includes(form.outcome)) {
      res.writeHead(400, { 'content-type': 'text/plain', ...SAFE })
      res.end('pick an outcome')
      return true
    }
    let callbackAt = null
    if (form.outcome === 'callback') {
      // The sheet's datetime-local is in the business's time; read it as such.
      const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.callbackAt ?? '') ? zonedToUtc(form.callbackAt, callWindow(lead).tz) : null
      if (!t || Number.isNaN(t.getTime())) {
        res.writeHead(400, { 'content-type': 'text/plain', ...SAFE })
        res.end('a call back needs a time')
        return true
      }
      callbackAt = t.toISOString()
    }
    outcome(id, form.outcome, { note: form.note ?? '', callbackAt })
    res.writeHead(303, { location: `/api/leads/${sig}/${encodeURIComponent(id)}/sheet?saved=${form.outcome}`, ...SAFE })
    res.end()
    return true
  }
  if (what === 'preview' && req.method === 'GET' && lead.preview?.dir) {
    const root = resolve(lead.preview.dir)
    let rel = '/'
    try {
      rel = decodeURIComponent(rest)
    } catch {}
    let file = resolve(root, '.' + rel)
    if (file !== root && !file.startsWith(root + sep)) return notFound(res)
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file) || /(^|[/\\])_headers$/.test(file)) return notFound(res)
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    let body = readFileSync(file)
    if (type.startsWith('text/html')) body = rebase(body.toString('utf8'), previewUrl(id))
    res.writeHead(200, { 'content-type': type, 'content-security-policy': CSP_PREVIEW, ...SAFE })
    res.end(body)
    return true
  }
  return notFound(res)
}

// A wall-clock time in the business's zone ("2027-01-05T09:30") → the real instant, using the
// zone's offset on that date (not today's), so a January callback booked in October is right.
const offsetMin = (date, tz) => {
  const v = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(date).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT'
  const m = v.match(/GMT([+-])(\d{2}):(\d{2})/)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
}
export function zonedToUtc(local, tz) {
  const asUtc = Date.parse(`${local}:00Z`)
  let t = asUtc - offsetMin(new Date(asUtc), tz) * 60000
  t = asUtc - offsetMin(new Date(t), tz) * 60000
  return new Date(t)
}

export function start() {
  if (process.env.JARVIS_NO_LEADS) return
  setTimeout(() => void tick(), 90_000).unref()
  setInterval(() => void tick(), EVERY).unref()
}
