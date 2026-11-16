/**
 * The command center's memory: jobs, Needs Markus items, project snapshots,
 * previews, Claude usage and the activity log.
 *
 * Everything lives in one JSON snapshot under ~/.jarvis (JARVIS_DATA_DIR), so a
 * refresh or a restart picks up exactly where it left off, plus an append-only
 * events.jsonl for the searchable history. Writes are debounced and atomic
 * (temp file + rename): a crash mid-write leaves the previous snapshot intact.
 *
 * Events are idempotent by id. A source that re-sends what it already sent, or
 * sends it twice over a flaky connection, changes nothing the second time. Job
 * and item updates carry their own updatedAt, and an update older than what is
 * already stored is ignored, so a delayed event cannot roll a job backwards.
 */

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const DATA_DIR = process.env.JARVIS_DATA_DIR ?? join(homedir(), '.jarvis')
const STATE_FILE = join(DATA_DIR, 'state.json')
const EVENTS_FILE = join(DATA_DIR, 'events.jsonl')
const TOKEN_FILE = join(DATA_DIR, 'token')
const DISMISSED_FILE = join(DATA_DIR, 'dismissed.json')

/** Explicit job states. Background work never borrows the voice loop's. */
export const JOB_STATES = new Set([
  'queued',
  'running',
  'waiting',
  'needs_markus',
  'retrying',
  'completed',
  'failed',
  'cancel_requested',
  'canceled',
])
export const ITEM_STATES = new Set([
  'open',
  'in_progress',
  'snoozed',
  'verifying',
  'resolved',
  'canceled',
])

/** A running job that has not reported for this long is shown as stale. */
const STALE_MS = 10 * 60 * 1000
const MAX_SEEN = 5000
const MAX_ACTIVITY = 600
const EVENTS_ROTATE_BYTES = 20 * 1024 * 1024

mkdirSync(DATA_DIR, { recursive: true })

/**
 * The shared secret local scripts (Claude Code hooks, the status line, a
 * remote worker) present to post events. Generated once, readable only by
 * this user. The browser never needs it: the bridge trusts its own origins.
 */
export function apiToken() {
  if (!existsSync(TOKEN_FILE)) {
    writeFileSync(TOKEN_FILE, randomBytes(24).toString('hex') + '\n', { mode: 0o600 })
  }
  try {
    chmodSync(TOKEN_FILE, 0o600)
  } catch {
    /* best effort on filesystems without modes */
  }
  return readFileSync(TOKEN_FILE, 'utf8').trim()
}

function emptyState() {
  return {
    version: 1,
    jobs: {},
    items: {},
    projects: {},
    previews: {},
    usage: {
      windows: {},
      context: null,
      requests: { count: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      status: null,
      sources: {},
    },
    activity: [],
    seen: [],
  }
}

function load() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return { ...emptyState(), ...parsed, usage: { ...emptyState().usage, ...(parsed.usage ?? {}) } }
  } catch {
    return emptyState()
  }
}

const state = load()
const seen = new Set(state.seen)

/**
 * Items Markus marked Done. Kept in their own file, keyed by id and by
 * normalised title, and checked every time the list is built — so a restart,
 * or a source (the studio queue) reporting the item open again, can't bring
 * one back. Entries: { id?, key, title, at }.
 */
const normTitle = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const SEEDED_DISMISSED = ['Switch the cloud chat to Sonnet']

function loadDismissed() {
  let list = []
  try {
    const parsed = JSON.parse(readFileSync(DISMISSED_FILE, 'utf8'))
    if (Array.isArray(parsed)) list = parsed.filter((e) => e && typeof e.key === 'string')
  } catch {
    /* none yet */
  }
  let added = false
  for (const title of SEEDED_DISMISSED) {
    if (!list.some((e) => e.key === normTitle(title))) {
      list.push({ key: normTitle(title), title, at: Date.now() })
      added = true
    }
  }
  return { list, added }
}

