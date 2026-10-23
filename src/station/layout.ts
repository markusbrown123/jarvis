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
 * The console at the centre: a raised platform with the command desk and
 * chair (console.tsx, modelled in tools/blender/console.py). The chair
 * faces the back of the room; in Talk mode the camera sits behind it.
 */
export const CHAIR: [number, number, number] = [0, 0.38, -0.2]
/** The platform's reach, back step included. */
export const CONSOLE_R = 2.45
export function seatCamera(aspect: number): { pos: [number, number, number]; target: [number, number, number] } {
  const k = Math.max(1, 1.6 / aspect)
  // Over the chair's shoulder, like the workshop shots: the chair, the desk
  // and its monitors across the lower half, the room beyond.
  return { pos: [0, 2.45 + 0.35 * k, CHAIR[2] + 4.5 * k], target: [0, 1.0, -2.2] }
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

/** The pathways run from just off the console's platform to just short of each pad. */
export const PATH_FROM = BASE + 0.12
export const PATH_TO = RING - PAD * 0.866 - 0.06
/** The stage's top surface. */
export const DECK_TOP = 0.16

/** The build bay's holo-table (foundry.tsx): straight back from the console, between the back pads. */
export const FOUNDRY: [number, number, number] = [0, DECK_TOP, -5.6]
export const FOUNDRY_R = 1.1

/** Where a zone's pathway starts and ends on the stage. */
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
 * The house (tools/blender/lair.py builds it; these mirror its sizes). In
 * scene terms, angles are measured as in Blender — from +X towards −Z —
 * so the glass, which faces −Z, runs from 0 to π.
 */
export const HOUSE = {
  /** Glass and back wall. */
  r: 15,
  ceiling: 4.6,
  /** The glass in 13 bays; the middle one stands open onto the terrace. */
  bays: 13,
  door: 6,
  /** The roof: 16.2 m out at the back, reaching 3.9 m further over the terrace. */
  roofBack: 16.2,
  roofReach: 3.9,
  roofSwoop: 0.7,
  deck: { r: 24, a0: (-8 * Math.PI) / 180, a1: Math.PI + (8 * Math.PI) / 180 },
  rail: 23.7,
  pool: { r0: 17.8, r1: 21.2, a0: Math.PI / 2 - (40 * Math.PI) / 180, a1: Math.PI / 2 + (40 * Math.PI) / 180, depth: 1.3 },
  sea: -28,
}

/**
 * The rest of the estate round the house (tools/blender/estate.py builds
 * it; these mirror its plan): the disc-roofed wings as circles on the
 * ground (x, z, roof radius), the helipad, the drive's turning circle, and
 * the lawn — an ellipse the ground is levelled to.
 */
export const ESTATE = {
  wings: [
    [24.5, 8.5, 12.5],
    [-27, 2, 11.2],
    [3, 29, 14.2],
  ] as [number, number, number][],
  helipad: { x: 54, z: 58, r: 9.5, top: -0.25 + 2.4 },
  /** The ramp from the helipad comes down here; the drive leaves from it. */
  turn: { x: 8.5, z: 66, r: 8 },
  lawn: { x: 24, z: 46, rx: 60, rz: 48, y: -0.25 },
}

/** A floor point's angle, the house's way (see HOUSE). */
export const houseAngle = (x: number, z: number) => Math.atan2(-z, x)

/**
 * What a person walking the station can't walk through, as circles on the
 * floor (x, z, radius): the console, each pad and the build bay. The house's walls, glass,
 * pool and rail bound the rest (walkable).
 */
export const OBSTACLES: [number, number, number][] = [
  [0, 0, CONSOLE_R],
  ...ZONES.map((z): [number, number, number] => [z.pos[0], z.pos[2], 1.35]),
  [FOUNDRY[0], FOUNDRY[2], FOUNDRY_R],
]

/** Can someone stand here? Inside, out through the open bay, and on the terrace. */
export function walkable(x: number, z: number, body = 0.3) {
  const r = Math.hypot(x, z)
  const a = houseAngle(x, z)
  const R = HOUSE.r
  if (r < R - body) return true
  const step = Math.PI / HOUSE.bays
  const inDoor = a > HOUSE.door * step + body / R && a < (HOUSE.door + 1) * step - body / R
  if (r <= R + body) return inDoor
  const d = HOUSE.deck
  const onDeck = a > d.a0 + body / r && a < d.a1 - body / r && r < HOUSE.rail - body
  if (!onDeck) return false
  const p = HOUSE.pool
  const inPool = a > p.a0 - (0.12 + body) / r && a < p.a1 + (0.12 + body) / r && r > p.r0 - 0.12 - body && r < p.r1 + 0.12 + body
  return !inPool
}

/** The raised stone stage in the middle of the house. */
export const STAGE_R = 8.1

/** Is a floor point up on the stage? */
export function onIsland(x: number, z: number) {
  return Math.hypot(x, z) < STAGE_R
}
