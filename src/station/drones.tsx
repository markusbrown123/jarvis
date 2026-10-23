import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { DECK_TOP, FOUNDRY, STATUS, ZONE, ZONES, type ZoneId } from './layout'
import { plated } from './metal'
import { reactorState } from './shared'
import { useStation, type StationEvent } from './stationStore'

/**
 * JARVIS's drones: six hover-drones that do the station's fetching and
 * carrying, the way the workshop's robots do in the films — and only when
 * there's real work, so when they fly it means something.
 *
 * They live in a row of docks in the floor behind the build bay. A dock's
 * pedestal rises out of the floor to launch its drone, its vents slide open
 * and its ring turns amber; it waits raised while the drone is out and
 * sinks back with it when it lands, ring green while it charges.
 *
 * Every live event becomes a delivery, a glowing crate in the colour of
 * what's being carried:
 * - work handed out (assign): from the console out to the zone
 * - a job finished (complete): from its zone to the build bay
 * - something new needs Markus (need): from its project to Needs Markus
 * - new leads (lead): in from outside — out through the open glass and
 *   back over the terrace — to Automaton
 * - the Roblox queue moved (studio): from the build bay to Roblox
 * - a voice turn (voice): from the console to Jarvis Core
 * - a failure (fail): a drone flies over and holds a red scan on the zone
 * Between deliveries, zones that are busy, need Markus or are in error get
 * a drone hovering over them, scanning in the zone's colour (amber, red).
 * With nothing happening they stay docked.
 */

const N = 6
const DOCK_R = 7.25
const DOCK_DEG = [-27, -16, -5, 5, 16, 27]
const LIFT = 0.26
const SPEED = 3.2
type V3 = THREE.Vector3
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

const DOCKS = DOCK_DEG.map((d) => {
  const a = (d * Math.PI) / 180
  return V(DOCK_R * Math.sin(a), DECK_TOP, -DOCK_R * Math.cos(a))
})
/** Where a drone sits on its dock's pedestal (lift 0..1). */
const seat = (i: number, lift: number) => V(DOCKS[i].x, DECK_TOP + 0.045 + lift * LIFT + 0.115, DOCKS[i].z)

const CONSOLE_DROP = V(0, 2.45, 0.35)
const BAY_DROP = V(FOUNDRY[0], 3.0, FOUNDRY[2] + 1.0)
const DOOR_IN = V(0, 3.0, -12.5)
const DOOR_OUT = V(0, 3.0, -18.5)
const OUTSIDE = V(0, 2.6, -27)

function zonePoint(z: ZoneId, y = 1.95, r = 4.05) {
  const a = (ZONE[z].angle * Math.PI) / 180
  return V(r * Math.sin(a), y, -r * Math.cos(a))
}
const zoneHover = (z: ZoneId) => V(ZONE[z].pos[0], 2.4, ZONE[z].pos[2])

// ---------------------------------------------------------------- flight plans

type Leg =
  | { kind: 'move'; a: V3; b: V3; c: V3; d: V3; dur: number }
  | { kind: 'hold'; at: V3; dur: number; act?: 'pick' | 'drop' | 'launch' | 'land'; beam?: THREE.Color; until?: () => boolean }

function bez(l: Extract<Leg, { kind: 'move' }>, t: number, out: V3) {
  const u = 1 - t
  return out
    .copy(l.a)
    .multiplyScalar(u * u * u)
    .addScaledVector(l.b, 3 * u * u * t)
    .addScaledVector(l.c, 3 * u * t * t)
    .addScaledVector(l.d, t * t * t)
}

/** Up to cruise height, across, and down: clear of the console and the crane. */
function hop(from: V3, to: V3, cruise: number): Leg {
  const hiA = V(from.x, Math.max(from.y, cruise), from.z)
  const hiB = V(to.x, Math.max(to.y, cruise), to.z)
  const b = hiA.clone().lerp(hiB, 0.22)
  const c = hiB.clone().lerp(hiA, 0.22)
  const len = from.distanceTo(b) + b.distanceTo(c) + c.distanceTo(to)
  return { kind: 'move', a: from.clone(), b, c, d: to.clone(), dur: Math.max(1.2, len / SPEED) }
}

