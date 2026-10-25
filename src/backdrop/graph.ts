import { create } from 'zustand'
import type { HubState } from '../hub/types'
import { openItems } from '../dash/state'
import { SALE_VALUE, SITE_VALUE } from './world'

/**
 * The background knowledge graph: a force-directed cluster map of Markus's
 * real project data.
 *
 *   gold    Roblox games        one node each, sized by tasks
 *   green   Automaton leads     a node per sales stage, with a satellite per lead
 *   blue    built sites         one node each; published ones burn white
 *   orange  running jobs        one node each, linked to the game they work on
 *   white   Claude allowance    5-hour, 7-day and spend
 *   violet  finance             QuantVue and the monitored services
 *   rose    needs Markus        open items
 *
 * This file is the model and the physics only. It touches no DOM and no
 * canvas, so it costs nothing while the layer is off.
 */

export type Cat = 'games' | 'leads' | 'sites' | 'jobs' | 'fuel' | 'money' | 'needs'

export const CATS: { id: Cat; label: string; hub: string; color: [number, number, number]; anchor: [number, number] }[] = [
  { id: 'games', label: 'Games', hub: 'Roblox', color: [255, 201, 77], anchor: [0.2, 0.34] },
  { id: 'leads', label: 'Leads', hub: 'Automaton leads', color: [61, 220, 151], anchor: [0.78, 0.3] },
  { id: 'sites', label: 'Sites', hub: 'Built sites', color: [91, 140, 255], anchor: [0.86, 0.62] },
  { id: 'jobs', label: 'Jobs', hub: 'Running jobs', color: [255, 138, 60], anchor: [0.64, 0.8] },
  { id: 'fuel', label: 'Allowance', hub: 'Claude allowance', color: [236, 242, 255], anchor: [0.36, 0.82] },
  { id: 'money', label: 'Finance', hub: 'Finance · QuantVue', color: [169, 139, 255], anchor: [0.14, 0.66] },
  { id: 'needs', label: 'Needs you', hub: 'Needs Markus', color: [255, 93, 122], anchor: [0.4, 0.14] },
]

export const CAT_INDEX = Object.fromEntries(CATS.map((c, i) => [c.id, i])) as Record<Cat, number>

/** What a node is: the centre, a category hub, a mid-level group, a data point, or a fine satellite. */
export type Kind = 'root' | 'hub' | 'group' | 'item' | 'dot'

export type Spec = {
  id: string
  cat: Cat
  kind: Kind
  r: number
  label?: string
  /** 0..1 brightness; lit things are real, dim ones are scaffolding. */
  live: number
  hot?: boolean
  bad?: boolean
  /** Parent in the cluster; the layout pulls the two together. */
  parent?: string
}

export type Link = { a: string; b: string; rest: number; cross?: boolean }
export type Model = { nodes: Spec[]; links: Link[]; counts: Record<Cat, number>; real: boolean }

const MAX_SITES = 28
const MAX_LEAD_DOTS = 64
const MAX_JOBS = 16
const MAX_NEEDS = 9
const MAX_FIN = 8
export const MAX_NODES = 240

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

const emptyCounts = (): Record<Cat, number> => ({ games: 0, leads: 0, sites: 0, jobs: 0, fuel: 0, money: 0, needs: 0 })

/** With no hub data the graph still stands, as dim scaffolding. */
function scaffold(): Model {
  const nodes: Spec[] = [{ id: 'root', cat: 'games', kind: 'root', r: 0, live: 0 }]
  const links: Link[] = []
  for (const c of CATS) {
    nodes.push({ id: `hub:${c.id}`, cat: c.id, kind: 'hub', r: 9, label: c.hub, live: 0.5, parent: 'root' })
    links.push({ a: 'root', b: `hub:${c.id}`, rest: 220 })
    const n = 5 + Math.floor(hash(CATS.indexOf(c)) * 5)
    for (let i = 0; i < n; i++) {
      const id = `${c.id}:s${i}`
      nodes.push({ id, cat: c.id, kind: 'dot', r: 2.4 + hash(i * 3 + n) * 3, live: 0.28, parent: `hub:${c.id}` })
      links.push({ a: `hub:${c.id}`, b: id, rest: 46 + hash(i + 5) * 30 })
    }
  }
  return { nodes, links, counts: emptyCounts(), real: false }
}

