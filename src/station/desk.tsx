import { useMemo, useRef } from 'react'
import { useStore } from '../store'
import { useHub } from '../hub/client'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { CHAIR } from './layout'
import { motion, reactorState, typing, useCanvasTex, useMaterials } from './shared'
import { useStation } from './stationStore'
import { Blob } from './floor'

/**
 * The talk station: a curved command desk and a chair in front of the
 * reactor, where Markus sits to talk to JARVIS — Tony's workshop desk. Its
 * light is JARVIS's own: the desk edges and the chair's back strips take
 * the reactor's colour and brighten with his voice, and the holo keyboard
 * lights up while Markus is typing to him. Three holo monitors stand on it,
 * each drawn from live state: Systems, Work, Business.
 */

const TOP = 0.74 // desk top above the deck
const IN = 0.7 // inner radius (towards the chair)
const OUT = 1.24 // outer radius (towards the reactor)
const SPAN = 2.62 // radians of arc, centred straight ahead

function keyboardTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const g = c.getContext('2d')!
  g.strokeStyle = '#ffffff'
  g.lineWidth = 2
  g.globalAlpha = 0.9
  g.strokeRect(4, 4, 504, 152)
  g.globalAlpha = 0.55
  const rows = [12, 12, 11, 10]
  rows.forEach((n, r) => {
    const w = 480 / 12.5
    const x0 = 16 + (12 - n) * (w / 2)
    for (let i = 0; i < n; i++) g.strokeRect(x0 + i * w, 14 + r * 30, w - 6, 24)
  })
  g.strokeRect(16 + 2.5 * 38.4, 14 + 4 * 30, 7 * 38.4 - 6, 20)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function Desk() {
  const m = useMaterials()
  const top = useMemo(() => {
    // An annulus sector round the chair, opening towards the reactor.
    const a0 = Math.PI / 2 - SPAN / 2
    const a1 = Math.PI / 2 + SPAN / 2
    const shape = new THREE.Shape()
    shape.absarc(0, 0, OUT, a0, a1, false)
    shape.absarc(0, 0, IN, a1, a0, true)
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 48 })
    // Shape y → world −z (away from the chair), extrusion → up.
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  // A lighter brushed top that picks up a little of JARVIS's colour, so the
  // desk reads from behind the chair.
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a5266', metalness: 0.55, roughness: 0.3, emissive: '#7c8bff', emissiveIntensity: 0.1 }), [])
  const edge = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false, side: THREE.DoubleSide }), [])
  const strip = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }), [])
  const keys = useMemo(() => new THREE.MeshBasicMaterial({ map: keyboardTexture(), color: '#7cc8ff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const glow = useRef(0)

  useFrame((_, dt) => {
    const r = reactorState()
    const lift = r.level * 1.6 * motion()
    edge.color.copy(r.color).multiplyScalar(1.6 + lift)
    topMat.emissive.copy(r.color)
    topMat.emissiveIntensity = 0.08 + r.level * 0.12
    strip.color.copy(r.color).multiplyScalar(0.9 + lift * 0.7)
    // Typing lights the keys; they fade back over a second.
    const want = performance.now() - typing.at < 900 ? 1 : 0
    glow.current += (want - glow.current) * Math.min(1, dt * (want ? 12 : 2))
    keys.opacity = 0.22 + glow.current * 0.7
  })

  // The arc's own angles in world terms: centred on −z.
  const arcStart = -Math.PI / 2 - SPAN / 2
  const legs = [-0.86, 0, 0.86].map((f) => -Math.PI / 2 + (f * SPAN) / 2)
  return (
    <group position={CHAIR}>
      <Blob radius={1.6} position={[0, 0, 0]} opacity={0.75} />
      {/* Desk: top, front skirt down to the deck, three pedestal legs. */}
      <mesh geometry={top} position-y={TOP - 0.05} material={topMat} castShadow receiveShadow />
      <mesh position-y={TOP / 2} material={m.graphite} castShadow>
        <cylinderGeometry args={[OUT - 0.04, OUT - 0.04, TOP - 0.06, 48, 1, true, Math.PI - SPAN / 2, SPAN]} />
      </mesh>
      {legs.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * (IN + OUT) * 0.5, TOP / 2, Math.sin(a) * (IN + OUT) * 0.5]} rotation-y={-a} material={m.graphite}>
          <boxGeometry args={[0.32, TOP - 0.06, 0.05]} />
        </mesh>
      ))}
      {/* Light: a band under the lip facing the chair, and along the far edge. */}
      <mesh position-y={TOP - 0.02} material={edge}>
        <cylinderGeometry args={[IN - 0.014, IN - 0.014, 0.03, 48, 1, true, Math.PI - SPAN / 2, SPAN]} />
      </mesh>
      <mesh position-y={TOP + 0.012} rotation={[Math.PI / 2, 0, arcStart]} material={edge}>
        <torusGeometry args={[OUT + 0.004, 0.014, 8, 64, SPAN]} />
      </mesh>
      {/* The holo keyboard, straight ahead on the desk. */}
      <mesh position={[0, TOP + 0.012, -(IN + 0.16)]} rotation-x={-Math.PI / 2} material={keys}>
        <planeGeometry args={[0.5, 0.16]} />
      </mesh>
      <Chair strip={strip} />
      <SystemsMonitor angle={-0.6} />
      <WorkMonitor angle={0.5} />
      <BusinessMonitor angle={1.02} />
    </group>
  )
}

