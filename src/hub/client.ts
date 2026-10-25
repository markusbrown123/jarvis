import { create } from 'zustand'
import { BRIDGE_HTTP_URL } from '../config'
import type { HubState, TermLine } from './types'

/**
 * The live connection to the command center.
 *
 * One EventSource on /api/stream: the bridge pushes the whole state on every
 * change (it is small, and a full snapshot can never drift the way patches
 * can). The browser reconnects on its own; while it is down the dashboard says
 * so and keeps showing the last state it had, marked as stale.
 */

export type Link = 'connecting' | 'live' | 'down'

export type View = 'station' | 'overview' | 'projects' | 'roblox' | 'finance' | 'automaton' | 'needs' | 'jobs' | 'terminal' | 'activity' | 'settings'

export type Graphics = 'low' | 'high' | 'ultra'

type Prefs = {
  view: View
  navCollapsed: boolean
  needsCollapsed: boolean
  immersive: boolean
  reducedMotion: boolean
  lowPower: boolean
  selectedGame: string | null
  selectedSite: string | null
  sitePreviewMode: 'desktop' | 'mobile'
  chartSymbol: string | null
  graphics: Graphics
  autoStart: boolean
  /** Say important things out loud when they land (hub/announce.ts). */
  announce: boolean
  /** The living backdrop behind the dashboard pages (backdrop/Backdrop.tsx). */
  backdrop: boolean
  /** What the voice view shows: the burst (scene/BurstView.tsx) or the crystal core. */
  voiceVisual: 'burst' | 'core'
  layoutVersion: number
}

const PREFS_KEY = 'jarvis.dashboard'
/** A phone or tablet (JARVIS over Tailscale): a touch screen, no mouse. */
export const TOUCH = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false
const DEFAULT_PREFS: Prefs = {
  view: 'overview',
  navCollapsed: false,
  needsCollapsed: false,
  immersive: false,
  reducedMotion: false,
  lowPower: false,
  selectedGame: null,
  selectedSite: null,
  sitePreviewMode: 'desktop',
  chartSymbol: null,
  // A phone has a fraction of the Mac's GPU and memory, and Safari drops a
  // page that asks for too much: it starts light (switch up in the station).
  graphics: TOUCH ? 'low' : 'ultra',
  autoStart: true,
  announce: true,
  // A full-screen shader behind the pages: not on a phone's GPU.
  backdrop: !TOUCH,
  voiceVisual: 'burst',
  layoutVersion: 2,
}

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const prefs = { ...DEFAULT_PREFS, reducedMotion: prefersReduced, ...saved, immersive: false }
    // The station arrived after people had a saved view; open there once.
    // Not on a phone: there he's mostly for talking, and the overview is quick.
    if ((saved.layoutVersion ?? 1) < 2) Object.assign(prefs, { view: TOUCH ? 'overview' : 'station', layoutVersion: 2 })
    // On the Mac every launch opens with the station's flight in (unless
    // auto-start is off, which brings back the start screen and the last view).
    if (!TOUCH && prefs.autoStart) prefs.view = 'station'
    return prefs
  } catch {
    return DEFAULT_PREFS
  }
}

/** The desk's Claude Code terminal (bridge/hub/code.mjs). */
export type CodeLine = { n: number; kind: 'you' | 'text' | 'tool' | 'out' | 'error' | 'note'; text: string; at: number }
export type CodeSession = {
  id: string
  project: string
  cwd: string
  title: string
  state: 'working' | 'approval' | 'ready'
  approval: { id: string; tool: string; detail: string } | null
  cost: number
  createdAt: number
  updatedAt: number
  lines: CodeLine[]
}

/** An idea on the desk's board (bridge/hub/ideas.mjs). */
export type Idea = {
  id: string
  title: string
  text: string
  notes: string
  project: string
  state: 'new' | 'developing' | 'building' | 'done' | 'parked'
  source: string
  createdAt: number
  updatedAt: number
}

type HubStore = {
  state: HubState | null
  ideas: Idea[]
  term: TermLine[]
  /** Claude Code at the desk: whether it can change things by itself, and its sessions, newest first. */
  code: { writes: boolean; sessions: CodeSession[] }
  link: Link
  lastUpdate: number
  prefs: Prefs
  paletteOpen: boolean
  toast: string | null
  setPrefs: (p: Partial<Prefs>) => void
  go: (v: View) => void
  setPalette: (open: boolean) => void
  say: (msg: string | null) => void
}

