import { create } from 'zustand'
import type { View, ZoneId } from './layout'
import type { StationModel } from './model'

/**
 * The station's own state: what is selected or hovered, where the camera is
 * headed, which mode the room is in, and the recent live events the scene is
 * animating. Data itself lives in the hub; this is only how it's being looked at.
 */

export type SelKind = 'zone' | 'game' | 'stage' | 'service' | 'capability' | 'job' | 'item'
export type Sel = { kind: SelKind; id: string; zone: ZoneId }

/**
 * Something that just happened, for the scene to show once:
 * - assign: work handed out (core → zone)        - complete: a job finished
 * - fail: a job failed or a source errored        - lead: Automaton leads went up
 * - studio: the Roblox queue moved                - need: something new needs Markus
 * - voice: a turn was heard / answered
 */
export type StationEvent = { id: number; at: number; kind: 'assign' | 'complete' | 'fail' | 'lead' | 'studio' | 'need' | 'voice'; zone: ZoneId; from?: ZoneId; label?: string }

type StationStore = {
  selected: Sel | null
  hovered: Sel | null
  /** The pointer is over the desk (Command / Cinematic): a click sits you down at it. */
  deskHover: boolean
  /** At the desk: talking to JARVIS, Claude Code (which session), or the Ideas board (which idea). */
  desk: { tab: DeskTab; session: string | null; idea: string | null; draft: { project: string; prompt: string } | null }
  setDesk: (d: Partial<StationStore['desk']>) => void
  /**
   * Talk: sat at the desk facing JARVIS, the conversation in front of you.
   * Command: panels and labels, built for working. Cinematic: the same live
   * room, camera pulled back and drifting. Walk: on foot, first person.
   */
  mode: Mode
  /** Walk mode: what E would do here, and whether the mouse is captured for looking. */
  walk: { hint: string | null; locked: boolean }
  setWalk: (w: Partial<{ hint: string | null; locked: boolean }>) => void
  connections: boolean
  view: View
  /** Bumped to re-fly to the same view (e.g. Reset). */
  viewNonce: number
  events: StationEvent[]
  /** The live state → scene mapping, built once (see model.ts) and shared by scene and panels. */
  model: StationModel | null
  setModel: (m: StationModel) => void
  select: (s: Sel | null, focus?: boolean) => void
  hover: (s: Sel | null) => void
  setMode: (m: Mode) => void
  toggleConnections: () => void
  fly: (v: View) => void
  push: (e: Omit<StationEvent, 'id' | 'at'>) => void
  /** The opening flight (intro.tsx): waiting for the house to load, flying in, or over. */
  intro: 'loading' | 'flying' | 'done'
  setIntro: (p: 'loading' | 'flying' | 'done') => void
}

let seq = 0

export type Mode = 'talk' | 'command' | 'cinematic' | 'walk'
export type DeskTab = 'talk' | 'code' | 'ideas'

// The mode is remembered between visits (and the room opens at the desk).
const MODE_KEY = 'jarvis.station.mode'
function savedMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY)
    // Walking is never where the room opens: you start sat at the desk.
    return m === 'command' || m === 'cinematic' ? m : 'talk'
  } catch {
    return 'talk'
  }
}

export const useStation = create<StationStore>((set, get) => ({
  selected: null,
  hovered: null,
  deskHover: false,
  desk: { tab: 'talk', session: null, idea: null, draft: null },
  setDesk: (d) => set({ desk: { ...get().desk, ...d } }),
  mode: savedMode(),
  walk: { hint: null, locked: false },
  setWalk: (w) => {
    const cur = get().walk
    if ((w.hint === undefined || w.hint === cur.hint) && (w.locked === undefined || w.locked === cur.locked)) return
    set({ walk: { ...cur, ...w } })
  },
  connections: false,
  view: 'overview',
  viewNonce: 0,
  events: [],
  model: null,
  setModel: (model) => set({ model }),
  select: (selected, focus = true) => {
    // Picking something to look at is work: details live in Command mode.
    if (selected && get().mode !== 'command') get().setMode('command')
    set({ selected })
    if (focus && selected) get().fly(selected.zone)
  },
  hover: (hovered) => {
    const h = get().hovered
    if (h?.id === hovered?.id && h?.kind === hovered?.kind) return
    set({ hovered })
  },
  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* private window: the mode just isn't remembered */
    }
    set({ mode, view: 'overview', viewNonce: get().viewNonce + 1 })
  },
  toggleConnections: () => set({ connections: !get().connections }),
  fly: (view) => set({ view, viewNonce: get().viewNonce + 1 }),
  intro: 'loading',
  setIntro: (intro) => {
    if (get().intro === intro) return
    // It always lands at the desk.
    if (intro !== 'done' && get().mode !== 'talk') set({ mode: 'talk', view: 'overview' })
    set({ intro })
  },
  push: (e) => {
    const now = performance.now()
    const keep = get().events.filter((x) => now - x.at < 8000).slice(-40)
    set({ events: [...keep, { ...e, id: ++seq, at: now }] })
  },
}))

// The render tests read the station's state from here.
if (import.meta.env.DEV) (window as unknown as { __station?: typeof useStation }).__station = useStation

/** Events of this kind for this zone that started within `ms`, newest first. */
export function recent(events: StationEvent[], ms: number, now = performance.now()) {
  return events.filter((e) => now - e.at < ms).reverse()
}
