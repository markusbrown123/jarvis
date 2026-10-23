import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { COL, reactorState, useMaterials } from './shared'
import { useStation } from './stationStore'
import { BASE } from './layout'
import { Blob } from './floor'

/**
 * The reactor: JARVIS himself. Every motion is a state:
 * - standby: slow blue-violet rotation
 * - listening: orange, the sphere breathing with the microphone level
 * - thinking / working: violet, rings accelerate, the conduits flow inward
 * - speaking: cyan, pulsing with his actual output level
 * - needs input: an amber halo over the core (and the path to Needs Markus)
 * - completed: a ring of light leaves the core when a job finishes
 * - error: a red segment on the base ring only — the rest stays readable
 */

export const SPHERE_Y = 2.45
const DECK = 0.16

const sphereVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vP = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const sphereFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLevel;
  uniform float uBusy;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
    // Slow latitudinal energy bands; faster and denser while thinking.
    float bands = 0.5 + 0.5 * sin(vP.y * (14.0 + uBusy * 10.0) - uTime * (1.2 + uBusy * 3.0) + sin(vP.x * 6.0 + uTime) * 0.8);
    float core = 1.0 - smoothstep(0.0, 0.9, f);
    vec3 c = uColor * (0.55 + 0.9 * uLevel) * (0.35 + 0.65 * bands) + uColor * f * 2.2 + vec3(1.0) * core * 0.18 * (0.6 + uLevel);
    gl_FragColor = vec4(c, 0.55 + f * 0.45);
  }
`

const flowVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const flowFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uBright;
  varying vec2 vUv;
  void main() {
    float packets = pow(fract(vUv.x * 4.0 - uTime * uSpeed), 6.0);
    float base = 0.25;
    gl_FragColor = vec4(uColor * (base + packets * 2.4) * uBright, 1.0);
  }
`

/** The layered mounting platform, three tiers with lit edges and ribs. */
function Platform({ glow }: { glow: THREE.MeshBasicMaterial }) {
  const m = useMaterials()
  const profile = useMemo(
    () =>
      [
        [0, 0],
        [BASE, 0],
        [BASE + 0.02, 0.05],
        [BASE - 0.02, 0.2],
        [1.62, 0.22],
        [1.6, 0.4],
        [1.18, 0.42],
        [1.16, 0.62],
        [0.78, 0.64],
        [0.74, 0.86],
        [0, 0.86],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  )
  const setRibs = (im: THREE.InstancedMesh | null) => {
    if (!im || im.userData.done) return
    const o = new THREE.Object3D()
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      o.position.set(Math.cos(a) * 1.82, 0.3, Math.sin(a) * 1.82)
      o.rotation.set(0, -a, 0)
      o.updateMatrix()
      im.setMatrixAt(i, o.matrix)
    }
    im.instanceMatrix.needsUpdate = true
    im.userData.done = true
  }
  return (
    <group position-y={DECK}>
      <mesh material={m.gunmetal} castShadow receiveShadow>
        <latheGeometry args={[profile, 96]} />
      </mesh>
      {[
        [BASE - 0.01, 0.205],
        [1.6, 0.405],
        [1.16, 0.625],
      ].map(([r, y]) => (
        <mesh key={r} rotation-x={Math.PI / 2} position-y={y} material={glow}>
          <torusGeometry args={[r, 0.012, 6, 160]} />
        </mesh>
      ))}
      <instancedMesh ref={setRibs} args={[undefined, undefined, 24]} material={m.graphite} castShadow>
        <boxGeometry args={[0.36, 0.16, 0.05]} />
      </instancedMesh>
    </group>
  )
}

