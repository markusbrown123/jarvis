import * as THREE from 'three'
import type { LinkModel } from './model'

/**
 * Where everything in the station lives. Positions are fixed so the room is
 * learnable: the same system is always in the same place.
 *
 * The floor is a hex island round the reactor. Six zone pads sit on a ring,
 * one per system, the three with tall structures (Roblox, Automaton, Finance)
 * at the back and right, the low ones (Jobs, Needs Markus, Jarvis Core) at
 * the front and left so nothing tall stands between the camera and the core.
 * The two front pads sit a little apart, leaving the front for the desk.
 */

export type ZoneId = 'roblox' | 'automaton' | 'finance' | 'jobs' | 'needs' | 'core'

export type Zone = {
  id: ZoneId
  label: string
  /** What the zone is for, in the words a label can afford. */
  role: string
  /** Degrees clockwise from straight back (−z). */
  angle: number
  color: string
  pos: [number, number, number]
}

/** Distance from the reactor to each pad's centre. */
export const RING = 4.9
/** Pad size (hexagon circumradius). */
export const PAD = 1.42
/** The reactor platform's outer radius. */
export const BASE = 2.05

const at = (deg: number): [number, number, number] => {
  const a = (deg * Math.PI) / 180
  return [+(RING * Math.sin(a)).toFixed(3), 0, +(-RING * Math.cos(a)).toFixed(3)]
}

export const ZONES: Zone[] = [
  { id: 'roblox', label: 'Roblox', role: 'games & studio', angle: 330, color: '#4f8bff', pos: at(330) },
  { id: 'automaton', label: 'Automaton', role: 'sites, clients & leads', angle: 30, color: '#22d3ee', pos: at(30) },
  { id: 'finance', label: 'Finance', role: 'trading research', angle: 90, color: '#34d399', pos: at(90) },
  { id: 'jobs', label: 'Jobs', role: 'running, queued & done', angle: 140, color: '#818cf8', pos: at(140) },
  { id: 'needs', label: 'Needs Markus', role: 'your actions', angle: 220, color: '#f5a524', pos: at(220) },
  { id: 'core', label: 'Jarvis Core', role: 'AI, voice & health', angle: 270, color: '#c084fc', pos: at(270) },
]

export const ZONE: Record<ZoneId, Zone> = Object.fromEntries(ZONES.map((z) => [z.id, z])) as Record<ZoneId, Zone>

export const STATUS = {
  ok: '#4ade80',
  warn: '#f5a524',
  error: '#ef4444',
  off: '#5b5874',
  live: '#a78bfa',
}

/** Which zone a job or item belongs to, from its project. */
export function zoneOfProject(project: string | undefined): ZoneId {
  if (project === 'roblox' || project === 'automaton' || project === 'finance') return project
  return 'core'
}

/**
 * The talk station: a desk and chair at the front of the reactor, facing it.
 * In Talk mode the camera sits behind the chair, looking over it at JARVIS.
 */
export const CHAIR: [number, number, number] = [0, 0.16, 4.0]
export function seatCamera(aspect: number): { pos: [number, number, number]; target: [number, number, number] } {
  const k = Math.max(1, 1.6 / aspect)
  // Over the chair's shoulder, like the workshop shots: chair and desk with
  // its monitors across the lower half, the reactor straight ahead above.
  return { pos: [0, 2.45 * k, CHAIR[2] + 4.3 * k], target: [0, 1.3, 0.4] }
}

/** Camera presets: where the camera sits and what it looks at. */
export type View = 'overview' | ZoneId
export function cameraFor(view: View, aspect: number): { pos: [number, number, number]; target: [number, number, number] } {
  // Narrow windows pull back so the island still fits between the panels.
  const k = Math.max(1, 1.6 / aspect)
  if (view === 'overview') return { pos: [0, 12.4 * k, 17.6 * k], target: [0, 0.2, 0.6] }
  const z = ZONE[view]
  const a = (z.angle * Math.PI) / 180
  // From the front, swung out towards the zone's own side, so every zone —
  // back ones too — is seen from the room with the reactor beside it.
  const dx = 0.6 * Math.sin(a)
  const dz = 1 - 0.6 * Math.cos(a)
  const n = Math.hypot(dx, dz)
  const D = 8.5 * k
  const flat = D * Math.cos(0.62)
  return {
    pos: [z.pos[0] + (dx / n) * flat, 0.8 + D * Math.sin(0.62), z.pos[2] + (dz / n) * flat],
    target: [z.pos[0], 0.8, z.pos[2]],
  }
}

/** Flat-top hexagon outline points at a radius. */
export function hexPoints(r: number, y = 0, flat = true) {
  return Array.from({ length: 7 }, (_, i) => {
    const a = ((flat ? 0 : 30) + i * 60) * (Math.PI / 180)
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)
  })
}

/** The pathways run from just off the reactor's base to just short of each pad. */
export const PATH_FROM = BASE + 0.12
export const PATH_TO = RING - PAD * 0.866 - 0.06
/** The island deck's top surface. */
export const DECK_TOP = 0.16

/** Where a zone's pathway starts and ends on the deck. */
export function along(zone: ZoneId, f: number, out: THREE.Vector3, y = DECK_TOP + 0.08) {
  const [x, , z] = ZONE[zone].pos
  const len = Math.hypot(x, z)
  const r = PATH_FROM + (PATH_TO - PATH_FROM) * f
  return out.set((x / len) * r, y, (z / len) * r)
}

/** Where a link's label goes: mid-pathway, or the top of its arc. */
export function linkAnchor(l: LinkModel): [number, number, number] {
  if (l.from === 'reactor') {
    const v = along(l.to, 0.5, new THREE.Vector3(), DECK_TOP + 0.3)
    return [v.x, v.y, v.z]
  }
  const a = new THREE.Vector3(...ZONE[l.from].pos)
  const b = new THREE.Vector3(...ZONE[l.to].pos)
  const peak = 1.0 + a.distanceTo(b) * 0.32
  const m = a.add(b).multiplyScalar(0.5)
  return [m.x, peak + 0.15, m.z]
}

/**
 * What a person walking the station can't walk through, as circles on the
 * floor (x, z, radius): the reactor, each pad, the desk and chair, the two
 * arms and the four pillars. The room's wall bounds the rest.
 */
export const WALL_R = 9.6
export const OBSTACLES: [number, number, number][] = [
  [0, 0, 2.35],
  ...ZONES.map((z): [number, number, number] => [z.pos[0], z.pos[2], 1.35]),
  [CHAIR[0], CHAIR[2], 1.3],
  [2.6, 1.5, 0.7],
  [-2.6, 1.5, 0.7],
  ...[-1, 1].flatMap((side) => [0.62, 0.8].map((f): [number, number, number] => [Math.sin(side * Math.PI * f) * 8.6, Math.cos(side * Math.PI * f) * 8.6, 0.55])),
]

/** Is a floor point on the raised island (its hex deck)? */
export function onIsland(x: number, z: number) {
  const ap = 8.1 * Math.cos(Math.PI / 6)
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3
    if (Math.abs(x * Math.cos(a) + z * Math.sin(a)) > ap) return false
  }
  return true
}
