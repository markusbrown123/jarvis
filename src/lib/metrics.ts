/**
 * The voice turn timeline, measured rather than guessed.
 *
 * Every turn records when the user stopped talking, when the endpoint was
 * decided, when the first words of the answer arrived and when sound actually
 * started. Kept in this browser only (localStorage, last 100 turns) so the
 * Settings panel can show real medians and p95s from this machine.
 */

export type TurnTiming = {
  id: string
  at: number
  /** ms epoch; 0 when unknown */
  speechEnd: number
  endpoint: number
  firstText: number
  firstSound: number
  done: number
  /** 'voice' or 'typed' */
  source: string
}

const KEY = 'jarvis.turnTimings'
const MAX = 100

function load(): TurnTiming[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as TurnTiming[]) : []
  } catch {
    return []
  }
}

let timings: TurnTiming[] = load()

export function recordTurn(t: TurnTiming): void {
  timings = [...timings, t].slice(-MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(timings))
  } catch {
    /* storage can be unavailable; the in-memory list still works */
  }
}

export function turnTimings(): TurnTiming[] {
  return timings
}

export type Stat = { median: number; p95: number; n: number } | null

function stat(values: number[]): Stat {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (!v.length) return null
  const pick = (q: number) => v[Math.min(v.length - 1, Math.floor(q * (v.length - 1) + 0.5))]
  return { median: pick(0.5), p95: pick(0.95), n: v.length }
}

/** Intervals measured from the end of speech (or the endpoint, for typed turns). */
export function timingSummary() {
  const voice = timings.filter((t) => t.source === 'voice' && t.speechEnd)
  const all = timings
  return {
    endpoint: stat(voice.map((t) => t.endpoint - t.speechEnd)),
    firstText: stat(all.filter((t) => t.firstText).map((t) => t.firstText - (t.speechEnd || t.endpoint))),
    firstSound: stat(all.filter((t) => t.firstSound).map((t) => t.firstSound - (t.speechEnd || t.endpoint))),
  }
}
