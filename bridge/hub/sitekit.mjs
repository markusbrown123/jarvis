/**
 * Leads and bookings from the sites (the site kit, bases/sites/kit), brought
 * to Markus.
 *
 * Every three minutes JARVIS reads the kit's feed (KIT_URL and KIT_ADMIN_KEY,
 * from the environment or the Keychain). Each new lead or booked call goes on
 * Needs — a lead as P1, so it reaches his phone — and a background job drafts
 * the reply, which lands on the same item to copy and send himself. Nothing
 * is sent from here, and a lead's details stay in JARVIS's own data folder.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hub from './store.mjs'
import { secret } from './phone.mjs'
import { baseDir } from './streams.mjs'
import * as closing from './closing.mjs'

const FILE = join(hub.DATA_DIR, 'sitekit.json')
const EVERY = 3 * 60000
const MAX_DRAFTS_AN_HOUR = 12
// Which of Markus's projects a site's leads belong to.
const PROJECT = { automaton: 'automaton', walkthroughs: 'realestate' }
const LABEL = { automaton: 'Automaton', walkthroughs: 'Listing Walkthroughs' }

const read = () => {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
  } catch {
    return {}
  }
}
let saved = { cursor: 0, drafted: [], ...read() }
const save = () => writeFileSync(FILE, JSON.stringify(saved, null, 2))
let status = { ok: false, detail: 'not checked yet' }
export const kitStatus = () => status

const when = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const transcriptOf = (r) =>
  (r.transcript ?? [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`)
    .join('\n')

/** The reply, drafted by a background job onto the item. Never sent. */
function draft(runner, item, brief) {
  if (!runner) return
  const hourAgo = Date.now() - 3600_000
  saved.drafted = saved.drafted.filter((t) => t > hourAgo)
  if (saved.drafted.length >= MAX_DRAFTS_AN_HOUR) return
  saved.drafted.push(Date.now())
  save()
  try {
    runner.start({
      title: `Draft a reply: ${item.title}`.slice(0, 120),
      project: item.project,
      cwd: baseDir('automaton'),
      instructions: `${brief}

Write the message Markus could send, in his voice: short, warm, plain, specific to what they asked, ending with one clear next step. Use only what's written above and in BRIEF.md here (no prices or promises that aren't there). Don't send anything, don't use any tools, and don't write files. Put the message, and nothing else, between <draft> and </draft>.`,
      onDone: (output) => {
        const text = /<draft>([\s\S]*?)<\/draft>/.exec(output ?? '')?.[1]?.trim()
        const now = hub.getItem(item.id)
        if (!text || !now) return
        hub.upsertItem({
          id: item.id,
          instructions: `${item.instructions}\n\nSuggested reply (not sent):\n${text}`,
          actions: [...(now.actions ?? []).filter((a) => a.label !== 'Copy the reply'), { kind: 'copy', label: 'Copy the reply', value: text }],
        })
      },
    })
  } catch (err) {
    console.warn('[hub] sitekit draft:', err.message)
  }
}