export function Reactor() {
  const m = useMaterials()
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }), [])
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false, transparent: true, opacity: 0.85 }), [])
  const holoMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#8fb4ff', toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), [])
  const amberMat = useMemo(() => new THREE.MeshBasicMaterial({ color: COL.amber, toneMapped: false, transparent: true, opacity: 0, depthWrite: false }), [])
  const errMat = useMemo(() => new THREE.MeshBasicMaterial({ color: COL.red, toneMapped: false, transparent: true, opacity: 0, depthWrite: false }), [])
  const waveMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#b9f5d0', toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), [])
  const sphereMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: sphereVert,
        fragmentShader: sphereFrag,
        uniforms: { uColor: { value: new THREE.Color('#7c8bff') }, uTime: { value: 0 }, uLevel: { value: 0 }, uBusy: { value: 0 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  )
  const flowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: flowVert,
        fragmentShader: flowFrag,
        uniforms: { uColor: { value: new THREE.Color('#7c8bff') }, uTime: { value: 0 }, uSpeed: { value: 0.2 }, uBright: { value: 0.8 } },
        toneMapped: false,
      }),
    [],
  )
  // Power conduits from the platform up to the sphere housing.
  const conduits = useMemo(
    () =>
      [45, 135, 225, 315].map((deg) => {
        const a = (deg * Math.PI) / 180
        const c = new THREE.CubicBezierCurve3(
          new THREE.Vector3(Math.cos(a) * 1.45, DECK + 0.62, Math.sin(a) * 1.45),
          new THREE.Vector3(Math.cos(a) * 1.55, DECK + 1.3, Math.sin(a) * 1.55),
          new THREE.Vector3(Math.cos(a) * 0.95, SPHERE_Y - 0.6, Math.sin(a) * 0.95),
          new THREE.Vector3(Math.cos(a) * 0.58, SPHERE_Y - 0.25, Math.sin(a) * 0.58),
        )
        return new THREE.TubeGeometry(c, 48, 0.045, 10, false)
      }),
    [],
  )
  const lattice = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.34, 1)), [])
  const latticeMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, toneMapped: false }), [])

  const gyro = useRef<(THREE.Group | null)[]>([])
  const stack = useRef<(THREE.Mesh | null)[]>([])
  const latt = useRef<THREE.LineSegments>(null)
  const sphere = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const halo = useRef<THREE.Mesh>(null)
  const wave = useRef<THREE.Mesh>(null)
  const col = useMemo(() => new THREE.Color('#7c8bff'), [])
  const d = useRef({ level: 0, spin: 0.2, busy: 0, t: 0 })

  useFrame((_, dt) => {
    const st = reactorState()
    const reduced = useHub.getState().prefs.reducedMotion
    const mo = reduced ? 0.12 : 1
    const k = Math.min(1, dt * 3)
    const s = d.current
    col.lerp(st.color, k)
    s.level += (st.level - s.level) * Math.min(1, dt * 12)
    s.busy += ((st.busy ? 1 : 0) - s.busy) * k
    s.spin += ((st.busy ? 1.2 : st.live ? 0.45 : 0.15) - s.spin) * k
    s.t += dt * mo
    const t = s.t
    glow.color.copy(col).multiplyScalar(1.4)
    ringMat.color.copy(col).multiplyScalar(1.8 + s.level * 1.5)
    holoMat.color.copy(col).lerp(COL.white, 0.25)
    flowMat.uniforms.uColor.value.copy(col)
    flowMat.uniforms.uTime.value = t
    // Inward flow means data converging on the core.
    flowMat.uniforms.uSpeed.value = -(0.15 + s.busy * 1.1)
    flowMat.uniforms.uBright.value = 0.5 + s.busy * 0.8 + s.level
    sphereMat.uniforms.uColor.value.copy(col)
    sphereMat.uniforms.uTime.value = t
    sphereMat.uniforms.uLevel.value = s.level
    sphereMat.uniforms.uBusy.value = s.busy
    if (sphere.current) sphere.current.scale.setScalar(1 + s.level * 0.16 + Math.sin(t * 1.6) * 0.012)
    if (latt.current) {
      latt.current.rotation.y += dt * (0.3 + s.busy * 1.5) * mo
      latt.current.rotation.x += dt * 0.11 * mo
    }
    gyro.current.forEach((g, i) => {
      if (!g) return
      g.rotation.y += dt * (0.25 + i * 0.1) * (i % 2 ? -1 : 1) * s.spin * 2 * mo
      g.rotation.z = Math.sin(t * 0.3 + i) * 0.25
    })
    stack.current.forEach((r, i) => {
      if (!r) return
      r.rotation.z += dt * (0.12 + i * 0.05) * (i % 2 ? -1 : 1) * (1 + s.busy * 3) * mo
      r.position.y = DECK + 1.15 + i * 0.62 + Math.sin(t * 0.8 + i) * 0.03 * mo
    })
    if (light.current) {
      light.current.color.copy(col)
      light.current.intensity = 10 + s.level * 30 + s.busy * 8
    }
    // Needs input: amber halo while anything is waiting on Markus.
    const model = useStation.getState().model
    const waiting = (model?.items.length ?? 0) > 0 || (model?.jobs.waiting.length ?? 0) > 0
    amberMat.opacity += ((waiting ? 0.55 + Math.sin(t * 2.2) * 0.2 * mo : 0) - amberMat.opacity) * k
    if (halo.current) halo.current.visible = amberMat.opacity > 0.01
    // Error: a red segment on the base ring — local, not the whole room.
    errMat.opacity += ((st.error || model?.zones.core.state === 'error' ? 0.9 : 0) - errMat.opacity) * k
    // Completed: a ring of light leaves the core.
    const ev = useStation.getState().events
    const last = [...ev].reverse().find((e) => e.kind === 'complete')
    const age = last ? (performance.now() - last.at) / 1000 : 99
    if (wave.current) {
      wave.current.visible = age < 1.6
      wave.current.scale.setScalar(0.6 + age * 2.6)
      waveMat.opacity = Math.max(0, 1 - age / 1.6) * 0.9
    }
  })

  return (
    <group>
      <Blob radius={2.9} opacity={0.8} />
      <Platform glow={glow} />
      {/* Error segment on the outer base ring. */}
      <mesh rotation-x={Math.PI / 2} position-y={DECK + 0.21} material={errMat}>
        <torusGeometry args={[BASE + 0.02, 0.03, 6, 48, Math.PI / 3]} />
      </mesh>
      {/* Emitter column and its glass sleeve. */}
      <mesh position-y={DECK + 1.25} material={m.gunmetal} castShadow>
        <cylinderGeometry args={[0.2, 0.32, 0.8, 32]} />
      </mesh>
      <mesh position-y={DECK + 1.62} material={m.chrome}>
        <cylinderGeometry args={[0.3, 0.3, 0.06, 32]} />
      </mesh>
      {conduits.map((g, i) => (
        <mesh key={i} geometry={g} material={flowMat} />
      ))}
      {/* The sphere and its lattice. */}
      <mesh ref={sphere} position-y={SPHERE_Y} material={sphereMat}>
        <sphereGeometry args={[0.52, 64, 48]} />
      </mesh>
      <lineSegments ref={latt} position-y={SPHERE_Y} geometry={lattice} material={latticeMat} />
      <pointLight ref={light} position-y={SPHERE_Y} distance={12} decay={2} intensity={10} />
      {/* Two mechanical gyroscope rings with coils. */}
      {[0.82, 1.0].map((r, i) => (
        <group key={r} position-y={SPHERE_Y} ref={(g) => void (gyro.current[i] = g)} rotation-x={i ? 1.1 : 0.4}>
          <mesh material={m.gunmetal} castShadow>
            <torusGeometry args={[r, 0.035, 16, 96]} />
          </mesh>
          <mesh material={ringMat}>
            <torusGeometry args={[r, 0.008, 6, 128]} />
          </mesh>
          {Array.from({ length: 8 }, (_, j) => {
            const a = (j / 8) * Math.PI * 2
            return (
              <mesh key={j} position={[Math.cos(a) * r, Math.sin(a) * r, 0]} rotation-z={a} material={m.graphite} castShadow>
                <boxGeometry args={[0.08, 0.13, 0.11]} />
              </mesh>
            )
          })}
        </group>
      ))}
      {/* Stack of holographic rings rising through the core. */}
      {[0.95, 1.35, 1.6, 1.35, 0.95].map((r, i) => (
        <mesh key={i} ref={(el) => void (stack.current[i] = el)} rotation-x={-Math.PI / 2} position-y={DECK + 1.15 + i * 0.62} material={holoMat}>
          <ringGeometry args={[r, r + (i === 2 ? 0.05 : 0.025), 128, 1, 0, Math.PI * (1.3 + (i % 3) * 0.2)]} />
        </mesh>
      ))}
      {/* Needs input: amber halo above the core. */}
      <mesh ref={halo} rotation-x={-Math.PI / 2} position-y={SPHERE_Y + 1.05} material={amberMat}>
        <ringGeometry args={[0.42, 0.5, 64]} />
      </mesh>
      {/* Completion wave. */}
      <mesh ref={wave} rotation-x={-Math.PI / 2} position-y={DECK + 0.25} material={waveMat} visible={false}>
        <ringGeometry args={[0.95, 1, 96]} />
      </mesh>
    </group>
  )
}
