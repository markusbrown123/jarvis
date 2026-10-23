import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { motion, reactorState, useMaterials } from './shared'
import { useStation, type Sel } from './stationStore'
import { hexPoints, PAD, STATUS, ZONE, type ZoneId } from './layout'
import { Blob } from './floor'
import type { StationModel, ZoneModel } from './model'

/**
 * The six systems, each on its own pad with its own structure, built only
 * from real objects in the model: games, pipeline stages and leads, finance
 * services, jobs, items needing Markus, JARVIS's own capabilities. Hover for
 * a tooltip, click to focus the camera and open the detail panel.
 */

const DECK = 0.16
const PAD_H = 0.2
export const PAD_TOP = DECK + PAD_H


/** Brushed steel for the structures on the pads: light enough to read against the deck. */
const steel = new THREE.MeshStandardMaterial({ color: '#6b7386', metalness: 0.55, roughness: 0.32, envMapIntensity: 1.2 })

/** Pointer handlers that hover and select a thing. */
function useHit(sel: Sel) {
  const hover = useStation((s) => s.hover)
  const select = useStation((s) => s.select)
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      hover(sel)
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      hover(null)
      document.body.style.cursor = ''
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      select(sel)
    },
  }
}

/** Is this thing (or its zone) the selected or hovered one? */
function useEmphasis(kind: Sel['kind'], id: string) {
  return useStation((s) => (s.selected?.kind === kind && s.selected.id === id) || (s.hovered?.kind === kind && s.hovered.id === id))
}

/** A texture drawn with the 2D canvas, redrawn when deps change or fonts arrive. */
function useCanvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const cv = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }, [w, h])
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [cv])
  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    void Promise.all([document.fonts.load('600 40px "Barlow Condensed"'), document.fonts.load('500 30px "IBM Plex Mono"'), document.fonts.load('500 30px "Barlow"')]).then(() => setFontsReady(true))
  }, [])
  useEffect(() => {
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, w, h)
    draw(g)
    tex.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, fontsReady])
  return tex
}

const STATE_RIM: Record<ZoneModel['state'], number> = { loading: 0.5, idle: 0.9, active: 1.8, attention: 1.6, error: 1.4, unavailable: 0.35 }

