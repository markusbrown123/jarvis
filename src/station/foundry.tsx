import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FOUNDRY, FOUNDRY_R, STATUS, ZONE } from './layout'
import { holo, steel, useEmphasis, useHit } from './holo'
import { motion, useCanvasTex } from './shared'
import { useStation } from './stationStore'
import type { JobNode, StationModel } from './model'

/**
 * The build bay: a round holo-table between Roblox and Automaton, straight
 * ahead of the desk, where JARVIS's work is shown being built — a little
 * skyline that grows as jobs get done.
 *
 * Every job on the table is a tower on its own plot, in its project's
 * colour:
 * - running: rising floor by floor — one floor per step the job reports
 *   (done of total), the rest of its height standing as scaffolding, a
 *   laser sweeping the floor being printed and sparks flying off it. A job
 *   that doesn't report its steps shows scaffolding with the laser hunting
 *   up and down it: honestly working, honestly unmeasured.
 * - waiting on Markus: paused where it got to, an amber beacon on top
 * - queued: an empty foundation, waiting its turn
 * - done in the last hour: the finished tower, lit to the top
 * - failed: in red, its top floors fallen in
 * When a job reports another step its new floor flashes as it lands; a
 * finished job sends a ring out across the table. A tower crane at the
 * table's edge swings over to whatever is being built and lowers the next
 * floor into place. The front of the table reads out the counts and the
 * job being built. Click a tower to open its job.
 */

const TABLE_H = 0.85
const TOP = TABLE_H + 0.02
const FLOOR = 0.13
const W = 0.3
const SPACING = 0.52
// Nine plots, the middle first, then the sides, then the corners.
const PLOTS: [number, number][] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, 1],
  [0, -1],
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
].map(([x, z]) => [x * SPACING, z * SPACING])
const MAST: [number, number] = [0.9, -0.58]
const MAST_H = 2.2

type Role = 'running' | 'waiting' | 'queued' | 'done' | 'failed'
type Plot = { j: JobNode; role: Role; x: number; z: number }

function plan(jobs: StationModel['jobs']): Plot[] {
  const order: [JobNode, Role][] = [
    ...jobs.running.map((j): [JobNode, Role] => [j, 'running']),
    ...jobs.waiting.map((j): [JobNode, Role] => [j, 'waiting']),
    ...jobs.failed.map((j): [JobNode, Role] => [j, 'failed']),
    ...jobs.done.map((j): [JobNode, Role] => [j, 'done']),
    ...jobs.queued.map((j): [JobNode, Role] => [j, 'queued']),
  ]
  return order.slice(0, PLOTS.length).map(([j, role], i) => ({ j, role, x: PLOTS[i][0], z: PLOTS[i][1] }))
}

/** How tall a job's tower is to be, and how many floors are up. */
function floors(p: Plot) {
  const pr = p.j.progress
  const total = pr ? Math.max(3, Math.min(12, pr.total)) : 8
  const done = pr ? Math.round((pr.done / pr.total) * total) : 0
  const built = p.role === 'done' ? total : p.role === 'queued' ? 0 : p.role === 'failed' ? (pr ? done : Math.ceil(total * 0.5)) : done
  return { total, built, measured: Boolean(pr) }
}

/** Outlines of every floor, drawn up to however many are built. */
const floorLines = (() => {
  const pts: number[] = []
  const h = W / 2
  for (let f = 0; f <= 12; f++) {
    const y = f * FLOOR
    const c: [number, number][] = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ]
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k]
      const [bx, bz] = c[(k + 1) % 4]
      pts.push(ax, y, az, bx, y, bz)
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
})()
const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const unitEdges = new THREE.EdgesGeometry(unitBox)

