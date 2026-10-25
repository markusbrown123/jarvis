import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub, type Autopilot, type Stream } from '../hub/client'
import { useStreams } from '../hub/streams'
import { motion, useMaterials } from './shared'
import { PROJECT_PAD, PROJECT_PADS, PROJECT_RING, STAGE_R, STATUS, type ProjectPad, type ProjectPadId } from './layout'
import { Blob } from './floor'
import { flowMaterial } from './links'
import { useStation } from './stationStore'

/**
 * The projects JARVIS builds himself, a pad each in the wing to the right of
 * the stage (layout.ts PROJECT_PADS). On each stands its build: a level for
 * every milestone in its brief. The ones done are solid; the next is a
 * scaffold, lit and scanned while a run of his is on it; the rest are a faint
 * outline of what's still to come. So it rises a level at a time as he gets
 * through them. A pad's rim goes amber while it waits on Markus.
 *
 * They stand on a lit track behind the stage, each plugged into the stage's
 * edge by a pathway like the six on it have.
 *
 * Click a pad to go over to it; click again (or its label) for the
 * Projects page.
 */

/** Where a project stands, from its brief, its autopilot and the jobs. */
export function useProjectPad(id: ProjectPadId): { stream: Stream | null; ap: Autopilot | null; live: string | null; done: number; total: number } {
  const stream = useStreams((s) => s.data?.streams.find((x) => x.project === id) ?? null)
  const ap = useStreams((s) => s.data?.autopilot[id] ?? null)
  const live = useHub((s) => Object.values(s.state?.jobs ?? {}).find((j) => j.project === id && j.autopilot && (j.state === 'running' || j.state === 'cancel_requested'))?.title ?? null)
  const ms = stream?.milestones ?? []
  return { stream, ap, live, done: ms.filter((m) => m.done).length, total: ms.length }
}

/** Click: over to the pad, then to the Projects page. */
function openProject(id: ProjectPadId) {
  const st = useStation.getState()
  if (st.view !== id && st.mode !== 'walk') st.fly(id)
  else useHub.getState().setPrefs({ view: 'projects' })
}

const TOP = 0.18
const MAX_H = 1.7
const STEP = 0.22
const amber = new THREE.Color(STATUS.warn)

