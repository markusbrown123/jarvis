import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, RoundedBox, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { useHub, fileUrl } from '../hub/client'
import type { Job } from '../hub/types'
import { C, crystalGeometry, nucleusGeometry, pointFrag, pointVert, rng, shellFrag, shellVert } from '../scene/crystal'
import { CORE_Y, motion, stateColor, useMaterials } from './shared'

/**
 * The station's models, all built from geometry here — nothing downloaded.
 * Each one reads live state: the core's colour is JARVIS's state, the arms
 * reach in while he works, each drone is a running job, rack lights blink
 * with how much is happening, the back screen shows the latest studio render.
 */

// ---------------------------------------------------------------- holo table

function gridTexture() {
  const size = 1024
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')!
  const c = size / 2
  g.strokeStyle = '#fff'
  g.fillStyle = '#fff'
  g.lineWidth = 2
  for (const r of [0.18, 0.3, 0.42, 0.47]) {
    g.globalAlpha = r === 0.47 ? 0.9 : 0.45
    g.beginPath()
    g.arc(c, c, r * size, 0, Math.PI * 2)
    g.stroke()
  }
  // Ticks round the rim, longer every tenth.
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2
    const long = i % 10 === 0
    const r0 = (long ? 0.43 : 0.445) * size
    g.globalAlpha = long ? 0.9 : 0.5
    g.beginPath()
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
    g.lineTo(c + Math.cos(a) * 0.465 * size, c + Math.sin(a) * 0.465 * size)
    g.stroke()
  }
  // Radial spokes and arc segments: an instrument dial, not a dartboard.
  g.globalAlpha = 0.28
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    g.beginPath()
    g.moveTo(c + Math.cos(a) * 0.19 * size, c + Math.sin(a) * 0.19 * size)
    g.lineTo(c + Math.cos(a) * 0.41 * size, c + Math.sin(a) * 0.41 * size)
    g.stroke()
  }
  g.lineWidth = 7
  g.globalAlpha = 0.7
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    g.beginPath()
    g.arc(c, c, 0.36 * size, a, a + 0.55)
    g.stroke()
  }
  g.lineWidth = 2
  // Dot field in the centre.
  const r = rng(3)
  g.globalAlpha = 0.5
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2
    const d = Math.sqrt(r()) * 0.16 * size
    g.fillRect(c + Math.cos(a) * d, c + Math.sin(a) * d, 2, 2)
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

const beamVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const beamFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLevel;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float edge = pow(1.0 - abs(dot(vN, vV)), 1.6);
    float rise = pow(1.0 - vUv.y, 1.3);
    float scan = 0.75 + 0.25 * sin(vUv.y * 90.0 - uTime * 6.0);
    float streak = 0.6 + 0.4 * sin(vUv.x * 120.0 + uTime * 0.7);
    float a = (0.05 + edge * 0.5) * rise * scan * streak * (0.55 + uLevel * 0.9);
    gl_FragColor = vec4(uColor * (1.4 + uLevel), a);
  }
