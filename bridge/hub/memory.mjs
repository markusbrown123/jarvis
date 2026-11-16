/**
 * JARVIS's memory, kept on this Mac so it survives restarts.
 *
 * Two parts:
 * - Facts: short things worth knowing for good ("Quant View is …", "Automaton
 *   sites go live on Netlify", "Markus trades MNQ on Tradovate"). JARVIS saves
 *   them with memory_save when Markus tells him something; Markus can see and
 *   delete every one in Settings → Memory. ~/.jarvis/memory.json
 * - The conversation log: every exchange, voice and phone, as it happened.
 *   A new session starts with the recent part of it, so "where were we" works
 *   after `jarvis stop`, and memory_recall searches all of it.
 *   ~/.jarvis/conversation.jsonl
 *
 * Both are plain files readable only by this user. Nothing leaves the Mac
 * except as part of a prompt to Claude, the same as the conversation itself.
 */

import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as hub from './store.mjs'

const FACTS = join(hub.DATA_DIR, 'memory.json')
const LOG = join(hub.DATA_DIR, 'conversation.jsonl')
const LOG_ROTATE_BYTES = 8 * 1024 * 1024

let facts = loadFacts()

function loadFacts() {
  try {
    return JSON.parse(readFileSync(FACTS, 'utf8'))
  } catch {
    return []
  }
}

function saveFacts() {
  const tmp = `${FACTS}.tmp`
  writeFileSync(tmp, JSON.stringify(facts, null, 1), { mode: 0o600 })
  renameSync(tmp, FACTS)
  publish()
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Dashboard view: the facts, and how much conversation is on file. */
function publish() {
  let turns = 0
  try {
    turns = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).length : 0
  } catch {
    /* unreadable log: show 0 */
  }
  hub.setMemory({ facts: [...facts].sort((a, b) => b.updatedAt - a.updatedAt), turns })
}
publish()

// ---------------------------------------------------------------- facts

export function remember({ text, topic = 'general', source = 'jarvis' }) {
  const t = String(text ?? '').trim().slice(0, 500)
  if (t.length < 3) throw new Error('Nothing to remember.')
  const top = String(topic).trim().toLowerCase().slice(0, 40) || 'general'
  // The same fact said again, or a near-identical rewording of one on the
  // same topic, replaces the old one instead of piling up beside it.
  const words = (x) => new Set(norm(x).split(' ').filter((w) => w.length > 2))
  const close = (a, b) => {
    const A = words(a)
    const B = words(b)
    const both = [...A].filter((w) => B.has(w)).length
    return both / (A.size + B.size - both || 1) >= 0.7
  }
  const same = facts.find((f) => norm(f.text) === norm(t) || (f.topic === top && close(f.text, t)))
  const now = Date.now()
  if (same) {
    same.text = t
    same.updatedAt = now
    same.topic = top
  } else {
    facts.push({ id: randomUUID().slice(0, 8), text: t, topic: top, source, createdAt: now, updatedAt: now })
  }
  saveFacts()
  hub.activity({ source: 'memory', project: 'jarvis', title: `Remembered: ${t.slice(0, 120)}` })
  return same ?? facts.at(-1)
}

/** Replace a fact that has changed ("actually it's …"). */
export function revise(id, text) {
  const f = facts.find((x) => x.id === id)
  if (!f) throw new Error('No such memory.')
  f.text = String(text).trim().slice(0, 500)
  f.updatedAt = Date.now()
  saveFacts()
  return f
}

export function forget(id) {
  const i = facts.findIndex((f) => f.id === id)
  if (i === -1) return false
  const [f] = facts.splice(i, 1)
  saveFacts()
  hub.activity({ source: 'memory', project: 'jarvis', title: `Forgot: ${f.text.slice(0, 120)}`, level: 'warn' })
  return true
}

// ---------------------------------------------------------------- conversation log