/** The pad every system stands on: hex plinth, lit rim, painted name. */
function Pad({ zone, model, children }: { zone: ZoneId; model: ZoneModel | undefined; children: ReactNode }) {
  const z = ZONE[zone]
  const m = useMaterials()
  const hit = useHit({ kind: 'zone', id: zone, zone })
  const on = useEmphasis('zone', zone)
  const geo = useMemo(() => {
    const shape = new THREE.Shape()
    hexPoints(PAD).forEach((p, i) => (i ? shape.lineTo(p.x, p.z) : shape.moveTo(p.x, p.z)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: PAD_H - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.04, bevelSegments: 2 })
    g.rotateX(Math.PI / 2)
    g.translate(0, PAD_TOP - 0.02, 0)
    return g
  }, [])
  const rim = useMemo(() => new THREE.MeshBasicMaterial({ color: z.color, toneMapped: false }), [z.color])
  const edges = useMemo(() => {
    const pts = hexPoints(PAD + 0.01, PAD_TOP + 0.005)
    return pts.slice(0, 6).map((a, i) => {
      const b = pts[i + 1]
      return { pos: a.clone().add(b).multiplyScalar(0.5), len: a.distanceTo(b), rot: -Math.atan2(b.z - a.z, b.x - a.x) }
    })
  }, [])
  const label = useCanvasTex(
    512,
    128,
    (g) => {
      g.fillStyle = z.color
      g.globalAlpha = 0.95
      g.font = '600 64px "Barlow Condensed", sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(z.label.toUpperCase().split('').join(String.fromCharCode(8202)), 256, 50)
      g.globalAlpha = 0.6
      g.font = '500 26px "IBM Plex Mono", monospace'
      g.fillText(z.role.toUpperCase(), 256, 104)
    },
    [z.label],
  )
  const labelMat = useMemo(() => new THREE.MeshBasicMaterial({ map: label, transparent: true, depthWrite: false, toneMapped: false }), [label])
  const base = useMemo(() => new THREE.Color(z.color), [z.color])
  const warn = useMemo(() => new THREE.Color(STATUS.error), [])
  useFrame((st) => {
    const s = model?.state ?? 'loading'
    const t = st.clock.elapsedTime * motion()
    const pulse = s === 'active' ? 0.25 * Math.sin(t * 3) : s === 'attention' ? 0.35 * Math.sin(t * 4) : 0
    rim.color.copy(s === 'error' ? warn : base).multiplyScalar(STATE_RIM[s] + pulse + (on ? 0.6 : 0))
    labelMat.opacity = s === 'unavailable' ? 0.45 : 1
  })
  return (
    <group position={z.pos}>
      <Blob radius={PAD * 1.45} opacity={0.7} />
      <mesh geometry={geo} material={m.gunmetal} castShadow receiveShadow {...hit} />
      {edges.map((e, i) => (
        <mesh key={i} position={e.pos} rotation-y={e.rot} material={rim}>
          <boxGeometry args={[e.len, 0.018, 0.035]} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, PAD_TOP + 0.006, PAD * 0.64]} material={labelMat}>
        <planeGeometry args={[1.5, 0.375]} />
      </mesh>
      {children}
    </group>
  )
}

// ---------------------------------------------------------------- Roblox

function GameNodeMesh({ g, x, z, y }: { g: StationModel['games'][number]; x: number; z: number; y: number }) {
  const hit = useHit({ kind: 'game', id: g.id, zone: 'roblox' })
  const on = useEmphasis('game', g.id)
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1f2a44', metalness: 0.5, roughness: 0.35, emissive: '#4f8bff', emissiveIntensity: 0.4 }), [])
  const ref = useRef<THREE.Group>(null)
  useFrame((st) => {
    const t = st.clock.elapsedTime * motion()
    const c = g.status === 'blocked' ? STATUS.warn : g.status === 'building' ? '#8fb7ff' : '#4f8bff'
    mat.emissive.set(c)
    mat.emissiveIntensity = g.status === 'building' ? 1.6 + Math.sin(t * 4 + x) * 0.6 : g.status === 'blocked' ? 1.3 : g.active ? 1.0 : 0.35
    if (ref.current) {
      ref.current.position.y = y + Math.sin(t * 1.2 + x * 3) * 0.02
      ref.current.rotation.y += 0.004 * motion()
      ref.current.scale.setScalar(on ? 1.35 : 1)
    }
  })
  return (
    <group position={[x, y, z]} ref={ref}>
      <RoundedBox args={[0.17, 0.17, 0.17]} radius={0.03} smoothness={3} material={mat} castShadow {...hit} />
      {g.active && (
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.17, 0.008, 6, 40]} />
          <meshBasicMaterial color="#cfe0ff" toneMapped={false} />
        </mesh>
      )}
      {g.published && (
        <mesh position-y={0.15}>
          <sphereGeometry args={[0.025, 10, 8]} />
          <meshBasicMaterial color="#22d3ee" toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

function Roblox({ model }: { model: StationModel }) {
  const cube = useRef<THREE.LineSegments>(null)
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.42, 0.42, 0.42)), [])
  const cubeMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#8fb7ff', toneMapped: false }), [])
  const zm = model.zones.roblox
  useFrame((_, dt) => {
    if (cube.current) {
      cube.current.rotation.y += dt * (0.3 + zm.level * 1.5) * motion()
      cube.current.rotation.x += dt * 0.12 * motion()
    }
    cubeMat.color.set(zm.state === 'unavailable' ? '#4a4f66' : '#8fb7ff').multiplyScalar(1 + zm.level)
  })
  const games = model.games.slice(0, 14)
  return (
    <Pad zone="roblox" model={zm}>
      <mesh position-y={PAD_TOP + 0.25} material={steel} castShadow>
        <cylinderGeometry args={[0.26, 0.34, 0.5, 6]} />
      </mesh>
      <lineSegments ref={cube} geometry={edges} material={cubeMat} position-y={PAD_TOP + 0.9} />
      {games.map((g, i) => {
        const a = (i / games.length) * Math.PI * 2 + Math.PI / 2
        return <GameNodeMesh key={g.id} g={g} x={Math.cos(a) * 0.98} z={Math.sin(a) * 0.98 - 0.08} y={PAD_TOP + 0.35 + (i % 2) * 0.16} />
      })}
    </Pad>
  )
}