function Tower({ p }: { p: Plot }) {
  const hit = useHit({ kind: 'job', id: p.j.id, zone: 'jobs' })
  const on = useEmphasis('job', p.j.id)
  const color = p.role === 'failed' ? STATUS.error : p.role === 'waiting' ? STATUS.warn : p.j.stale ? '#ff6b3d' : ZONE[p.j.zone].color
  const { total, built, measured } = floors(p)
  const mats = useMemo(
    () => ({
      fill: holo(color, p.role === 'done' ? 0.34 : p.role === 'queued' ? 0.06 : 0.24),
      line: new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      scaffold: new THREE.LineBasicMaterial({ color, transparent: true, opacity: p.role === 'queued' ? 0.35 : 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      laser: holo('#fff3d6', 0.0),
      beacon: holo(STATUS.warn, 0.9),
      cap: holo(color, 0.85),
      sparks: new THREE.PointsMaterial({ color: '#ffd9a0', size: 0.025, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    }),
    [color, p.role],
  )
  const lines = useMemo(() => {
    const g = floorLines.clone()
    g.setDrawRange(0, (built + 1) * 8)
    return g
  }, [built])
  const sparks = useMemo(() => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3)), [])
  const laser = useRef<THREE.Group>(null)
  const flash = useRef(0)
  const was = useRef(built)
  useEffect(() => {
    if (built > was.current) flash.current = 1
    was.current = built
  }, [built])

  const h = built * FLOOR
  const H = total * FLOOR
  const live = p.role === 'running' && !p.j.stale
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime * motion()
    flash.current = Math.max(0, flash.current - dt * 0.8)
    mats.fill.opacity = (p.role === 'done' ? 0.34 : p.role === 'queued' ? 0.06 : 0.24) * (on ? 1.6 : 1) + flash.current * 0.5
    if (p.role === 'failed') mats.fill.opacity *= 0.75 + 0.25 * Math.sin(t * 9) * Math.sin(t * 3.3)
    mats.beacon.opacity = p.role === 'waiting' ? 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * 3)) : 0
    // The build front: where the next floor is printed, or (unmeasured) hunting up and down.
    const front = measured ? h + FLOOR * 0.5 : (0.5 + 0.5 * Math.sin(t * 0.9)) * H
    if (laser.current) {
      laser.current.visible = live
      laser.current.position.y = Math.min(front, H)
      laser.current.children[1].position.x = Math.sin(t * 3.1) * W * 0.5
    }
    mats.laser.opacity = live ? 0.55 : 0
    mats.sparks.opacity = live ? 0.9 : 0
    if (live) {
      const pos = sparks.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const k = (t * 1.7 + i * 0.37) % 1
        const a = i * 2.4
        pos.setXYZ(i, Math.cos(a) * (0.05 + k * 0.25) + Math.sin(t * 3.1) * W * 0.5, Math.min(front, H) + k * 0.18 - k * k * 0.4, Math.sin(a) * (0.05 + k * 0.25))
      }
      pos.needsUpdate = true
    }
  })

  return (
    <group position={[p.x, TOP, p.z]}>
      {/* The foundation, and something to click. */}
      <mesh position-y={0.005} material={mats.fill} {...hit}>
        <boxGeometry args={[W + 0.08, 0.01, W + 0.08]} />
      </mesh>
      <mesh visible={false} position-y={Math.max(H, 0.2) / 2} {...hit}>
        <boxGeometry args={[W, Math.max(H, 0.2), W]} />
      </mesh>
      {built > 0 && (
        <>
          <mesh geometry={unitBox} material={mats.fill} scale={[W, p.role === 'failed' ? h * 0.7 : h, W]} />
          <lineSegments geometry={lines} material={mats.line} scale={[1, p.role === 'failed' ? 0.7 : 1, 1]} />
        </>
      )}
      {p.role === 'failed' && built > 1 && (
        // What's left of the top floors, fallen in.
        <group position={[0.04, h * 0.7, -0.02]} rotation={[0.35, 0.4, 0.5]}>
          <mesh geometry={unitBox} material={mats.fill} scale={[W * 0.9, FLOOR * 1.2, W * 0.7]} />
          <lineSegments geometry={unitEdges} material={mats.line} scale={[W * 0.9, FLOOR * 1.2, W * 0.7]} />
        </group>
      )}
      {p.role !== 'done' && p.role !== 'failed' && <lineSegments geometry={unitEdges} material={mats.scaffold} scale={[W + 0.02, H, W + 0.02]} />}
      {p.role === 'done' && (
        <mesh position-y={H + 0.01} material={mats.cap}>
          <boxGeometry args={[W * 0.4, 0.02, W * 0.4]} />
        </mesh>
      )}
      {p.role === 'waiting' && (
        <mesh position-y={h + 0.08} material={mats.beacon}>
          <sphereGeometry args={[0.05, 12, 8]} />
        </mesh>
      )}
      <group ref={laser} visible={false}>
        <mesh rotation-x={-Math.PI / 2} material={mats.laser}>
          <planeGeometry args={[W + 0.1, W + 0.1]} />
        </mesh>
        <mesh material={mats.laser}>
          <boxGeometry args={[0.012, 0.012, W + 0.1]} />
        </mesh>
      </group>
      {live && <points geometry={sparks} material={mats.sparks} />}
    </group>
  )
}

