import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { CHAIR, DECK_TOP, FOUNDRY, STATUS, ZONE, ZONES, type ZoneId } from './layout'
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
 * Each drone's FPV camera is on a gimbal and is never left staring at the
 * floor: it's on whoever's at the desk — while docked, perched, circling or
 * bringing data to the console — or on where it's working: the place it's
 * flying to, the spot it's picking up from or dropping at, the zone it's
 * scanning. Hovering, a drone turns to face what it's looking at; in flight
 * its body tilts no more than a real one would indoors.
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
/** Whoever's sat at the desk: where the cameras look when there's nothing else. */
const SUBJECT = V(CHAIR[0], 1.2, CHAIR[2])
const BAY_DROP = V(FOUNDRY[0], 3.0, FOUNDRY[2] + 1.0)
// High in the open bay: over the project build that stands in front of it (layout.ts PROJECT_PADS).
const DOOR_IN = V(0, 3.7, -12.5)
const DOOR_OUT = V(0, 3.7, -18.5)
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
  /** The camera gimbal: tilt (x) and pan (y), radians. */
  gimbal: THREE.Vector2
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

/**
 * What a drone's camera is on: whoever's at the desk, unless it's working —
 * then the spot below it (picking up, dropping off, scanning) or, in
 * flight, the next place it has work to do.
 */
function subjectOf(d: Drone, out: V3): V3 {
  const l = d.legs[0]
  if (!l || l.kind === 'home' || l.kind === 'orbit') return out.copy(SUBJECT)
  if (l.kind === 'hold') {
    if (l.act === 'launch' || l.act === 'land') return out.copy(SUBJECT)
    return out.set(l.at.x, Math.max(DECK_TOP + 0.6, l.at.y - 1.6), l.at.z)
  }
  const job = d.legs.find((x) => x.kind === 'hold' && x.act !== 'launch' && x.act !== 'land')
  if (job && job.kind === 'hold') return out.set(job.at.x, Math.max(DECK_TOP + 0.6, job.at.y - 1.6), job.at.z)
  return out.copy(SUBJECT)
}

// ---------------------------------------------------------------- the models

const TRAIL = 40
/**
 * Each drone's own livery, so no two look the same: its props' colour, and
 * a turn of the hue (radians) for its accents — on a quad the orange of its
 * battery's stripe and its TPU mounts (orange, green, magenta, blue, purple,
 * yellow); on a whoop its whole shell and its little pack (blue, mint, pink).
 */
const LIVERY: { prop: string; hue: number }[] = [
  { prop: '#2fb8d0', hue: 0 },
  { prop: '#2a2e35', hue: 1.75 },
  { prop: '#f4f6f8', hue: -0.45 },
  { prop: '#ff8a1e', hue: 3.5 },
  { prop: '#9be22d', hue: 4.6 },
  { prop: '#3a7bff', hue: 0.5 },
  { prop: '#e9eef2', hue: 0 },
  { prop: '#e8fff0', hue: -1.2 },
  { prop: '#ffe8f2', hue: 2.2 },
]
// The materials (fpv.py) whose orange takes a quad's accent hue, and the whoop's shell.
const ACCENTS = new Set(['pack', 'pack1s', 'tpu'])
const HUE_GLSL = /* glsl */ `
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}`

/**
 * One drone's scene objects: its own copy of the model's hierarchy (to fly,
 * spin and aim; drawn by its Fleet, below), where the blur disc over each
 * prop goes, the packet it carries, its scan beam, and its light trail (in
 * world space).
 */
