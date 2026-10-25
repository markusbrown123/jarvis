import type { HubState } from '../hub/types'

/**
 * Hub state -> the numbers the backdrop shaders draw. Everything here is a
 * plain Float32Array so the engine can hand it straight to uniform calls.
 *
 *   games  : 14 x [progress, active, blocked, presence + 2*published]
 *   leads  : 64 x light value (0 = none, ~.15 lead, 1 = site live)
 *   jobs   : 16 x [kind, source tower 0..1 or -1, fade 0..1]  (kind 1 running,
 *            2 needs Markus, 3 stale/retrying, .5 queued)
 *   fin    : 8 x [up (+1/-1), latency 0..1]
 *   fuel   : [5h left, 7d left, has reading, spend]
 *   need   : [open count, P1 count, 0, 0]
 *   count  : [games, leads, jobs, fin]
 */

export const MAX_GAMES = 14
export const MAX_LEADS = 64
export const MAX_JOBS = 16
export const MAX_FIN = 8

export type World = {
  live: number
  act: number
  games: Float32Array
  leads: Float32Array
  jobs: Float32Array
  fin: Float32Array
  fuel: Float32Array
  need: Float32Array
  count: Float32Array
}

export const emptyWorld = (): World => ({
  live: 0,
  act: 0,
  games: new Float32Array(16 * 4),
  leads: new Float32Array(MAX_LEADS),
  jobs: new Float32Array(MAX_JOBS * 3),
  fin: new Float32Array(MAX_FIN * 2),
  fuel: new Float32Array(4),
  need: new Float32Array(4),
  count: new Float32Array(4),
})

export const SITE_VALUE: Record<string, number> = {
  generated_draft: 0.42,
  needs_review: 0.58,
  needs_edits: 0.52,
  approved: 0.74,
  client_ready: 0.9,
  deployed: 1,
}

export const SALE_VALUE: Record<string, number> = {
  pitched: 0.16,
  sample_built: 0.28,
  sample_sent: 0.32,
  in_revision: 0.38,
  approved: 0.46,
  pay_link_sent: 0.5,
  paid: 0.62,
  survey_sent: 0.66,
  survey_done: 0.7,
  site_live: 0.9,
  google_connected: 0.95,
  complete: 1,
  lost: 0.06,
}

const ACTIVE_JOB = new Set(['running', 'needs_markus', 'retrying', 'cancel_requested', 'queued', 'waiting'])

/** Where the lead at index k lands in the 16 x 4 light lattice: a stride that
 *  spreads lit sites across the whole fleet instead of filling one corner. */
const slot = (k: number) => (k * 37) % MAX_LEADS

export function mapHub(s: HubState | null, link: 'connecting' | 'live' | 'down', now: number, openCount: number, p1Count: number): World {
  const w = emptyWorld()
  w.live = !s ? 0 : link === 'live' ? 1 : 0.5
  if (!s) return w

  // ---- Roblox games -> structures
  const games = s.projects.roblox?.games ?? []
  const slotOfGame = new Map<string, number>()
  for (let i = 0; i < MAX_GAMES; i++) {
    const g = games[i]
    if (!g) continue
    slotOfGame.set(g.id, i)
    const { done, running, queued, blocked } = g.tasks
    const total = done + running + queued + blocked
    const progress = total > 0 ? done / total : 0.05
    const active = g.active ? 1 : running > 0 ? 0.6 : 0
    const blk = blocked > 0 ? Math.min(1, 0.35 + (blocked / Math.max(1, total)) * 1.5) : 0
    w.games.set([progress, active, blk, 1 + (g.published ? 2 : 0)], i * 4)
  }
  w.count[0] = games.length

  // ---- Automaton leads and sites -> fleet of lights
  const am = s.projects.automaton
  const sites = am?.sites ?? []
  const siteVals = sites.map((x) => (x.publishStatus === 'published' || x.publishedUrl ? 1 : (SITE_VALUE[x.stage] ?? 0.45))).sort((a, b) => b - a)
  const leadTotal = am?.leads?.total ?? 0
  const lights = Math.min(MAX_LEADS, Math.max(leadTotal, sites.length))
  const rest: number[] = []
  const by = am?.leads?.byStage ?? {}
  for (const [stage, n] of Object.entries(by).sort((a, b) => (SALE_VALUE[b[0]] ?? 0.1) - (SALE_VALUE[a[0]] ?? 0.1))) {
    for (let i = 0; i < n; i++) rest.push(SALE_VALUE[stage] ?? 0.12)
  }
  for (let k = 0; k < lights; k++) {
    const fromSite = k < siteVals.length
    const v = fromSite ? siteVals[k] : (rest[k - siteVals.length] ?? 0.14)
    w.leads[slot(k)] = Math.max(0.08, v)
  }
  w.count[1] = lights

  // ---- running jobs -> drones on streams
  const jobs = Object.values(s.jobs)
    .filter((j) => ACTIVE_JOB.has(j.state))
    .sort((a, b) => (b.heartbeatAt ?? b.updatedAt) - (a.heartbeatAt ?? a.updatedAt))
    .slice(0, MAX_JOBS)
  jobs.forEach((j, i) => {
    const kind = j.state === 'needs_markus' ? 2 : j.stale || j.state === 'retrying' || j.state === 'cancel_requested' ? 3 : j.state === 'running' ? 1 : 0.5
    const gi = j.game ? slotOfGame.get(j.game) : undefined
    w.jobs[i * 3] = kind
    w.jobs[i * 3 + 1] = gi === undefined ? -1 : gi / 13
    w.jobs[i * 3 + 2] = 1
  })
  w.count[2] = jobs.length

  // ---- Claude allowance -> fuel rail
  const five = s.usage.windows.five_hour
  const seven = s.usage.windows.seven_day
  const fresh = (x?: { usedPct: number; resetsAt: number | null }) => !!x && (!x.resetsAt || x.resetsAt > now)
  const f5 = fresh(five) ? Math.max(0, Math.min(1, 1 - five!.usedPct / 100)) : -1
  const f7 = fresh(seven) ? Math.max(0, Math.min(1, 1 - seven!.usedPct / 100)) : -1
  w.fuel[0] = f5 >= 0 ? f5 : f7 >= 0 ? f7 : 0
  w.fuel[1] = f7 >= 0 ? f7 : 0
  w.fuel[2] = f5 >= 0 || f7 >= 0 ? 1 : 0
  w.fuel[3] = Math.min(1, (s.usage.requests?.costUsd ?? 0) / 50)

  // ---- things that need Markus -> beacon
  const stuck = jobs.filter((j) => j.state === 'needs_markus').length
  w.need[0] = openCount + stuck
  w.need[1] = p1Count > 0 ? 1 : 0

  // ---- finance / QuantVue monitoring -> sensor chain
  const fin = s.projects.finance
  const services = fin?.services ?? []
  let n = 0
  for (const sv of services) {
    if (n >= MAX_FIN) break
    w.fin[n * 2] = sv.up ? 1 : -1
    w.fin[n * 2 + 1] = Math.max(0, Math.min(1, sv.ms / 1500))
    n++
  }
  if (fin?.quantView?.url && n < MAX_FIN && !services.some((x) => /quant/i.test(`${x.id}${x.name}`))) {
    w.fin[n * 2] = 1
    w.fin[n * 2 + 1] = 0.2
    n++
  }
  w.count[3] = n
  return w
}

