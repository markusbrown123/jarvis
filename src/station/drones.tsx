import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { DECK_TOP, FOUNDRY, STATUS, ZONE, ZONES, type ZoneId } from './layout'
import { plated } from './metal'
import { reactorState } from './shared'
import { useStation, type StationEvent } from './stationStore'

/**
 * JARVIS's drones: a squad of FPV quads and tiny whoops (modelled in
 * Blender, tools/blender/fpv.py) that fly the station's real work — so
 * when they fly it means something.
 *
 * The six 5-inch quads live in docks in the floor behind the build bay. A
 * dock's pedestal rises out of the floor to launch its quad, its vents
 * slide open and its ring turns amber; it waits raised while the quad is
 * out and sinks back with it when it lands, ring green while it charges.
 * Every live event is a delivery, a glowing packet in the colour of what's
 * being carried:
 * - work handed out (assign): from the console out to the zone
 * - a job finished (complete): from its zone to the build bay
 * - something new needs Markus (need): from its project to Needs Markus
 * - new leads (lead): in from outside — out through the open glass and
 *   back over the terrace — to Automaton
 * - the Roblox queue moved (studio): from the build bay to Roblox
 * - a voice turn (voice): from the console to Jarvis Core
 * - a failure (fail): a quad flies over and holds a red scan on the zone
 * Between deliveries, zones that are busy, need Markus or are in error get
 * a quad hovering over them, scanning in the zone's colour (amber, red).
 *
 * The three tiny whoops perch on the build bay's rim and carry data: when
 * a zone's live data changes they zip from it to the console, trailing its
 * colour; while JARVIS is thinking or working they circle high over the
 * console. They fly like FPV drones — nose down into speed, banked hard
 * into turns, the odd roll on a long straight.
 *
 * Sat at the desk in Talk mode, nothing flies through the view: anything
 * passing over the desk and its monitors goes up near the ceiling, above
 * the picture.
 */

type V3 = THREE.Vector3
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const G = 9.81

const DOCK_R = 7.25
const DOCK_DEG = [-27, -16, -5, 5, 16, 27]
const LIFT = 0.26
const DOCKS = DOCK_DEG.map((d) => {
  const a = (d * Math.PI) / 180
  return V(DOCK_R * Math.sin(a), DECK_TOP, -DOCK_R * Math.cos(a))
})
/** The top of a dock's pedestal (lift 0..1), where its quad sits. */
const padTop = (i: number, lift: number) => V(DOCKS[i].x, DECK_TOP + 0.05 + lift * LIFT, DOCKS[i].z)
/** Where the whoops sit, on their pads on the build bay's rim. */
const TABLE_TOP = FOUNDRY[1] + 0.85
const PERCHES = [200, 225, 248].map((deg) => {
  const a = (deg * Math.PI) / 180
  return V(FOUNDRY[0] + Math.sin(a) * 0.97, TABLE_TOP + 0.012 + 0.025, FOUNDRY[2] - Math.cos(a) * 0.97)
})

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
  | { kind: 'move'; a: V3; b: V3; c: V3; d: V3; dur: number; flip?: boolean }
  | { kind: 'hold'; at: V3; dur: number; act?: 'pick' | 'drop' | 'launch' | 'land'; beam?: THREE.Color; until?: () => boolean }
  | { kind: 'orbit'; center: V3; r: number; dur: number; until: () => boolean }
  // Back home from wherever the leg before it ended.
  | { kind: 'home' }

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
function hop(from: V3, to: V3, cruise: number, speed: number, flips = false): Leg {
  const hiA = V(from.x, Math.max(from.y, cruise), from.z)
  const hiB = V(to.x, Math.max(to.y, cruise), to.z)
  const b = hiA.clone().lerp(hiB, 0.22)
  const c = hiB.clone().lerp(hiA, 0.22)
  const len = from.distanceTo(b) + b.distanceTo(c) + c.distanceTo(to)
  const dur = Math.max(1.0, len / speed)
  return { kind: 'move', a: from.clone(), b, c, d: to.clone(), dur, flip: flips && dur > 2.2 && Math.random() < 0.4 }
}

function straight(from: V3, to: V3, speed: number): Leg {
  return { kind: 'move', a: from.clone(), b: from.clone().lerp(to, 1 / 3), c: from.clone().lerp(to, 2 / 3), d: to.clone(), dur: Math.max(0.5, from.distanceTo(to) / speed) }
}

