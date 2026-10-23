import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { CHAIR } from './layout'
import { motion, reactorState, typing, useMaterials } from './shared'
import { Blob } from './floor'

/**
 * The talk station: a curved command desk and a chair in front of the
 * reactor, where Markus sits to talk to JARVIS. Its light is JARVIS's own:
 * the desk edges and the chair's back strips take the reactor's colour and
 * brighten with his voice, and the holo keyboard lights up while Markus is
 * typing to him.
 */

const TOP = 0.74 // desk top above the deck
const IN = 0.66 // inner radius (towards the chair)
const OUT = 1.08 // outer radius (towards the reactor)
const SPAN = 2.16 // radians of arc, centred straight ahead

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
    </group>
  )
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