function build(nodes: Record<string, THREE.Object3D>, kind: Kind) {
  const quad = kind === 'quad'
  const scale = quad ? 1.6 : 2.1
  const parts: THREE.Mesh[] = []
  const copy = (o: THREE.Object3D) => {
    const c = o.clone(true)
    c.traverse((m) => {
      const mesh = m as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.visible = false
      parts.push(mesh)
    })
    return c
  }
  const pre = quad ? 'quad' : 'whoop'
  const model = new THREE.Group()
  model.scale.setScalar(scale)
  model.add(copy(nodes[`${pre}_body`]), copy(nodes[`${pre}_led`]))
  // The FPV camera on its gimbal (fpv.py exports it level, at its pivot).
  const cam = copy(nodes[`${pre}_cam`])
  model.add(cam)
  // Prop discs at the props' height (fpv.py).
  const discs: THREE.Object3D[] = []
  const rotors = ['fl', 'fr', 'rl', 'rr'].map((k) => {
    const r = copy(nodes[`${pre}_rotor_${k}`])
    const d = new THREE.Object3D()
    d.position.set(r.position.x, quad ? 0.029 : 0.0098, r.position.z)
    model.add(r, d)
    discs.push(d)
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
  trail.visible = false
  const hist = Array.from({ length: TRAIL }, () => V(0, 0, 0))
  return { kind, root, tilt, model, cam, rotors, parts, discs, packet, packetMat, beam, beamMat, trail, hist }
}

type Kit = ReturnType<typeof build>

/**
 * A per-instance attribute read in the fragment shader (vertex → varying);
 * `key` names the shader variant, `fns` adds helpers it calls.
 */
function perInstance(m: THREE.Material, name: string, type: 'float' | 'vec3', apply: [string, string], key = name, fns = '') {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute ${type} a${name};\nvarying ${type} v${name};`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nv${name} = a${name};`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying ${type} v${name};${fns}`).replace(apply[0], `${apply[0]}\n${apply[1]}`)
  }
  m.customProgramCacheKey = () => `drone-${key}`
  return m
}

/**
 * Every drone of a kind drawn together: one instanced mesh per part of the
 * model, put each frame where that part of each drone is. Nine drones cost
 * the draw calls of one of each kind instead of some three hundred. Each
 * drone's props have their own colour and fade as they spin up (a blur
 * disc showing instead), and its LEDs glow in their own colour.
 */
class Fleet {
  group = new THREE.Group()
  private drawn: { mesh: THREE.InstancedMesh; of: THREE.Object3D[] }[] = []
  private disc: THREE.InstancedMesh
  private propFade: THREE.InstancedBufferAttribute
  private blurFade: THREE.InstancedBufferAttribute
  private ledGlow: THREE.InstancedBufferAttribute
  private kit: Kit[]
  constructor(kit: Kit[], livery: { prop: string; hue: number }[]) {
    this.kit = kit
    const n = kit.length
    const quad = kit[0].kind === 'quad'
    const hue = new THREE.InstancedBufferAttribute(new Float32Array(livery.map((l) => l.hue)), 1)
    // Accents: only the orange turns on a quad (its black, text and charge
    // lights stay); a whoop's shell turns whole.
    const accented = new Map<THREE.Material, THREE.Material>()
    const accent = (src: THREE.Material, shell: boolean) => {
      let m = accented.get(src)
      if (!m) {
        m = perInstance(
          src.clone(),
          'Hue',
          'float',
          ['#include <color_fragment>', shell ? 'diffuseColor.rgb = max(hueShift(diffuseColor.rgb, vHue), 0.0);' : 'diffuseColor.rgb = mix(diffuseColor.rgb, max(hueShift(diffuseColor.rgb, vHue), 0.0), clamp((diffuseColor.r - max(diffuseColor.g, diffuseColor.b)) * 4.0, 0.0, 1.0));'],
          shell ? 'shell' : 'accent',
          HUE_GLSL,
        )
        accented.set(src, m)
      }
      return m
    }
    this.propFade = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(0.9), 1)
    this.blurFade = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 1)
    this.ledGlow = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3)
    for (const a of [this.propFade, this.blurFade, this.ledGlow]) a.setUsage(THREE.DynamicDrawUsage)
    const prop = perInstance(new THREE.MeshStandardMaterial({ roughness: 0.25, transparent: true }), 'Fade', 'float', ['#include <color_fragment>', 'diffuseColor.a *= vFade;'])
    const led = perInstance(new THREE.MeshStandardMaterial({ color: '#05060a', emissive: '#ffffff', roughness: 0.4 }), 'Glow', 'vec3', ['#include <emissivemap_fragment>', 'totalEmissiveRadiance *= vGlow;'])
    const tint = new THREE.Color()
    kit[0].parts.forEach((template, j) => {
      const name = (template.material as THREE.Material).name
      const isProp = name === 'prop' || name === 'prop_clear'
      const isLed = name === 'led'
      const isAccent = ACCENTS.has(name) || name === 'whoop'
      const geometry = template.geometry
      if (isProp) geometry.setAttribute('aFade', this.propFade)
      if (isLed) geometry.setAttribute('aGlow', this.ledGlow)
      if (isAccent) geometry.setAttribute('aHue', hue)
      const material = isProp ? prop : isLed ? led : isAccent ? accent(template.material as THREE.Material, name === 'whoop') : template.material
      const mesh = new THREE.InstancedMesh(geometry, material, n)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      if (isProp) kit.forEach((_, k) => mesh.setColorAt(k, tint.set(livery[k].prop)))
      mesh.castShadow = true
      mesh.frustumCulled = false
      this.drawn.push({ mesh, of: kit.map((o) => o.parts[j]) })
      this.group.add(mesh)
    })
    const blur = perInstance(new THREE.MeshBasicMaterial({ color: '#d8deea', transparent: true, depthWrite: false, side: THREE.DoubleSide }), 'Fade', 'float', ['#include <color_fragment>', 'diffuseColor.a *= vFade;'])
    const disc = new THREE.CircleGeometry(quad ? 0.067 : 0.0162, 32).rotateX(-Math.PI / 2)
    disc.setAttribute('aFade', this.blurFade)
    this.disc = new THREE.InstancedMesh(disc, blur, n * 4)
    this.disc.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.disc.frustumCulled = false
    this.group.add(this.disc)
  }
  /** A drone's props (0..1 spun up) and LED colour. */
  set(k: number, spin: number, glow: THREE.Color) {
    this.propFade.setX(k, 0.9 - spin * 0.7)
    for (let j = 0; j < 4; j++) this.blurFade.setX(k * 4 + j, spin * 0.13)
    this.ledGlow.setXYZ(k, glow.r, glow.g, glow.b)
  }
  /** After the drones have moved: every part to where its drone has it. */
  sync() {
    for (const { mesh, of } of this.drawn) {
      of.forEach((o, k) => mesh.setMatrixAt(k, o.matrixWorld))
      mesh.instanceMatrix.needsUpdate = true
    }
    this.kit.forEach((o, k) => o.discs.forEach((d, j) => this.disc.setMatrixAt(k * 4 + j, d.matrixWorld)))
    this.disc.instanceMatrix.needsUpdate = true
    for (const a of [this.propFade, this.blurFade, this.ledGlow]) a.needsUpdate = true
  }
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
  const vents = useRef<THREE.InstancedMesh>(null)
  const mats = useMemo(
    () => ({
      status: new THREE.MeshBasicMaterial({ color: STATUS.ok, toneMapped: false }),
      shaft: new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false }),
      mark: new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false, transparent: true, opacity: 0.8 }),
    }),
    [],
  )
  const c = useMemo(() => new THREE.Color(), [])
  const vent = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0) }), [])
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
    // Vents slide out as the pedestal comes up (six in one draw).
    const v = vents.current
    if (v) {
      for (const k of p.vents) {
        const a = (k / 6) * Math.PI * 2
        const r = 0.42 + L * 0.06
        vent.p.set(Math.cos(a) * r, 0.006 + L * 0.004, Math.sin(a) * r)
        v.setMatrixAt(k, vent.m.compose(vent.p, vent.q.setFromAxisAngle(vent.up, -a), vent.s))
      }
      v.instanceMatrix.needsUpdate = true
    }
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
      <instancedMesh ref={vents} args={[p.ventGeo, p.pad, p.vents.length]} frustumCulled={false} />
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
  const kit = useMemo(() => Array.from({ length: 9 }, (_, i) => build(nodes, i < 6 ? 'quad' : 'whoop')), [nodes])
  const fleets = useMemo(
    () => ({ quad: new Fleet(kit.slice(0, 6), LIVERY.slice(0, 6)), whoop: new Fleet(kit.slice(6), LIVERY.slice(6)) }),
    [kit],
  )
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
        heading: 0,
        gimbal: new THREE.Vector2(0, 0),
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
  const tmp = useMemo(() => ({ v: V(0, 0, 0), a: V(0, 0, 0), up: V(0, 1, 0), x: V(1, 0, 0), z: V(0, 0, 1), t: V(0, 0, 0), m: new THREE.Matrix4(), q: new THREE.Quaternion(), roll: new THREE.Quaternion(), axis: V(0, 0, -1), c: new THREE.Color() }), [])

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
      // In flight it noses the way it's going; hovering, it turns to face
      // what its camera is on.
      const subject = subjectOf(d, tmp.t)
      const sx = subject.x - d.pos.x
      const sz = subject.z - d.pos.z
      const face = speed > 0.6 ? Math.atan2(-v.x, -v.z) : Math.hypot(sx, sz) > 0.8 ? Math.atan2(-sx, -sz) : d.heading
      let dh = face - d.heading
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      d.heading += reduced ? dh : dh * Math.min(1, dt * (speed > 0.6 ? 5 : 2.5))
      const next = d.legs[0]
      const onPad = !next || (next.kind === 'hold' && (next.act === 'launch' || next.act === 'land'))
      if (onPad || reduced) tmp.up.set(0, 1, 0)
      else {
        tmp.up.set(d.acc.x + v.x * 0.35, Math.max(2, d.acc.y + G), d.acc.z + v.z * 0.35).normalize()
        // No more tilt than a real one indoors (and so no staring at the floor).
        const max = d.kind === 'quad' ? 0.61 : 0.52
        if (tmp.up.y < Math.cos(max)) {
          const k = Math.sin(max) / Math.hypot(tmp.up.x, tmp.up.z)
          tmp.up.set(tmp.up.x * k, Math.cos(max), tmp.up.z * k)
        }
      }
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
      // The gimbal: pan and tilt the camera onto its subject, within its travel.
      o.root.updateMatrixWorld(true)
      const local = o.model.worldToLocal(tmp.t.copy(subject)).sub(o.cam.position)
      const pan = Math.max(-1.05, Math.min(1.05, Math.atan2(-local.x, -local.z)))
      const tiltTo = Math.max(-1.3, Math.min(0.7, Math.atan2(local.y, Math.hypot(local.x, local.z))))
      const gk = reduced ? 1 : Math.min(1, dt * 6)
      d.gimbal.x += (tiltTo - d.gimbal.x) * gk
      d.gimbal.y += (pan - d.gimbal.y) * gk
      o.cam.rotation.set(d.gimbal.x, d.gimbal.y, 0, 'YXZ')
      const rate = d.spin * (60 + 20 * Math.min(1, d.acc.length() / 4))
      o.rotors.forEach((r, k) => (r.rotation.y += (k === 1 || k === 2 ? -1 : 1) * rate * dt))
      // Spinning props are a blur: the blades fade and a disc shows instead.
      const lit = d.cargo ?? d.beam ?? reactorState().color
      fleets[d.kind].set(d.kind === 'quad' ? idx : idx - 6, d.spin, tmp.c.copy(lit).multiplyScalar(d.spin > 0.1 ? 3.5 : 1.2))
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
      o.trail.visible = on > 0
      o.hist.forEach((p, k) => {
        pos.setXYZ(k, p.x, p.y, p.z)
        const f = on * (1 - k / TRAIL) ** 1.5
        col.setXYZ(k, c.r * f, c.g * f, c.b * f)
      })
      pos.needsUpdate = true
      col.needsUpdate = true
      o.root.updateMatrixWorld(true)
    })
    fleets.quad.sync()
    fleets.whoop.sync()
  })

  return (
    <group>
      {DOCKS.map((_, i) => (
        <Dock key={i} i={i} parts={dockParts} state={drones} />
      ))}
      <Perches />
      <primitive object={fleets.quad.group} />
      <primitive object={fleets.whoop.group} />
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
