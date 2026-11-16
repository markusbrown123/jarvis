import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DECK_TOP, ZONES } from './layout'
import { plated } from './metal'
import { motion, reactorState } from './shared'
import { useStation } from './stationStore'

/**
 * The floor round the console moves with JARVIS: a ring of machined plates
 * set into the stage between the pathways, his light glowing in the seams.
 * At rest they lie flush. While he listens or speaks they lift and settle
 * in a wave running round the ring, higher the louder the voice; while he
 * thinks a slow ripple turns through them; when a job finishes they all
 * kick up together once.
 */

const R0 = 2.62
const R1 = 3.3
const GAP = (5 * Math.PI) / 180

/** One plate: a slab cut from the ring between two angles (compass, clockwise from −z). */
function plateGeometry(a0: number, a1: number) {
  const s = new THREE.Shape()
  const steps = 10
  const pt = (r: number, a: number) => [r * Math.sin(a), r * Math.cos(a)] as const
  s.moveTo(...pt(R0, a0))
  for (let k = 0; k <= steps; k++) s.lineTo(...pt(R1, a0 + ((a1 - a0) * k) / steps))
  for (let k = steps; k >= 0; k--) s.lineTo(...pt(R0, a0 + ((a1 - a0) * k) / steps))
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 1, curveSegments: 4 })
  g.rotateX(-Math.PI / 2)
  // Planar UVs across the floor, so the plating lines up plate to plate.
  const p = g.attributes.position
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * 0.5
    uv[i * 2 + 1] = p.getZ(i) * 0.5
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

export function FloorWorks() {
  // Plates in the sectors between the pathways out to the zones.
  const plates = useMemo(() => {
    const angles = ZONES.map((z) => (z.angle * Math.PI) / 180).sort((a, b) => a - b)
    const out: { geo: THREE.BufferGeometry; mid: number }[] = []
    angles.forEach((a, k) => {
      const b = k + 1 < angles.length ? angles[k + 1] : angles[0] + Math.PI * 2
      const from = a + GAP * 1.6
      const to = b - GAP * 1.6
      const n = Math.max(1, Math.round((to - from) / 0.24))
      for (let j = 0; j < n; j++) {
        const p0 = from + ((to - from) * j) / n + GAP * 0.25
        const p1 = from + ((to - from) * (j + 1)) / n - GAP * 0.25
        out.push({ geo: plateGeometry(p0, p1), mid: (p0 + p1) / 2 })
      }
    })
    return out
  }, [])
  const mat = useMemo(() => plated({ color: '#4c5360', repeat: 1, roughness: 1, metalness: 1, envMapIntensity: 1.1 }), [])
  const seam = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }), [])
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const kick = useRef({ last: 0, t: 99 })

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime * motion()
    const s = reactorState()
    const level = s.level
    // A finished job: one kick, all together.
    const ev = useStation.getState().events
    const done = ev.length ? [...ev].reverse().find((e) => e.kind === 'complete') : undefined
    if (done && done.id !== kick.current.last) {
      kick.current.last = done.id
      kick.current.t = 0
    }
    kick.current.t += dt
    const k = Math.max(0, 1 - kick.current.t / 0.9)
    plates.forEach((p, i) => {
      const m = refs.current[i]
      if (!m) return
      let h = 0
      if (s.live || s.phase === 'speaking') h = (0.012 + 0.045 * level) * (0.5 + 0.5 * Math.sin(t * 7 - p.mid * 3))
      else if (s.busy) h = 0.012 * (0.5 + 0.5 * Math.sin(t * 2.2 - p.mid * 4))
      h += k * 0.05 * Math.sin(k * Math.PI)
      m.position.y = DECK_TOP + h
    })
    seam.color.copy(s.color).multiplyScalar(0.5 + level * 1.5 + (s.busy ? 0.3 : 0) + k)
  })

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={DECK_TOP + 0.002} material={seam} renderOrder={1}>
        <ringGeometry args={[R0 - 0.02, R1 + 0.02, 96]} />
      </mesh>
      {plates.map((p, i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)} geometry={p.geo} material={mat} position-y={DECK_TOP} castShadow receiveShadow />
      ))}
    </group>
  )
}