function straight(from: V3, to: V3, speed = SPEED * 0.6): Leg {
  return { kind: 'move', a: from.clone(), b: from.clone().lerp(to, 1 / 3), c: from.clone().lerp(to, 2 / 3), d: to.clone(), dur: Math.max(0.7, from.distanceTo(to) / speed) }
}

type Drone = {
  i: number
  legs: Leg[]
  t: number
  pos: V3
  vel: V3
  yaw: number
  pitch: number
  roll: number
  cargo: THREE.Color | null
  lift: number
  spin: number
  beam: THREE.Color | null
  cruise: number
  /** What it's doing: docked, flying a delivery, or tending a zone. */
  job: 'docked' | 'delivery' | 'tend'
  tend: ZoneId | null
}

type Mission = { kind: StationEvent['kind']; zone: ZoneId; at: number; color: THREE.Color }

const atDock = (d: Drone) => d.job === 'docked' && d.legs.length === 0

/** Out of the dock (if it's in it) to wherever the drone is going next. */
function departure(d: Drone): { legs: Leg[]; from: V3 } {
  if (!atDock(d)) return { legs: [], from: d.pos.clone() }
  const top = seat(d.i, 1)
  const up = top.clone().setY(top.y + 1.2)
  return { legs: [{ kind: 'hold', at: top, dur: 1.0, act: 'launch' }, straight(top, up)], from: up }
}

function homeward(d: Drone, from: V3): Leg[] {
  const top = seat(d.i, 1)
  const above = top.clone().setY(top.y + 1.3)
  return [hop(from, above, d.cruise), straight(above, top, 1.1), { kind: 'hold', at: top, dur: 1.0, act: 'land' }]
}

function deliver(d: Drone, A: V3, B: V3, outside: boolean): Leg[] {
  const { legs, from } = departure(d)
  const hiA = A.clone().setY(A.y + 0.7)
  const hiB = B.clone().setY(B.y + 0.7)
  if (outside) {
    // Out through the open glass, over the terrace, and back in.
    legs.push(hop(from, DOOR_IN, d.cruise), straight(DOOR_IN, DOOR_OUT, SPEED), straight(DOOR_OUT, A, SPEED))
    legs.push({ kind: 'hold', at: A, dur: 0.7, act: 'pick' }, straight(A, DOOR_OUT, SPEED), straight(DOOR_OUT, DOOR_IN, SPEED), hop(DOOR_IN, hiB, d.cruise))
  } else {
    legs.push(hop(from, hiA, d.cruise), straight(hiA, A), { kind: 'hold', at: A, dur: 0.7, act: 'pick' }, straight(A, hiA), hop(hiA, hiB, d.cruise))
  }
  legs.push(straight(hiB, B), { kind: 'hold', at: B, dur: 0.7, act: 'drop' }, straight(B, hiB))
  return [...legs, ...homeward(d, hiB)]
}

function scan(d: Drone, z: ZoneId, color: THREE.Color, until: () => boolean, maxSec: number): Leg[] {
  const { legs, from } = departure(d)
  const over = zoneHover(z)
  legs.push(hop(from, over, d.cruise), { kind: 'hold', at: over, dur: maxSec, beam: color, until })
  return [...legs, ...homeward(d, over)]
}

// ---------------------------------------------------------------- the drone

