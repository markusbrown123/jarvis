import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { useHub, type Graphics } from '../hub/client'
import { COL, motion, reactorState, typing, useCanvasTex } from './shared'
import { useStation } from './stationStore'
import { BASE, CONSOLE_R, DECK_TOP, ZONES } from './layout'
import { Blob } from './floor'

/**
 * The centre console: a raised round platform with a wide C-shaped command
 * desk, a command chair and four holo monitors — where Markus sits to talk
 * to JARVIS, like Tony's workshop desk.
 *
 * The platform, desk and chair are modelled in Blender and their surfaces
 * baked there with Cycles (tools/blender/console.py): colour, ray-traced
 * ambient occlusion, roughness, metalness and normal relief, at 4096 px on
 * Ultra, 2048 on High and 1024 on Low. What changes with JARVIS is live:
 *
 * - every light strip (platform ring, back step, desk edges, shelf, chair
 *   back) is his colour — standby blue, listening orange, thinking violet,
 *   speaking cyan — and brightens with his voice
 * - the two holo pads on the desk turn amber while anything waits on Markus
 * - a red segment lights on the platform ring on an error
 * - a ring of light leaves the platform when a job completes
 * - the holo keyboard lights while Markus types to him
 * - the monitors are drawn from the station model: Systems, Zones, Work,
 *   Business
 */

const MODEL = '/station/console.glb'
const BAKED = ['desk', 'dais', 'chair'] as const

/** One baked texture set — colour, ORM, normal — at the quality's size. */
function useBaked(graphics: Graphics) {
  const urls = BAKED.flatMap((n) => ['albedo', 'orm', 'normal'].map((k) => `/station/${n}_${k}_${graphics}.jpg`))
  const tex = useLoader(THREE.TextureLoader, urls)
  return useMemo(() => {
    const out = {} as Record<(typeof BAKED)[number], THREE.MeshStandardMaterial>
    BAKED.forEach((n, i) => {
      const [map, orm, normal] = tex.slice(i * 3, i * 3 + 3)
      for (const t of [map, orm, normal]) {
        // glTF's UVs run top-down.
        t.flipY = false
        t.anisotropy = 8
        t.needsUpdate = true
      }
      map.colorSpace = THREE.SRGBColorSpace
      out[n] = new THREE.MeshStandardMaterial({
        map,
        aoMap: orm,
        aoMapIntensity: 1,
        roughnessMap: orm,
        metalnessMap: orm,
        roughness: 1,
        metalness: 1,
        normalMap: normal,
        envMapIntensity: 1.15,
      })
    })
    return out
  }, [tex])
}

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