/** A line drawing for each project, for the emblem over its build. */
function emblem(id: ProjectPadId) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.strokeStyle = g.fillStyle = '#fff'
  g.lineWidth = 7
  g.lineJoin = g.lineCap = 'round'
  if (id === 'realestate') {
    g.beginPath()
    g.moveTo(20, 62)
    g.lineTo(64, 22)
    g.lineTo(108, 62)
    g.moveTo(32, 52)
    g.lineTo(32, 106)
    g.lineTo(96, 106)
    g.lineTo(96, 52)
    g.moveTo(56, 106)
    g.lineTo(56, 78)
    g.lineTo(72, 78)
    g.lineTo(72, 106)
    g.stroke()
  } else if (id === 'youtube') {
    g.beginPath()
    g.roundRect(14, 30, 100, 68, 18)
    g.stroke()
    g.beginPath()
    g.moveTo(54, 46)
    g.lineTo(82, 64)
    g.lineTo(54, 82)
    g.closePath()
    g.fill()
  } else {
    g.beginPath()
    g.arc(64, 46, 20, 0, Math.PI * 2)
    g.moveTo(26, 110)
    g.quadraticCurveTo(28, 74, 64, 74)
    g.quadraticCurveTo(100, 74, 102, 110)
    g.stroke()
    g.font = '700 26px "IBM Plex Mono", monospace'
    g.fillText('AI', 88, 30)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function Wing({ pad }: { pad: ProjectPad }) {
  const { done, total, live, ap } = useProjectPad(pad.id)
  const m = useMaterials()
  const n = Math.max(1, total)
  const step = Math.min(STEP, MAX_H / n)
  const h = step * 0.78
  // One level per milestone, narrowing as it rises: a hex prism and its outline.
  const levels = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const r = 0.6 - 0.26 * (i / Math.max(1, n - 1))
        const geo = new THREE.CylinderGeometry(r * 0.94, r, h, 6)
        return { y: TOP + 0.05 + i * step + h / 2, r, geo, edges: new THREE.EdgesGeometry(geo) }
      }),
    [n, h, step],
  )
  useEffect(() => () => levels.forEach((l) => (l.geo.dispose(), l.edges.dispose())), [levels])
  const base = useMemo(() => {
    const g = new THREE.LatheGeometry(
      [
        [0, 0],
        [PROJECT_PAD, 0],
        [PROJECT_PAD, TOP * 0.55],
        [PROJECT_PAD - 0.08, TOP],
        [0, TOP],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      96,
    )
    return g
  }, [])
  const color = useMemo(() => new THREE.Color(pad.color), [pad.color])
  const mats = useMemo(
    () => ({
      rim: new THREE.MeshBasicMaterial({ color: pad.color, toneMapped: false }),
      solid: new THREE.MeshStandardMaterial({ color: '#191c24', emissive: pad.color, emissiveIntensity: 0.32, metalness: 0.7, roughness: 0.32 }),
      solidLine: new THREE.LineBasicMaterial({ color: pad.color, toneMapped: false }),
      next: new THREE.MeshBasicMaterial({ color: pad.color, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      nextLine: new THREE.LineBasicMaterial({ color: pad.color, transparent: true, toneMapped: false }),
      ghost: new THREE.LineBasicMaterial({ color: pad.color, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }),
      scan: new THREE.MeshBasicMaterial({ color: pad.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      icon: new THREE.SpriteMaterial({ map: emblem(pad.id), color: pad.color, transparent: true, depthWrite: false, toneMapped: false }),
    }),
    [pad.color, pad.id],
  )
  useEffect(() => () => (mats.icon.map?.dispose(), Object.values(mats).forEach((x) => x.dispose())), [mats])
  const scanRef = useRef<THREE.Mesh>(null)
  const beamRef = useRef<THREE.Mesh>(null)
  const iconRef = useRef<THREE.Sprite>(null)
  const next = Math.min(done, n - 1)
  const finished = total > 0 && done >= total
  const waiting = Boolean(ap && (ap.blocked || ap.waiting > 0))
  useFrame((st) => {
    const t = st.clock.elapsedTime * motion()
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2)
    // The rim: lit and breathing while he works, amber while it waits on Markus, dim when paused.
    if (live) mats.rim.color.copy(color).multiplyScalar(1.6 + pulse * 0.8)
    else if (waiting) mats.rim.color.copy(amber).multiplyScalar(1.1 + 0.4 * Math.sin(t * 1.6))
    else mats.rim.color.copy(color).multiplyScalar(ap?.paused ? 0.35 : 0.95)
    mats.nextLine.opacity = live ? 0.55 + 0.45 * pulse : 0.38
    mats.nextLine.color.copy(color).multiplyScalar(live ? 1.8 : 1)
    mats.next.opacity = live ? 0.1 + 0.12 * pulse : 0.05
    // The scanner runs up and down the level being built.
    const lv = levels[next]
    if (scanRef.current && lv) {
      scanRef.current.visible = Boolean(live) && !finished
      scanRef.current.position.y = lv.y + Math.sin(t * 2.4) * h * 0.5
      scanRef.current.scale.setScalar(lv.r * 1.08)
      mats.scan.opacity = 0.75
    }
    if (beamRef.current) beamRef.current.visible = Boolean(live) && !finished
    if (iconRef.current) {
      iconRef.current.position.y = TOP + 0.05 + n * step + 0.38 + Math.sin(t * 1.3) * 0.04
      mats.icon.opacity = finished ? 1 : done > 0 ? 0.85 : 0.4
    }
  })
  const top = TOP + 0.05 + n * step
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    openProject(pad.id)
  }
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
  }
  const out = () => (document.body.style.cursor = '')
  return (
    <group position={pad.pos} onClick={click} onPointerOver={over} onPointerOut={out}>
      <Blob radius={PROJECT_PAD * 1.45} position={[0, 0, 0]} opacity={0.6} />
      <mesh geometry={base} material={m.gunmetal} castShadow receiveShadow />
      <mesh rotation-x={Math.PI / 2} position-y={TOP + 0.002} material={mats.rim}>
        <torusGeometry args={[PROJECT_PAD - 0.09, 0.013, 6, 128]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position-y={TOP + 0.002} material={mats.rim}>
        <torusGeometry args={[0.72, 0.007, 6, 96]} />
      </mesh>
      {levels.map((l, i) =>
        i < done ? (
          <group key={i} position-y={l.y}>
            <mesh geometry={l.geo} material={mats.solid} castShadow />
            <lineSegments geometry={l.edges} material={mats.solidLine} />
          </group>
        ) : i === next && !finished ? (
          <group key={i} position-y={l.y}>
            <mesh geometry={l.geo} material={mats.next} />
            <lineSegments geometry={l.edges} material={mats.nextLine} />
          </group>
        ) : (
          <lineSegments key={i} geometry={l.edges} material={mats.ghost} position-y={l.y} />
        ),
      )}
      <mesh ref={scanRef} rotation-x={Math.PI / 2} material={mats.scan} visible={false}>
        <torusGeometry args={[1, 0.012, 6, 48]} />
      </mesh>
      {/* While he's on it, a beam comes down from the ceiling onto the level being built. */}
      <mesh ref={beamRef} position-y={(top + 4.4) / 2} material={mats.scan} visible={false}>
        <cylinderGeometry args={[0.018, 0.018, 4.4 - top, 6, 1, true]} />
      </mesh>
      <sprite ref={iconRef} material={mats.icon} scale={[0.42, 0.42, 1]} />
    </group>
  )
}

/** The pathway from the stage's edge out to a pad: flowing out while he builds it, amber and back while it waits on Markus. */
function Feed({ pad }: { pad: ProjectPad }) {
  const { live, ap } = useProjectPad(pad.id)
  const mat = useMemo(() => flowMaterial(1), [])
  useEffect(() => () => mat.dispose(), [mat])
  const [x, , z] = pad.pos
  const from = STAGE_R + 0.06
  const to = PROJECT_RING - PROJECT_PAD + 0.04
  const mid = (from + to) / 2 / Math.hypot(x, z)
  const waiting = Boolean(ap && (ap.blocked || ap.waiting > 0))
  useFrame((st) => {
    const u = mat.uniforms
    const still = useHub.getState().prefs.reducedMotion
    ;(u.uColor.value as THREE.Color).set(waiting && !live ? STATUS.warn : pad.color).multiplyScalar(1.5)
    u.uTime.value = st.clock.elapsedTime
    u.uSpeed.value = still ? 0 : live ? 0.9 : waiting ? -0.4 : 0.05
    u.uDash.value = live ? 5 : 3
    u.uBase.value = live ? 0.25 : 0.18
    u.uOpacity.value = live ? 1 : waiting ? 0.85 : ap?.paused ? 0.2 : 0.4
  })
  return (
    <group position={[x * mid, 0.006, z * mid]} rotation-y={-Math.atan2(z, x)}>
      <mesh rotation-x={-Math.PI / 2} material={mat} renderOrder={2}>
        <planeGeometry args={[to - from, 0.2]} />
      </mesh>
    </group>
  )
}

/** The lit track on the floor the three stand on: an arc behind the stage, fading out past the outer two. */
const arcFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uHalf;
varying vec3 vP;
void main() {
  float off = abs(atan(vP.x, vP.y));
  float fade = 1.0 - smoothstep(uHalf - 0.3, uHalf, off);
  gl_FragColor = vec4(uColor, 0.7 * fade);
}`

function Track() {
  const span = Math.max(...PROJECT_PADS.map((p) => Math.abs(Math.atan2(p.pos[0], -p.pos[2])))) + 0.3
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: arcFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: { uColor: { value: new THREE.Color('#9fb4ff').multiplyScalar(1.3) }, uHalf: { value: span } },
      }),
    [span],
  )
  useEffect(() => () => mat.dispose(), [mat])
  // Laid flat, the ring's +y points to −z (the back): theta runs round from there either way.
  return (
    <group position-y={0.005} rotation-x={-Math.PI / 2}>
      {[-0.05, 0.05].map((d) => (
        <mesh key={d} material={mat} renderOrder={2}>
          <ringGeometry args={[PROJECT_RING + d - 0.012, PROJECT_RING + d + 0.012, 160, 1, Math.PI / 2 - span, span * 2]} />
        </mesh>
      ))}
    </group>
  )
}

export function ProjectPads() {
  return (
    <>
      <Track />
      {PROJECT_PADS.map((p) => (
        <Feed key={`feed-${p.id}`} pad={p} />
      ))}
      {PROJECT_PADS.map((p) => (
        <Wing key={p.id} pad={p} />
      ))}
    </>
  )
}