function useDroneParts() {
  return useMemo(() => {
    const shell = plated({ color: '#e9edf2', repeat: 0.6, roughness: 0.75, metalness: 0.35, normal: 0.5 })
    const frame = plated({ color: '#3a414d', repeat: 1.5, roughness: 1, metalness: 1 })
    const glassMat = new THREE.MeshStandardMaterial({ color: '#05070b', roughness: 0.05, metalness: 0.9 })
    const blade = new THREE.MeshStandardMaterial({ color: '#15181e', roughness: 0.4, metalness: 0.6 })
    const ducts: [number, number][] = [
      [-0.25, -0.2],
      [0.25, -0.2],
      [-0.25, 0.2],
      [0.25, 0.2],
    ]
    return {
      shell,
      frame,
      glassMat,
      blade,
      ducts,
      body: new THREE.SphereGeometry(1, 32, 16),
      arm: new THREE.BoxGeometry(0.035, 0.022, 1),
      duct: new THREE.TorusGeometry(0.1, 0.016, 10, 36),
      rotor: new THREE.BoxGeometry(0.18, 0.004, 0.024),
      disc: new THREE.CircleGeometry(0.095, 24),
      glow: new THREE.CircleGeometry(0.055, 18),
      skid: new THREE.BoxGeometry(0.014, 0.014, 0.34),
      strut: new THREE.BoxGeometry(0.012, 0.08, 0.012),
      claw: new THREE.BoxGeometry(0.02, 0.07, 0.05),
      crate: new THREE.BoxGeometry(0.17, 0.17, 0.17),
      crateEdges: new THREE.EdgesGeometry(new THREE.BoxGeometry(0.17, 0.17, 0.17)),
      eye: new THREE.SphereGeometry(0.028, 16, 10),
      led: new THREE.SphereGeometry(0.012, 8, 6),
      strip: new THREE.TorusGeometry(1, 0.012, 6, 48),
      beam: new THREE.ConeGeometry(0.75, 2.0, 32, 1, true).translate(0, -1.0, 0),
    }
  }, [])
}

type Parts = ReturnType<typeof useDroneParts>

function DroneModel({ parts, refs }: { parts: Parts; refs: DroneRefs }) {
  const p = parts
  return (
    <group ref={refs.root}>
      <group ref={refs.tilt}>
        {/* Body: a white shell over a dark frame, a glass canopy, JARVIS's eye. */}
        <mesh geometry={p.body} material={p.shell} scale={[0.17, 0.07, 0.25]} castShadow />
        <mesh geometry={p.body} material={p.glassMat} scale={[0.09, 0.045, 0.13]} position={[0, 0.045, -0.06]} />
        <mesh geometry={p.body} material={p.frame} scale={[0.13, 0.05, 0.2]} position-y={-0.03} />
        <mesh ref={refs.eye} geometry={p.eye} material={refs.eyeMat} position={[0, 0.0, -0.245]} />
        <mesh geometry={p.strip} material={refs.stripMat} scale={[0.172, 0.172, 0.252]} rotation-x={Math.PI / 2} />
        {p.ducts.map(([x, z], k) => (
          <group key={k} position={[x, 0.01, z]}>
            <mesh geometry={p.arm} material={p.frame} position={[-x / 2, -0.005, -z / 2]} scale={[1, 1, Math.hypot(x, z)]} rotation-y={Math.atan2(x, z)} />
            <mesh geometry={p.duct} material={p.frame} rotation-x={Math.PI / 2} castShadow />
            <group ref={(g) => void (refs.rotors.current[k] = g)}>
              <mesh geometry={p.rotor} material={p.blade} />
              <mesh geometry={p.rotor} material={p.blade} rotation-y={Math.PI / 2} />
            </group>
            <mesh geometry={p.disc} material={refs.blurMat} rotation-x={-Math.PI / 2} position-y={0.003} />
            <mesh geometry={p.glow} material={refs.thrustMat} rotation-x={Math.PI / 2} position-y={-0.02} />
            <mesh geometry={p.led} material={x < 0 ? refs.portMat : refs.starMat} position={[x * 1.45, 0, z * 1.2]} />
          </group>
        ))}
        {/* Landing skids and the cargo claw. */}
        {[-0.09, 0.09].map((x) => (
          <group key={x}>
            <mesh geometry={p.skid} material={p.frame} position={[x, -0.105, 0]} />
            <mesh geometry={p.strut} material={p.frame} position={[x, -0.07, -0.1]} />
            <mesh geometry={p.strut} material={p.frame} position={[x, -0.07, 0.1]} />
            <mesh geometry={p.claw} material={p.frame} position={[x * 1.0, -0.1, 0]} />
          </group>
        ))}
        <group ref={refs.crate} position-y={-0.2} visible={false}>
          <mesh geometry={p.crate} material={refs.crateMat} />
          <lineSegments geometry={p.crateEdges} material={refs.crateLine} />
        </group>
        <mesh ref={refs.beam} geometry={p.beam} material={refs.beamMat} position-y={-0.08} visible={false} />
      </group>
    </group>
  )
}