/** One line said by Markus or JARVIS. channel: voice | phone | typed. */
export function logTurn({ channel = 'voice', role, text }) {
  const t = String(text ?? '').trim()
  if (!t) return
  try {
    if (existsSync(LOG) && statSync(LOG).size > LOG_ROTATE_BYTES) renameSync(LOG, `${LOG}.1`)
    appendFileSync(LOG, JSON.stringify({ ts: Date.now(), channel, role, text: t.slice(0, 4000) }) + '\n', { mode: 0o600 })
  } catch (err) {
    console.warn('[memory] could not log a turn:', err.message)
  }
}

function readLog() {
  const out = []
  for (const f of [`${LOG}.1`, LOG]) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line) continue
        try {
          out.push(JSON.parse(line))
        } catch {
          /* a torn line from a crash: skip it */
        }
      }
    } catch {
      /* no file yet */
    }
  }
  return out
}

/** What Markus himself said over the last `days` (voice and phone, not jobs), oldest first, as plain lines. */
export function recentUserTurns({ days = 7, maxChars = 14000 } = {}) {
  const since = Date.now() - days * 86400000
  const lines = readLog()
    .filter((t) => t.role === 'user' && t.ts >= since && t.channel !== 'job')
    .map((t) => `${when(t.ts)} — ${String(t.text).replace(/\s+/g, ' ').slice(0, 400)}`)
  // Keep the newest if there's too much.
  const out = []
  let n = 0
  for (let i = lines.length - 1; i >= 0 && n + lines[i].length < maxChars; i--) {
    out.unshift(lines[i])
    n += lines[i].length + 1
  }
  return out
}

export function clearConversation() {
  for (const f of [LOG, `${LOG}.1`]) {
    try {
      writeFileSync(f, '', { mode: 0o600 })
    } catch {
      /* nothing to clear */
    }
  }
  publish()
  hub.activity({ source: 'memory', project: 'jarvis', title: 'Conversation history cleared', level: 'warn' })
}

const when = (ts) => new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Search facts and the whole conversation log. Plain word matching, ranked
 * by how many of the query's words a line has, newest first on ties.
 */
