import { create } from 'zustand'
import { BRIDGE_HTTP_URL } from '../config'
import type { HubState } from './types'

/**
 * The live connection to the command center.
 *
 * One EventSource on /api/stream: the bridge pushes the whole state on every
 * change (it is small, and a full snapshot can never drift the way patches
 * can). The browser reconnects on its own; while it is down the dashboard says
 * so and keeps showing the last state it had, marked as stale.
 */

export type Link = 'connecting' | 'live' | 'down'

export type View = 'overview' | 'roblox' | 'finance' | 'automaton' | 'needs' | 'jobs' | 'activity' | 'settings'

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
}

const PREFS_KEY = 'jarvis.dashboard'
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
}

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    return { ...DEFAULT_PREFS, reducedMotion: prefersReduced, ...saved, immersive: false }
  } catch {
    return DEFAULT_PREFS
  }
}

type HubStore = {
  state: HubState | null
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

export const hubActions = {
  checkItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/check`),
  snoozeItem: (id: string, hours = 4) => post(`/api/items/${encodeURIComponent(id)}/snooze?hours=${hours}`),
  startItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/start`),
  cancelItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/cancel`),
  reopenItem: (id: string) => post(`/api/items/${encodeURIComponent(id)}/reopen`),
  cancelJob: (id: string) => post(`/api/jobs/${encodeURIComponent(id)}/cancel`),
  startJob: (title: string, project: string, instructions: string) => post('/api/jobs/start', { title, project, instructions }),
  refresh: (project: 'roblox' | 'automaton' | 'finance') => post(`/api/refresh/${project}`),
  setQuantView: (name: string, url: string) => post('/api/config/quant-view', { name, url }),
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

/** A bridge-served file (renders on disk) as an <img> URL. */
export const fileUrl = (path: string) => `${BRIDGE_HTTP_URL}/file?path=${encodeURIComponent(path)}`