function saveDismissed() {
  const tmp = `${DISMISSED_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(dismissed, null, 2))
  renameSync(tmp, DISMISSED_FILE)
}

const loadedDismissed = loadDismissed()
const dismissed = loadedDismissed.list
if (loadedDismissed.added) saveDismissed()

export function isDismissed(item) {
  if (!item) return false
  const key = normTitle(item.title)
  return dismissed.some((e) => (e.id && e.id === item.id) || (key && e.key === key))
}

for (const [id, item] of Object.entries(state.items)) if (isDismissed(item)) delete state.items[id]
const listeners = new Set()

let saveTimer = null
let notifyTimer = null

function persist() {
  state.seen = [...seen].slice(-MAX_SEEN)
  const tmp = `${STATE_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(state))
  renameSync(tmp, STATE_FILE)
}

/** Debounced save + throttled push to every open dashboard. */
function changed() {
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        persist()
      } catch (err) {
        console.error('[hub] could not save state:', err.message)
      }
    }, 400)
  }
  if (!notifyTimer) {
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      const snap = snapshot()
      for (const fn of listeners) fn(snap)
    }, 150)
  }
}

/**
 * The terminal feed: one line per thing happening right now — a question,
 * a tool call, a job step, a Claude Code edit, a phone message. Memory only
 * (the activity log is the durable record); pushed to dashboards as it
 * happens rather than inside the state snapshot.
 */
const termLines = []
const termListeners = new Set()
let termSeq = 0

export function term(src, text, kind = 'info') {
  if (!text) return
  const line = { id: ++termSeq, ts: Date.now(), src, kind, text: String(text).replace(/\s+/g, ' ').slice(0, 280) }
  termLines.push(line)
  if (termLines.length > 400) termLines.splice(0, termLines.length - 400)
  for (const fn of termListeners) fn(line)
}

// Start with the last few things that happened, so a fresh terminal isn't blank.
for (const a of state.activity.slice(-25)) termLines.push({ id: ++termSeq, ts: a.ts, src: a.source, kind: 'history', text: a.title })

export function termBacklog(n = 200) {
  return termLines.slice(-n)
}

