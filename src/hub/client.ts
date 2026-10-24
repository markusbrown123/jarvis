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

export type View = 'station' | 'overview' | 'roblox' | 'finance' | 'automaton' | 'needs' | 'jobs' | 'terminal' | 'activity' | 'settings'

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

type HubStore = {
  state: HubState | null
  term: TermLine[]
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

export const hubActions = {
  robloxGallery: (game: string): Promise<Gallery> => get(`/api/roblox/gallery?game=${encodeURIComponent(game)}`),
  robloxImages: (shas: string[]): Promise<{ files: Record<string, string | null> }> => post('/api/roblox/images', { shas }),
  checkItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/check`),
  snoozeItem: (id: string, hours = 4) => post(`/api/items/${encodeURIComponent(id)}/snooze?hours=${hours}`),
  startItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/start`),
  cancelItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/cancel`),
  reopenItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/reopen`),
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
