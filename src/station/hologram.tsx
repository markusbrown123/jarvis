import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DECK_TOP } from './layout'
import { motion, reactorState } from './shared'

/**
 * JARVIS, visible: a hologram at the desk's front edge, between the two
 * middle monitors, thrown up by a projector set into the desk.
 *
 * A glass-clear core with a bright rim and scan bands, a nucleus turning
 * inside it, three orbit rings, HUD arcs that always face you, a shell of
 * drifting light, and a ring that moves with his voice. It reads his state
 * the way the desk's light strips do:
 * - standing by: slow, dim, breathing
 * - listening: warms to amber, the voice ring follows you
 * - thinking / working: the rings spread and spin up
 * - speaking: the core and the voice ring pulse with what he says
 * About a dozen draw calls, no shadows, nothing that lights the room.
 */

const DESK_Y = DECK_TOP + 0.99
const AT = new THREE.Vector3(0, DESK_Y + 0.52, -1.32)
const R = 0.17

const glow = (opacity = 1) =>
  new THREE.MeshBasicMaterial({ color: '#7c8bff', transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })

/** The core: clear in the middle, bright at the rim, scan bands drifting up, a faint flicker. */
function coreMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#7c8bff') }, uTime: { value: 0 }, uEnergy: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uEnergy;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 2.4);
        float bands = 0.55 + 0.45 * sin(vY * 140.0 - uTime * 3.0);
        float flicker = 0.92 + 0.08 * sin(uTime * 37.0) * sin(uTime * 11.0);
        float a = (rim * 0.95 + 0.05) * bands * flicker * (0.35 + uEnergy);
        gl_FragColor = vec4(uColor * (1.4 + uEnergy), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/** The projector's beam: brightest at the emitter, fading as it rises, lines running up it. */
function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#7c8bff') }, uTime: { value: 0 }, uEnergy: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uEnergy;
      varying vec2 vUv;
      void main() {
        float rise = pow(1.0 - vUv.y, 1.6);
        float lines = 0.6 + 0.4 * sin(vUv.y * 60.0 - uTime * 5.0);
        float streaks = 0.7 + 0.3 * sin(vUv.x * 6.2831 * 9.0 + uTime * 0.7);
        gl_FragColor = vec4(uColor * 1.6, rise * lines * streaks * (0.08 + uEnergy * 0.16));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/** Points in a loose shell round the core, each with its own drift. */
function dust(n: number) {
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1
    const th = Math.random() * Math.PI * 2
    const r = R * (1.05 + Math.random() * 0.7)
    const s = Math.sqrt(1 - u * u)
    pos.set([r * s * Math.cos(th), r * u * 0.8, r * s * Math.sin(th)], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  return g
}

const ARCS: [number, number, number][] = [
  // radius, length (turns), start
  [1.34, 0.28, 0],
  [1.34, 0.12, 0.45],
  [1.34, 0.06, 0.7],
  [1.46, 0.4, 0.15],
  [1.46, 0.08, 0.66],
]
const VOICE_N = 160

export function Hologram() {
  const col = useMemo(() => new THREE.Color('#7c8bff'), [])
  const core = useMemo(coreMaterial, [])
  const beam = useMemo(beamMaterial, [])
  const ringMat = useMemo(() => glow(0.85), [])
  const arcMat = useMemo(() => glow(0.55), [])
  const nucleusMat = useMemo(() => Object.assign(glow(0.7), { wireframe: true }), [])
  const heartMat = useMemo(() => glow(1), [])
  const emitMat = useMemo(() => glow(0.9), [])
  const dustMat = useMemo(() => new THREE.PointsMaterial({ color: '#7c8bff', size: 0.007, sizeAttenuation: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const voiceMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#7c8bff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const dustGeo = useMemo(() => dust(260), [])
  const voiceGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VOICE_N * 3), 3))
    return g
  }, [])
  const voiceLine = useMemo(() => new THREE.LineLoop(voiceGeo, voiceMat), [voiceGeo, voiceMat])
  const beamH = AT.y - R * 0.75 - DESK_Y

  const coreRef = useRef<THREE.Mesh>(null)
  const nucleus = useRef<THREE.Mesh>(null)
  const heart = useRef<THREE.Mesh>(null)
  const rings = useRef<THREE.Group>(null)
  const facing = useRef<THREE.Group>(null)
  const arcs = useRef<THREE.Group>(null)
  const shell = useRef<THREE.Points>(null)
  const s = useRef({ t: 0, energy: 0.4, spin: 0.3, level: 0, spread: 0 })

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const st = reactorState()
    const v = s.current
    const k = Math.min(1, dt * 3)
    v.t += dt * motion()
    v.level += (st.level - v.level) * Math.min(1, dt * 14)
    const want =
      st.phase === 'offline' ? 0.12 : st.phase === 'speaking' ? 0.75 + v.level * 0.6 : st.live ? 0.85 : st.busy ? 0.8 : 0.42
    v.energy += (want - v.energy) * k
    v.spin += ((st.busy ? 1.8 : st.live ? 0.7 : st.phase === 'speaking' ? 0.9 : 0.28) - v.spin) * k
    v.spread += ((st.busy ? 1 : 0) - v.spread) * k
    col.lerp(st.color, k)
    const t = v.t
    const breathe = Math.sin(t * 1.3) * 0.02

    for (const m of [core, beam]) {
      m.uniforms.uColor.value.copy(col)
      m.uniforms.uTime.value = t
      m.uniforms.uEnergy.value = v.energy
    }
    for (const m of [ringMat, arcMat, nucleusMat, heartMat, emitMat, dustMat, voiceMat]) m.color.copy(col).multiplyScalar(1.3 + v.energy)
    ringMat.opacity = 0.35 + v.energy * 0.6
    arcMat.opacity = 0.25 + v.energy * 0.45
    dustMat.opacity = 0.3 + v.energy * 0.6
    heartMat.opacity = 0.5 + v.energy * 0.5

    coreRef.current?.scale.setScalar(1 + breathe + v.level * 0.1)
    if (nucleus.current) {
      nucleus.current.rotation.x += dt * v.spin * 0.7 * motion()
      nucleus.current.rotation.y += dt * v.spin * motion()
      nucleus.current.scale.setScalar(1 + v.level * 0.35 + breathe * 2)
    }
    heart.current?.scale.setScalar(0.85 + v.energy * 0.4 + v.level * 0.5)
    // The orbit rings: tilted apart, turning; working spreads them wider.
    const g = rings.current
    if (g) {
      g.children.forEach((c, i) => {
        c.rotation.x = Math.PI / 2 + (i - 1) * (0.55 + v.spread * 0.35) + Math.sin(t * 0.4 + i) * 0.08
        c.rotation.y = t * v.spin * (i % 2 ? -0.6 : 0.8) + i * 2.1
        c.scale.setScalar(1 + v.spread * 0.08 * (i + 1))
      })
    }
    shell.current?.rotation.set(Math.sin(t * 0.2) * 0.2, t * v.spin * 0.35, 0)
    // HUD arcs and the voice ring face you wherever you stand.
    facing.current?.quaternion.copy(camera.quaternion)
    if (arcs.current) arcs.current.children.forEach((c, i) => (c.rotation.z = t * (i % 2 ? -0.35 : 0.5) * (0.6 + v.spin * 0.4) + i))
    // The voice ring: still when he's quiet, rippling with the sound when he speaks or hears you.
    const p = voiceGeo.attributes.position as THREE.BufferAttribute
    const amp = v.level * R * 0.35
    for (let i = 0; i < VOICE_N; i++) {
      const a = (i / VOICE_N) * Math.PI * 2
      const wob = Math.sin(a * 6 + t * 7) * 0.6 + Math.sin(a * 11 - t * 9) * 0.4
      const r = R * 1.2 + amp * wob + Math.sin(a * 3 + t) * R * 0.01
      p.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r, 0)
    }
    p.needsUpdate = true
    voiceMat.opacity = 0.15 + Math.min(1, v.level * 2.5) * 0.8
  })

  return (
    <group>
      {/* The projector in the desk: a lit ring and its lens. */}
      <mesh position={[AT.x, DESK_Y + 0.004, AT.z]} rotation-x={-Math.PI / 2} material={emitMat}>
        <ringGeometry args={[0.038, 0.052, 48]} />
      </mesh>
      <mesh position={[AT.x, DESK_Y + 0.003, AT.z]} rotation-x={-Math.PI / 2} material={heartMat}>
        <circleGeometry args={[0.022, 32]} />
      </mesh>
      {/* Its beam, from the lens up to the core. */}
      <mesh position={[AT.x, DESK_Y + beamH / 2, AT.z]} material={beam}>
        <cylinderGeometry args={[R * 0.62, 0.03, beamH, 48, 1, true]} />
      </mesh>
      <group position={AT.toArray()}>
        <mesh ref={coreRef} material={core}>
          <sphereGeometry args={[R, 48, 32]} />
        </mesh>
        <mesh ref={nucleus} material={nucleusMat}>
          <icosahedronGeometry args={[R * 0.42, 1]} />
        </mesh>
        <mesh ref={heart} material={heartMat}>
          <sphereGeometry args={[R * 0.12, 16, 12]} />
        </mesh>
        <group ref={rings}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} material={ringMat}>
              <torusGeometry args={[R * (1.1 + i * 0.07), 0.0018, 6, 128]} />
            </mesh>
          ))}
        </group>
        <points ref={shell} geometry={dustGeo} material={dustMat} />
        <group ref={facing}>
          <group ref={arcs}>
            {ARCS.map(([r, len, start], i) => (
              <mesh key={i} material={arcMat}>
                <ringGeometry args={[R * r, R * r + 0.006, 64, 1, start * Math.PI * 2, len * Math.PI * 2]} />
              </mesh>
            ))}
          </group>
          <primitive object={voiceLine} />
        </group>
      </group>
    </group>
  )
}
