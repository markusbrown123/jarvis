import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { useHub, fileUrl } from '../hub/client'
import { rng } from '../scene/crystal'
import { motion, useMaterials } from './shared'
import { ZONE, type ZoneId } from './layout'
import { useStation } from './stationStore'

/**
 * The room round the installation, all built from geometry here — nothing
 * downloaded — and each piece reading live state: the arms track the zones
 * they serve, rack lights blink with how much is happening, the back screen
 * shows the latest studio render.
 */

// ---------------------------------------------------------------- robot arm

const L1 = 1.35
const L2 = 1.25
const SHOULDER = 0.62

/**
 * An articulated arm on the deck between the pads. Two-link IK in its
 * vertical plane reaches the claw tip for a target. It serves the three
 * zones on its side: when work is handed to or comes back from one of them
 * it swings over and its stripe lights in that zone's colour; while one is
 * active it tends it; while JARVIS is thinking it works at the reactor; and
 * with nothing going on it docks, folded.
 */
export function RobotArm({ position, side, seed, zones }: { position: [number, number, number]; side: 1 | -1; seed: number; zones: ZoneId[] }) {
  const m = useMaterials()
  const yaw = useRef<THREE.Group>(null)
  const shoulder = useRef<THREE.Group>(null)
  const elbow = useRef<THREE.Group>(null)
  const wrist = useRef<THREE.Group>(null)
  const fingers = useRef<(THREE.Group | null)[]>([])
  const spark = useRef<THREE.PointLight>(null)
  const [working, setWorking] = useState(false)
  const target = useMemo(() => new THREE.Vector3(), [])
  const want = useMemo(() => new THREE.Vector3(), [])
  const base = useMemo(() => new THREE.Vector3(...position), [position])
  const stripe = useMemo(() => m.glow('#5eead4', 1.4), [m])
  const stripeTo = useMemo(() => new THREE.Color(), [])
  const t = useRef(seed * 10)

  useFrame((_, dt) => {
    const mo = motion()
    t.current += dt * mo
    const tt = t.current
    const now = performance.now()
    const { model, events } = useStation.getState()
    // A transfer to or from one of its zones in the last few seconds wins;
    // then the busiest active zone; then the reactor while JARVIS thinks.
    const transfer = events.findLast((e) => zones.includes(e.zone) && e.kind !== 'voice' && e.kind !== 'fail' && now - e.at < 3000)
    const active = model ? zones.filter((z) => model.zones[z].state === 'active').sort((a, b) => model.zones[b].level - model.zones[a].level)[0] : undefined
    const focus: ZoneId | undefined = transfer?.zone ?? active
    const { phase } = useStore.getState()
    const thinking = phase === 'thinking' || phase === 'tooling'
    const busy = Boolean(focus) || thinking
    if (Boolean(transfer) !== working) setWorking(Boolean(transfer))

    if (focus) {
      // Out over the near edge of the zone's pad.
      const [px, , pz] = ZONE[focus].pos
      const dx = px - base.x
      const dz = pz - base.z
      const d = Math.hypot(dx, dz)
      const reach = Math.min(L1 + L2 - 0.25, Math.max(0.8, d - 0.9))
      want.set(base.x + (dx / d) * reach + Math.sin(tt * 2.1 + seed) * 0.05, 0.95 + Math.sin(tt * 1.6) * 0.06, base.z + (dz / d) * reach + Math.cos(tt * 1.8 + seed) * 0.05)
    } else if (thinking) {
      // Over the console's monitor shelf, with small deliberate "tool" moves.
      const d = Math.hypot(base.x, base.z)
      want.set((base.x / d) * 1.95 + Math.sin(tt * 2.3 + seed) * 0.06, 1.55 + Math.sin(tt * 1.7) * 0.08, (base.z / d) * 1.95 + Math.cos(tt * 1.9 + seed) * 0.06)
    } else {
      // Docked: upper arm upright, claw tucked down towards the reactor, breathing.
      const d = Math.hypot(base.x, base.z)
      want.set(base.x - (base.x / d) * 0.6, base.y + 0.9 + Math.sin(tt * 0.6 + seed) * 0.04, base.z - (base.z / d) * 0.6)
    }
    if (target.lengthSq() === 0) target.copy(want)
    target.lerp(want, Math.min(1, dt * (transfer ? 2.2 : busy ? 1.4 : 0.8)))

    stripeTo.set(focus ? ZONE[focus].color : thinking ? '#b69cff' : '#5eead4').multiplyScalar(transfer ? 3.2 : busy ? 1.8 : 0.7)
    stripe.color.lerp(stripeTo, Math.min(1, dt * 4))

    // Into the arm's frame.
    const dx = target.x - base.x
    const dz = target.z - base.z
    const dy = target.y - base.y - SHOULDER
    if (yaw.current) yaw.current.rotation.y = Math.atan2(dx, dz)
    const r = Math.hypot(dx, dz)
    const D = Math.min(L1 + L2 - 0.02, Math.max(0.35, Math.hypot(r, dy)))
    const phi = Math.atan2(dy, r)
    const alpha = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))))
    const inner = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2))))
    const elev = phi + alpha
    if (shoulder.current) shoulder.current.rotation.x = Math.PI / 2 - elev
    if (elbow.current) elbow.current.rotation.x = Math.PI - inner
    if (wrist.current) wrist.current.rotation.x = (busy ? 0.35 : 0.9) + Math.sin(tt * 1.3) * 0.08
    const grip = busy ? 0.18 + Math.abs(Math.sin(tt * 3.1)) * 0.25 : 0.05
    fingers.current.forEach((f, i) => f && (f.rotation.x = (i === 0 ? 1 : -1) * grip))
    if (spark.current) spark.current.intensity = transfer ? (Math.random() > 0.55 ? 2 + Math.random() * 7 : 0.3) : 0
  })

  const seg = (len: number, w: number) => (
    <group>
      <RoundedBox args={[w, len, w]} radius={w * 0.22} smoothness={4} position-y={len / 2} material={m.gunmetal} castShadow receiveShadow />
      {/* Amber cover plates and a glowing status stripe. */}
      <RoundedBox args={[w * 1.04, len * 0.42, w * 0.6]} radius={0.015} smoothness={3} position={[0, len * 0.5, w * 0.24]} material={m.amber} castShadow />
      <mesh position={[side * w * 0.53, len * 0.5, 0]} material={stripe}>
        <boxGeometry args={[0.006, len * 0.6, w * 0.18]} />
      </mesh>
      {/* Hydraulic ram along the back. */}
      <mesh position={[0, len * 0.45, -w * 0.62]} material={m.chrome} castShadow>
        <cylinderGeometry args={[0.022, 0.022, len * 0.7, 16]} />
      </mesh>
      <mesh position={[0, len * 0.22, -w * 0.62]} material={m.graphite}>
        <cylinderGeometry args={[0.036, 0.036, len * 0.32, 16]} />
      </mesh>
    </group>
  )
  const joint = (r: number) => (
    <group rotation-z={Math.PI / 2}>
      <mesh material={m.graphite} castShadow>
        <cylinderGeometry args={[r, r, r * 1.9, 32]} />
      </mesh>
      <mesh material={m.chrome} position-y={r * 0.98}>
        <cylinderGeometry args={[r * 0.55, r * 0.55, 0.02, 32]} />
      </mesh>
      <mesh material={m.chrome} position-y={-r * 0.98}>
        <cylinderGeometry args={[r * 0.55, r * 0.55, 0.02, 32]} />
      </mesh>
    </group>
  )

  return (
    <group position={position}>
      {/* Bolted base plate and turntable. */}
      <mesh material={m.graphite} receiveShadow castShadow position-y={0.04}>
        <cylinderGeometry args={[0.58, 0.62, 0.08, 48]} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return (
          <mesh key={i} material={m.chrome} position={[Math.cos(a) * 0.5, 0.09, Math.sin(a) * 0.5]}>
            <cylinderGeometry args={[0.025, 0.025, 0.025, 12]} />
          </mesh>
        )
      })}
      <mesh position-y={0.085} rotation-x={-Math.PI / 2} material={stripe}>
        <ringGeometry args={[0.4, 0.415, 64]} />
      </mesh>
      <group ref={yaw}>
        <mesh material={m.gunmetal} castShadow position-y={0.2}>
          <cylinderGeometry args={[0.36, 0.42, 0.24, 48]} />
        </mesh>
        <mesh material={m.amber} castShadow position-y={0.42}>
          <boxGeometry args={[0.34, 0.26, 0.3]} />
        </mesh>
        <group position-y={SHOULDER}>
          {joint(0.15)}
          <group ref={shoulder}>
            {seg(L1, 0.2)}
            <group position-y={L1}>
              {joint(0.12)}
              <group ref={elbow}>
                {seg(L2 - 0.3, 0.16)}
                <group position-y={L2 - 0.3}>
                  <mesh material={m.chrome} castShadow>
                    <sphereGeometry args={[0.085, 24, 16]} />
                  </mesh>
                  <group ref={wrist}>
                    <mesh material={m.gunmetal} position-y={0.1} castShadow>
                      <cylinderGeometry args={[0.07, 0.09, 0.16, 24]} />
                    </mesh>
                    {/* Two-finger gripper. */}
                    {[1, -1].map((dir, i) => (
                      <group key={dir} position={[0, 0.18, dir * 0.04]} ref={(el) => void (fingers.current[i] = el)}>
                        <mesh material={m.graphite} position-y={0.08} castShadow>
                          <boxGeometry args={[0.05, 0.16, 0.024]} />
                        </mesh>
                        <mesh material={m.amber} position={[0, 0.17, -dir * 0.012]} castShadow>
                          <boxGeometry args={[0.045, 0.05, 0.02]} />
                        </mesh>
                      </group>
                    ))}
                    <group position-y={0.36}>
                      <pointLight ref={spark} color="#ffd8a8" distance={2.5} decay={2} intensity={0} />
                      {working && <Sparkles count={24} scale={0.35} size={2.2} speed={2.2} color="#ffe2b8" noise={2} />}
                    </group>
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- room