type Kind = 'quad' | 'whoop'
type Drone = {
  i: number
  kind: Kind
  legs: Leg[]
  t: number
  pos: V3
  prev: V3
  vel: V3
  acc: V3
  heading: number
  quat: THREE.Quaternion
  cargo: THREE.Color | null
  lift: number
  spin: number
  beam: THREE.Color | null
  cruise: number
  speed: number
  job: 'home' | 'delivery' | 'tend' | 'data' | 'swarm'
  tend: ZoneId | null
}

type Mission = { kind: StationEvent['kind'] | 'data'; zone: ZoneId; at: number; color: THREE.Color }

const homeSpot = (d: Drone, lift = d.lift) => (d.kind === 'quad' ? padTop(d.i, lift) : PERCHES[d.i - 6].clone())
const atHome = (d: Drone) => d.job === 'home' && d.legs.length === 0

/** Out of the dock or off the perch, if it's there, to wherever it's going next. */
function departure(d: Drone): { legs: Leg[]; from: V3 } {
  if (!atHome(d)) return { legs: [], from: d.pos.clone() }
  const spot = homeSpot(d, 1)
  const up = spot.clone().setY(spot.y + (d.kind === 'quad' ? 1.2 : 0.7))
  return { legs: [{ kind: 'hold', at: spot, dur: d.kind === 'quad' ? 1.0 : 0.45, act: 'launch' }, straight(spot, up, d.speed * 0.5)], from: up }
}

function homeward(d: Drone, from: V3): Leg[] {
  const spot = homeSpot(d, 1)
  const above = spot.clone().setY(spot.y + (d.kind === 'quad' ? 1.3 : 0.8))
  return [hop(from, above, d.cruise, d.speed), straight(above, spot, d.speed * 0.3), { kind: 'hold', at: spot, dur: d.kind === 'quad' ? 1.0 : 0.3, act: 'land' }]
}

function deliver(d: Drone, A: V3, B: V3, outside: boolean): Leg[] {
  const { legs, from } = departure(d)
  const hiA = A.clone().setY(A.y + 0.7)
  const hiB = B.clone().setY(B.y + 0.7)
  const s = d.speed
  if (outside) {
    // Out through the open glass, over the terrace, and back in.
    legs.push(hop(from, DOOR_IN, d.cruise, s), straight(DOOR_IN, DOOR_OUT, s), straight(DOOR_OUT, A, s))
    legs.push({ kind: 'hold', at: A, dur: 0.6, act: 'pick' }, straight(A, DOOR_OUT, s), straight(DOOR_OUT, DOOR_IN, s), hop(DOOR_IN, hiB, d.cruise, s))
  } else {
    legs.push(hop(from, hiA, d.cruise, s, true), straight(hiA, A, s * 0.6), { kind: 'hold', at: A, dur: 0.6, act: 'pick' }, straight(A, hiA, s * 0.6), hop(hiA, hiB, d.cruise, s, true))
  }
  legs.push(straight(hiB, B, s * 0.6), { kind: 'hold', at: B, dur: 0.6, act: 'drop' }, straight(B, hiB, s * 0.6), { kind: 'home' })
  return legs
}

function scan(d: Drone, z: ZoneId, color: THREE.Color, until: () => boolean, maxSec: number): Leg[] {
  const { legs, from } = departure(d)
  const over = zoneHover(z)
  legs.push(hop(from, over, d.cruise, d.speed), { kind: 'hold', at: over, dur: maxSec, beam: color, until }, { kind: 'home' })
  return legs
}

function swarm(d: Drone, until: () => boolean): Leg[] {
  const { legs, from } = departure(d)
  const r = 2.4 + (d.i % 3) * 0.35
  const center = V(0, 3.85 + (d.i % 3) * 0.12, -0.4)
  legs.push(hop(from, V(center.x + r, center.y, center.z), d.cruise, d.speed), { kind: 'orbit', center, r, dur: 600, until }, { kind: 'home' })
  return legs
}

/**
 * Sat at the desk, the view over the desk and its monitors stays clear:
 * anything flying through it is lifted to the ceiling, above the picture,
 * easing in and out at the edges.
 */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