export function buildModel(s: HubState | null): Model {
  if (!s) return scaffold()
  const counts = emptyCounts()
  const nodes: Spec[] = [{ id: 'root', cat: 'games', kind: 'root', r: 0, live: 0 }]
  const links: Link[] = []
  const have = new Set<string>(['root'])
  const add = (n: Spec, rest = 60) => {
    if (nodes.length >= MAX_NODES || have.has(n.id)) return false
    have.add(n.id)
    nodes.push(n)
    if (n.parent) links.push({ a: n.parent, b: n.id, rest })
    return true
  }
  for (const c of CATS) add({ id: `hub:${c.id}`, cat: c.id, kind: 'hub', r: 9.5, label: c.hub, live: 0.8, parent: 'root' }, 230)

  // ---- Roblox games
  const games = s.projects.roblox?.games ?? []
  for (const g of games) {
    const t = g.tasks
    const total = t.done + t.running + t.queued + t.blocked
    add(
      { id: `game:${g.id}`, cat: 'games', kind: 'item', r: 4.5 + Math.min(6, total / 5), label: short(g.name, 22), live: g.published ? 1 : g.active || t.running > 0 ? 0.9 : 0.6, hot: g.active || t.running > 0, bad: t.blocked > 0, parent: 'hub:games' },
      58 + hash(total) * 26,
    )
  }
  counts.games = games.length

  // ---- Automaton leads: a node per stage, a satellite for each lead
  const am = s.projects.automaton
  const by = Object.entries(am?.leads?.byStage ?? {}).filter(([, n]) => n > 0)
  const total = am?.leads?.total ?? by.reduce((a, [, n]) => a + n, 0)
  const scale = Math.min(1, MAX_LEAD_DOTS / Math.max(1, by.reduce((a, [, n]) => a + n, 0)))
  by.sort((a, b) => (SALE_VALUE[b[0]] ?? 0.1) - (SALE_VALUE[a[0]] ?? 0.1))
  for (const [stage, n] of by) {
    const sid = `stage:${stage}`
    const v = SALE_VALUE[stage] ?? 0.12
    add({ id: sid, cat: 'leads', kind: 'group', r: Math.min(10, 3.8 + Math.sqrt(n) * 1.1), label: `${stage.replace(/_/g, ' ')} · ${n}`, live: 0.45 + v * 0.55, parent: 'hub:leads' }, 70)
    const dots = Math.min(16, Math.max(1, Math.round(n * scale)))
    for (let i = 0; i < dots; i++) add({ id: `lead:${stage}:${i}`, cat: 'leads', kind: 'dot', r: 2 + hash(i + n) * 2.2, live: 0.3 + v * 0.7, parent: sid }, 26 + hash(i * 5 + n) * 24)
  }
  counts.leads = total

  // ---- built sites
  const sites = (am?.sites ?? []).slice(0, MAX_SITES)
  for (const x of sites) {
    const pub = x.publishStatus === 'published' || !!x.publishedUrl
    add({ id: `site:${x.id}`, cat: 'sites', kind: 'item', r: 3.6 + (pub ? 2.6 : 0), live: pub ? 1 : (SITE_VALUE[x.stage] ?? 0.45), hot: pub, parent: 'hub:sites' }, 50 + hash(sites.indexOf(x)) * 26)
  }
  if (sites.length) links.push({ a: 'hub:sites', b: 'hub:leads', rest: 200 })
  counts.sites = am?.sites?.length ?? 0

  // ---- running jobs, tied to their game
  const ACTIVE = new Set(['running', 'needs_markus', 'retrying', 'cancel_requested', 'queued', 'waiting'])
  const jobs = Object.values(s.jobs)
    .filter((j) => ACTIVE.has(j.state))
    .sort((a, b) => (b.heartbeatAt ?? b.updatedAt) - (a.heartbeatAt ?? a.updatedAt))
    .slice(0, MAX_JOBS)
  for (const j of jobs) {
    const urgent = j.state === 'needs_markus' || j.stale || j.state === 'retrying'
    const ok = add({ id: `job:${j.id}`, cat: 'jobs', kind: 'item', r: j.state === 'running' ? 6 : 4.2, label: short(j.taskId ?? j.title, 20), live: j.state === 'running' ? 1 : 0.6, hot: j.state === 'running', bad: urgent, parent: 'hub:jobs' }, 60)
    if (ok && j.game && have.has(`game:${j.game}`)) links.push({ a: `job:${j.id}`, b: `game:${j.game}`, rest: 150, cross: true })
  }
  counts.jobs = jobs.length

  // ---- Claude allowance
  const w = s.usage.windows
  const fresh = (x?: { resetsAt: number | null }) => !!x && (!x.resetsAt || x.resetsAt > Date.now())
  const win = (key: 'five_hour' | 'seven_day', label: string) => {
    const x = w[key]
    if (!x || !fresh(x)) return
    const left = Math.max(0, Math.min(1, 1 - x.usedPct / 100))
    add({ id: `fuel:${key}`, cat: 'fuel', kind: 'item', r: 4 + left * 6, label: `${label} · ${Math.round(left * 100)}% left`, live: 0.5 + left * 0.5, bad: left < 0.2, parent: 'hub:fuel' }, 62)
    counts.fuel++
  }
  win('five_hour', '5h')
  win('seven_day', '7d')
  if (s.usage.requests?.costUsd) {
    add({ id: 'fuel:spend', cat: 'fuel', kind: 'item', r: 4.5, label: `JARVIS $${s.usage.requests.costUsd.toFixed(2)}`, live: 0.7, parent: 'hub:fuel' }, 70)
    counts.fuel++
  }

  // ---- finance
  const fin = s.projects.finance
  let nf = 0
  const q = fin?.quantView
  if (q?.url) {
    add({ id: 'fin:quantvue', cat: 'money', kind: 'item', r: 7, label: 'QuantVue', live: 1, hot: true, parent: 'hub:money' }, 66)
    nf++
  }
  for (const sv of fin?.services ?? []) {
    if (nf >= MAX_FIN) break
    add({ id: `fin:${sv.id}`, cat: 'money', kind: 'item', r: 4.6, label: short(sv.name, 18), live: sv.up ? 0.85 : 0.5, bad: !sv.up, parent: 'hub:money' }, 58 + hash(nf) * 22)
    nf++
  }
  counts.money = nf

  // ---- what needs Markus
  const items = openItems(s.items)
  for (const it of items.slice(0, MAX_NEEDS)) {
    add({ id: `need:${it.id}`, cat: 'needs', kind: 'item', r: it.priority === 'P1' ? 6.5 : 4.5, label: short(it.title, 24), live: it.priority === 'P1' ? 1 : 0.7, hot: it.priority === 'P1', bad: it.priority === 'P1', parent: 'hub:needs' }, 56)
  }
  counts.needs = items.length

  return { nodes, links, counts, real: true }
}