/** Server racks along the back wall; their lights blink with real activity. */
export function Racks() {
  const m = useMaterials()
  const leds = useRef<THREE.InstancedMesh>(null)
  const RACKS = 10
  const ROWS = 18
  const COLS = 3
  const placed = useMemo(() => {
    const out: { x: number; z: number; a: number }[] = []
    for (let i = 0; i < RACKS; i++) {
      const a = Math.PI + (i - (RACKS - 1) / 2) * 0.13
      out.push({ x: Math.sin(a) * 10.2, z: Math.cos(a) * 10.2, a })
    }
    return out
  }, [])
  const ledMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])
  const topGlow = useMemo(() => m.glow('#a78bfa', 1.2), [m])
  const phases = useMemo(() => {
    const r = rng(17)
    return Array.from({ length: RACKS * ROWS * COLS }, () => ({ p: r() * 10, f: 0.4 + r() * 2.2, hue: r() }))
  }, [])
  useEffect(() => {
    const im = leds.current
    if (!im) return
    const o = new THREE.Object3D()
    let n = 0
    for (const rk of placed) {
      for (let row = 0; row < ROWS; row++)
        for (let c = 0; c < COLS; c++) {
          o.position.set(rk.x, 0.45 + row * 0.13, rk.z)
          o.rotation.set(0, rk.a + Math.PI, 0)
          o.translateZ(0.56)
          o.translateX((c - 1) * 0.28)
          o.updateMatrix()
          im.setMatrixAt(n++, o.matrix)
        }
    }
    im.instanceMatrix.needsUpdate = true
  }, [placed])
  const acc = useRef(0)
  const cA = useMemo(() => new THREE.Color('#5eead4'), [])
  const cB = useMemo(() => new THREE.Color('#a78bfa'), [])
  const cC = useMemo(() => new THREE.Color('#f5a524'), [])
  const tmp = useMemo(() => new THREE.Color(), [])
  useFrame((state, dt) => {
    acc.current += dt
    if (acc.current < 0.1 || !leds.current) return
    acc.current = 0
    // Busier when more has happened in the last minute.
    const now = Date.now()
    const recent = useHub.getState().term.filter((l) => now - l.ts < 60000).length
    const busy = Math.min(1, recent / 25)
    const t = state.clock.elapsedTime
    phases.forEach((ph, i) => {
      const on = Math.sin(t * ph.f * (0.6 + busy * 3) + ph.p) > 0.55 - busy * 0.5
      const base = ph.hue < 0.7 ? cA : ph.hue < 0.93 ? cB : cC
      tmp.copy(base).multiplyScalar(on ? 2.4 : 0.08)
      leds.current!.setColorAt(i, tmp)
    })
    if (leds.current.instanceColor) leds.current.instanceColor.needsUpdate = true
  })
  return (
    <group>
      {placed.map((rk, i) => (
        <group key={i} position={[rk.x, 0, rk.z]} rotation-y={rk.a + Math.PI}>
          <RoundedBox args={[1.05, 2.9, 1.0]} radius={0.04} smoothness={3} position-y={1.45} material={m.panel} castShadow receiveShadow />
          <mesh position={[0, 1.45, 0.505]} material={m.graphite}>
            <boxGeometry args={[0.92, 2.7, 0.01]} />
          </mesh>
          <mesh position={[0, 2.82, 0.51]} material={topGlow}>
            <boxGeometry args={[0.9, 0.012, 0.01]} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={leds} args={[undefined, undefined, RACKS * ROWS * COLS]} material={ledMat}>
        <boxGeometry args={[0.16, 0.022, 0.01]} />
      </instancedMesh>
    </group>
  )
}

/** The room: curved back wall with ribs, pillars, ceiling light ring. */
export function Room() {
  const m = useMaterials()
  const strip = useMemo(() => m.glow('#8b7cff', 1.3), [m])
  const cool = useMemo(() => m.glow('#d9e2ff', 2.2), [m])
  const ribs = useMemo(() => Array.from({ length: 23 }, (_, i) => Math.PI + (i - 11) * 0.075), [])
  return (
    <group>
      <mesh position-y={4} receiveShadow>
        <cylinderGeometry args={[11.2, 11.2, 8, 96, 1, true, Math.PI * 0.62, Math.PI * 0.76]} />
        <meshStandardMaterial attach="material" color="#0e0e15" metalness={0.5} roughness={0.7} side={THREE.BackSide} />
      </mesh>
      {ribs.map((a, i) => (
        <group key={i} position={[Math.sin(a) * 11.05, 0, Math.cos(a) * 11.05]} rotation-y={a}>
          <mesh position-y={4} material={m.graphite} castShadow>
            <boxGeometry args={[0.16, 8, 0.3]} />
          </mesh>
          {i % 2 === 0 && (
            <mesh position={[0, 4, 0.16]} material={strip}>
              <boxGeometry args={[0.025, 7.2, 0.01]} />
            </mesh>
          )}
        </group>
      ))}
      {/* Floor-level light line round the wall. */}
      <mesh position-y={0.08} rotation-x={Math.PI / 2}>
        <torusGeometry args={[10.95, 0.02, 6, 256, Math.PI * 0.76]} />
        <meshBasicMaterial color={new THREE.Color('#8b7cff').multiplyScalar(1.6)} toneMapped={false} />
      </mesh>
      {/* Pillars. */}
      {[-1, 1].flatMap((side) =>
        [0.62, 0.8].map((f) => {
          const a = side * Math.PI * f
          return (
            <group key={`${side}${f}`} position={[Math.sin(a) * 8.6, 0, Math.cos(a) * 8.6]} rotation-y={a + Math.PI}>
              <mesh position-y={4} material={m.gunmetal} castShadow receiveShadow>
                <cylinderGeometry args={[0.38, 0.45, 8, 6]} />
              </mesh>
              <mesh position={[0, 4, 0.4]} material={strip}>
                <boxGeometry args={[0.04, 6.5, 0.01]} />
              </mesh>
            </group>
          )
        }),
      )}
      {/* Ceiling light ring over the table. */}
      <mesh position-y={7.6} rotation-x={Math.PI / 2} material={cool}>
        <torusGeometry args={[3.2, 0.05, 12, 160]} />
      </mesh>
      <mesh position-y={7.65} rotation-x={Math.PI / 2} material={m.graphite}>
        <torusGeometry args={[3.2, 0.14, 12, 160]} />
      </mesh>
    </group>
  )
}

/**
 * The rest of the room, for walking it: the front of the curved wall with a
 * row of tall windows, and the ceiling with its lamps. (From the overview
 * the camera is outside this line, so it's only built when you're inside.)
 */
export function RoomShell() {
  const m = useMaterials()
  const glass = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffeccc').multiplyScalar(1.25), toneMapped: false }), [])
  const lamp = useMemo(() => m.glow('#e8eeff', 2), [m])
  const windows = useMemo(() => Array.from({ length: 9 }, (_, i) => Math.PI * 1.5 + (i / 8) * Math.PI), [])
  return (
    <group>
      <mesh position-y={4} receiveShadow>
        <cylinderGeometry args={[11.2, 11.2, 8, 96, 1, true, Math.PI * 1.38, Math.PI * 1.24]} />
        <meshStandardMaterial attach="material" color="#15161f" metalness={0.4} roughness={0.75} side={THREE.BackSide} />
      </mesh>
      {windows.map((a) => (
        <group key={a} position={[Math.sin(a) * 11.12, 0, Math.cos(a) * 11.12]} rotation-y={a + Math.PI}>
          <mesh position-y={3.9} material={glass}>
            <planeGeometry args={[2.2, 2.6]} />
          </mesh>
          <mesh position={[0, 3.9, 0.02]} material={m.graphite}>
            <boxGeometry args={[0.06, 2.6, 0.04]} />
          </mesh>
          <mesh position={[0, 5.24, 0.02]} material={m.graphite}>
            <boxGeometry args={[2.3, 0.1, 0.06]} />
          </mesh>
        </group>
      ))}
      <mesh position-y={8} rotation-x={Math.PI / 2}>
        <circleGeometry args={[11.2, 96]} />
        <meshStandardMaterial attach="material" color="#0b0b12" metalness={0.3} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.sin(a) * 6.6, 7.96, Math.cos(a) * 6.6]} rotation-x={Math.PI / 2} material={lamp}>
            <circleGeometry args={[0.32, 32]} />
          </mesh>
        )
      })}
    </group>
  )
}