// ---------------------------------------------------------------- Automaton

function StagePillar({ st, i, n, available }: { st: StationModel['stages'][number]; i: number; n: number; available: boolean }) {
  const hit = useHit({ kind: 'stage', id: st.id, zone: 'automaton' })
  const on = useEmphasis('stage', st.id)
  const a = Math.PI + 0.35 + (i / (n - 1)) * (Math.PI - 0.7)
  const h = st.count === null ? 0.12 : 0.1 + Math.log2(st.count + 1) * 0.16
  const mat = useMemo(
    () =>
      available
        ? new THREE.MeshStandardMaterial({ color: '#0f2a33', emissive: new THREE.Color('#22d3ee').multiplyScalar(0.35 + (i / n) * 0.9), emissiveIntensity: 1, metalness: 0.4, roughness: 0.3 })
        : new THREE.MeshBasicMaterial({ color: '#3b4a55', wireframe: true, transparent: true, opacity: 0.45 }),
    [available, i, n],
  )
  return (
    <mesh position={[Math.cos(a) * 1.0, PAD_TOP + h / 2, Math.sin(a) * 0.82]} material={mat} scale={on ? [1.3, 1, 1.3] : 1} castShadow {...hit}>
      <boxGeometry args={[0.13, h, 0.13]} />
    </mesh>
  )
}

function Automaton({ model }: { model: StationModel }) {
  const globe = useRef<THREE.Group>(null)
  const lead = useRef<THREE.InstancedMesh>(null)
  const wire = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.4, 2)), [])
  const wireMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#22d3ee', toneMapped: false, transparent: true, opacity: 0.8 }), [])
  const innerMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0c3640', transparent: true, opacity: 0.6, toneMapped: false }), [])
  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#a5f3fc', toneMapped: false }), [])
  const hit = useHit({ kind: 'zone', id: 'automaton', zone: 'automaton' })
  const zm = model.zones.automaton
  const leads = Math.min(36, model.leads.total ?? 0)
  const o = useMemo(() => new THREE.Object3D(), [])
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime * motion()
    if (globe.current) globe.current.rotation.y += dt * 0.25 * motion()
    const down = model.site.ok === false
    wireMat.color.set(down ? STATUS.error : model.site.ok === null ? '#4a5866' : '#22d3ee').multiplyScalar(down ? 1 + 0.5 * Math.sin(t * 3) : 1.2 + zm.level)
    innerMat.color.set(down ? '#3a0d0d' : '#0c3640')
    const im = lead.current
    if (im) {
      for (let k = 0; k < leads; k++) {
        const a = (k / Math.max(1, leads)) * Math.PI * 2 + t * 0.15
        o.position.set(Math.cos(a) * 0.62, PAD_TOP + 0.85 + Math.sin(a * 3) * 0.04, Math.sin(a) * 0.62)
        o.updateMatrix()
        im.setMatrixAt(k, o.matrix)
      }
      im.count = leads
      im.instanceMatrix.needsUpdate = true
    }
  })
  const available = model.stages.some((s) => s.count !== null)
  return (
    <Pad zone="automaton" model={zm}>
      <group ref={globe} position-y={PAD_TOP + 0.85} {...hit}>
        <lineSegments geometry={wire} material={wireMat} />
        <mesh material={innerMat}>
          <sphereGeometry args={[0.36, 24, 18]} />
        </mesh>
      </group>
      <instancedMesh ref={lead} args={[undefined, undefined, 36]} material={dotMat}>
        <sphereGeometry args={[0.022, 8, 6]} />
      </instancedMesh>
      {model.stages.map((st, i) => (
        <StagePillar key={st.id} st={st} i={i} n={model.stages.length} available={available} />
      ))}
    </Pad>
  )
}