// ---------------------------------------------------------------- monitors

const W = 640
const H = 400
const MON_R = 1.02 // from the chair's centre
const MON_Y = TOP + 0.46 // screen centre above the deck

type Draw = (g: CanvasRenderingContext2D) => void

/** Frame, header and the right colours; the body is the monitor's own. */
function screen(title: string, accent: string, body: Draw): Draw {
  return (g) => {
    g.fillStyle = 'rgba(4, 18, 30, 0.7)'
    g.fillRect(0, 0, W, H)
    g.strokeStyle = accent
    g.globalAlpha = 0.8
    g.lineWidth = 3
    g.strokeRect(3, 3, W - 6, H - 6)
    g.globalAlpha = 1
    g.fillStyle = accent
    g.font = '600 34px "Barlow Condensed", sans-serif'
    g.textBaseline = 'alphabetic'
    g.fillText(title.toUpperCase().split('').join(String.fromCharCode(8202)), 24, 50)
    g.fillRect(24, 64, W - 48, 2)
    body(g)
  }
}

const DOT: Record<string, string> = { ok: '#4ade80', live: '#a9d8ff', warn: '#f5a524', error: '#ef4444', bad: '#ef4444', off: '#5b5874' }

/** One status row: dot, label, value — clipped to the width. */
function row(g: CanvasRenderingContext2D, y: number, state: string, label: string, value: string) {
  g.fillStyle = DOT[state] ?? DOT.off
  g.beginPath()
  g.arc(36, y - 9, 8, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#c9d6e8'
  g.font = '500 26px "Barlow", sans-serif'
  g.fillText(label, 56, y)
  g.fillStyle = state === 'off' ? '#7d86a0' : '#eef4ff'
  g.font = '500 24px "IBM Plex Mono", monospace'
  const x = 250
  let v = value
  while (v.length > 3 && g.measureText(v).width > W - x - 24) v = v.slice(0, -2)
  g.fillText(v === value ? v : `${v}…`, x, y)
}

/** A screen on a slim stand, turned to face the chair. */
function Monitor({ angle, tex }: { angle: number; tex: THREE.Texture }) {
  const m = useMaterials()
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }), [tex])
  const w = 0.72
  const h = (w * H) / W
  return (
    <group position={[Math.sin(angle) * MON_R, 0, -Math.cos(angle) * MON_R]} rotation-y={-angle}>
      <mesh position-y={TOP + 0.12} material={m.chrome}>
        <cylinderGeometry args={[0.012, 0.018, 0.24, 10]} />
      </mesh>
      <group position-y={MON_Y} rotation-x={-0.08}>
        <mesh material={mat} renderOrder={3}>
          <planeGeometry args={[w, h]} />
        </mesh>
      </group>
    </group>
  )
}

const PHASE_WORD: Record<string, string> = { offline: 'offline', boot: 'starting', dormant: 'standing by', waking: 'listening', listening: 'listening', thinking: 'thinking', tooling: 'working', speaking: 'speaking' }

/** What JARVIS is doing, and each of his own systems. */
function SystemsMonitor({ angle }: { angle: number }) {
  const phase = useStore((s) => s.phase)
  const caps = useStation((s) => s.model?.caps)
  const key = `${phase}|${caps?.map((c) => `${c.state}:${c.detail}`).join('|')}`
  const tex = useCanvasTex(
    W,
    H,
    screen('Jarvis · systems', '#7cc8ff', (g) => {
      g.fillStyle = reactorState().color.getStyle()
      g.font = '600 46px "Barlow Condensed", sans-serif'
      g.fillText((PHASE_WORD[phase] ?? phase).toUpperCase(), 24, 118)
      ;(caps ?? []).slice(0, 6).forEach((c, i) => row(g, 168 + i * 38, c.state, c.label, c.detail))
      if (!caps) row(g, 168, 'off', 'Status', 'reading…')
    }),
    [key],
  )
  return <Monitor angle={angle} tex={tex} />
}