// ----------------------------------------------------------------- physics

export type Node = Spec & {
  x: number
  y: number
  vx: number
  vy: number
  seed: number
  /** Parallax depth: how far this node slides when the camera orbits. */
  depth: number
  ci: number
  /** Where it was last drawn (after drift and parallax). */
  sx: number
  sy: number
}
export type Edge = { a: Node; b: Node; rest: number; cross: boolean }

const REPEL = 1500
const REPEL_RANGE2 = 240 * 240

export class GraphSim {
  nodes: Node[] = []
  edges: Edge[] = []
  w = 1280
  h = 720
  alpha = 1
  private byId = new Map<string, Node>()
  private acc = 0

  setSize(w: number, h: number) {
    if (Math.abs(w - this.w) < 2 && Math.abs(h - this.h) < 2) return
    const sx = w / this.w
    const sy = h / this.h
    for (const n of this.nodes) {
      n.x *= sx
      n.y *= sy
    }
    this.w = w
    this.h = h
    this.alpha = Math.max(this.alpha, 0.35)
  }

  /** Merge a fresh model in place: known nodes keep their position, new ones appear beside their parent. */
  merge(m: Model) {
    const next = new Map<string, Node>()
    const hubPos = (cat: Cat) => {
      const c = CATS[CAT_INDEX[cat]]
      return { x: c.anchor[0] * this.w, y: c.anchor[1] * this.h }
    }
    for (const s of m.nodes) {
      const old = this.byId.get(s.id)
      if (old) {
        Object.assign(old, s)
        next.set(s.id, old)
        continue
      }
      const par = s.parent ? (next.get(s.parent) ?? this.byId.get(s.parent)) : undefined
      const base = par ? { x: par.x, y: par.y } : hubPos(s.cat)
      const k = hash(next.size * 1.7 + 3) * Math.PI * 2
      const d = s.kind === 'hub' ? 0 : 30 + hash(next.size + 9) * 50
      const seed = hash(next.size * 0.37 + 11)
      next.set(s.id, {
        ...s,
        x: s.kind === 'root' ? this.w / 2 : s.kind === 'hub' ? hubPos(s.cat).x : base.x + Math.cos(k) * d,
        y: s.kind === 'root' ? this.h * 0.47 : s.kind === 'hub' ? hubPos(s.cat).y : base.y + Math.sin(k) * d,
        vx: 0,
        vy: 0,
        seed,
        depth: 0.5 + hash(next.size * 2.3 + 1) * 1.1,
        ci: CAT_INDEX[s.cat],
        sx: 0,
        sy: 0,
      })
    }
    this.byId = next
    this.nodes = [...next.values()]
    this.edges = []
    for (const l of m.links) {
      const a = next.get(l.a)
      const b = next.get(l.b)
      if (a && b) this.edges.push({ a, b, rest: l.rest, cross: !!l.cross })
    }
    this.alpha = Math.max(this.alpha, 0.6)
  }