/** The crane: swings over to whatever is being built and lowers its next floor. */
function Crane({ target }: { target: { x: number; z: number; y: number } | null }) {
  const mats = useMemo(
    () => ({
      frame: new THREE.LineBasicMaterial({ color: new THREE.Color('#ffc46b').multiplyScalar(1.3), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      load: holo('#ffc46b', 0.35),
    }),
    [],
  )
  const mast = useMemo(() => {
    // A lattice mast and a long jib, as lines.
    const p: number[] = []
    const s = 0.05
    const seg = (a: number[], b: number[]) => p.push(...a, ...b)
    for (let i = 0; i < 4; i++) {
      const [ax, az] = [i & 1 ? s : -s, i & 2 ? s : -s]
      seg([ax, 0, az], [ax, MAST_H, az])
    }
    for (let y = 0; y < MAST_H; y += 0.2) {
      seg([-s, y, -s], [s, y + 0.2, -s])
      seg([s, y, s], [-s, y + 0.2, s])
      seg([-s, y, s], [-s, y + 0.2, -s])
      seg([s, y, -s], [s, y + 0.2, s])
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  }, [])
  const jib = useMemo(() => {
    const p: number[] = []
    const seg = (a: number[], b: number[]) => p.push(...a, ...b)
    const L = 1.95
    seg([-0.6, 0, -0.03], [L, 0, -0.03])
    seg([-0.6, 0, 0.03], [L, 0, 0.03])
    seg([-0.1, 0.25, 0], [L, 0.03, 0])
    seg([-0.1, 0.25, 0], [-0.6, 0.02, 0])
    for (let x = -0.6; x < L; x += 0.15) seg([x, 0, -0.03], [x + 0.15, 0, 0.03])
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  }, [])
  const head = useRef<THREE.Group>(null)
  const trolley = useRef<THREE.Group>(null)
  const cable = useRef<THREE.Mesh>(null)
  const state = useRef({ yaw: 0.6, reach: 1, drop: 0.4 })
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime * motion()
    const s = state.current
    const k = Math.min(1, dt * 1.2)
    // Point the jib at the build (or rest, swinging gently).
    const goal = target
      ? { yaw: Math.atan2(-(target.z - MAST[1]), target.x - MAST[0]), reach: Math.hypot(target.x - MAST[0], target.z - MAST[1]), drop: MAST_H - target.y - 0.15 }
      : { yaw: 2.4 + Math.sin(t * 0.15) * 0.3, reach: 0.9, drop: 0.6 }
    let dy = goal.yaw - s.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    s.yaw += dy * k * 0.8
    s.reach += (goal.reach - s.reach) * k
    // Lowering a floor, then hauling the hook back up for the next.
    const cycle = target ? 0.5 - 0.5 * Math.cos(t * 0.8) : 0
    s.drop += (Math.max(0.15, goal.drop * (0.35 + 0.65 * cycle)) - s.drop) * k
    if (head.current) head.current.rotation.y = s.yaw
    if (trolley.current) trolley.current.position.x = s.reach
    if (cable.current) {
      cable.current.scale.y = s.drop
      cable.current.position.y = -s.drop / 2
      ;(cable.current.parent!.children[2] as THREE.Object3D).position.y = -s.drop - 0.05
    }
  })
  return (
    <group position={[MAST[0], TOP, MAST[1]]}>
      <lineSegments geometry={mast} material={mats.frame} />
      <group ref={head} position-y={MAST_H}>
        <lineSegments geometry={jib} material={mats.frame} />
        <mesh position={[-0.5, -0.04, 0]} material={mats.load}>
          <boxGeometry args={[0.16, 0.1, 0.12]} />
        </mesh>
        <group ref={trolley}>
          <mesh material={mats.load}>
            <boxGeometry args={[0.06, 0.03, 0.08]} />
          </mesh>
          <mesh ref={cable} material={mats.frame}>
            <cylinderGeometry args={[0.003, 0.003, 1, 4]} />
          </mesh>
          {/* The floor on its way down. */}
          <mesh material={mats.load} visible={Boolean(target)}>
            <boxGeometry args={[W, FLOOR * 0.8, W]} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/** The table's front edge: counts, and what's being built. */
function Fascia({ plots, jobs }: { plots: Plot[]; jobs: StationModel['jobs'] }) {
  const lead = plots.find((p) => p.role === 'running') ?? plots.find((p) => p.role === 'waiting')
  const f = lead ? floors(lead) : null
  const line1 = `${jobs.running.length} building · ${jobs.waiting.length} waiting on you · ${jobs.queued.length} queued · ${jobs.done.length} built this hour${jobs.failed.length ? ` · ${jobs.failed.length} failed` : ''}`
  const line2 = lead ? `${lead.j.title}${lead.j.progress ? ` — step ${lead.j.progress.done} of ${lead.j.progress.total}` : ' — progress not reported'}` : 'Nothing being built right now'
  const tex = useCanvasTex(
    1400,
    200,
    (g) => {
      g.fillStyle = 'rgba(8,12,22,0.55)'
      g.fillRect(0, 0, 1400, 200)
      g.fillStyle = '#ffc46b'
      g.font = '600 54px "Barlow Condensed", sans-serif'
      g.fillText('BUILD BAY', 28, 64)
      g.fillStyle = '#cfd8ff'
      g.font = '500 34px "IBM Plex Mono", monospace'
      g.fillText(line1, 290, 60, 1090)
      g.fillStyle = '#ffffff'
      g.font = '500 40px "Barlow", sans-serif'
      g.fillText(line2, 28, 136, 1340)
      if (f && lead?.j.progress) {
        g.fillStyle = 'rgba(255,255,255,0.15)'
        g.fillRect(28, 162, 1344, 12)
        g.fillStyle = '#ffc46b'
        g.fillRect(28, 162, (1344 * lead.j.progress.done) / lead.j.progress.total, 12)
      }
    },
    [line1, line2],
  )
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }), [tex])
  return (
    <mesh position={[0, TABLE_H - 0.06, FOUNDRY_R + 0.02]} rotation-x={-0.35} material={mat} renderOrder={3}>
      <planeGeometry args={[1.75, 0.25]} />
    </mesh>
  )
}