function keepClear(p: V3) {
  const w = (1 - smooth(2.6, 3.8, Math.abs(p.x))) * smooth(-4.4, -3.2, p.z) * (1 - smooth(5.6, 6.8, p.z))
  if (w > 0) p.y += (Math.max(p.y, 4.05) - p.y) * w
}

// ---------------------------------------------------------------- the models

const TRAIL = 40
const PROP_COLORS = ['#3aa0ff', '#ff5a3c', '#36e0a0', '#ffc23a', '#c46bff', '#e8edf5', '#ff3fa4', '#3af0ff', '#ffe95a']

/**
 * One drone's scene objects: its own copy of the model (shared geometry,
 * its own LEDs and props), a blur disc over each prop, the packet it
 * carries, its scan beam, and its light trail (in world space).
 */
function build(nodes: Record<string, THREE.Object3D>, kind: Kind, propColor: string) {
  const quad = kind === 'quad'
  const scale = quad ? 1.6 : 2.1
  const led = new THREE.MeshStandardMaterial({ color: '#05060a', emissive: new THREE.Color('#7c8bff'), emissiveIntensity: 3, roughness: 0.4 })
  const prop = new THREE.MeshStandardMaterial({ color: propColor, roughness: 0.25, transparent: true, opacity: 0.9 })
  const blur = new THREE.MeshBasicMaterial({ color: '#d8deea', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
  const copy = (o: THREE.Object3D) => {
    const c = o.clone(true)
    c.traverse((m) => {
      const mesh = m as THREE.Mesh
      if (!mesh.isMesh) return
      const name = (mesh.material as THREE.Material).name
      if (name === 'prop') mesh.material = prop
      else if (name === 'led') mesh.material = led
      mesh.castShadow = true
    })
    return c
  }
  const pre = quad ? 'quad' : 'whoop'
  const model = new THREE.Group()
  model.scale.setScalar(scale)
  model.add(copy(nodes[`${pre}_body`]), copy(nodes[`${pre}_led`]))
  // Prop discs at the props' height (fpv.py), the size of the props.
  const disc = new THREE.CircleGeometry(quad ? 0.067 : 0.0162, 32).rotateX(-Math.PI / 2)
  const rotors = ['fl', 'fr', 'rl', 'rr'].map((k) => {
    const r = copy(nodes[`${pre}_rotor_${k}`])
    const d = new THREE.Mesh(disc, blur)
    d.position.set(r.position.x, quad ? 0.029 : 0.0098, r.position.z)
    model.add(r, d)
    return r
  })
  const packetMat = new THREE.MeshBasicMaterial({ color: '#7c8bff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const packet = new THREE.Mesh(new THREE.OctahedronGeometry(quad ? 0.06 : 0.03, 0), packetMat)
  packet.position.y = quad ? -0.07 : -0.05
  packet.visible = false
  const tilt = new THREE.Group()
  tilt.add(model, packet)
  const beamMat = new THREE.MeshBasicMaterial({ color: '#7c8bff', transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.0, 32, 1, true), beamMat)
  beam.visible = false
  const root = new THREE.Group()
  root.add(tilt, beam)
  const trailGeo = new THREE.BufferGeometry()
  trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRAIL * 3), 3))
  trailGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(TRAIL * 3), 3))
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
  trail.frustumCulled = false
  const hist = Array.from({ length: TRAIL }, () => V(0, 0, 0))
  return { root, tilt, rotors, led, prop, blur, packet, packetMat, beam, beamMat, trail, hist }
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
    const out = !atHome(d)
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