export function Console({ graphics }: { graphics: Graphics }) {
  const { scene } = useGLTF(MODEL, false)
  const baked = useBaked(graphics)
  const strip = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }), [])
  const ring = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }), [])
  const pads = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }), [])
  // Smoked glass: dark, glossy, faintly lit from inside — not a mirror.
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#04070d', roughness: 0.38, metalness: 0.2, envMapIntensity: 0.12, emissive: '#7c8bff', emissiveIntensity: 0.05 }), [])
  const errMat = useMemo(() => new THREE.MeshBasicMaterial({ color: COL.red, toneMapped: false, transparent: true, opacity: 0, depthWrite: false }), [])
  const waveMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#b9f5d0', toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), [])
  const keys = useMemo(() => new THREE.MeshBasicMaterial({ map: keyboardTexture(), color: '#7cc8ff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const light = useRef<THREE.PointLight>(null)
  const wave = useRef<THREE.Mesh>(null)
  const col = useMemo(() => new THREE.Color('#7c8bff'), [])
  const s = useRef({ level: 0, t: 0, typed: 0, hot: 0 })
  const away = () => {
    const m = useStation.getState().mode
    return m === 'command' || m === 'cinematic'
  }
  const sit = (e: ThreeEvent<MouseEvent>) => {
    if (!away()) return
    e.stopPropagation()
    const st = useStation.getState()
    st.select(null, false)
    st.setMode('talk')
    useStation.setState({ deskHover: false })
    document.body.style.cursor = ''
  }
  const over = (e: ThreeEvent<PointerEvent>) => {
    if (!away()) return
    e.stopPropagation()
    useStation.setState({ deskHover: true })
    document.body.style.cursor = 'pointer'
  }
  const out = () => {
    if (!useStation.getState().deskHover) return
    useStation.setState({ deskHover: false })
    document.body.style.cursor = ''
  }

  // Dress the model: baked surfaces, live light, glass.
  useLayoutEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      // Blender's duplicate suffix (".001") arrives as "001" once the loader drops the dot.
      const name = m.name.replace(/\.?\d{3}$/, '')
      if (name in baked) {
        m.material = baked[name as keyof typeof baked]
        m.castShadow = true
        m.receiveShadow = true
      } else if (name === 'glass') m.material = glass
      else if (name.startsWith('emit_pad')) m.material = pads
      else if (name === 'emit_dais' || name === 'emit_step') m.material = ring
      else if (name.startsWith('emit_')) m.material = strip
    })
  }, [scene, baked, glass, strip, ring, pads])

  const mounts = useMemo(() => [0, 1, 2, 3].map((i) => scene.getObjectByName(`mon_${i}`)), [scene])
  // The keyboard sits on the desk straight ahead of the chair.
  const kbd = useMemo(() => new THREE.Vector3(0, 0.989, -1.16), [])

  useFrame((_, dt) => {
    const st = reactorState()
    const k = Math.min(1, dt * 3)
    const v = s.current
    col.lerp(st.color, k)
    v.level += (st.level - v.level) * Math.min(1, dt * 12)
    v.t += dt * motion()
    const lift = v.level * 1.6
    // Pointed at from across the room: the desk's light comes up to say "here".
    v.hot += ((useStation.getState().deskHover ? 1 : 0) - v.hot) * Math.min(1, dt * 8)
    strip.color.copy(col).multiplyScalar(1.5 + lift + v.hot * 1.2)
    ring.color.copy(col).multiplyScalar(1.9 + lift + v.hot * 1.6)
    glass.emissive.copy(col)
    glass.emissiveIntensity = 0.04 + v.level * 0.1
    if (light.current) {
      light.current.color.copy(col)
      light.current.intensity = 6 + v.level * 18 + (st.busy ? 4 : 0)
    }
    // Needs input: the desk's two holo pads go amber and pulse.
    const model = useStation.getState().model
    const waiting = (model?.items.length ?? 0) > 0 || (model?.jobs.waiting.length ?? 0) > 0
    pads.color.copy(waiting ? COL.amber : col).multiplyScalar(waiting ? 1.6 + Math.sin(v.t * 2.4) * 0.6 : 1.4)
    // Error: a red segment on the platform ring — local, not the whole room.
    errMat.opacity += ((st.error || model?.zones.core.state === 'error' ? 0.95 : 0) - errMat.opacity) * k
    // Completed: a ring of light leaves the platform.
    const ev = useStation.getState().events
    const last = ev.findLast((e) => e.kind === 'complete')
    const age = last ? (performance.now() - last.at) / 1000 : 99
    if (wave.current) {
      wave.current.visible = age < 1.6
      wave.current.scale.setScalar(1 + age * 1.6)
      waveMat.opacity = Math.max(0, 1 - age / 1.6) * 0.9
    }
    // Typing lights the keys; they fade back over a second.
    v.typed += ((performance.now() - typing.at < 900 ? 1 : 0) - v.typed) * Math.min(1, dt * 6)
    keys.opacity = 0.2 + v.typed * 0.7
  })

  return (
    <group position-y={DECK_TOP}>
      <Blob radius={2.9} position={[0, 0, 0]} opacity={0.8} />
      <primitive object={scene} />
      {/* JARVIS's own light over the desk. */}
      <pointLight ref={light} position={[0, 2.3, -0.5]} distance={7} decay={2} intensity={6} />
      <mesh rotation-x={Math.PI / 2} position-y={0.125} material={errMat}>
        <torusGeometry args={[BASE - 0.12, 0.02, 6, 48, Math.PI / 3]} />
      </mesh>
      <mesh ref={wave} rotation-x={-Math.PI / 2} position-y={0.24} material={waveMat} visible={false}>
        <ringGeometry args={[BASE - 0.05, BASE, 128]} />
      </mesh>
      <mesh position={kbd} rotation-x={-Math.PI / 2} material={keys}>
        <planeGeometry args={[0.5, 0.16]} />
      </mesh>
      {/* The desk is a place to go: from Command or Cinematic, click it to
          sit down. A plain cylinder catches the pointer, which is cheaper
          than testing every face of the model on each move; from the chair
          (inside it) its faces point away, so it never gets in the way. */}
      <mesh position-y={0.7} onClick={sit} onPointerOver={over} onPointerOut={out}>
        <cylinderGeometry args={[CONSOLE_R - 0.25, CONSOLE_R - 0.25, 1.4, 24]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {mounts[3] && <SystemsMonitor mount={mounts[3]} />}
      {mounts[2] && <ZonesMonitor mount={mounts[2]} />}
      {mounts[1] && <WorkMonitor mount={mounts[1]} />}
      {mounts[0] && <BusinessMonitor mount={mounts[0]} />}
    </group>
  )
}