export function Foundry() {
  const jobs = useStation((s) => s.model?.jobs)
  const events = useStation((s) => s.events)
  const plots = useMemo(() => (jobs ? plan(jobs) : []), [jobs])
  const table = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          [0, 0],
          [0.5, 0],
          [0.42, 0.08],
          [0.32, TABLE_H - 0.12],
          [FOUNDRY_R, TABLE_H - 0.04],
          [FOUNDRY_R, TABLE_H],
          [0, TABLE_H],
        ].map(([x, y]) => new THREE.Vector2(x, y)),
        64,
      ),
    [],
  )
  const glow = useMemo(() => holo('#ffc46b', 0.5), [])
  const grid = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const g = c.getContext('2d')!
    g.strokeStyle = 'rgba(255,196,107,0.55)'
    g.lineWidth = 1.5
    for (let i = 0; i <= 512; i += 512 / 22) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i, 512)
      g.moveTo(0, i)
      g.lineTo(512, i)
      g.stroke()
    }
    g.globalCompositeOperation = 'destination-in'
    const r = g.createRadialGradient(256, 256, 60, 256, 256, 256)
    r.addColorStop(0, 'rgba(0,0,0,1)')
    r.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 512, 512)
    const t = new THREE.CanvasTexture(c)
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  }, [])
  const ring = useRef<THREE.Mesh>(null)
  const ringMat = useMemo(() => holo('#ffc46b', 0), [])
  useFrame(() => {
    // A finished job sends a ring out across the table.
    const now = performance.now()
    const last = [...events].reverse().find((e) => e.kind === 'complete')
    const s = last ? (now - last.at) / 1000 : 99
    if (ring.current) ring.current.scale.setScalar(0.2 + Math.min(s, 1.5) * 0.6)
    ringMat.opacity = s < 1.5 ? 0.8 * (1 - s / 1.5) : 0
  })
  const lead = plots.find((p) => p.role === 'running' && !p.j.stale)
  const target = lead ? { x: lead.x, z: lead.z, y: TOP + floors(lead).built * FLOOR + FLOOR } : null

  return (
    <group position={FOUNDRY}>
      <mesh geometry={table} material={steel} castShadow receiveShadow />
      <mesh position-y={TABLE_H + 0.004} rotation-x={-Math.PI / 2} material={grid}>
        <circleGeometry args={[FOUNDRY_R - 0.04, 64]} />
      </mesh>
      <mesh position-y={TABLE_H - 0.02} rotation-x={-Math.PI / 2} material={glow}>
        <ringGeometry args={[FOUNDRY_R - 0.015, FOUNDRY_R + 0.005, 96]} />
      </mesh>
      <mesh ref={ring} position-y={TOP + 0.005} rotation-x={-Math.PI / 2} material={ringMat}>
        <ringGeometry args={[0.95, 1.0, 96]} />
      </mesh>
      {plots.map((p) => (
        <Tower key={p.j.id} p={p} />
      ))}
      <Crane target={target} />
      {jobs && <Fascia plots={plots} jobs={jobs} />}
    </group>
  )
}