type DroneRefs = ReturnType<typeof useDroneRefs>
function useDroneRefs() {
  const root = useRef<THREE.Group>(null)
  const tilt = useRef<THREE.Group>(null)
  const eye = useRef<THREE.Mesh>(null)
  const crate = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)
  const rotors = useRef<(THREE.Group | null)[]>([])
  const mats = useMemo(() => {
    const glow = (c: string, o = 1) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: o < 1, opacity: o, depthWrite: o >= 1 })
    return {
      eyeMat: glow('#7c8bff'),
      stripMat: glow('#7c8bff'),
      portMat: glow('#ff3b30'),
      starMat: glow('#2bd96b'),
      blurMat: new THREE.MeshBasicMaterial({ color: '#cfd6e2', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      thrustMat: new THREE.MeshBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      crateMat: new THREE.MeshBasicMaterial({ color: '#7c8bff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      crateLine: new THREE.LineBasicMaterial({ color: '#7c8bff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, toneMapped: false }),
      beamMat: new THREE.MeshBasicMaterial({ color: '#7c8bff', transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    }
  }, [])
  return { root, tilt, eye, crate, beam, rotors, ...mats }
}

function DroneSlot({ parts, refsOut }: { parts: Parts; refsOut: (r: DroneRefs) => void }) {
  const refs = useDroneRefs()
  refsOut(refs)
  return <DroneModel parts={parts} refs={refs} />
}

// ---------------------------------------------------------------- the docks

function useDockParts() {
  return useMemo(() => {
    const ring = new THREE.RingGeometry(0.34, 0.5, 48)
    const vents = Array.from({ length: 6 }, (_, k) => k)
    return {
      ring,
      vents,
      deck: plated({ color: '#5d6573', repeat: 0.5, roughness: 1, metalness: 1 }),
      pad: plated({ color: '#8c94a3', repeat: 0.4, roughness: 1, metalness: 1 }),
      ventGeo: new THREE.BoxGeometry(0.1, 0.012, 0.07),
      platform: new THREE.CylinderGeometry(0.31, 0.31, 0.05, 40),
      column: new THREE.CylinderGeometry(0.15, 0.17, 1, 24, 1, true),
      column2: new THREE.CylinderGeometry(0.1, 0.1, 1, 20, 1, true),
      shaft: new THREE.CircleGeometry(0.34, 32),
      status: new THREE.TorusGeometry(0.42, 0.008, 6, 64),
      mark: new THREE.RingGeometry(0.18, 0.2, 40),
    }
  }, [])
}

type DockParts = ReturnType<typeof useDockParts>

function Dock({ i, parts, state }: { i: number; parts: DockParts; state: { current: Drone[] } }) {
  const p = parts
  const lift = useRef<THREE.Group>(null)
  const col = useRef<THREE.Mesh>(null)
  const col2 = useRef<THREE.Mesh>(null)
  const vents = useRef<(THREE.Mesh | null)[]>([])
  const mats = useMemo(
    () => ({
      status: new THREE.MeshBasicMaterial({ color: STATUS.ok, toneMapped: false }),
      shaft: new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false }),
      mark: new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false, transparent: true, opacity: 0.8 }),
    }),
    [],
  )
  const c = useMemo(() => new THREE.Color(), [])
  useFrame((st) => {
    const d = state.current[i]
    if (!d) return
    const t = st.clock.elapsedTime
    const L = d.lift
    if (lift.current) lift.current.position.y = L * LIFT
    if (col.current) {
      col.current.scale.y = Math.max(0.001, L * LIFT)
      col.current.position.y = (L * LIFT) / 2
    }
    if (col2.current) {
      col2.current.scale.y = Math.max(0.001, L * LIFT + 0.2)
      col2.current.position.y = (L * LIFT) / 2 - 0.1
    }
    // Vents slide out as the pedestal comes up.
    vents.current.forEach((v, k) => {
      if (!v) return
      const a = (k / 6) * Math.PI * 2
      const r = 0.42 + L * 0.06
      v.position.set(Math.cos(a) * r, 0.006 + L * 0.004, Math.sin(a) * r)
    })
    // Green while charging, amber while launching or out, breathing.
    const out = d.job !== 'docked' || d.legs.length > 0
    c.set(out ? STATUS.warn : STATUS.ok).multiplyScalar(out ? 1.2 + 0.8 * Math.sin(t * 6) : 0.9 + 0.4 * Math.sin(t * 1.5 + i))
    mats.status.color.copy(c)
    mats.shaft.color.copy(reactorState().color).multiplyScalar(L * 1.4)
    mats.mark.color.copy(reactorState().color).multiplyScalar(out ? 1.4 : 0.9)
  })
  const pos = DOCKS[i]
  return (
    <group position={[pos.x, DECK_TOP, pos.z]} rotation-y={-((DOCK_DEG[i] * Math.PI) / 180)}>
      <mesh geometry={p.ring} material={p.deck} rotation-x={-Math.PI / 2} position-y={0.004} receiveShadow />
      <mesh geometry={p.shaft} material={mats.shaft} rotation-x={-Math.PI / 2} position-y={0.001} />
      <mesh geometry={p.status} material={mats.status} rotation-x={Math.PI / 2} position-y={0.008} />
      {p.vents.map((k) => (
        <mesh key={k} ref={(m) => void (vents.current[k] = m)} geometry={p.ventGeo} material={p.pad} rotation-y={-(k / 6) * Math.PI * 2} />
      ))}
      <mesh ref={col} geometry={p.column} material={p.deck} />
      <mesh ref={col2} geometry={p.column2} material={p.pad} />
      <group ref={lift}>
        <mesh geometry={p.platform} material={p.pad} position-y={0.02} castShadow receiveShadow />
        <mesh geometry={p.mark} material={mats.mark} rotation-x={-Math.PI / 2} position-y={0.046} />
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- the squad

const KIND_FROM: Record<StationEvent['kind'], (z: ZoneId) => { A: V3; B: V3; outside?: boolean } | null> = {
  assign: (z) => ({ A: CONSOLE_DROP, B: zonePoint(z) }),
  complete: (z) => ({ A: zonePoint(z), B: BAY_DROP }),
  need: (z) => ({ A: zonePoint(z), B: zonePoint('needs') }),
  lead: () => ({ A: OUTSIDE, B: zonePoint('automaton'), outside: true }),
  studio: () => ({ A: BAY_DROP, B: zonePoint('roblox') }),
  voice: () => ({ A: CONSOLE_DROP, B: zonePoint('core') }),
  fail: () => null,
}

export function Drones() {
  const parts = useDroneParts()
  const dockParts = useDockParts()
  const refs = useRef<DroneRefs[]>([])
  const drones = useRef<Drone[]>(
    Array.from({ length: N }, (_, i) => ({
      i,
      legs: [],
      t: 0,
      pos: seat(i, 0),
      vel: V(0, 0, 0),
      yaw: Math.PI - ((DOCK_DEG[i] * Math.PI) / 180),
      pitch: 0,
      roll: 0,
      cargo: null,
      lift: 0,
      spin: 0,
      beam: null,
      cruise: 3.45 + (i % 3) * 0.14,
      job: 'docked',
      tend: null,
    })),
  )
  const queue = useRef<Mission[]>([])
  const seen = useRef(0)
  const tmp = useMemo(() => ({ p: V(0, 0, 0), prev: V(0, 0, 0), acc: V(0, 0, 0), q: new THREE.Quaternion(), e: new THREE.Euler() }), [])

  useFrame((st, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const reduced = useHub.getState().prefs.reducedMotion
    const { events, model } = useStation.getState()
    const now = performance.now()
    const t = st.clock.elapsedTime

    // New events become missions.
    for (const e of events) {
      if (e.id <= seen.current) continue
      seen.current = e.id
      if (now - e.at > 4000) continue
      const color = new THREE.Color(e.kind === 'complete' ? STATUS.ok : e.kind === 'need' ? STATUS.warn : e.kind === 'fail' ? STATUS.error : ZONE[e.zone].color)
      queue.current.push({ kind: e.kind, zone: e.zone, at: now, color })
    }
    queue.current = queue.current.filter((m) => now - m.at < 25000)

    const all = drones.current
    const free = () => all.filter((d) => atDock(d) || (d.job === 'tend' && d.legs[0]?.kind === 'hold'))
    // Hand out missions: the nearest free drone takes each.
    while (queue.current.length) {
      const m = queue.current[0]
      const plan = KIND_FROM[m.kind](m.zone)
      const target = plan ? plan.A : zoneHover(m.zone)
      const pick = free().sort((a, b) => a.pos.distanceTo(target) - b.pos.distanceTo(target))[0]
      if (!pick) break
      queue.current.shift()
      if (pick.job === 'tend') pick.job = 'delivery'
      pick.legs = plan ? deliver(pick, plan.A, plan.B, Boolean(plan.outside)) : scan(pick, m.zone, m.color, () => false, 5)
      pick.t = 0
      pick.cargo = m.color
      pick.job = 'delivery'
      pick.tend = null
    }
    // Zones that are busy, need Markus or are in error get a drone over them.
    if (model && !queue.current.length) {
      const want = ZONES.map((z) => ({ z: z.id, s: model.zones[z.id]?.state }))
        .filter((w) => w.s === 'active' || w.s === 'attention' || w.s === 'error')
        .sort((a, b) => (a.s === 'error' ? 0 : a.s === 'attention' ? 1 : 2) - (b.s === 'error' ? 0 : b.s === 'attention' ? 1 : 2))
        .slice(0, 3)
      for (const w of want) {
        if (all.some((d) => d.tend === w.z)) continue
        const d = all.filter(atDock).sort((a, b) => a.pos.distanceTo(zoneHover(w.z)) - b.pos.distanceTo(zoneHover(w.z)))[0]
        if (!d) break
        const color = new THREE.Color(w.s === 'error' ? STATUS.error : w.s === 'attention' ? STATUS.warn : ZONE[w.z].color)
        const zone = w.z
        d.legs = scan(d, zone, color, () => useStation.getState().model?.zones[zone]?.state !== w.s || queue.current.length > 0, 600)
        d.t = 0
        d.job = 'tend'
        d.tend = zone
        d.cargo = null
      }
    }

    // Fly.
    all.forEach((d) => {
      const r = refs.current[d.i]
      tmp.prev.copy(d.pos)
      const leg = d.legs[0]
      d.beam = null
      if (!leg) {
        d.job = 'docked'
        d.tend = null
        d.lift = Math.max(0, d.lift - dt * 1.2)
        d.pos.copy(seat(d.i, d.lift))
      } else {
        d.t += reduced ? leg.dur : dt
        const k = Math.min(1, d.t / leg.dur)
        const e = k * k * (3 - 2 * k)
        if (leg.kind === 'move') bez(leg, e, d.pos)
        else {
          if (leg.act === 'launch') d.lift = k
          if (leg.act === 'land') d.lift = 1 - k
          d.pos.copy(leg.act === 'launch' || leg.act === 'land' ? seat(d.i, d.lift) : leg.at)
          if (!leg.act) d.pos.y += Math.sin(t * 1.7 + d.i) * 0.04
          d.beam = leg.beam ?? null
        }
        const done = d.t >= leg.dur || (leg.kind === 'hold' && leg.until?.())
        if (done) {
          if (leg.kind === 'hold' && leg.act === 'drop') d.cargo = null
          d.legs.shift()
          d.t = 0
        }
      }
      // Carrying from the pick-up to the drop.
      const carrying = Boolean(d.cargo) && !d.legs.some((l) => l.kind === 'hold' && l.act === 'pick') && d.legs.some((l) => l.kind === 'hold' && l.act === 'drop')
      // Motion: face the way it's going, bank into turns, pitch into speed.
      d.vel.copy(d.pos).sub(tmp.prev).divideScalar(Math.max(dt, 1e-3))
      const speed = Math.hypot(d.vel.x, d.vel.z)
      if (speed > 0.3) {
        let dy = Math.atan2(-d.vel.x, -d.vel.z) - d.yaw
        dy = Math.atan2(Math.sin(dy), Math.cos(dy))
        d.yaw += dy * Math.min(1, dt * 4)
      }
      const fwd = -(d.vel.x * Math.sin(d.yaw) + d.vel.z * Math.cos(d.yaw))
      const side = d.vel.x * Math.cos(d.yaw) - d.vel.z * Math.sin(d.yaw)
      d.pitch += (-Math.max(-0.35, Math.min(0.35, fwd * 0.09)) - d.pitch) * Math.min(1, dt * 5)
      d.roll += (Math.max(-0.4, Math.min(0.4, side * 0.12)) - d.roll) * Math.min(1, dt * 5)
      const flying = d.legs.length > 0 && !(d.legs[0].kind === 'hold' && (d.legs[0] as { act?: string }).act === 'launch' && d.t < 0.5)
      d.spin += ((flying ? 1 : 0) - d.spin) * Math.min(1, dt * 2)
      if (!r?.root.current || !r.tilt.current) return
      r.root.current.position.copy(d.pos)
      r.root.current.rotation.set(0, d.yaw, 0)
      r.tilt.current.rotation.set(d.pitch, 0, d.roll)
      r.rotors.current.forEach((g, k) => g && (g.rotation.y += (k % 2 ? -1 : 1) * d.spin * dt * 70))
      r.blurMat.opacity = d.spin * 0.16
      r.thrustMat.opacity = d.spin * (0.45 + 0.25 * Math.sin(t * 30 + d.i))
      const eye = d.cargo ?? reactorState().color
      r.eyeMat.color.copy(eye).multiplyScalar(1.8)
      r.stripMat.color.copy(eye).multiplyScalar(d.spin > 0.1 ? 1.5 : 0.6)
      if (r.crate.current) {
        r.crate.current.visible = carrying
        if (carrying && d.cargo) {
          r.crateMat.color.copy(d.cargo)
          r.crateLine.color.copy(d.cargo).multiplyScalar(1.6)
          r.crate.current.rotation.y += dt * 0.8
        }
      }
      if (r.beam.current) {
        r.beam.current.visible = Boolean(d.beam)
        if (d.beam) {
          r.beamMat.color.copy(d.beam)
          r.beamMat.opacity = 0.08 + 0.05 * Math.sin(t * 5)
          r.beam.current.scale.set(1, (d.pos.y - 0.4) / 2, 1)
        }
      }
    })
  })

  return (
    <group>
      {Array.from({ length: N }, (_, i) => (
        <group key={i}>
          <Dock i={i} parts={dockParts} state={drones} />
          <DroneSlot parts={parts} refsOut={(r) => void (refs.current[i] = r)} />
        </group>
      ))}
    </group>
  )
}
