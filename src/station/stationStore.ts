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
  /** Command: panels and labels, built for working. Cinematic: the same live room, camera pulled back and drifting. */
  mode: 'command' | 'cinematic'
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
  setMode: (m: 'command' | 'cinematic') => void
  toggleConnections: () => void
  fly: (v: View) => void
  push: (e: Omit<StationEvent, 'id' | 'at'>) => void
}

let seq = 0

export const useStation = create<StationStore>((set, get) => ({
  selected: null,
  hovered: null,
  mode: 'command',
  connections: false,
  view: 'overview',
  viewNonce: 0,
  events: [],
  model: null,
  setModel: (model) => set({ model }),
  select: (selected, focus = true) => {
    set({ selected })
    if (focus && selected) get().fly(selected.zone)
  },
  hover: (hovered) => {
    const h = get().hovered
    if (h?.id === hovered?.id && h?.kind === hovered?.kind) return
    set({ hovered })
  },
  setMode: (mode) => set({ mode, view: 'overview', viewNonce: get().viewNonce + 1 }),
  toggleConnections: () => set({ connections: !get().connections }),
  fly: (view) => set({ view, viewNonce: get().viewNonce + 1 }),
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