// ---------------------------------------------------------------- Finance

function ServicePylon({ s, x }: { s: StationModel['services'][number]; x: number }) {
  const hit = useHit({ kind: 'service', id: s.id, zone: 'finance' })
  const on = useEmphasis('service', s.id)
  return (
    <group position={[x, PAD_TOP, 0.55]} scale={on ? 1.2 : 1}>
      <mesh position-y={0.22} material={steel} castShadow {...hit}>
        <cylinderGeometry args={[0.09, 0.12, 0.44, 6]} />
      </mesh>
      <mesh position-y={0.47}>
        <sphereGeometry args={[0.05, 12, 10]} />
        <meshBasicMaterial color={s.up ? STATUS.ok : STATUS.off} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Finance({ model }: { model: StationModel }) {
  const zm = model.zones.finance
  const hit = useHit({ kind: 'zone', id: 'finance', zone: 'finance' })
  const svcKey = model.services.map((s) => `${s.name}:${s.up}`).join('|')
  const screen = useCanvasTex(
    1024,
    560,
    (g) => {
      g.fillStyle = 'rgba(6, 28, 22, 0.78)'
      g.fillRect(0, 0, 1024, 560)
      g.strokeStyle = 'rgba(52, 211, 153, 0.7)'
      g.lineWidth = 4
      g.strokeRect(6, 6, 1012, 548)
      g.fillStyle = '#6ee7b7'
      g.font = '600 56px "Barlow Condensed", sans-serif'
      g.fillText('FINANCE  ·  MONITORING ONLY', 40, 82)
      g.font = '500 36px "IBM Plex Mono", monospace'
      let y = 160
      for (const s of model.services) {
        g.fillStyle = s.up ? '#4ade80' : '#5b5874'
        g.beginPath()
        g.arc(56, y - 12, 12, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#d1fae5'
        g.fillText(`${s.name}`, 84, y)
        g.fillStyle = s.up ? '#86efac' : '#8b8aa3'
        g.fillText(s.up ? 'running' : 'not running', 640, y)
        y += 58
      }
      g.fillStyle = '#d1fae5'
      g.fillText(`Quant View: ${model.quantView ?? 'not identified yet'}`, 40, y + 20)
      g.fillStyle = '#8b9c95'
      g.font = '500 30px "IBM Plex Mono", monospace'
      g.fillText('No broker connected — no positions, balances or P&L', 40, 500)
    },
    [svcKey, model.quantView],
  )
  const screenMat = useMemo(() => {
    // Seen from inside the curve, so the texture runs right to left.
    screen.wrapS = THREE.RepeatWrapping
    screen.repeat.x = -1
    return new THREE.MeshBasicMaterial({ map: screen, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false })
  }, [screen])
  useFrame(() => {
    screenMat.opacity = zm.state === 'unavailable' ? 0.65 : 0.95
  })
  return (
    <Pad zone="finance" model={zm}>
      {/* The terminal: a curved screen on a stand, facing the room. */}
      <mesh position={[0, PAD_TOP + 0.22, -0.3]} material={steel} castShadow>
        <boxGeometry args={[0.5, 0.44, 0.22]} />
      </mesh>
      <mesh position={[0, PAD_TOP + 0.98, 1.05]} rotation-y={Math.PI} material={screenMat} {...hit}>
        <cylinderGeometry args={[1.5, 1.5, 0.82, 32, 1, true, -0.62, 1.24]} />
      </mesh>
      {model.services.slice(0, 4).map((s, i, a) => (
        <ServicePylon key={s.id} s={s} x={(i - (a.length - 1) / 2) * 0.55} />
      ))}
    </Pad>
  )
}

// ---------------------------------------------------------------- Jobs

function JobCapsule({ j, x, y, z, color, pulse }: { j: StationModel['jobs']['running'][number]; x: number; y: number; z: number; color: string; pulse: boolean }) {
  const hit = useHit({ kind: 'job', id: j.id, zone: 'jobs' })
  const on = useEmphasis('job', j.id)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, toneMapped: false }), [color])
  const ref = useRef<THREE.Mesh>(null)
  const c = useMemo(() => new THREE.Color(color), [color])
  useFrame((st) => {
    const t = st.clock.elapsedTime * motion()
    mat.color.copy(c).multiplyScalar(pulse ? 1.1 + Math.sin(t * 4 + x * 5) * 0.5 : 0.8)
    if (ref.current) ref.current.scale.setScalar(on ? 1.5 : 1)
  })
  return (
    <mesh ref={ref} position={[x, y, z]} rotation-z={Math.PI / 2} material={mat} {...hit}>
      <capsuleGeometry args={[0.06, 0.16, 6, 12]} />
    </mesh>
  )
}