  get settled() {
    return this.alpha < 0.012
  }

  /** Advance by `dt` seconds in fixed 1/60 s steps (at most two per call). */
  step(dt: number) {
    if (this.settled) return
    this.acc = Math.min(this.acc + dt, 2 / 60)
    while (this.acc >= 1 / 60) {
      this.acc -= 1 / 60
      this.physics()
      this.alpha *= 0.993
    }
  }

  private physics() {
    const { nodes, edges, w, h } = this
    const gain = 0.12 + 0.88 * Math.min(1, this.alpha * 1.6)
    const cx = w / 2
    const cy = h * 0.47
    const hole = Math.min(w, h) * 0.2
    const n = nodes.length

    for (let i = 0; i < n; i++) {
      const a = nodes[i]
      if (a.kind === 'root') continue
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]
        if (b.kind === 'root') continue
        const dx = a.x - b.x
        const dy = a.y - b.y
        const d2 = dx * dx + dy * dy
        if (d2 > REPEL_RANGE2) continue
        const min = a.r + b.r + 10
        const f = (REPEL * (a.kind === 'hub' || b.kind === 'hub' ? 2.2 : 1)) / (d2 + 80) + (d2 < min * min ? 1.2 : 0)
        const d = Math.sqrt(d2) + 0.01
        const fx = (dx / d) * f * gain
        const fy = (dy / d) * f * gain
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    for (const e of edges) {
      const dx = e.b.x - e.a.x
      const dy = e.b.y - e.a.y
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01
      const k = e.cross ? 0.004 : e.a.kind === 'root' ? 0.0025 : 0.03
      const f = (d - e.rest) * k * gain
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      if (e.a.kind !== 'root') {
        e.a.vx += fx
        e.a.vy += fy
      }
      e.b.vx -= fx
      e.b.vy -= fy
    }

    const damp = 0.84
    for (const a of nodes) {
      if (a.kind === 'root') continue
      if (a.kind === 'hub') {
        const c = CATS[a.ci]
        a.vx += (c.anchor[0] * w - a.x) * 0.012
        a.vy += (c.anchor[1] * h - a.y) * 0.012
      }
      const dx = a.x - cx
      const dy = a.y - cy
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01
      if (d < hole) {
        const push = (hole - d) * 0.06
        a.vx += (dx / d) * push
        a.vy += (dy / d) * push
      }
      const m = 28
      if (a.x < m) a.vx += (m - a.x) * 0.05
      else if (a.x > w - m) a.vx -= (a.x - (w - m)) * 0.05
      if (a.y < m + 40) a.vy += (m + 40 - a.y) * 0.05
      else if (a.y > h - m) a.vy -= (a.y - (h - m)) * 0.05
      a.vx *= damp
      a.vy *= damp
      a.x += a.vx
      a.y += a.vy
    }
    const root = nodes.find((x) => x.kind === 'root')
    if (root) {
      root.x = cx
      root.y = cy
    }
  }
}

// ------------------------------------------------------------------- store

const KEY = 'jarvis.graph'

type Saved = { on: boolean; hidden: Partial<Record<Cat, boolean>> }
function load(): Saved {
  const q = new URLSearchParams(location.search).get('graph')
  let s: Saved = { on: true, hidden: {} }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) s = { ...s, ...(JSON.parse(raw) as Partial<Saved>) }
  } catch {
    /* defaults */
  }
  if (q === '0') s.on = false
  if (q === '1') s.on = true
  return s
}

type GraphStore = {
  on: boolean
  hidden: Partial<Record<Cat, boolean>>
  counts: Record<Cat, number>
  toggle: () => void
  flip: (c: Cat) => void
  setCounts: (c: Record<Cat, number>) => void
}

const saved = load()
const persist = (s: Pick<GraphStore, 'on' | 'hidden'>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ on: s.on, hidden: s.hidden }))
  } catch {
    /* not saved */
  }
}

export const useGraph = create<GraphStore>((set, get) => ({
  on: saved.on,
  hidden: saved.hidden,
  counts: emptyCounts(),
  toggle: () => {
    set({ on: !get().on })
    persist(get())
  },
  flip: (c) => {
    set({ hidden: { ...get().hidden, [c]: !get().hidden[c] } })
    persist(get())
  },
  setCounts: (c) => {
    const o = get().counts
    if (CATS.some((k) => o[k.id] !== c[k.id])) set({ counts: c })
  },
}))
