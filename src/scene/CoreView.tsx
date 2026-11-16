import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { useStore } from '../store'
import { useHub } from '../hub/client'
import { Orbits } from './Orbits'
import { C, crystalGeometry, nucleusGeometry, pointFrag, pointVert, ringFor, rng, shellFrag, shellVert } from './crystal'

/**
 * JARVIS's core: an asymmetric crystal around a particle nucleus, a thin
 * state ring, and filaments that orbit it.
 *
 * Every effect reports something real. The ring's colour is the state
 * (violet idle, orange listening, violet-bright thinking, cyan speaking,
 * amber when something needs Markus, red on an error). The filaments move
 * with the microphone while listening and with his actual output level while
 * speaking. Background work shows as light travelling along them. Nothing
 * animates for decoration alone, and reduced motion slows it to a near stop.
 *
 * `compact` sits behind the overview constellation; `immersive` is the full
 * voice view with the nebula and the long tendrils.
 */

type Mode = 'compact' | 'immersive'

// ---------------------------------------------------------------- shaders

const lineVert = /* glsl */ `
  attribute float aU;
  varying float vU;
  void main() {
    vU = aU;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const lineFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uBase;
  uniform float uPulse;
  uniform float uAlpha;
  varying float vU;
  void main() {
    float head = fract(vU - uTime * uSpeed);
    float comet = pow(head, 7.0) * uPulse;
    gl_FragColor = vec4(uColor * (uBase + comet * 2.2), (uBase + comet) * uAlpha);
  }
`

