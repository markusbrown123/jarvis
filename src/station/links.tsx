import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { along, DECK_TOP, PATH_FROM, PATH_TO, STATUS, ZONE, type ZoneId } from './layout'
import { useStation, type StationEvent } from './stationStore'
import type { LinkModel, LinkStyle } from './model'

/**
 * Connections. A pathway runs across the deck from the reactor to each pad,
 * and its look is the link's real state (model.links): flowing outward when
 * work is going that way, slow pulses when only queued, amber when waiting
 * on Markus, red when failing, broken and grey when the source can't be
 * reached, a faint line when idle. Jobs and open items also arc over to the
 * project they belong to. Live events send a packet along the right path.
 *
 * Connections View (L) brightens every link and labels it; otherwise arcs
 * stay faint unless they're active or one of their ends is selected.
 */


const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uSpeed;
uniform float uDash;
uniform float uOpacity;
uniform float uGap;
uniform float uRail;
uniform float uBase;
varying vec2 vUv;
void main() {
  float x = vUv.x;
  float d = fract(x * uDash - uTime * uSpeed);
  float dash = smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(0.3, 0.46, d));
  float across = abs(vUv.y - 0.5) * 2.0;
  float rail = uRail * smoothstep(0.72, 0.9, across) * (1.0 - smoothstep(0.96, 1.0, across));
  float core = 1.0 - smoothstep(0.0, 0.45, across);
  float a = max(rail * 0.75, dash * core) + uBase * core;
  if (uGap > 0.0) a *= smoothstep(uGap, uGap + 0.03, abs(x - 0.5));
  float ends = smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.95, 1.0, x));
  gl_FragColor = vec4(uColor * (0.7 + dash * 0.9), clamp(a, 0.0, 1.0) * uOpacity * ends);
}`

type Look = { color: string; speed: number; dash: number; opacity: number; gap: number; base: number; flicker: boolean }

/** How each link state looks. Speed is signed: + is reactor → zone. */
const LOOK: Record<LinkStyle, Omit<Look, 'color'> & { color?: string }> = {
  active: { speed: 0.9, dash: 5, opacity: 1, gap: 0, base: 0.25, flicker: false },
  queued: { speed: 0.25, dash: 3, opacity: 0.6, gap: 0, base: 0.15, flicker: false },
  idle: { speed: 0.05, dash: 2, opacity: 0.32, gap: 0, base: 0.2, flicker: false },
  attention: { color: STATUS.warn, speed: -0.4, dash: 3, opacity: 0.9, gap: 0, base: 0.25, flicker: false },
  disconnected: { color: STATUS.off, speed: 0, dash: 7, opacity: 0.55, gap: 0.12, base: 0.1, flicker: false },
  failed: { color: STATUS.error, speed: 0, dash: 6, opacity: 0.95, gap: 0.08, base: 0.35, flicker: true },
}

export function flowMaterial(rail: number) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color() },
      uTime: { value: 0 },
      uSpeed: { value: 0 },
      uDash: { value: 4 },
      uOpacity: { value: 1 },
      uGap: { value: 0 },
      uRail: { value: rail },
      uBase: { value: 0.2 },
    },
  })
}

const reduced = () => useHub.getState().prefs.reducedMotion

/** Feed a link's state into its material, every frame. */
function drive(mat: THREE.ShaderMaterial, link: LinkModel | undefined, zoneColor: string, t: number, emphasis: number, events: StationEvent[], zone: ZoneId) {
  const style = link?.style ?? 'disconnected'
  const look = LOOK[style]
  const u = mat.uniforms
  const now = performance.now()
  // A job that just finished turns its path green for a moment.
  const done = events.find((e) => e.kind === 'complete' && e.zone === zone && now - e.at < 2500)
  ;(u.uColor.value as THREE.Color).set(done ? STATUS.ok : (look.color ?? zoneColor)).multiplyScalar(1.4 + emphasis * 0.8)
  u.uTime.value = t
  u.uSpeed.value = reduced() ? 0 : look.speed
  u.uDash.value = look.dash
  u.uGap.value = look.gap
  u.uBase.value = look.base
  const flick = look.flicker && !reduced() ? 0.65 + 0.35 * Math.sin(t * 13) * Math.sin(t * 7.3) : 1
  u.uOpacity.value = Math.min(1, look.opacity * flick * (0.85 + emphasis * 0.6))
}

function Pathway({ zone }: { zone: ZoneId }) {
  const mat = useMemo(() => flowMaterial(1), [])
  const [x, , z] = ZONE[zone].pos
  const len = PATH_TO - PATH_FROM
  const mid = (PATH_FROM + PATH_TO) / 2 / Math.hypot(x, z)
  useFrame((st) => {
    const s = useStation.getState()
    const link = s.model?.links.find((l) => l.id === `reactor-${zone}`)
    const on = s.connections || s.selected?.zone === zone || s.hovered?.zone === zone ? 1 : 0
    drive(mat, link, ZONE[zone].color, st.clock.elapsedTime, on, s.events, zone)
  })
  return (
    <group position={[x * mid, DECK_TOP + 0.006, z * mid]} rotation-y={-Math.atan2(z, x)}>
      <mesh rotation-x={-Math.PI / 2} material={mat} renderOrder={2}>
        <planeGeometry args={[len, 0.2]} />
      </mesh>
    </group>
  )
}

/** An arc from one pad over to another: jobs → their project, needs → theirs. */
function Arc({ link }: { link: LinkModel }) {
  const from = link.from as ZoneId
  const geo = useMemo(() => {
    const a = new THREE.Vector3(...ZONE[from].pos).setY(0.55)
    const b = new THREE.Vector3(...ZONE[link.to].pos).setY(0.55)
    const peak = 1.0 + a.distanceTo(b) * 0.32
    const c = a.clone().add(b).multiplyScalar(0.5).setY(2 * peak - 0.55)
    return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, c, b), 64, 0.018, 6, false)
  }, [from, link.to])
  const mat = useMemo(() => flowMaterial(0), [])
  useFrame((st) => {
    const s = useStation.getState()
    const ends = (z?: ZoneId) => z === from || z === link.to
    const on = s.connections || ends(s.selected?.zone) || ends(s.hovered?.zone) ? 1 : 0
    const live = s.model?.links.find((l) => l.id === link.id) ?? link
    drive(mat, live, ZONE[link.to].color, st.clock.elapsedTime, on, s.events, link.to)
    // Arcs are context: quiet unless asked for.
    mat.uniforms.uOpacity.value *= on ? 1 : 0.45
  })
  return <mesh geometry={geo} material={mat} renderOrder={2} />
}

const PACKET_MS = 1600
const MAX_PACKETS = 16

/** Live events as packets along the pathways. */
function Packets() {
  const im = useRef<THREE.InstancedMesh>(null)
  const o = useMemo(() => new THREE.Object3D(), [])
  const c = useMemo(() => new THREE.Color(), [])
  const p = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const mesh = im.current
    if (!mesh) return
    const now = performance.now()
    const list = useStation.getState().events.filter((e) => e.kind !== 'fail' && now - e.at < PACKET_MS)
    let n = 0
    for (const e of list.slice(-MAX_PACKETS)) {
      const k = (now - e.at) / PACKET_MS
      // assign goes out to the zone; results, leads, studio moves and voice
      // come in to the reactor; something new for Markus comes in from its
      // project and goes back out to the Needs pad.
      if (e.kind === 'assign') along(e.zone, k, p)
      else if (e.kind === 'need' && k < 0.5) along(e.zone, 1 - k * 2, p)
      else if (e.kind === 'need') along('needs', (k - 0.5) * 2, p)
      else along(e.zone, 1 - k, p)
      p.y += Math.sin(k * Math.PI) * 0.12
      o.position.copy(p)
      o.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.6)
      o.updateMatrix()
      mesh.setMatrixAt(n, o.matrix)
      c.set(e.kind === 'complete' ? STATUS.ok : e.kind === 'need' ? STATUS.warn : ZONE[e.zone].color).multiplyScalar(3)
      mesh.setColorAt(n, c)
      n++
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })
  return (
    <instancedMesh ref={im} args={[undefined, undefined, MAX_PACKETS]} frustumCulled={false}>
      <sphereGeometry args={[0.09, 12, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

export function Links() {
  const links = useStation((s) => s.model?.links)
  const arcs = useMemo(() => (links ?? []).filter((l) => l.from !== 'reactor'), [links])
  return (
    <>
      {(['roblox', 'automaton', 'finance', 'jobs', 'needs', 'core'] as ZoneId[]).map((z) => (
        <Pathway key={z} zone={z} />
      ))}
      {arcs.map((l) => (
        <Arc key={l.id} link={l} />
      ))}
      <Packets />
    </>
  )
}