`

export function HoloTable() {
  const m = useMaterials()
  const top = useRef<THREE.Mesh>(null)
  const grid = useMemo(gridTexture, [])
  const trims = useMemo(() => [m.glow('#a78bfa', 1.6), m.glow('#a78bfa', 1.2)], [m])
  const topMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: grid, color: '#a78bfa', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [grid],
  )
  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        uniforms: { uColor: { value: new THREE.Color('#a78bfa') }, uTime: { value: 0 }, uLevel: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  // The pedestal's silhouette, turned on a lathe: a stepped foot, a waisted
  // column with a collar, and a flared top with a lip.
  const profile = useMemo(() => {
    const p = [
      [0, 0],
      [1.78, 0],
      [1.8, 0.04],
      [1.74, 0.1],
      [1.52, 0.13],
      [1.46, 0.2],
      [1.0, 0.26],
      [0.82, 0.36],
      [0.74, 0.55],
      [0.8, 0.6],
      [0.8, 0.66],
      [0.72, 0.7],
      [0.9, 0.82],
      [1.48, 0.92],
      [1.62, 0.95],
      [1.66, 0.99],
      [1.6, 1.01],
      [0, 1.01],
    ]
    return p.map(([x, y]) => new THREE.Vector2(x, y))
  }, [])
  const col = useMemo(() => new THREE.Color('#a78bfa'), [])
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt * motion()
    stateColor(col, Math.min(1, dt * 3))
    const { level, phase } = useStore.getState()
    const live = phase === 'listening' || phase === 'speaking'
    topMat.color.copy(col)
    trims[0].color.copy(col).multiplyScalar(1.8)
    trims[1].color.copy(col).multiplyScalar(1.1 + (live ? level : 0) * 2)
    beamMat.uniforms.uColor.value.copy(col)
    beamMat.uniforms.uTime.value = t.current
    beamMat.uniforms.uLevel.value += ((live ? level : 0.05) - beamMat.uniforms.uLevel.value) * Math.min(1, dt * 8)
    if (top.current) top.current.rotation.z += dt * 0.05 * motion()
  })
  return (
    <group>
      <mesh castShadow receiveShadow material={m.gunmetal}>
        <latheGeometry args={[profile, 128]} />
      </mesh>
      {/* Glowing trim at the foot and the lip. */}
      <mesh position-y={0.14} rotation-x={Math.PI / 2} material={trims[1]}>
        <torusGeometry args={[1.5, 0.012, 8, 160]} />
      </mesh>
      <mesh position-y={0.975} rotation-x={Math.PI / 2} material={trims[0]}>
        <torusGeometry args={[1.645, 0.014, 8, 192]} />
      </mesh>
      {/* Vertical service seams round the column. */}
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 0.79, 0.47, Math.sin(a) * 0.79]} rotation-y={-a} material={m.graphite}>
            <boxGeometry args={[0.02, 0.2, 0.05]} />
          </mesh>
        )
      })}
      {/* Projector lens. */}
      <mesh position-y={1.03} material={m.chrome}>
        <cylinderGeometry args={[0.22, 0.28, 0.06, 48]} />
      </mesh>
      <mesh position-y={1.065} material={trims[0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.012, 48]} />
      </mesh>
      {/* The dial projected on the top. */}
      <mesh ref={top} position-y={1.02} rotation-x={-Math.PI / 2} material={topMat}>
        <circleGeometry args={[1.56, 96]} />
      </mesh>
      {/* Light rising to the core. */}
      <mesh position-y={1.02 + (CORE_Y - 1.02) / 2} material={beamMat}>
        <cylinderGeometry args={[1.05, 0.2, CORE_Y - 1.02, 64, 1, true]} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- the core

export function StationCore() {
  const lowPower = useHub.getState().prefs.graphics === 'low'
  const crystal = useMemo(crystalGeometry, [])
  const nucleus = useMemo(() => nucleusGeometry(lowPower ? 800 : 2600), [lowPower])
  const m = useMaterials()
  const spin = useRef<THREE.Group>(null)
  const gyro = useRef<(THREE.Group | null)[]>([])
  const light = useRef<THREE.PointLight>(null)
  const ringMat = useMemo(() => m.glow('#a78bfa', 2), [m])
  const coilMat = useMemo(() => m.glow('#a78bfa', 1.3), [m])
  const nucleusMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pointVert,
        fragmentShader: pointFrag,
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uSize: { value: 2.4 }, uMotion: { value: 1 }, uColor: { value: new THREE.Color('#c4b5fd') }, uAlpha: { value: 0.95 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: shellVert,
        fragmentShader: shellFrag,
        uniforms: { uRim: { value: new THREE.Color('#a78bfa') }, uInner: { value: new THREE.Color('#1e1036') }, uOpacity: { value: 0.8 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const edgeMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#d8ccff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const col = useMemo(() => new THREE.Color('#a78bfa'), [])
  const d = useRef({ level: 0, spin: 0.2, t: 0 })

  // Coils round the reactor ring: the arc-reactor look, in the state colour.
  const coils = useMemo(() => Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2), [])

  useFrame((_, dt) => {
    const { phase, level } = useStore.getState()
    const mo = motion()
    const k = Math.min(1, dt * 3)
    stateColor(col, k)
    const live = phase === 'listening' || phase === 'speaking' || phase === 'waking'
    const busy = phase === 'thinking' || phase === 'tooling'
    const s = d.current
    s.level += ((live ? level : busy ? 0.2 : 0.03) - s.level) * Math.min(1, dt * 10)
    s.spin += ((busy ? 1.1 : live ? 0.4 : 0.16) - s.spin) * k
    s.t += dt * mo
    if (spin.current) {
      spin.current.rotation.y += dt * s.spin * mo
      spin.current.rotation.x = Math.sin(s.t * 0.21) * 0.16
      spin.current.scale.setScalar(0.62 * (1 + s.level * 0.12))
    }
    gyro.current.forEach((g, i) => {
      if (!g) return
      const dir = i % 2 ? -1 : 1
      g.rotation.z += dt * (0.18 + i * 0.07) * dir * mo * (busy ? 3 : 1)
      g.rotation.x += dt * 0.05 * (i + 1) * mo * (busy ? 2 : 1)
    })
    ringMat.color.copy(col).multiplyScalar(2.2 + s.level * 2)
    coilMat.color.copy(col).multiplyScalar(1.1 + s.level * 1.5)
    shellMat.uniforms.uRim.value.copy(C.violet).lerp(col, 0.25)
    shellMat.uniforms.uOpacity.value = 0.6 + s.level * 0.4
    edgeMat.color.copy(C.violet).lerp(C.white, 0.35).lerp(col, 0.2)
    nucleusMat.uniforms.uTime.value = s.t
    nucleusMat.uniforms.uLevel.value = s.level
    nucleusMat.uniforms.uMotion.value = mo
    nucleusMat.uniforms.uColor.value.copy(phase === 'speaking' ? C.cyan : C.white).lerp(col, 0.25)
    if (light.current) {
      light.current.color.copy(col)
      light.current.intensity = 14 + s.level * 40 + (busy ? 6 : 0)
    }
  })

  return (
    <group position-y={CORE_Y}>
      <pointLight ref={light} distance={10} decay={2} intensity={14} />
      <group ref={spin}>
        <points geometry={nucleus} material={nucleusMat} />
        <mesh geometry={crystal.faceted} material={shellMat} />
        <lineSegments geometry={crystal.edges} material={edgeMat} />
      </group>
      {/* The reactor ring: metal housing, glowing core line, twelve coils. */}
      <group rotation-x={Math.PI / 2}>
        <mesh material={m.gunmetal} castShadow>
          <torusGeometry args={[1.12, 0.06, 20, 160]} />
        </mesh>
        <mesh material={ringMat}>
          <torusGeometry args={[1.12, 0.018, 8, 200]} />
        </mesh>
        {coils.map((a, i) => (
          <group key={i} position={[Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0]} rotation-z={a}>
            <RoundedBox args={[0.1, 0.2, 0.16]} radius={0.02} smoothness={3} material={m.graphite} castShadow />
            <mesh material={coilMat} position-x={-0.051}>
              <boxGeometry args={[0.004, 0.14, 0.1]} />
            </mesh>
          </group>
        ))}
      </group>
      {/* A gyroscope of thin rings round it. */}
      {[1.42, 1.62, 1.8].map((r, i) => (
        <group key={r} ref={(el) => void (gyro.current[i] = el)} rotation={[i * 0.9, i * 0.4, 0]}>
          <mesh material={i === 1 ? m.chrome : m.gunmetal}>
            <torusGeometry args={[r, i === 1 ? 0.012 : 0.02, 10, 200, Math.PI * (1.2 + i * 0.25)]} />
          </mesh>
          <mesh material={ringMat} rotation-z={Math.PI * 1.35}>
            <torusGeometry args={[r, 0.006, 6, 120, Math.PI * 0.35]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- robot arm

const L1 = 1.35
const L2 = 1.25
const SHOULDER = 0.62

/**
 * An articulated workshop arm. Two-link IK in its vertical plane reaches the
 * claw tip for a target; it idles folded and swaying, and reaches in to the
 * core to "work" while JARVIS is thinking or a job of his is running.
 */
export function RobotArm({ position, side, seed }: { position: [number, number, number]; side: 1 | -1; seed: number }) {
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
  const t = useRef(seed * 10)

  useFrame((_, dt) => {
    const mo = motion()
    t.current += dt * mo
    const tt = t.current
    const { phase } = useStore.getState()
    const s = useHub.getState().state
    const jobs = s ? Object.values(s.jobs).some((j) => j.source === 'jarvis' && j.state === 'running') : false
    const busy = phase === 'thinking' || phase === 'tooling' || jobs
    if (busy !== working) setWorking(busy)

    // Where the claw should be, in world space.
    if (busy) {
      // At the core's flank, with small deliberate "tool" moves.
      want.set(side * 0.95 + Math.sin(tt * 2.3 + seed) * 0.06, CORE_Y - 0.15 + Math.sin(tt * 1.7) * 0.08, 0.35 + Math.cos(tt * 1.9 + seed) * 0.06)
    } else {
      // Folded beside its base, breathing.
      want.set(position[0] - side * 0.2, 1.25 + Math.sin(tt * 0.6 + seed) * 0.08, position[2] - 0.65 + Math.sin(tt * 0.4) * 0.05)
    }
    if (target.lengthSq() === 0) target.copy(want)
    target.lerp(want, Math.min(1, dt * (busy ? 1.6 : 0.9)))

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
    if (spark.current) spark.current.intensity = busy ? (Math.random() > 0.55 ? 2 + Math.random() * 7 : 0.3) : 0
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

// ---------------------------------------------------------------- drones

const DRONE_COLOR: Record<string, string> = {
  running: '#a78bfa',
  needs_markus: '#f59e0b',
  waiting: '#5eead4',
  queued: '#6b6488',
  retrying: '#f59e0b',
  cancel_requested: '#f59e0b',
  failed: '#ef4444',
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

function Drone({ job, index, onOpen }: { job: Job; index: number; onOpen: () => void }) {
  const m = useMaterials()
  const g = useRef<THREE.Group>(null)
  const rotors = useRef<(THREE.Mesh | null)[]>([])
  const [hover, setHover] = useState(false)
  const color = job.stale ? '#ef4444' : (DRONE_COLOR[job.state] ?? '#a78bfa')
  const glow = useMemo(() => m.glow(color, 2.2), [m, color])
  const eye = useMemo(() => m.glow('#5eead4', 3), [m])
  const h = hash(job.id)
  const orbit = useMemo(() => ({ r: 2.3 + h * 1.1 + (index % 3) * 0.25, y: CORE_Y - 0.4 + ((index * 0.37) % 1) * 1.6, speed: (0.12 + h * 0.12) * (index % 2 ? 1 : -1), phase: h * Math.PI * 2, tilt: (h - 0.5) * 0.5 }), [h, index])
  const prev = useMemo(() => new THREE.Vector3(), [])
  useFrame((state, dt) => {
    const mo = motion()
    const t = state.clock.elapsedTime * mo
    const a = orbit.phase + t * orbit.speed * (job.state === 'running' ? 1 : 0.35)
    const x = Math.cos(a) * orbit.r
    const z = Math.sin(a) * orbit.r
    const y = orbit.y + Math.sin(t * 1.3 + orbit.phase) * 0.12 + Math.sin(a) * orbit.tilt
    if (g.current) {
      prev.copy(g.current.position)
      g.current.position.set(x, y, z)
      // Face the direction of travel, banking a little into the turn.
      g.current.rotation.y = Math.atan2(x - prev.x, z - prev.z)
      g.current.rotation.z = orbit.speed > 0 ? -0.18 : 0.18
    }
    rotors.current.forEach((r) => r && (r.rotation.y += dt * 40))
  })
  return (
    <group
      ref={g}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHover(true)
      }}
      onPointerOut={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      <mesh material={m.gunmetal} scale={[1, 0.5, 1.25]} castShadow>
        <sphereGeometry args={[0.15, 32, 16]} />
      </mesh>
      <mesh material={glow} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.2, 0.014, 8, 48]} />
      </mesh>
      <mesh material={eye} position={[0, 0, 0.17]}>
        <sphereGeometry args={[0.032, 16, 12]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = Math.PI / 4 + (i * Math.PI) / 2
        return (
          <group key={i} position={[Math.cos(a) * 0.27, 0.02, Math.sin(a) * 0.27]}>
            <mesh material={m.graphite} rotation-y={-a} position={[-Math.cos(a) * 0.06, 0, -Math.sin(a) * 0.06]}>
              <boxGeometry args={[0.12, 0.018, 0.022]} />
            </mesh>
            <mesh ref={(el) => void (rotors.current[i] = el)} material={m.chrome} position-y={0.03}>
              <boxGeometry args={[0.16, 0.004, 0.02]} />
            </mesh>
          </group>
        )
      })}
      {hover && (
        <Html center distanceFactor={7} zIndexRange={[40, 30]} position-y={0.45}>
          <div className="drone-tip">
            <b>{job.taskId ?? job.worker ?? job.source}</b> {job.title}
            <span>{job.stale ? 'no heartbeat' : job.state.replace('_', ' ')}{job.stage ? ` · ${job.stage}` : ''}</span>
          </div>
        </Html>
      )}
    </group>
  )
}

export function Drones() {
  const jobs = useHub((s) => s.state?.jobs)
  const go = useHub((s) => s.go)
  const list = useMemo(
    () =>
      Object.values(jobs ?? {})
        .filter((j) => ['running', 'needs_markus', 'retrying', 'cancel_requested'].includes(j.state))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 12),
    [jobs],
  )
  return (
    <>
      {list.map((j, i) => (
        <Drone key={j.id} job={j} index={i} onOpen={() => go('jobs')} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------- room

const hexFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec3 vPos;
  float hexd(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
  void main() {
    vec2 p = vPos.xz * 1.15;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    float d = hexd(gv);
    float line = smoothstep(0.455, 0.5, d);
    float dist = length(vPos.xz);
    float fade = smoothstep(15.0, 3.0, dist) * smoothstep(1.7, 2.6, dist);
    float wave = 0.55 + 0.45 * sin(dist * 1.3 - uTime * 1.2);
    gl_FragColor = vec4(uColor * line * fade * (0.18 + 0.22 * wave), 1.0);
  }
`