export function recall(query, limit = 12) {
  const words = norm(query).split(' ').filter((w) => w.length > 2)
  if (!words.length) return { facts: facts.slice(-limit), turns: [] }
  const score = (s) => {
    const n = norm(s)
    return words.reduce((a, w) => a + (n.includes(w) ? 1 : 0), 0)
  }
  const f = facts
    .map((x) => ({ x, s: score(`${x.topic} ${x.text}`) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || b.x.updatedAt - a.x.updatedAt)
    .slice(0, limit)
    .map((r) => r.x)
  const turns = readLog()
    .map((x, i) => ({ x, i, s: score(x.text) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.x)
  return { facts: f, turns }
}

// ---------------------------------------------------------------- per-turn context

const STOP = new Set(
  'the and for are but not you all any can had her was one our out has have him his how its may new now see two who did get let put say she too use what when where which while with this that than then them they there these those from your yours into just like about would could should will been were being more most some such only also very much many want need make made know think tell give said says does doing done going really here over under after before again been jarvis please thanks thank okay yeah yes sir right well what whats today tomorrow'.split(' '),
)

const terms = (s) => [...new Set(norm(s).split(' ').filter((w) => w.length > 3 && !STOP.has(w)))]

/**
 * Older memory that bears on what Markus just said, attached to his message
 * so JARVIS doesn't have to stop and search: past exchanges from before what
 * the session started with, and background-job findings. Rare words count
 * for more than common ones; weak matches are left out.
 */
export function relevantContext(query, { sessionStart = Date.now(), skipRecent = 40, maxItems = 4, maxChars = 1800 } = {}) {
  const q = terms(query)
  if (!q.length) return ''
  const all = readLog()
  // What the session already has: the recent turns it was started with, and
  // everything said since it started.
  const before = all.filter((t) => t.ts < sessionStart && t.channel !== 'job')
  const shown = new Set(before.slice(-skipRecent).filter((t) => t.ts >= sessionStart - 72 * 3600000))
  const pool = all.filter((t) => t.ts < sessionStart && !shown.has(t))
  if (!pool.length) return ''
  const df = new Map()
  for (const t of pool) for (const w of terms(t.text)) df.set(w, (df.get(w) ?? 0) + 1)
  const N = pool.length
  const scored = pool
    .map((t, i) => {
      const own = new Set(terms(t.text))
      const hits = q.filter((w) => own.has(w))
      const score = hits.reduce((a, w) => a + Math.log(1 + N / (df.get(w) ?? 1)), 0)
      const rare = hits.some((w) => (df.get(w) ?? 0) <= 3 && w.length >= 6)
      return { t, i, score, ok: hits.length >= 2 || rare }
    })
    .filter((r) => r.ok && r.score > 1.2)
    .sort((a, b) => b.score - a.score || b.i - a.i)
    .slice(0, maxItems)
    .sort((a, b) => a.i - b.i)
  if (!scored.length) return ''
  let out = ''
  for (const { t } of scored) {
    const who = t.channel === 'job' ? 'Background job' : t.role === 'user' ? 'Markus' : 'You'
    const line = `- ${when(t.ts)} — ${who}: ${t.text.replace(/\s+/g, ' ').slice(0, 500)}\n`
    if (out.length + line.length > maxChars) break
    out += line
  }
  return out
}

// ---------------------------------------------------------------- prompt

/**
 * What a new session starts with: every saved fact, then the recent
 * conversation — the last couple of days, newest kept when trimming.
 */
export function promptBlock({ maxTurns = 40, maxAgeHours = 72, maxChars = 9000, conversation = true } = {}) {
  const parts = []
  const lessons = facts.filter((f) => f.topic.startsWith('lesson'))
  const known = facts.filter((f) => !f.topic.startsWith('lesson'))
  if (lessons.length) {
    const lines = lessons.sort((a, b) => a.createdAt - b.createdAt).map((f) => `- ${f.topic === 'lesson' ? '' : `[${f.topic.replace(/^lesson:?/, '')}] `}${f.text}`)
    parts.push(`LESSONS YOU HAVE LEARNED (from your own mistakes and Markus's corrections — follow them):\n${lines.join('\n').slice(-4000)}`)
  }
  if (known.length) {
    const lines = known
      .sort((a, b) => a.topic.localeCompare(b.topic) || a.createdAt - b.createdAt)
      .map((f) => `- [${f.topic}] ${f.text}`)
    parts.push(`WHAT YOU REMEMBER (saved facts, from earlier sessions — trust these):\n${lines.join('\n').slice(0, 6000)}`)
  }
  const cutoff = Date.now() - maxAgeHours * 3600000
  const recent = conversation ? readLog().filter((t) => t.ts >= cutoff && t.channel !== 'job').slice(-maxTurns) : []
  if (recent.length) {
    const lines = []
    let size = 0
    for (let i = recent.length - 1; i >= 0; i--) {
      const t = recent[i]
      const who = t.role === 'user' ? 'Markus' : 'You'
      const line = `[${when(t.ts)}${t.channel === 'phone' ? ', by phone' : ''}] ${who}: ${t.text.replace(/\s+/g, ' ').slice(0, 600)}`
      if (size + line.length > maxChars) break
      lines.unshift(line)
      size += line.length
    }
    parts.push(`EARLIER CONVERSATION (before this session started, oldest first):\n${lines.join('\n')}`)
  }
  if (!parts.length) return ''
  return `\n\n${parts.join('\n\n')}\n\nThis is your memory of Markus and of earlier conversations. Use it naturally; never say you can't remember something that is in it. If he asks about something older or not shown here, call memory_recall.`
}