// ---------------------------------------------------------------- monitors

const W = 640
const H = 400
const SCREEN_W = 0.95

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

/** A screen hung on one of the console's mounts (mon_N in the model), facing the chair. */
function Monitor({ mount, tex }: { mount: THREE.Object3D; tex: THREE.Texture }) {
  // Writes depth so depth of field knows the screen is here, not the room behind it.
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide }), [tex])
  return (
    <group position={mount.position} quaternion={mount.quaternion}>
      <mesh material={mat} renderOrder={3}>
        <planeGeometry args={[SCREEN_W, (SCREEN_W * H) / W]} />
      </mesh>
    </group>
  )
}

const PHASE_WORD: Record<string, string> = { offline: 'offline', boot: 'starting', dormant: 'standing by', waking: 'listening', listening: 'listening', thinking: 'thinking', tooling: 'working', speaking: 'speaking' }

/** What JARVIS is doing, and each of his own systems. */
function SystemsMonitor({ mount }: { mount: THREE.Object3D }) {
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
  return <Monitor mount={mount} tex={tex} />
}

/** What's running and what's waiting on Markus. */
function WorkMonitor({ mount }: { mount: THREE.Object3D }) {
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
  return <Monitor mount={mount} tex={tex} />
}

/** The businesses, each figure only when it's really known. */
function BusinessMonitor({ mount }: { mount: THREE.Object3D }) {
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
  return <Monitor mount={mount} tex={tex} />
}

/** Every system at a glance: its state and its one line. */
function ZonesMonitor({ mount }: { mount: THREE.Object3D }) {
  const zones = useStation((s) => s.model?.zones)
  const key = ZONES.map((z) => `${zones?.[z.id].state}:${zones?.[z.id].headline}`).join('|')
  const tex = useCanvasTex(
    W,
    H,
    screen('Zones', '#c4b5fd', (g) => {
      ZONES.forEach((z, i) => {
        const zm = zones?.[z.id]
        const state = !zm ? 'off' : zm.state === 'error' ? 'error' : zm.state === 'attention' ? 'warn' : zm.state === 'active' ? 'live' : zm.state === 'idle' ? 'ok' : 'off'
        row(g, 112 + i * 46, state, z.label, zm?.headline ?? 'reading…')
      })
    }),
    [key],
  )
  return <Monitor mount={mount} tex={tex} />
}