/** Ease `cur` toward `tgt` in place; counts and discrete kinds snap. */
export function easeWorld(cur: World, tgt: World, dt: number) {
  const k = 1 - Math.exp(-dt * 2.2)
  const kf = 1 - Math.exp(-dt * 4)
  cur.live += (tgt.live - cur.live) * kf
  cur.act += (tgt.act - cur.act) * (1 - Math.exp(-dt * 1.5))
  for (let i = 0; i < cur.games.length; i += 4) {
    const pubT = tgt.games[i + 3] >= 1.5 ? 1 : 0
    const presT = tgt.games[i + 3] - 2 * pubT
    const pubC = cur.games[i + 3] >= 1.5 ? 1 : 0
    const presC = cur.games[i + 3] - 2 * pubC
    cur.games[i] += (tgt.games[i] - cur.games[i]) * k * 0.6
    cur.games[i + 1] += (tgt.games[i + 1] - cur.games[i + 1]) * kf
    cur.games[i + 2] += (tgt.games[i + 2] - cur.games[i + 2]) * kf
    cur.games[i + 3] = presC + (presT - presC) * k + 2 * pubT
  }
  for (let i = 0; i < cur.leads.length; i++) cur.leads[i] += (tgt.leads[i] - cur.leads[i]) * k
  // A job's drone fades in and out rather than popping; its slot keeps the old
  // look while it fades, so a finished job does not change colour on the way out.
  let used = 0
  for (let j = 0; j < MAX_JOBS; j++) {
    const o = j * 3
    const on = tgt.jobs[o + 2] > 0.5
    if (on) {
      cur.jobs[o] = tgt.jobs[o]
      cur.jobs[o + 1] = tgt.jobs[o + 1]
    }
    cur.jobs[o + 2] += ((on ? 1 : 0) - cur.jobs[o + 2]) * kf
    if (!on && cur.jobs[o + 2] < 0.004) cur.jobs[o + 2] = 0
    if (cur.jobs[o + 2] > 0) used = j + 1
  }
  cur.fin.set(tgt.fin)
  for (let i = 0; i < 4; i++) {
    cur.fuel[i] += (tgt.fuel[i] - cur.fuel[i]) * k
    cur.need[i] += (tgt.need[i] - cur.need[i]) * kf
    cur.count[i] = tgt.count[i]
  }
  cur.count[2] = used
  cur.fuel[2] = tgt.fuel[2]
  cur.need[1] = tgt.need[1]
}

// ------------------------------------------------------------------ colour

const cache = new Map<string, [number, number, number]>()
let probe: CanvasRenderingContext2D | null = null

/** Any CSS colour -> linear-ish 0..1 rgb. Falls back to `fallback` for junk. */
export function cssRgb(css: string, fallback: [number, number, number] = [0.1, 0.85, 0.85]): [number, number, number] {
  const hit = cache.get(css)
  if (hit) return hit
  let out = fallback
  try {
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (probe) {
      probe.fillStyle = '#010203'
      probe.fillStyle = css
      if (probe.fillStyle !== '#010203' || /^#?010203$/i.test(css)) {
        probe.clearRect(0, 0, 1, 1)
        probe.fillRect(0, 0, 1, 1)
        const d = probe.getImageData(0, 0, 1, 1).data
        out = [d[0] / 255, d[1] / 255, d[2] / 255]
      }
    }
  } catch {
    /* keep the fallback */
  }
  cache.set(css, out)
  return out
}

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
  }
  return [f(0), f(8), f(4)]
}
