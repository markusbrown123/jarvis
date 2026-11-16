/**
 * The shortlist (the best 25), and calling them a few at a time.
 *
 * A batch is 2–3 shortlisted businesses whose preview site is ready. The next batch opens
 * only when every business in the current one has a final outcome, so each call gets a
 * researched sheet and a real preview, and none is rushed.
 *
 * Calls happen in the business's own time: Mon–Fri 8 am–6 pm, Sat 9 am–1 pm, never Sunday
 * (well inside the 8 am–9 pm telemarketing limits). Markus places every call himself; the
 * engine never dials, texts or emails anyone.
 */

const STAGES_ACTIVE = new Set(['found', 'shortlisted', 'preview_ready'])
export const FINAL = new Set(['interested', 'not_interested', 'callback', 'do_not_call', 'wrong_number', 'unreached'])
export const OUTCOMES = ['interested', 'callback', 'not_interested', 'no_answer', 'voicemail', 'wrong_number', 'do_not_call']
const MAX_ATTEMPTS = 3

/** Keep 25 on the shortlist: the best-scoring callable businesses not yet in a batch. */
export function shortlist(store, { size = 25 } = {}) {
  const all = Object.values(store.leads())
  const inPlay = all.filter((l) => ['shortlisted', 'preview_ready'].includes(l.stage))
  const room = size - inPlay.length
  if (room <= 0) return inPlay
  const fresh = all
    .filter((l) => (l.stage ?? 'found') === 'found' && l.score && !l.score.excluded && l.site)
    .sort((a, b) => b.score.total - a.score.total || (b.reviews ?? 0) - (a.reviews ?? 0))
    .slice(0, room)
  for (const l of fresh) store.putLead({ id: l.id, stage: 'shortlisted', shortlistedAt: new Date().toISOString() })
  return [...inPlay, ...fresh.map((l) => store.lead(l.id))]
}

export const openBatch = (store) => store.batches().find((b) => b.status === 'open') ?? null

/**
 * Open the next batch of `size` (2–3) if none is open and enough previews are ready.
 * A batch of one only when `last` says no more businesses are coming (the shortlist is spent).
 */
export function nextBatch(store, { size = 3, last = false, now = new Date() } = {}) {
  if (openBatch(store)) return null
  const ready = Object.values(store.leads())
    .filter((l) => l.stage === 'preview_ready')
    .sort((a, b) => b.score.total - a.score.total)
  const take = ready.slice(0, Math.max(2, Math.min(3, size)))
  if (take.length < 2 && !(last && take.length === 1)) return null
  const n = store.batches().length + 1
  const batch = { id: `b${n}`, n, status: 'open', leadIds: take.map((l) => l.id), openedAt: now.toISOString() }
  store.putBatch(batch)
  for (const l of take) store.putLead({ id: l.id, stage: 'in_batch', batchId: batch.id })
  store.log({ type: 'batch_opened', batch: batch.id, leads: batch.leadIds })
  return batch
}

/** Record how a call went. Returns the lead; closes the batch when every lead in it is final. */
export function recordOutcome(store, leadId, outcome, { note = '', callbackAt = null, now = new Date(), dnc } = {}) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`unknown outcome "${outcome}" (one of ${OUTCOMES.join(', ')})`)
  const lead = store.lead(leadId)
  if (!lead) throw new Error(`no lead ${leadId}`)
  if (outcome === 'callback' && !callbackAt) throw new Error('a callback needs a time (callbackAt)')
  const calls = [...(lead.calls ?? []), { at: now.toISOString(), outcome, note: String(note).slice(0, 1000), ...(callbackAt ? { callbackAt } : {}) }]
  const attempts = calls.filter((c) => c.outcome === 'no_answer' || c.outcome === 'voicemail').length
  let final = outcome
  if ((outcome === 'no_answer' || outcome === 'voicemail') && attempts >= MAX_ATTEMPTS) final = 'unreached'
  const stage = {
    interested: 'interested',
    callback: 'callback',
    not_interested: 'lost',
    wrong_number: 'lost',
    do_not_call: 'dnc',
    unreached: 'lost',
  }[final] ?? lead.stage
  store.putLead({ id: leadId, calls, stage, ...(FINAL.has(final) ? { outcome: final } : {}) })
  if (final === 'do_not_call' && lead.phone) dnc?.add(lead.phone)
  store.log({ type: 'call', lead: leadId, outcome, final })

  const batch = lead.batchId && store.batches().find((b) => b.id === lead.batchId)
  if (batch && batch.status === 'open' && batch.leadIds.every((id) => FINAL.has(store.lead(id).outcome))) {
    store.putBatch({ id: batch.id, status: 'done', closedAt: now.toISOString() })
    store.log({ type: 'batch_done', batch: batch.id })
  }
  return store.lead(leadId)
}

// ---- calling hours, in the business's time zone

const ZONES = {
  'America/New_York': 'CT DE DC FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV',
  'America/Chicago': 'AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI',
  'America/Denver': 'CO MT NM UT WY ID',
  'America/Phoenix': 'AZ',
  'America/Los_Angeles': 'CA NV OR WA',
  'America/Anchorage': 'AK',
  'Pacific/Honolulu': 'HI',
}
export const zoneOf = (state) => Object.entries(ZONES).find(([, s]) => s.split(' ').includes(state))?.[0] ?? 'America/New_York'

const HOURS = { 1: [8, 18], 2: [8, 18], 3: [8, 18], 4: [8, 18], 5: [8, 18], 6: [9, 13] }
const local = (date, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: 'numeric', minute: 'numeric' }).formatToParts(date).map((x) => [x.type, x.value]))
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), h: Number(p.hour) % 24, m: Number(p.minute) }
}

/** Is now a good time to call them, and if not, when is the next window? */
export function callWindow(lead, now = new Date()) {
  const tz = zoneOf(lead.state)
  const at = (d) => d.toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const { dow, h, m } = local(now, tz)
  const span = HOURS[dow]
  const open = !!span && h * 60 + m >= span[0] * 60 && h * 60 + m < span[1] * 60
  let next = null
  if (!open) {
    for (let step = 15; step <= 8 * 24 * 60; step += 15) {
      const t = new Date(now.getTime() + step * 60000)
      const l = local(t, tz)
      const s = HOURS[l.dow]
      if (s && l.h * 60 + l.m >= s[0] * 60 && l.h * 60 + l.m < s[1] * 60) {
        next = t
        break
      }
    }
  }
  return { tz, open, theirTime: at(now), next: next && at(next), nextAt: next?.toISOString() ?? null, tip: 'Trades are usually on a job mid-morning to mid-afternoon; just after 8 am or 4–6 pm reaches the owner most often.' }
}
