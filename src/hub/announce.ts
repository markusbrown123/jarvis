import { useHub } from './client'
import type { HubState } from './types'

/**
 * JARVIS says the important things out loud when they land, if you're there
 * to hear them: a new P1 on Needs Markus, and a background job you gave him
 * finishing or failing. Once each (remembered across reloads), never over a
 * conversation (only while he's idle), never in the phone's quiet hours, and
 * only with the window in view — away, the phone carries it instead.
 */

const SEEN_KEY = 'jarvis.announced'

function seenIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}
function remember(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-400)))
  } catch {
    /* private mode: they may repeat after a reload */
  }
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return ((h || 0) % 24) * 60 + ((m || 0) % 60)
}
/** The phone's quiet hours (they wrap past midnight). */
export function quietNow(q: { enabled: boolean; start: string; end: string } | undefined, now = new Date()) {
  if (!q?.enabled) return false
  const t = now.getHours() * 60 + now.getMinutes()
  const a = minutes(q.start)
  const b = minutes(q.end)
  return a <= b ? t >= a && t < b : t >= a || t < b
}

/** What's new and worth saying, as short spoken lines (and the ids they cover). */
function news(s: HubState, seen: Set<string>) {
  const lines: string[] = []
  const ids: string[] = []
  const blockers = Object.values(s.items ?? {}).filter((i) => i.priority === 'P1' && (i.state === 'open' || i.state === 'in_progress') && !seen.has(`item:${i.id}`))
  if (blockers.length === 1) lines.push(`Sir, something needs you: ${blockers[0].title}.`)
  else if (blockers.length > 1) lines.push(`Sir, ${blockers.length} things need you. First: ${blockers[0].title}.`)
  ids.push(...blockers.map((i) => `item:${i.id}`))
  for (const j of Object.values(s.jobs ?? {})) {
    if (j.source !== 'jarvis' || (j.state !== 'completed' && j.state !== 'failed')) continue
    const key = `job:${j.id}:${j.state}`
    if (seen.has(key)) continue
    ids.push(key)
    lines.push(j.state === 'completed' ? `Sir, ${j.title} is done.` : `Sir, ${j.title} failed. The details are in Jobs.`)
  }
  return { lines: lines.slice(0, 3), ids }
}

export function startAnnouncer({ say, idle }: { say: (text: string) => void; idle: () => boolean }) {
  const seen = seenIds()
  let primed = false
  let pending: string[] = []
  const take = (s: HubState | null) => {
    if (!s) return
    const { lines, ids } = news(s, seen)
    for (const id of ids) seen.add(id)
    if (ids.length) remember(seen)
    // What was already there when he started is in the briefing, not news.
    if (!primed) {
      primed = true
      return
    }
    // A burst (a source coming back with a backlog) is a few lines, not a speech.
    pending = [...pending, ...lines].slice(0, 4)
  }
  take(useHub.getState().state)
  const off = useHub.subscribe((st, prev) => {
    if (st.state !== prev.state) take(st.state)
  })
  const timer = window.setInterval(() => {
    if (!pending.length) return
    const { state, prefs } = useHub.getState()
    // Quiet hours, or switched off: let it go (the phone has it, silently).
    if (!prefs.announce || quietNow(state?.phone?.quiet)) {
      pending = []
      return
    }
    if (document.visibilityState !== 'visible' || !idle()) return
    say(pending.join(' '))
    pending = []
  }, 2000)
  return () => {
    off()
    window.clearInterval(timer)
  }
}