/** The whoops' little charging pads on the build bay's rim. */
function Perches() {
  const mat = useMemo(() => plated({ color: '#7d8596', repeat: 0.3, roughness: 1, metalness: 1 }), [])
  const ring = useMemo(() => new THREE.MeshBasicMaterial({ color: STATUS.ok, toneMapped: false }), [])
  return (
    <>
      {PERCHES.map((p, k) => (
        <group key={k} position={[p.x, TABLE_TOP, p.z]}>
          <mesh material={mat} position-y={0.006} castShadow receiveShadow>
            <cylinderGeometry args={[0.13, 0.14, 0.012, 32]} />
          </mesh>
          <mesh material={ring} rotation-x={-Math.PI / 2} position-y={0.0125}>
            <ringGeometry args={[0.1, 0.11, 32]} />
          </mesh>
        </group>
      ))}
    </>
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

/** What a zone's live data says now, to notice when it changes. */
const signature = (m: NonNullable<ReturnType<typeof useStation.getState>['model']>, z: ZoneId) => {
  const zm = m.zones[z]
  return zm ? `${zm.state}|${zm.headline}|${zm.lines.join('|')}` : ''
}

export function Drones() {
  const { nodes } = useGLTF('/station/fpv.glb', false) as unknown as { nodes: Record<string, THREE.Object3D> }
  const dockParts = useDockParts()
  const kit = useMemo(() => Array.from({ length: 9 }, (_, i) => build(nodes, i < 6 ? 'quad' : 'whoop', PROP_COLORS[i])), [nodes])
  const drones = useRef<Drone[]>(
    kit.map((_, i) => {
      const kind: Kind = i < 6 ? 'quad' : 'whoop'
      const d: Drone = {
        i,
        kind,
        legs: [],
        t: 0,
        pos: V(0, 0, 0),
        prev: V(0, 0, 0),
        vel: V(0, 0, 0),
        acc: V(0, 0, 0),
        heading: kind === 'quad' ? Math.PI - (DOCK_DEG[i] * Math.PI) / 180 : Math.PI / 2,
        quat: new THREE.Quaternion(),
        cargo: null,
        lift: 0,
        spin: 0,
        beam: null,
        cruise: kind === 'quad' ? 3.45 + (i % 3) * 0.14 : 3.1 + (i % 3) * 0.12,
        speed: kind === 'quad' ? 5.2 : 3.4,
        job: 'home',
        tend: null,
      }
      d.pos.copy(homeSpot(d, 0))
      d.prev.copy(d.pos)
      return d
    }),
  )
  const queue = useRef<Mission[]>([])
  const seen = useRef(0)
  const sigs = useRef<Partial<Record<ZoneId, string>>>({})
  const lastData = useRef<Partial<Record<ZoneId, number>>>({})
  const tmp = useMemo(() => ({ v: V(0, 0, 0), a: V(0, 0, 0), up: V(0, 1, 0), x: V(1, 0, 0), z: V(0, 0, 1), m: new THREE.Matrix4(), q: new THREE.Quaternion(), roll: new THREE.Quaternion(), axis: V(0, 0, -1), c: new THREE.Color() }), [])

  useFrame((st, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    if (dt <= 0) return
    const reduced = useHub.getState().prefs.reducedMotion
    const { events, model, mode, intro } = useStation.getState()
    const talking = mode === 'talk' && intro === 'done'
    const now = performance.now()
    const t = st.clock.elapsedTime
    const all = drones.current
    const quads = all.filter((d) => d.kind === 'quad')
    const whoops = all.filter((d) => d.kind === 'whoop')

    // New events become deliveries.
    for (const e of events) {
      if (e.id <= seen.current) continue
      seen.current = e.id
      if (now - e.at > 4000) continue
      const color = new THREE.Color(e.kind === 'complete' ? STATUS.ok : e.kind === 'need' ? STATUS.warn : e.kind === 'fail' ? STATUS.error : ZONE[e.zone].color)
      queue.current.push({ kind: e.kind, zone: e.zone, at: now, color })
    }
    // A zone's live data changed: a data run from it to the console.
    if (model) {
      for (const z of ZONES) {
        const sig = signature(model, z.id)
        const before = sigs.current[z.id]
        sigs.current[z.id] = sig
        if (before === undefined || before === sig || now - (lastData.current[z.id] ?? 0) < 8000) continue
        lastData.current[z.id] = now
        queue.current.push({ kind: 'data', zone: z.id, at: now, color: new THREE.Color(z.color) })
      }
    }
    queue.current = queue.current.filter((m) => now - m.at < 25000)

    const nearest = (pool: Drone[], target: V3) => pool.sort((a, b) => a.pos.distanceTo(target) - b.pos.distanceTo(target))[0]
    // Free to take a mission: at home, or only hanging about (tending, circling).
    const idle = (l?: Leg) => (l?.kind === 'hold' && !l.act) || l?.kind === 'orbit'
    const free = (pool: Drone[]) => pool.filter((d) => atHome(d) || ((d.job === 'tend' || d.job === 'swarm') && idle(d.legs[0])))
    // Hand out missions: data runs to the whoops, everything else to the quads.
    for (let k = 0; k < queue.current.length; ) {
      const m = queue.current[k]
      const data = m.kind === 'data'
      const plan = m.kind === 'data' ? { A: zonePoint(m.zone, 2.0, 4.3), B: CONSOLE_DROP, outside: false } : KIND_FROM[m.kind](m.zone)
      const pick = nearest(free(data ? whoops : quads), plan ? plan.A : zoneHover(m.zone))
      if (!pick) {
        k++
        continue
      }
      queue.current.splice(k, 1)
      pick.job = data ? 'data' : 'delivery'
      pick.legs = plan ? deliver(pick, plan.A, plan.B, Boolean(plan.outside)) : scan(pick, m.zone, m.color, () => false, 5)
      pick.t = 0
      pick.cargo = m.color
      pick.tend = null
    }
    // Zones that are busy, need Markus or are in error get a quad over them.
    if (model && !queue.current.some((m) => m.kind !== 'data')) {
      const rank = (s?: string) => (s === 'error' ? 0 : s === 'attention' ? 1 : 2)
      const want = ZONES.map((z) => ({ z: z.id, s: model.zones[z.id]?.state }))
        .filter((w) => w.s === 'active' || w.s === 'attention' || w.s === 'error')
        .sort((a, b) => rank(a.s) - rank(b.s))
        .slice(0, 3)
      for (const w of want) {
        if (quads.some((d) => d.tend === w.z)) continue
        const d = nearest(quads.filter(atHome), zoneHover(w.z))
        if (!d) break
        const color = new THREE.Color(w.s === 'error' ? STATUS.error : w.s === 'attention' ? STATUS.warn : ZONE[w.z].color)
        const zone = w.z
        d.legs = scan(d, zone, color, () => useStation.getState().model?.zones[zone]?.state !== w.s, 600)
        d.t = 0
        d.job = 'tend'
        d.tend = zone
        d.cargo = null
      }
    }
    // While JARVIS thinks or works, the whoops circle high over the console.
    if (reactorState().busy && !queue.current.some((m) => m.kind === 'data')) {
      for (const d of whoops.filter(atHome)) {
        d.legs = swarm(d, () => !reactorState().busy)
        d.t = 0
        d.job = 'swarm'
        d.cargo = null
      }
    }

    // Fly.
    all.forEach((d, idx) => {
      d.prev.copy(d.pos)
      let leg = d.legs[0]
      if (leg?.kind === 'home') {
        d.legs.splice(0, 1, ...homeward(d, d.pos))
        leg = d.legs[0]
      }
      d.beam = null
      let roll = 0
      if (!leg) {
        d.job = 'home'
        d.tend = null
        d.lift = Math.max(0, d.lift - dt * 1.2)
        d.pos.copy(homeSpot(d))
      } else if (leg.kind !== 'home') {
        d.t += reduced ? leg.dur : dt
        const k = Math.min(1, d.t / leg.dur)
        const e = k * k * (3 - 2 * k)
        if (leg.kind === 'move') {
          bez(leg, e, d.pos)
          // A roll on a long straight, like a pilot showing off (not with a load).
          if (leg.flip && !d.cargo) roll = smooth(0.38, 0.62, k) * Math.PI * 2
        } else if (leg.kind === 'orbit') {
          const a = t * 1.1 + d.i * 2.1
          d.pos.set(leg.center.x + Math.cos(a) * leg.r, leg.center.y + Math.sin(t * 1.7 + d.i) * 0.15, leg.center.z + Math.sin(a) * leg.r)
        } else {
          if (leg.act === 'launch') d.lift = k
          if (leg.act === 'land') d.lift = 1 - k
          d.pos.copy(leg.act === 'launch' || leg.act === 'land' ? homeSpot(d) : leg.at)
          if (!leg.act) d.pos.y += Math.sin(t * 1.7 + d.i) * 0.04
          d.beam = leg.beam ?? null
        }
        const done = d.t >= leg.dur || ((leg.kind === 'hold' || leg.kind === 'orbit') && leg.until?.())
        if (done) {
          if (leg.kind === 'hold' && leg.act === 'drop') d.cargo = null
          d.legs.shift()
          d.t = 0
        }
      }
      if (talking) keepClear(d.pos)

      // FPV attitude: a quad tilts its whole body along its thrust, which
      // holds it up against gravity, fights drag and pushes it where it's
      // accelerating: nose down into speed, banked hard into turns, nose
      // pointing the way it's flying.
      const v = tmp.v.copy(d.pos).sub(d.prev).divideScalar(dt)
      d.acc.lerp(tmp.a.copy(v).sub(d.vel).divideScalar(dt), Math.min(1, dt * 6))
      d.vel.copy(v)
      const speed = Math.hypot(v.x, v.z)
      if (speed > 0.4) {
        let dh = Math.atan2(-v.x, -v.z) - d.heading
        dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        d.heading += dh * Math.min(1, dt * 5)
      }
      const next = d.legs[0]
      const onPad = !next || (next.kind === 'hold' && (next.act === 'launch' || next.act === 'land'))
      if (onPad || reduced) tmp.up.set(0, 1, 0)
      else tmp.up.set(d.acc.x + v.x * 0.35, Math.max(2, d.acc.y + G), d.acc.z + v.z * 0.35).normalize()
      tmp.z.set(Math.sin(d.heading), 0, Math.cos(d.heading)) // towards the drone's tail
      tmp.z.addScaledVector(tmp.up, -tmp.z.dot(tmp.up)).normalize()
      tmp.x.crossVectors(tmp.up, tmp.z).normalize()
      tmp.q.setFromRotationMatrix(tmp.m.makeBasis(tmp.x, tmp.up, tmp.z))
      if (roll) tmp.q.multiply(tmp.roll.setFromAxisAngle(tmp.axis, roll))
      d.quat.slerp(tmp.q, roll ? 1 : Math.min(1, dt * 10))
      // Props spool up when it launches and down once it's landed.
      d.spin += ((next ? 1 : 0) - d.spin) * Math.min(1, dt * 3)

      const o = kit[idx]
      o.root.position.copy(d.pos)
      o.tilt.quaternion.copy(d.quat)
      const rate = d.spin * (60 + 20 * Math.min(1, d.acc.length() / 4))
      o.rotors.forEach((r, k) => (r.rotation.y += (k === 1 || k === 2 ? -1 : 1) * rate * dt))
      // Spinning props are a blur: the blades fade and a disc shows instead.
      o.blur.opacity = d.spin * 0.13
      o.prop.opacity = 0.9 - d.spin * 0.7
      const lit = d.cargo ?? d.beam ?? reactorState().color
      o.led.emissive.copy(lit)
      o.led.emissiveIntensity = d.spin > 0.1 ? 3.5 : 1.2
      const carrying = Boolean(d.cargo) && !d.legs.some((l) => l.kind === 'hold' && l.act === 'pick') && d.legs.some((l) => l.kind === 'hold' && l.act === 'drop')
      o.packet.visible = carrying
      if (carrying && d.cargo) {
        o.packetMat.color.copy(d.cargo).multiplyScalar(1.6)
        o.packet.rotation.y += dt * 2
      }
      o.beam.visible = Boolean(d.beam)
      if (d.beam) {
        o.beamMat.color.copy(d.beam)
        o.beamMat.opacity = 0.08 + 0.05 * Math.sin(t * 5)
        const h = Math.max(0.3, d.pos.y - 0.4)
        o.beam.scale.set(1, h / 2, 1)
        o.beam.position.y = -h / 2 - 0.05
      }
      // A light trail behind it while it carries something (data most of all).
      const last = o.hist.pop()!
      o.hist.unshift(last.copy(d.pos))
      const pos = o.trail.geometry.attributes.position as THREE.BufferAttribute
      const col = o.trail.geometry.attributes.color as THREE.BufferAttribute
      const c = tmp.c.copy(d.cargo ?? lit)
      const on = carrying && speed > 0.5 ? (d.kind === 'whoop' ? 1.6 : 0.9) : 0
      o.hist.forEach((p, k) => {
        pos.setXYZ(k, p.x, p.y, p.z)
        const f = on * (1 - k / TRAIL) ** 1.5
        col.setXYZ(k, c.r * f, c.g * f, c.b * f)
      })
      pos.needsUpdate = true
      col.needsUpdate = true
    })
  })

  return (
    <group>
      {DOCKS.map((_, i) => (
        <Dock key={i} i={i} parts={dockParts} state={drones} />
      ))}
      <Perches />
      {kit.map((o, i) => (
        <group key={i}>
          <primitive object={o.root} />
          <primitive object={o.trail} />
        </group>
      ))}
    </group>
  )
}

useGLTF.preload('/station/fpv.glb', false)