export function termSubscribe(fn) {
  termListeners.add(fn)
  return () => termListeners.delete(fn)
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** What the dashboard sees. Stale jobs are derived, not stored. */
export function snapshot() {
  const now = Date.now()
  const jobs = {}
  for (const [id, j] of Object.entries(state.jobs)) {
    const live = j.state === 'running' || j.state === 'retrying' || j.state === 'cancel_requested'
    const last = j.heartbeatAt ?? j.updatedAt ?? 0
    jobs[id] = { ...j, stale: Boolean(live && j.expectsHeartbeat && now - last > (j.staleAfterMs ?? STALE_MS)) }
  }
  const { seen: _seen, ...rest } = state
  // What he marked Done, newest first, so the Needs page can bring one back.
  const done = dismissed.map(({ key, title, at }) => ({ key, title, at })).sort((a, b) => b.at - a.at)
  return { ...rest, jobs, dismissed: done, serverTime: now }
}

function logEvent(ev) {
  try {
    if (existsSync(EVENTS_FILE) && statSync(EVENTS_FILE).size > EVENTS_ROTATE_BYTES) {
      renameSync(EVENTS_FILE, `${EVENTS_FILE}.1`)
    }
    appendFileSync(EVENTS_FILE, JSON.stringify(ev) + '\n')
  } catch (err) {
    console.error('[hub] could not append event:', err.message)
  }
}

/**
 * Add to the activity stream. `id` makes it idempotent; without one the
 * stream simply grows. Level: info | success | warn | error.
 */
export function activity({ id, ts, source, project, title, detail, level = 'info', ref }) {
  const evId = id ?? `${source}:${ts ?? Date.now()}:${title}`
  if (seen.has(evId)) return false
  seen.add(evId)
  const ev = { id: evId, ts: ts ?? Date.now(), source, project: project ?? null, title, detail: detail ?? '', level, ref: ref ?? null }
  state.activity.push(ev)
  // Out-of-order arrivals still read in time order.
  state.activity.sort((a, b) => a.ts - b.ts)
  if (state.activity.length > MAX_ACTIVITY) state.activity.splice(0, state.activity.length - MAX_ACTIVITY)
  logEvent(ev)
  if (Date.now() - ev.ts < 10 * 60000) term(source, title, level)
  changed()
  return true
}

/**
 * Create or update a job. Fields: id (stable), project, title, run, worker,
 * stage, state, revision, createdAt, updatedAt, heartbeatAt, done, total,
 * links, blocker, summary, output, nextStep, cancel ('supported' | undefined).
 * `done`/`total` are only shown as a percentage when total is a real count.
 */
/** Undefined means "not reported", never "erase". */
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

export function upsertJob(patch) {
  if (!patch?.id) return false
  patch = defined(patch)
  const prev = state.jobs[patch.id]
  const updatedAt = patch.updatedAt ?? Date.now()
  if (prev && prev.updatedAt && updatedAt < prev.updatedAt) return false
  if (patch.state && !JOB_STATES.has(patch.state)) return false
  const next = { ...(prev ?? { createdAt: updatedAt }), ...patch, updatedAt }
  if (JSON.stringify(prev) === JSON.stringify(next)) return false
  state.jobs[patch.id] = next
  if (!prev || prev.state !== next.state) {
    activity({
      id: `job:${next.id}:${next.state}:${updatedAt}`,
      ts: updatedAt,
      source: next.source ?? 'jobs',
      project: next.project,
      title: `${next.title ?? next.id} — ${next.state.replace('_', ' ')}`,
      detail: next.summary ?? '',
      level: next.state === 'failed' ? 'error' : next.state === 'completed' ? 'success' : next.state === 'needs_markus' ? 'warn' : 'info',
      ref: { kind: 'job', id: next.id },
    })
  }
  changed()
  return true
}

/** Drop jobs a source no longer reports (e.g. pruned from its queue). */
export function pruneJobs(source, keepIds) {
  const keep = new Set(keepIds)
  let removed = false
  for (const [id, j] of Object.entries(state.jobs)) {
    if (j.source === source && !keep.has(id)) {
      delete state.jobs[id]
      removed = true
    }
  }
  if (removed) changed()
}

/**
 * A Needs Markus item. Fields: id (stable, so a repeated blocker updates the
 * same item instead of piling up), title, why, project, blocks (job ids),
 * destination {label, url}, prepared, estimate, verify {kind, ...}, resumes,
 * priority (P1..P3), actions [{kind, label, value}], source.
 *
 * Who decides the state matters. A source can open an item or report it done
 * at its end; the person's own choices here (snooze, in progress, cancel)
 * stick until the source says otherwise. Only verification resolves an item
 * the source does not report on.
 */
export function upsertItem(patch, { fromSource = true } = {}) {
  if (!patch?.id) return false
  patch = defined(patch)
  const prev = state.items[patch.id]
  const now = Date.now()
  let next = { ...(prev ?? { createdAt: now, state: 'open', priority: 'P2' }), ...patch, updatedAt: now }
  if (patch.state && !ITEM_STATES.has(patch.state)) return false
  if (isDismissed(next)) return false
  if (fromSource && prev && !patch.state) next.state = prev.state
  if (fromSource && prev && patch.state === 'open' && ['snoozed', 'in_progress', 'verifying'].includes(prev.state)) {
    next.state = prev.state
  }
  if (prev?.state === 'snoozed' && prev.snoozedUntil && prev.snoozedUntil < now) next.state = 'open'
  const { updatedAt: _a, ...cmpPrev } = prev ?? {}
  const { updatedAt: _b, ...cmpNext } = next
  if (prev && JSON.stringify(cmpPrev) === JSON.stringify(cmpNext)) return false
  state.items[patch.id] = next
  if (!prev || prev.state !== next.state) {
    activity({
      id: `item:${next.id}:${next.state}:${now}`,
      source: next.source ?? 'needs',
      project: next.project,
      title: `${next.state === 'open' ? 'Needs you' : 'Needs you — ' + next.state.replace('_', ' ')}: ${next.title}`,
      level: next.state === 'resolved' ? 'success' : next.state === 'open' ? 'warn' : 'info',
      ref: { kind: 'item', id: next.id },
    })
  }
  changed()
  return true
}

export function getItem(id) {
  return state.items[id] ?? null
}

/**
 * Markus's Done: by item id or by title (exact once normalised, else the one
 * item whose title contains it). Returns the dismissed item, or null when
 * nothing matches or the title is ambiguous.
 */
export function dismissItem(ref) {
  const key = normTitle(ref)
  if (!key) return null
  let item = state.items[ref]
  if (!item) {
    const live = Object.values(state.items).filter((i) => !['resolved', 'canceled'].includes(i.state))
    const exact = live.filter((i) => normTitle(i.title) === key)
    const loose = exact.length ? exact : live.filter((i) => normTitle(i.title).includes(key))
    if (loose.length !== 1) return null
    item = loose[0]
  }
  dismissed.push({ id: item.id, key: normTitle(item.title), title: item.title, at: Date.now() })
  delete state.items[item.id]
  try {
    saveDismissed()
  } catch (err) {
    console.error('[hub] could not save dismissed items:', err.message)
  }
  activity({
    id: `item:${item.id}:dismissed:${Date.now()}`,
    source: item.source ?? 'needs',
    project: item.project,
    title: `Done: ${item.title}`,
    level: 'success',
    ref: { kind: 'item', id: item.id },
  })
  changed()
  return item
}

/** Undo a Done: the item can come back (its source reports it again at its next check). */
export function restoreDismissed(key) {
  const n = dismissed.length
  for (let i = dismissed.length - 1; i >= 0; i--) if (dismissed[i].key === key) dismissed.splice(i, 1)
  if (dismissed.length === n) return false
  try {
    saveDismissed()
  } catch (err) {
    console.error('[hub] could not save dismissed items:', err.message)
  }
  changed()
  return true
}

export function getJob(id) {
  return state.jobs[id] ?? null
}

/** Mark that the work an item unblocks was resumed. Exactly once. */
export function markResumed(id) {
  const item = state.items[id]
  if (!item || item.resumedAt) return false
  item.resumedAt = Date.now()
  changed()
  return true
}

export function setProject(id, data) {
  const prev = state.projects[id]
  const next = { ...data, updatedAt: Date.now() }
  const { updatedAt: _a, ...a } = prev ?? {}
  const { updatedAt: _b, ...b } = next
  if (prev && JSON.stringify(a) === JSON.stringify(b)) return
  state.projects[id] = next
  changed()
}

/** Saved memories and how much conversation is on file (Settings → Memory). */
export function setMemory(data) {
  state.memory = data
  changed()
}

/** The expense ledger's summary and recent entries (the ledger itself is its own file). */
export function setExpenses(data) {
  state.expenses = data
  changed()
}

/** Phone link status (no secrets): what Settings → Phone shows. */
export function setPhone(data) {
  if (JSON.stringify(state.phone) === JSON.stringify(data)) return
  state.phone = data
  changed()
}

/**
 * Markus was just seen: at the dashboard, or texting from his phone. Reports
 * go to the phone only after a stretch with no dashboard presence.
 */
export function observePresence({ where = 'dashboard', at = Date.now() } = {}) {
  const prev = state.presence ?? {}
  if (where === 'dashboard') {
    if (prev.lastSeenAt && at - prev.lastSeenAt < 20000) return
    state.presence = { ...prev, lastSeenAt: at, where }
  } else {
    state.presence = { ...prev, phoneAt: at }
  }
  changed()
}

/**
 * A preview: { id, project, kind: LIVE | LAST_PLAYTEST | WEB_PROTOTYPE |
 * ASSET | SITE, title, url?, file?, revision?, capturedAt?, artifactUrl? }.
 */
export function setPreview(p) {
  if (!p?.id) return
  state.previews[p.id] = { ...state.previews[p.id], ...p }
  changed()
}

export function prunePreviews(project, keepIds) {
  const keep = new Set(keepIds)
  for (const [id, p] of Object.entries(state.previews)) {
    if (p.project === project && !keep.has(id)) delete state.previews[id]
  }
  changed()
}

/**
 * Subscription windows from the Claude Code status line. Account-wide, so the
 * newest observation wins; nothing is summed across sessions.
 */
export function observeWindows({ windows, source, at = Date.now() }) {
  for (const [name, w] of Object.entries(windows ?? {})) {
    if (!w || typeof w.used_percentage !== 'number') continue
    const prev = state.usage.windows[name]
    if (prev && prev.observedAt > at) continue
    state.usage.windows[name] = {
      usedPct: w.used_percentage,
      resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : null,
      observedAt: at,
      source,
    }
  }
  state.usage.sources[source] = at
  changed()
}

export function observeContext(ctx, source, at = Date.now()) {
  if (!ctx) return
  state.usage.context = {
    usedPct: ctx.used_percentage ?? null,
    size: ctx.context_window_size ?? null,
    observedAt: at,
    source,
  }
  changed()
}

/** JARVIS's own session: allowed / limited, and when the window resets. */
export function observeLimitStatus(info, at = Date.now()) {
  if (!info) return
  state.usage.status = {
    status: info.status ?? null,
    window: info.rateLimitType ?? null,
    resetsAt: info.resetsAt ? info.resetsAt * 1000 : null,
    usingOverage: Boolean(info.isUsingOverage),
    observedAt: at,
  }
  state.usage.sources.jarvis = at
  changed()
}

/** One finished request, deduplicated by its id. */
export function observeRequest({ id, inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, costUsd = 0 }) {
  if (!id || seen.has(`req:${id}`)) return false
  seen.add(`req:${id}`)
  const r = state.usage.requests
  r.count += 1
  r.inputTokens += inputTokens
  r.outputTokens += outputTokens
  r.cacheReadTokens += cacheReadTokens
  r.cacheWriteTokens += cacheWriteTokens
  r.costUsd += costUsd
  r.since ??= Date.now()
  changed()
  return true
}

export function observeHook(at = Date.now()) {
  state.usage.sources.hooks = at
  changed()
}

/** Last status line seen: proves the forwarding works, even with no limits. */
export function observeStatusLine(info) {
  state.usage.statusLine = info
  changed()
}

/**
 * Cancellation for jobs JARVIS runs himself. The runner registers how to stop
 * one; the job shows cancel_requested until the runner confirms it stopped.
 */
const cancellers = new Map()

export function registerCanceller(id, fn) {
  cancellers.set(id, fn)
}

export function cancelJob(id) {
  const fn = cancellers.get(id)
  const job = state.jobs[id]
  if (!fn || !job || ['completed', 'failed', 'canceled'].includes(job.state)) return false
  upsertJob({ id, state: 'cancel_requested', stage: 'cancellation requested — waiting for it to stop' })
  fn()
  return true
}

export function forgetCanceller(id) {
  cancellers.delete(id)
}

/** Sweep: snoozes that have run out, and stale jobs need a fresh push. */
setInterval(() => {
  const now = Date.now()
  let dirty = false
  for (const item of Object.values(state.items)) {
    if (item.state === 'snoozed' && item.snoozedUntil && item.snoozedUntil < now) {
      item.state = 'open'
      dirty = true
    }
  }
  if (dirty || Object.values(state.jobs).some((j) => j.expectsHeartbeat)) changed()
}, 30000).unref()