/** The latest studio render on a big floating screen behind the core. */
export function BackScreen() {
  const m = useMaterials()
  const previews = useHub((s) => s.state?.previews)
  const file = useMemo(() => {
    const list = Object.values(previews ?? {}).filter((p) => p.kind === 'ASSET' && p.file)
    list.sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0))
    return list[0]?.file ?? null
  }, [previews])
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!file) return
    let live = true
    new THREE.TextureLoader().load(
      fileUrl(file),
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = 8
        if (live) setTex(t)
        else t.dispose()
      },
      undefined,
      () => {},
    )
    return () => {
      live = false
    }
  }, [file])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#8f88b8', transparent: true, opacity: 0.6, toneMapped: false }), [])
  const underline = useMemo(() => m.glow('#a78bfa', 1.6), [m])
  useEffect(() => {
    mat.map = tex
    mat.needsUpdate = true
  }, [mat, tex])
  if (!tex) return null
  const aspect = (tex.image as HTMLImageElement | undefined)?.width ? (tex.image as HTMLImageElement).width / (tex.image as HTMLImageElement).height : 16 / 9
  const h = 2.5
  return (
    <group position={[0, 4.9, -7.6]}>
      <RoundedBox args={[h * aspect + 0.24, h + 0.24, 0.12]} radius={0.05} smoothness={3} position-z={-0.08} material={m.graphite} castShadow />
      <mesh material={mat}>
        <planeGeometry args={[h * aspect, h]} />
      </mesh>
      <mesh position={[0, -h / 2 - 0.2, 0]} material={underline}>
        <boxGeometry args={[h * aspect * 0.6, 0.012, 0.01]} />
      </mesh>
    </group>
  )
}