function Jobs({ model }: { model: StationModel }) {
  const rail = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#818cf8').multiplyScalar(1.4), toneMapped: false }), [])
  const { running, queued, failed, done, waiting } = model.jobs
  const y = PAD_TOP + 0.42
  const live = [...waiting, ...running].slice(0, 6)
  return (
    <Pad zone="jobs" model={model.zones.jobs}>
      {/* The rail: queued → running → done. */}
      <mesh position={[0, PAD_TOP + 0.24, -0.15]} material={steel} castShadow>
        <boxGeometry args={[2.1, 0.06, 0.16]} />
      </mesh>
      <mesh position={[0, PAD_TOP + 0.275, -0.15]} material={rail}>
        <boxGeometry args={[2.1, 0.01, 0.03]} />
      </mesh>
      {queued.slice(0, 6).map((j, i) => (
        <JobCapsule key={j.id} j={j} x={-0.92} y={PAD_TOP + 0.36 + i * 0.13} z={-0.15} color="#5b5f9e" pulse={false} />
      ))}
      {live.map((j, i) => (
        <JobCapsule
          key={j.id}
          j={j}
          x={-0.45 + (live.length === 1 ? 0.45 : (i / (live.length - 1)) * 0.9)}
          y={y + (i % 2) * 0.12}
          z={-0.15}
          color={j.state === 'needs_markus' ? STATUS.warn : j.stale ? '#ff6b3d' : '#a5b4fc'}
          pulse={!j.stale}
        />
      ))}
      {[...failed.slice(0, 4), ...done.slice(0, 5)].map((j, i) => (
        <JobCapsule key={j.id} j={j} x={0.92} y={PAD_TOP + 0.36 + i * 0.12} z={-0.15} color={j.state === 'failed' ? STATUS.error : STATUS.ok} pulse={false} />
      ))}
    </Pad>
  )
}

// ---------------------------------------------------------------- Needs Markus