export const useHub = create<HubStore>((set, get) => ({
  state: null,
  term: [],
  code: { writes: false, sessions: [] },
  ideas: [],
  link: 'connecting',
  lastUpdate: 0,
  prefs: loadPrefs(),
  paletteOpen: false,
  toast: null,
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p }
    try {
      const { immersive: _i, ...persist } = prefs
      localStorage.setItem(PREFS_KEY, JSON.stringify(persist))
    } catch {
      /* preferences are per-browser conveniences */
    }
    set({ prefs })
  },
  go: (view) => get().setPrefs({ view, immersive: false }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  say: (toast) => {
    set({ toast })
    if (toast) setTimeout(() => get().toast === toast && set({ toast: null }), 4000)
  },
}))

let source: EventSource | null = null

export function connectHub() {
  if (source) return
  source = new EventSource(`${BRIDGE_HTTP_URL}/api/stream`)
  source.addEventListener('state', (e) => {
    try {
      useHub.setState({ state: JSON.parse((e as MessageEvent).data), link: 'live', lastUpdate: Date.now() })
    } catch {
      /* a malformed frame is skipped; the next one replaces it */
    }
  })
  // Terminal lines arrive on their own: a backlog on connect, then one at a
  // time. Ids make the reconnect backlog merge instead of repeat.
  source.addEventListener('term', (e) => {
    try {
      const lines = JSON.parse((e as MessageEvent).data) as TermLine[]
      const have = useHub.getState().term
      const last = have.at(-1)?.id ?? 0
      // Ids restart with the bridge; a batch that ends below what we hold is
      // a new bridge, so it replaces rather than merges.
      if (lines.length && lines[lines.length - 1].id < last) return useHub.setState({ term: lines })
      const fresh = lines.filter((l) => l.id > last)
      if (fresh.length) useHub.setState({ term: [...have, ...fresh].slice(-500) })
    } catch {
      /* skip a malformed frame */
    }
  })
  // The desk's Claude Code sessions: all of them on connect, then a line or a
  // state change at a time.
  source.addEventListener('code', (e) => {
    try {
      const ev = JSON.parse((e as MessageEvent).data)
      const { code } = useHub.getState()
      const byNew = (a: CodeSession, b: CodeSession) => b.createdAt - a.createdAt
      if (ev.op === 'all') return useHub.setState({ code: { writes: ev.writes, sessions: [...ev.sessions].sort(byNew) } })
      if (ev.op === 'gone') return useHub.setState({ code: { ...code, sessions: code.sessions.filter((x) => x.id !== ev.id) } })
      const had = code.sessions.find((x) => x.id === ev.session.id)
      const lines = had?.lines ?? []
      const next: CodeSession = { ...ev.session, lines: ev.op === 'line' && !lines.some((l) => l.n === ev.line.n) ? [...lines, ev.line].slice(-800) : lines }
      useHub.setState({ code: { ...code, sessions: had ? code.sessions.map((x) => (x.id === next.id ? next : x)) : [next, ...code.sessions].sort(byNew) } })
    } catch {
      /* skip a malformed frame */
    }
  })
  source.addEventListener('ideas', (e) => {
    try {
      useHub.setState({ ideas: JSON.parse((e as MessageEvent).data) })
    } catch {
      /* skip a malformed frame */
    }
  })
  source.onopen = () => useHub.setState({ link: 'live' })
  source.onerror = () => useHub.setState({ link: 'down' })
  trackPresence()
}