const nebulaFrag = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform vec3 uA;
  uniform vec3 uB;
  varying vec2 vUv;
  vec2 h(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return -1.0+2.0*fract(sin(p)*43758.5453); }
  float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(dot(h(i),f), dot(h(i+vec2(1,0)),f-vec2(1,0)),u.x), mix(dot(h(i+vec2(0,1)),f-vec2(0,1)), dot(h(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y); }
  float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
  void main() {
    vec2 p = vUv * vec2(3.2, 2.0);
    float w = fbm(p * 1.6 - vec2(uTime * 0.03, uTime * 0.02));
    float v = fbm(p + w * 1.4 + vec2(uTime * 0.015, -uTime * 0.01));
    v = v * 0.5 + 0.5;
    vec3 col = vec3(0.012, 0.006, 0.03);
    col += uA * smoothstep(0.42, 0.95, v) * (0.55 + uLevel * 0.6);
    col += uB * pow(smoothstep(0.55, 1.0, v), 3.0) * 0.6;
    float vig = smoothstep(1.05, 0.25, length(vUv - 0.5) * 1.6);
    gl_FragColor = vec4(col * vig, 1.0);
  }
`

// ---------------------------------------------------------------- geometry

type Filament = {
  line: THREE.Line
  radius: number
  squash: number
  rot: THREE.Quaternion
  speed: number
  freq: number
  phase: number
  points: number
}

function makeFilaments(count: number, maxR: number, seed: number) {
  const r = rng(seed)
  const out: Filament[] = []
  for (let i = 0; i < count; i++) {
    const points = 180
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3))
    const u = new Float32Array(points)
    for (let k = 0; k < points; k++) u[k] = k / (points - 1)
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: lineVert,
      fragmentShader: lineFrag,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uTime: { value: 0 },
        uSpeed: { value: 0.05 + r() * 0.08 },
        uBase: { value: 0.18 },
        uPulse: { value: 0.3 },
        uAlpha: { value: 0.8 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const euler = new THREE.Euler((r() - 0.5) * 2.4, (r() - 0.5) * 2.4, r() * Math.PI)
    out.push({
      line: new THREE.Line(g, mat),
      radius: 1.3 + r() * (maxR - 1.3),
      squash: 0.45 + r() * 0.5,
      rot: new THREE.Quaternion().setFromEuler(euler),
      speed: (0.15 + r() * 0.35) * (r() > 0.5 ? 1 : -1),
      freq: 2 + Math.floor(r() * 4),
      phase: r() * Math.PI * 2,
      points,
    })
  }
  return out
}

// ---------------------------------------------------------------- the rig

function Rig({ mode }: { mode: Mode }) {
  const lowPower = useHub.getState().prefs.lowPower
  const crystal = useMemo(crystalGeometry, [])
  const nucleus = useMemo(() => nucleusGeometry(lowPower ? 700 : 2200), [lowPower])
  const filaments = useMemo(
    () => makeFilaments(mode === 'immersive' ? 12 : 7, mode === 'immersive' ? 2.6 : 1.85, mode === 'immersive' ? 3 : 5),
    [mode],
  )
  const tendrils = useMemo(() => (mode === 'immersive' ? makeFilaments(3, 5.5, 9) : []), [mode])
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])

  const nucleusMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pointVert,
        fragmentShader: pointFrag,
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uSize: { value: 2.2 }, uMotion: { value: 1 }, uColor: { value: new THREE.Color('#c4b5fd') }, uAlpha: { value: 0.9 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const vertexMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pointVert,
        fragmentShader: pointFrag,
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uSize: { value: 5.5 }, uMotion: { value: 1 }, uColor: { value: new THREE.Color('#e9d5ff') }, uAlpha: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const vertexGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(crystal.vertices, 3))
    const s = new Float32Array(crystal.vertices.length / 3).map((_, i) => ((i * 0.618) % 1))
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1))
    return g
  }, [crystal])
  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: shellVert,
        fragmentShader: shellFrag,
        uniforms: { uRim: { value: new THREE.Color('#a78bfa') }, uInner: { value: new THREE.Color('#1e1036') }, uOpacity: { value: 0.75 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#c4b5fd', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    [],
  )
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    [],
  )
  const nebulaMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }`,
        fragmentShader: nebulaFrag,
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uA: { value: new THREE.Color('#5b21b6') }, uB: { value: new THREE.Color('#c084fc') } },
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )

  const drive = useRef({ level: 0, spin: 0.2, ring: new THREE.Color('#a78bfa'), flow: 0.05, pulse: 0.3, amp: 0.04, t: 0 })

  useFrame((state, dt) => {
    const { phase, level, error, ui } = useStore.getState()
    const hub = useHub.getState()
    const items = hub.state ? Object.values(hub.state.items) : []
    const blocked = items.some((i) => i.state === 'open' && i.priority === 'P1')
    const working = hub.state ? Object.values(hub.state.jobs).some((j) => j.state === 'running' && !j.stale) : false
    const motion = hub.prefs.reducedMotion ? 0.12 : 1
    const d = drive.current
    const k = Math.min(1, dt * 3)

    // Inputs → targets.
    const live = phase === 'listening' || phase === 'speaking' || phase === 'waking'
    const wantLevel = live ? level : phase === 'thinking' || phase === 'tooling' ? 0.18 : 0.03
    d.level += (wantLevel - d.level) * Math.min(1, dt * 10)
    const wantSpin = phase === 'thinking' || phase === 'tooling' ? 0.9 : phase === 'listening' ? 0.35 : 0.14
    d.spin += (wantSpin * ui.reactor.spin - d.spin) * k
    d.flow = phase === 'thinking' || phase === 'tooling' ? 0.22 : working ? 0.1 : 0.05
    d.pulse = working || phase === 'tooling' ? 0.9 : 0.25
    d.amp += ((live ? 0.04 + d.level * 0.3 : 0.03) - d.amp) * k
    d.ring.lerp(ui.reactor.color ? new THREE.Color(ui.reactor.color) : ringFor(phase, blocked, Boolean(error)), k)
    d.t += dt * motion

    const t = d.t
    const g = group.current
    if (g) {
      g.rotation.y += dt * d.spin * motion
      g.rotation.x = Math.sin(t * 0.21) * 0.18
      const s = ui.reactor.scale * (1 + d.level * 0.1)
      g.scale.setScalar(s)
      g.visible = ui.reactor.visible
    }
    if (ring.current) {
      ring.current.rotation.z += dt * 0.12 * motion
      ring.current.scale.setScalar(1 + d.level * 0.12)
    }
    const intensity = ui.reactor.intensity
    ringMat.color.copy(d.ring).multiplyScalar(intensity)
    shellMat.uniforms.uRim.value.copy(C.violet).lerp(d.ring, 0.2)
    shellMat.uniforms.uOpacity.value = 0.55 * intensity + d.level * 0.4
    edgeMat.color.copy(C.violet).lerp(C.white, 0.3).lerp(d.ring, 0.15)
    edgeMat.opacity = 0.35 + d.level * 0.5
    for (const m of [nucleusMat, vertexMat]) {
      m.uniforms.uTime.value = t
      m.uniforms.uLevel.value = d.level
      m.uniforms.uMotion.value = motion
    }
    nucleusMat.uniforms.uColor.value.copy(phase === 'speaking' ? C.cyan : C.white).lerp(d.ring, 0.25)
    nebulaMat.uniforms.uTime.value = t
    nebulaMat.uniforms.uLevel.value = d.level

    // Filaments: closed loops that wobble with the voice.
    const lineColor = d.ring.clone().lerp(C.violetDeep, phase === 'listening' ? 0.2 : 0.5)
    for (const f of [...filaments, ...tendrils]) {
      const posAttr = f.line.geometry.attributes.position as THREE.BufferAttribute
      const arr = posAttr.array as Float32Array
      const tendril = tendrils.includes(f)
      for (let i = 0; i < f.points; i++) {
        const a = (i / (f.points - 1)) * Math.PI * 2
        const wob = 1 + d.amp * Math.sin(f.freq * a + t * f.speed * 3 + f.phase) + 0.03 * Math.sin(7 * a - t)
        const r = f.radius * wob
        tmp.set(Math.cos(a + t * f.speed * 0.2) * r, Math.sin(a + t * f.speed * 0.2) * r * f.squash, Math.sin(a * 2 + f.phase) * 0.25)
        if (tendril) tmp.x *= 1.8
        tmp.applyQuaternion(f.rot)
        arr[i * 3] = tmp.x
        arr[i * 3 + 1] = tmp.y
        arr[i * 3 + 2] = tmp.z
      }
      posAttr.needsUpdate = true
      const u = (f.line.material as THREE.ShaderMaterial).uniforms
      u.uTime.value = t
      u.uColor.value.copy(lineColor)
      u.uBase.value = (tendril ? 0.1 : 0.16) + d.level * 0.5
      u.uPulse.value = d.pulse
      u.uSpeed.value = Math.sign(u.uSpeed.value || 1) * d.flow * (tendril ? 0.6 : 1)
    }

    // A slow drift of the eye, so it reads as an object in space.
    state.camera.position.x = Math.sin(t * 0.11) * 0.25
    state.camera.position.y = Math.cos(t * 0.13) * 0.18
    state.camera.lookAt(0, 0, 0)
  })

  return (
    <>
      {mode === 'immersive' && (
        <mesh renderOrder={-10} frustumCulled={false}>
          <planeGeometry args={[2, 2]} />
          <primitive object={nebulaMat} attach="material" />
        </mesh>
      )}
      {[...filaments, ...tendrils].map((f, i) => (
        <primitive key={`f${i}`} object={f.line} />
      ))}
      <group ref={group}>
        <points geometry={nucleus} material={nucleusMat} />
        <mesh geometry={crystal.faceted} material={shellMat} />
        <lineSegments geometry={crystal.edges} material={edgeMat} />
        <points geometry={vertexGeo} material={vertexMat} />
      </group>
      <mesh ref={ring} material={ringMat}>
        <torusGeometry args={[1.42, 0.014, 8, 160]} />
      </mesh>
      {mode === 'immersive' && <Orbits />}
    </>
  )
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const HAS_GL = typeof document !== 'undefined' && webglOk()