function Beacon({ it, x, z }: { it: StationModel['items'][number]; x: number; z: number }) {
  const hit = useHit({ kind: 'item', id: it.id, zone: 'needs' })
  const on = useEmphasis('item', it.id)
  const h = it.priority === 'P1' ? 0.95 : it.priority === 'P2' ? 0.68 : 0.46
  const top = useMemo(() => new THREE.MeshBasicMaterial({ color: STATUS.warn, toneMapped: false }), [])
  useFrame((st) => {
    const t = st.clock.elapsedTime * motion()
    top.color.set(it.priority === 'P1' ? '#ff8a1f' : STATUS.warn).multiplyScalar(1.2 + Math.sin(t * (it.priority === 'P1' ? 5 : 2.5)) * 0.5)
  })
  return (
    <group position={[x, PAD_TOP, z]} scale={on ? 1.25 : 1}>
      <mesh position-y={h / 2} material={steel} castShadow {...hit}>
        <cylinderGeometry args={[0.07, 0.1, h, 6]} />
      </mesh>
      <mesh position-y={h + 0.05} material={top} {...hit}>
        <octahedronGeometry args={[0.08, 0]} />
      </mesh>
    </group>
  )
}

function Needs({ model }: { model: StationModel }) {
  const clear = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#f5a524').multiplyScalar(0.5), toneMapped: false, transparent: true, opacity: 0.6 }), [])
  const items = model.items.slice(0, 6)
  return (
    <Pad zone="needs" model={model.zones.needs}>
      {items.length ? (
        items.map((it, i) => {
          const a = Math.PI + 0.5 + (items.length === 1 ? 0.5 : i / (items.length - 1)) * (Math.PI - 1.0)
          return <Beacon key={it.id} it={it} x={Math.cos(a) * 0.72} z={Math.sin(a) * 0.62} />
        })
      ) : (
        <mesh rotation-x={-Math.PI / 2} position-y={PAD_TOP + 0.01} material={clear}>
          <ringGeometry args={[0.45, 0.48, 48]} />
        </mesh>
      )}
    </Pad>
  )
}

// ---------------------------------------------------------------- Jarvis Core

function CapPylon({ c, a }: { c: StationModel['caps'][number]; a: number }) {
  const hit = useHit({ kind: 'capability', id: c.id, zone: 'core' })
  const on = useEmphasis('capability', c.id)
  const color = c.state === 'ok' ? STATUS.ok : c.state === 'warn' ? STATUS.warn : c.state === 'error' ? STATUS.error : STATUS.off
  return (
    <group position={[Math.cos(a) * 0.8, PAD_TOP, Math.sin(a) * 0.7 - 0.1]} scale={on ? 1.25 : 1}>
      <mesh position-y={0.17} material={steel} castShadow {...hit}>
        <cylinderGeometry args={[0.1, 0.13, 0.34, 6]} />
      </mesh>
      <mesh position-y={0.36} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.1, 0.014, 6, 24]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Core({ model }: { model: StationModel }) {
  const orb = useMemo(() => new THREE.MeshBasicMaterial({ color: '#c084fc', toneMapped: false }), [])
  const ref = useRef<THREE.Mesh>(null)
  useFrame((st) => {
    const r = reactorState()
    const t = st.clock.elapsedTime * motion()
    orb.color.copy(r.color).multiplyScalar(1.2 + r.level)
    if (ref.current) ref.current.position.y = PAD_TOP + 0.62 + Math.sin(t * 1.4) * 0.04
  })
  const hit = useHit({ kind: 'zone', id: 'core', zone: 'core' })
  return (
    <Pad zone="core" model={model.zones.core}>
      <mesh ref={ref} material={orb} {...hit}>
        <icosahedronGeometry args={[0.16, 2]} />
      </mesh>
      {model.caps.map((c, i) => (
        <CapPylon key={c.id} c={c} a={Math.PI + 0.35 + (i / (model.caps.length - 1)) * (Math.PI - 0.7)} />
      ))}
    </Pad>
  )
}

export function Clusters() {
  const model = useStation((s) => s.model)
  if (!model) return null
  return (
    <>
      <Roblox model={model} />
      <Automaton model={model} />
      <Finance model={model} />
      <Jobs model={model} />
      <Needs model={model} />
      <Core model={model} />
    </>
  )
}