/** One event from the feed onto Needs. */
export function take(e, runner) {
  const r = e.record
  if (!r) return
  // A paying client's progress (agreement, payment, intake form): the closing flow takes it.
  if (['agreed', 'paid', 'intake'].includes(e.type)) return void closing.onEvent(e).catch((err) => console.warn('[hub] closing:', err.message))
  // An enquiry on a client's own site already went to the client; Markus just sees it happened.
  if (e.type === 'lead' && !PROJECT[e.site]) {
    hub.activity({ source: 'jarvis', project: 'automaton', title: `Enquiry on a client's site (${e.site}): ${r.name || r.phone || r.email}`, level: 'info' })
    return
  }
  const project = PROJECT[e.site] ?? 'automaton'
  const site = LABEL[e.site] ?? e.site
  if (e.type === 'lead') {
    const who = r.name || r.phone || r.email
    const contact = [r.phone && `Phone: ${r.phone}`, r.email && `Email: ${r.email}`].filter(Boolean).join(' · ')
    const said = transcriptOf(r)
    const item = {
      id: `sites:lead:${e.ref}`,
      source: 'jarvis',
      project,
      title: `New lead on ${site}: ${who}`.slice(0, 140),
      why: `Someone left their details on the ${site} site${r.page ? ` (${r.page})` : ''}. The sooner they hear back, the likelier they book.`,
      instructions: [contact, r.message && `They wrote: “${r.message}”`, said && `The chat:\n${said}`].filter(Boolean).join('\n\n'),
      priority: 'P1',
      state: 'open',
      actions: [r.phone && { kind: 'open', label: 'Call them', url: `tel:${r.phone.replace(/[^\d+]/g, '')}` }, r.email && { kind: 'copy', label: 'Copy their email', value: r.email }].filter(Boolean),
    }
    hub.upsertItem(item)
    hub.activity({ source: 'jarvis', project, title: `New lead on ${site}: ${who}`, level: 'warn' })
    draft(
      runner,
      item,
      `A visitor to the ${site} website (${e.site === 'walkthroughs' ? 'listing video walkthroughs for real estate agents' : "Automaton's custom websites for trade businesses"}) left their details and wants to hear back.\n\n${item.instructions}`,
    )
    return
  }
  if (e.type.startsWith('booking')) {
    const cancelled = e.type === 'booking_cancelled'
    const answers = Object.entries(r.answers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    const item = {
      id: `sites:booking:${r.uid}`,
      source: 'jarvis',
      project,
      title: `${cancelled ? 'Call cancelled' : e.type === 'booking_rescheduled' ? 'Call moved' : 'Call booked'}: ${r.name || r.email}, ${when(r.start)}`.slice(0, 140),
      why: cancelled
        ? `They cancelled the ${r.title || 'call'} booked from the ${site} site.`
        : `Booked from the ${site} site: ${r.title || 'a call'}${r.timeZone ? ` (their time zone: ${r.timeZone})` : ''}.`,
      instructions: [r.email && `Email: ${r.email}`, answers && `They said:\n${answers}`].filter(Boolean).join('\n\n') || 'No details beyond the booking.',
      priority: cancelled ? 'P3' : 'P2',
      state: 'open',
      actions: r.email ? [{ kind: 'copy', label: 'Copy their email', value: r.email }] : [],
    }
    hub.upsertItem(item)
    hub.activity({ source: 'jarvis', project, title: item.title, level: cancelled ? 'info' : 'success' })
    if (!cancelled)
      draft(
        runner,
        item,
        `Someone booked a call from the ${site} website. Draft a short note confirming the time (${when(r.start)}) and saying what the call will cover, based on what they told us.\n\n${item.instructions}`,
      )
  }
}

let busy = false
export async function tick(runner) {
  const url = secret('KIT_URL', 'KIT_URL')
  const key = secret('KIT_ADMIN_KEY', 'KIT_ADMIN_KEY')
  if (!url || !key) return void (status = { ok: false, detail: 'KIT_URL and KIT_ADMIN_KEY are not set' })
  if (busy) return
  busy = true
  try {
    for (let page = 0; page < 5; page++) {
      const res = await fetch(`${url.replace(/\/+$/, '')}/api/feed?since=${saved.cursor}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`the kit answered ${res.status}`)
      const { events = [], cursor, more } = await res.json()
      for (const e of events) take(e, runner)
      if (typeof cursor === 'number' && cursor > saved.cursor) {
        saved.cursor = cursor
        save()
      }
      if (!more) break
    }
    status = { ok: true, detail: `read ${new Date().toLocaleTimeString()}` }
  } catch (err) {
    status = { ok: false, detail: err.message }
    console.warn('[hub] sitekit:', err.message)
  } finally {
    busy = false
  }
}

export function start({ runner }) {
  setTimeout(() => void tick(runner), 45_000).unref()
  setInterval(() => void tick(runner), EVERY).unref()
}