export function FloorMarks() {
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#a78bfa').multiplyScalar(1.5), toneMapped: false, transparent: true, opacity: 0.85 }), [])
  const hexMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vPos; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: hexFrag,
        uniforms: { uColor: { value: new THREE.Color('#7c5cf0') }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const ticks = useRef<THREE.InstancedMesh>(null)
  const ring = useRef<THREE.Group>(null)
  const col = useMemo(() => new THREE.Color('#a78bfa'), [])
  useEffect(() => {
    const im = ticks.current
    if (!im) return
    const o = new THREE.Object3D()
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2
      const long = i % 10 === 0
      o.position.set(Math.cos(a) * 3.15, 0, Math.sin(a) * 3.15)
      o.rotation.set(0, -a, 0)
      o.scale.set(long ? 0.32 : 0.14, 1, 1)
      o.updateMatrix()
      im.setMatrixAt(i, o.matrix)
    }
    im.instanceMatrix.needsUpdate = true
  }, [])
  useFrame((state, dt) => {
    stateColor(col, Math.min(1, dt * 3))
    ringMat.color.copy(col).multiplyScalar(1.4)
    hexMat.uniforms.uTime.value = state.clock.elapsedTime * motion()
    if (ring.current) ring.current.rotation.y -= dt * 0.03 * motion()
  })
  return (
    <group position-y={0.006}>
      <mesh rotation-x={-Math.PI / 2} material={hexMat}>
        <circleGeometry args={[16, 64]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} material={ringMat} position-y={0.002}>
        <ringGeometry args={[2.25, 2.28, 160]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} material={ringMat} position-y={0.002}>
        <ringGeometry args={[3.55, 3.565, 192]} />
      </mesh>
      <group ref={ring}>
        <instancedMesh ref={ticks} args={[undefined, undefined, 120]} material={ringMat}>
          <boxGeometry args={[1, 0.002, 0.018]} />
        </instancedMesh>
      </group>
    </group>
  )
}

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