async function post(path: string, body?: unknown) {
  const res = await fetch(`${BRIDGE_HTTP_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? '{}' : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

async function get(path: string) {
  const res = await fetch(`${BRIDGE_HTTP_URL}${path}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

export type GalleryItem = { sha: string; name: string; label: string; device: string | null; path: string }
export type GallerySection = { id: string; title: string; note?: string; items: GalleryItem[] }
export type Gallery = { game: string; revision: string | null; sections: GallerySection[]; counts: Record<string, number> }

/** JARVIS building one of the base projects himself (bridge/hub/autopilot.mjs). */
export type Autopilot = { paused: boolean; lastAt: number | null; waiting: number; blocked: boolean; off: boolean; next: string | null }

/** A stream of work from its base (bridge/hub/streams.mjs): the Projects page. */
export type Stream = {
  id: string
  name: string
  project: string
  line: string
  base: string | null
  status: string
  milestones: { done: boolean; text: string; waiting?: boolean }[]
  brief: string
}

export const hubActions = {
  streams: (): Promise<{ streams: Stream[]; links: { label: string; url: string }[]; autopilot: Record<string, Autopilot> }> => get('/api/streams'),
  projectWork: (project: string) => post(`/api/autopilot/${project}/run`),
  projectPause: (project: string, paused: boolean) => post(`/api/autopilot/${project}/pause`, { paused }),
  projectNote: (project: string, text: string) => post(`/api/autopilot/${project}/note`, { text }),
  robloxGallery: (game: string): Promise<Gallery> => get(`/api/roblox/gallery?game=${encodeURIComponent(game)}`),
  robloxImages: (shas: string[]): Promise<{ files: Record<string, string | null> }> => post('/api/roblox/images', { shas }),
  checkItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/check`),
  snoozeItem: (id: string, hours = 4) => post(`/api/items/${encodeURIComponent(id)}/snooze?hours=${hours}`),
  startItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/start`),
  doneItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/done`),
  cancelItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/cancel`),
  reopenItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/reopen`),
  restoreDone: (key: string) => post('/api/dismissed/restore', { key }),
  cancelJob: (id: string) => post(`/api/jobs/${encodeURIComponent(id)}/cancel`),
  startJob: (title: string, project: string, instructions: string) => post('/api/jobs/start', { title, project, instructions }),
  refresh: (project: 'roblox' | 'automaton' | 'finance') => post(`/api/refresh/${project}`),
  financeService: (id: string, action: 'start' | 'stop') => post(`/api/finance/services/${encodeURIComponent(id)}/${action}`),
  setQuantView: (name: string, url: string) => post('/api/config/quant-view', { name, url }),
  addExpense: (e: Record<string, unknown>) => post('/api/expenses', e),
  deleteExpense: (id: string) => post(`/api/expenses/${encodeURIComponent(id)}/delete`),
  downloadExpenses: async (period = 'all') => {
    const res = await fetch(`${BRIDGE_HTTP_URL}/api/expenses.csv?period=${encodeURIComponent(period)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await res.blob())
    a.download = `jarvis-expenses-${period}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  },
  addMemory: (text: string, topic: string) => post('/api/memory', { text, topic }),
  forgetMemory: (id: string) => post(`/api/memory/${encodeURIComponent(id)}/forget`),
  clearConversation: () => post('/api/memory/clear-conversation'),
  codeStart: (project: string, prompt: string): Promise<{ session: CodeSession }> => post('/api/code/start', { project, prompt }),
  codeSend: (id: string, prompt: string) => post(`/api/code/${encodeURIComponent(id)}/send`, { prompt }),
  codeStop: (id: string) => post(`/api/code/${encodeURIComponent(id)}/stop`),
  codeApprove: (id: string, ask: string, allow: boolean) => post(`/api/code/${encodeURIComponent(id)}/approve`, { ask, allow }),
  codeClose: (id: string) => post(`/api/code/${encodeURIComponent(id)}/close`),
  ideaAdd: (text: string, project: string): Promise<{ idea: Idea }> => post('/api/ideas', { text, project }),
  ideaUpdate: (id: string, patch: Partial<Pick<Idea, 'title' | 'text' | 'notes' | 'project' | 'state'>>) => post(`/api/ideas/${encodeURIComponent(id)}`, patch),
  ideaDelete: (id: string) => post(`/api/ideas/${encodeURIComponent(id)}/delete`),
  phonePair: () => post('/api/phone/pair'),
  phoneUnpair: () => post('/api/phone/unpair'),
  phoneSettings: (p: Record<string, unknown>) => post('/api/phone/settings', p),
  phoneTest: (channel: 'telegram' | 'pushover' | 'pushover-urgent') => post('/api/phone/test', { channel }),
}

/**
 * Tells the bridge Markus is at the dashboard, so reports stay off his phone
 * while he is here. Only real input in a visible tab counts — a screen left
 * on in an empty room does not.
 */
let lastInput = Date.now()
export function trackPresence() {
  const mark = () => {
    lastInput = Date.now()
  }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, mark, { passive: true })
  const beat = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastInput < 120000) void post('/api/presence').catch(() => {})
  }
  beat()
  setInterval(beat, 30000)
}

/** Voice activity counts as presence too. */
export const markPresent = () => {
  lastInput = Date.now()
}

// Development only: lets the render and behaviour tests drive hub state.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __hub?: typeof useHub }).__hub = useHub

/** A bridge-served file (renders on disk) as an <img> URL. */
export const fileUrl = (path: string) => `${BRIDGE_HTTP_URL}/file?path=${encodeURIComponent(path)}`