/** What's running and what's waiting on Markus. */
function WorkMonitor({ angle }: { angle: number }) {
  const jobs = useStation((s) => s.model?.jobs)
  const items = useStation((s) => s.model?.items)
  const live = jobs ? [...jobs.waiting, ...jobs.running, ...jobs.queued] : []
  const key = `${live.map((j) => `${j.id}:${j.state}:${j.stale}`).join('|')}|${items?.map((i) => i.id).join('|')}`
  const tex = useCanvasTex(
    W,
    H,
    screen('Work', '#a5b4fc', (g) => {
      g.fillStyle = '#eef4ff'
      g.font = '600 40px "Barlow Condensed", sans-serif'
      g.fillText(jobs ? `${jobs.running.length} RUNNING · ${jobs.queued.length} QUEUED` : 'CONNECTING…', 24, 112)
      live.slice(0, 4).forEach((j, i) => row(g, 160 + i * 36, j.stale ? 'warn' : j.state === 'needs_markus' ? 'warn' : j.state === 'queued' ? 'off' : 'live', j.stale ? 'no heartbeat' : j.state.replace('_', ' '), j.title))
      g.fillStyle = items?.length ? '#f5a524' : '#7d86a0'
      g.font = '600 32px "Barlow Condensed", sans-serif'
      g.fillText(items?.length ? `${items.length} WAITING ON YOU` : 'NOTHING WAITING ON YOU', 24, 330)
      if (items?.length) {
        g.fillStyle = '#f3e3c8'
        g.font = '500 24px "Barlow", sans-serif'
        let t = items[0].title
        while (t.length > 3 && g.measureText(t).width > W - 48) t = t.slice(0, -2)
        g.fillText(t === items[0].title ? t : `${t}…`, 24, 368)
      }
    }),
    [key],
  )
  return <Monitor angle={angle} tex={tex} />
}

/** The businesses, each figure only when it's really known. */
function BusinessMonitor({ angle }: { angle: number }) {
  const model = useStation((s) => s.model)
  const spent = useHub((s) => s.state?.expenses?.month.total)
  const allowance = model?.caps.find((c) => c.id === 'allowance')
  const up = model?.services.filter((x) => x.up).length ?? 0
  const lines: [string, string, string][] = model
    ? [
        [model.site.ok === null ? 'off' : model.site.ok ? 'ok' : 'error', 'automaton.llc', model.site.detail],
        [model.stagesReason ? 'off' : 'ok', 'Site pipeline', model.stagesReason ? `unavailable — ${model.stagesReason}` : `${model.stages.reduce((n, s) => n + (s.count ?? 0), 0)} sites`],
        [model.leads.total === null ? 'off' : 'ok', 'Leads', model.leads.total === null ? `unavailable — ${model.leads.reason ?? 'no access'}` : `${model.leads.total}`],
        [up ? 'ok' : 'off', 'Finance', `${up}/${model.services.length} services · monitoring only`],
        [spent === undefined ? 'off' : 'ok', 'Spent this month', spent === undefined ? 'ledger not loaded' : `$${spent.toFixed(2)}`],
        [allowance?.state ?? 'off', 'Claude 5h', allowance?.detail ?? 'unavailable'],
      ]
    : []
  const key = lines.map((l) => l.join(':')).join('|')
  const tex = useCanvasTex(
    W,
    H,
    screen('Business', '#5eead4', (g) => {
      lines.forEach((l, i) => row(g, 112 + i * 44, l[0], l[1], l[2]))
      if (!lines.length) row(g, 112, 'off', 'Status', 'reading…')
      g.fillStyle = '#7d86a0'
      g.font = '400 20px "IBM Plex Mono", monospace'
      g.fillText('No broker connected — no positions or P&L', 24, 382)
    }),
    [key],
  )
  return <Monitor angle={angle} tex={tex} />
}

/** A command chair facing the reactor (−z), seen from behind in Talk mode. */
function Chair({ strip }: { strip: THREE.Material }) {
  const m = useMaterials()
  const seat = 0.48
  return (
    <group position-z={0.12}>
      {/* Five-star base on castors. */}
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 2
        return (
          <group key={i} rotation-y={a}>
            <mesh position={[0.15, 0.06, 0]} material={m.graphite} castShadow>
              <boxGeometry args={[0.3, 0.035, 0.05]} />
            </mesh>
            <mesh position={[0.29, 0.03, 0]} material={m.rubber}>
              <sphereGeometry args={[0.03, 12, 8]} />
            </mesh>
          </group>
        )
      })}
      <mesh position-y={0.27} material={m.chrome} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.4, 16]} />
      </mesh>
      {/* Seat and arms. */}
      <RoundedBox args={[0.56, 0.1, 0.52]} radius={0.04} smoothness={3} position-y={seat} material={m.gunmetal} castShadow receiveShadow />
      {[-1, 1].map((s) => (
        <group key={s} position-x={s * 0.31}>
          <mesh position={[0, seat + 0.12, 0.08]} material={m.graphite}>
            <boxGeometry args={[0.035, 0.22, 0.04]} />
          </mesh>
          <RoundedBox args={[0.07, 0.04, 0.38]} radius={0.015} smoothness={2} position={[0, seat + 0.24, 0]} material={m.gunmetal} castShadow />
        </group>
      ))}
      {/* Back, leaning a little, with JARVIS's light down it. */}
      <group position={[0, seat + 0.06, 0.25]} rotation-x={0.16}>
        <RoundedBox args={[0.52, 0.76, 0.09]} radius={0.04} smoothness={3} position-y={0.4} material={m.gunmetal} castShadow />
        <RoundedBox args={[0.3, 0.16, 0.08]} radius={0.03} smoothness={3} position={[0, 0.9, 0.01]} material={m.gunmetal} castShadow />
        {[-0.17, 0.17].map((x) => (
          <mesh key={x} position={[x, 0.4, 0.047]} material={strip}>
            <boxGeometry args={[0.012, 0.6, 0.004]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