/** Without WebGL: a quiet CSS orb in the state colour, so status still reads. */
function FallbackCore() {
  const phase = useStore((s) => s.phase)
  return <div className={`core-fallback core-fallback-${phase}`} aria-hidden />
}

export function CoreView({ mode }: { mode: Mode }) {
  const lowPower = useHub((s) => s.prefs.lowPower)
  if (!HAS_GL) return <FallbackCore />
  return (
    <Canvas
      className={`coreview coreview-${mode}`}
      // Compact keeps the ring at ~21.5% of the height, which the overview's
      // constellation layout is built around.
      camera={{ position: [0, 0, mode === 'immersive' ? 6.4 : 8.6], fov: 42 }}
      gl={{ antialias: !lowPower, alpha: true, powerPreference: lowPower ? 'low-power' : 'high-performance' }}
      dpr={lowPower ? 1 : [1, 1.75]}
    >
      <Rig mode={mode} />
      {!lowPower && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={mode === 'immersive' ? 1.25 : 0.9} luminanceThreshold={0.18} luminanceSmoothing={0.3} mipmapBlur />
          <Vignette eskil={false} offset={0.25} darkness={mode === 'immersive' ? 0.65 : 0.2} />
        </EffectComposer>
      )}
    </Canvas>
  )
}
