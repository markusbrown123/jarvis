import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { HOUSE } from './layout'
import { SKY } from './sky'
import { WAKES } from './wakes'

/**
 * Life on the water below the house: a motor yacht and two sailboats
 * cruising, a speedboat, two jet skis weaving about closer in, and a
 * container ship crossing far out on the horizon. Each runs its own long
 * loop, so they're never in the same place twice in a few minutes.
 *
 * Their wakes are drawn by the sea itself (outside.tsx reads WAKES): a
 * churned white trail and the V of the bow waves spreading behind each,
 * longer and wider the faster it goes. After dark they show navigation
 * lights — red to port, green to starboard, white on the mast — and the
 * yacht's cabins glow; the sea carries those lights' reflections too.
 */

type Kind = 'yacht' | 'sail' | 'speed' | 'jetski' | 'ship'
type Route = { kind: Kind; cx: number; cz: number; rx: number; rz: number; speed: number; phase: number; weave?: number; color?: string }

const ROUTES: Route[] = [
  { kind: 'yacht', cx: -40, cz: -720, rx: 470, rz: 170, speed: 7, phase: 0.6 },
  { kind: 'sail', cx: 260, cz: -460, rx: 270, rz: 120, speed: 3.4, phase: 2.2 },
  { kind: 'sail', cx: -300, cz: -1050, rx: 300, rz: 150, speed: 4, phase: 4.1 },
  { kind: 'speed', cx: 60, cz: -330, rx: 330, rz: 95, speed: 14, phase: 1.3, color: '#1d3b6e' },
  { kind: 'jetski', cx: -50, cz: -175, rx: 140, rz: 55, speed: 13, phase: 0.2, weave: 12, color: '#f2c230' },
  { kind: 'jetski', cx: 95, cz: -240, rx: 115, rz: 70, speed: 15.5, phase: 3.0, weave: 9, color: '#2e7fd8' },
  { kind: 'ship', cx: 0, cz: -1950, rx: 1500, rz: 40, speed: 8, phase: 2.5 },
]

const DIMS: Record<Kind, { L: number; B: number; f: number }> = {
  yacht: { L: 26, B: 6.2, f: 2.1 },
  sail: { L: 12, B: 3.6, f: 1.1 },
  speed: { L: 9, B: 2.8, f: 1.0 },
  jetski: { L: 3.2, B: 1.2, f: 0.55 },
  ship: { L: 180, B: 28, f: 13 },
}

/** A hull seen from above, square at the stern and pointed at the bow (bow is +X). */
function hull(L: number, B: number, f: number) {
  const s = new THREE.Shape()
  const h = B / 2
  s.moveTo(-L / 2, -h * 0.9)
  s.lineTo(L * 0.12, -h)
  s.quadraticCurveTo(L * 0.42, -h * 0.85, L / 2, 0)
  s.quadraticCurveTo(L * 0.42, h * 0.85, L * 0.12, h)
  s.lineTo(-L / 2, h * 0.9)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: f, bevelEnabled: true, bevelThickness: f * 0.15, bevelSize: B * 0.05, bevelSegments: 2, curveSegments: 10 })
  g.rotateX(-Math.PI / 2)
  g.translate(0, -f * 0.35, 0)
  return g
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z)
}

function sail(points: [number, number, number][]) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3))
  g.computeVertexNormals()
  return g
}

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material }
type Light = { at: [number, number, number]; color: string }

function useMats() {
  return useMemo(
    () => ({
      white: new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.32, metalness: 0.05 }),
      glass: new THREE.MeshStandardMaterial({ color: '#0b1118', roughness: 0.08, metalness: 0.6, emissive: new THREE.Color('#ffb466'), emissiveIntensity: 0 }),
      dark: new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.6 }),
      teak: new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.7 }),
      sailcloth: new THREE.MeshStandardMaterial({ color: '#f4f2ea', roughness: 0.75, side: THREE.DoubleSide }),
      mast: new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.3, metalness: 0.8 }),
      rust: new THREE.MeshStandardMaterial({ color: '#4a1e18', roughness: 0.7 }),
      boxes: ['#9c2f25', '#1f4f7a', '#2f6b3f', '#b8862b', '#5b5f66'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
    }),
    [],
  )
}

function build(r: Route, m: ReturnType<typeof useMats>): { parts: Part[]; lights: Light[] } {
  const { L, B, f } = DIMS[r.kind]
  const tint = r.color ? new THREE.MeshStandardMaterial({ color: r.color, roughness: 0.35 }) : m.white
  switch (r.kind) {
    case 'yacht':
      return {
        parts: [
          { geo: hull(L, B, f), mat: m.white },
          { geo: boxAt(L * 0.5, 1.5, B * 0.78, -1.5, f * 0.65), mat: m.white },
          { geo: boxAt(L * 0.5 + 0.1, 0.7, B * 0.78 + 0.1, -1.5, f * 0.65 + 0.45), mat: m.glass },
          { geo: boxAt(L * 0.3, 1.2, B * 0.6, -3, f * 0.65 + 1.5), mat: m.white },
          { geo: boxAt(L * 0.3 + 0.1, 0.55, B * 0.6 + 0.1, -3, f * 0.65 + 1.85), mat: m.glass },
          { geo: boxAt(1.2, 1.6, B * 0.5, -6.5, f * 0.65 + 2.7), mat: m.dark },
          { geo: boxAt(L * 0.25, 0.2, B * 0.8, -L * 0.36, f * 0.62), mat: m.teak },
        ],
        lights: [
          { at: [L * 0.32, f * 0.7, -B * 0.45], color: '#ff3b30' },
          { at: [L * 0.32, f * 0.7, B * 0.45], color: '#2bd96b' },
          { at: [-6.5, f * 0.65 + 4.5, 0], color: '#ffffff' },
        ],
      }
    case 'sail': {
      const top = 15
      return {
        parts: [
          { geo: hull(L, B, f), mat: m.white },
          { geo: boxAt(L * 0.35, 0.7, B * 0.6, -0.5, f * 0.6), mat: m.white },
          { geo: new THREE.CylinderGeometry(0.08, 0.1, top, 6).translate(0.8, top / 2 + f * 0.6, 0), mat: m.mast },
          { geo: sail([[0.75, f + 1.4, 0], [0.75, top, 0], [-4.6, f + 1.4, 0]]), mat: m.sailcloth },
          { geo: sail([[0.9, top - 1, 0], [L * 0.47, f + 0.8, 0], [0.9, f + 1.2, 0]]), mat: m.sailcloth },
        ],
        lights: [
          { at: [L * 0.4, f, -B * 0.4], color: '#ff3b30' },
          { at: [L * 0.4, f, B * 0.4], color: '#2bd96b' },
          { at: [0.8, top + f * 0.6, 0], color: '#ffffff' },
        ],
      }
    }
    case 'speed':
      return {
        parts: [
          { geo: hull(L, B, f), mat: tint },
          { geo: boxAt(1.4, 0.9, B * 0.6, -0.5, f * 0.6), mat: m.white },
          { geo: boxAt(0.15, 0.55, B * 0.62, 0.3, f * 0.6 + 0.9), mat: m.glass },
          { geo: boxAt(2.2, 0.5, B * 0.75, -L * 0.33, f * 0.6), mat: m.white },
        ],
        lights: [
          { at: [L * 0.38, f * 0.8, -B * 0.4], color: '#ff3b30' },
          { at: [L * 0.38, f * 0.8, B * 0.4], color: '#2bd96b' },
          { at: [-L * 0.45, f + 1.2, 0], color: '#ffffff' },
        ],
      }
    case 'jetski':
      return {
        parts: [
          { geo: hull(L, B, f), mat: tint },
          { geo: boxAt(1.1, 0.3, 0.5, -0.4, f * 0.6), mat: m.dark },
          { geo: new THREE.CapsuleGeometry(0.22, 0.6, 3, 8).translate(-0.5, f * 0.6 + 0.75, 0), mat: m.dark },
        ],
        lights: [{ at: [0.6, f + 0.6, 0], color: '#ffffff' }],
      }
    case 'ship': {
      const parts: Part[] = [
        { geo: hull(L, B, f), mat: m.rust },
        { geo: boxAt(14, 16, B * 0.9, -L * 0.42, f * 0.65), mat: m.white },
      ]
      for (let i = 0; i < 9; i++) {
        const h = 5 + ((i * 7) % 4) * 2.6
        parts.push({ geo: boxAt(14, h, B * 0.85, -L * 0.28 + i * 15, f * 0.65), mat: m.boxes[i % m.boxes.length] })
      }
      return {
        parts,
        lights: [
          { at: [-L * 0.42, f + 18, 0], color: '#ffffff' },
          { at: [L * 0.45, f + 6, 0], color: '#ffffff' },
          { at: [-L * 0.42, f + 10, -B * 0.5], color: '#ff3b30' },
        ],
      }
    }
  }
}

function at(r: Route, t: number): [number, number] {
  const circ = 2 * Math.PI * Math.sqrt((r.rx * r.rx + r.rz * r.rz) / 2)
  const th = r.phase + (t * r.speed * 2 * Math.PI) / circ
  // Weaving jet skis swing across their own line.
  const w = r.weave ? r.weave * Math.sin(t * 0.55 + r.phase * 3) : 0
  const vx = -r.rx * Math.sin(th)
  const vz = r.rz * Math.cos(th)
  const n = Math.hypot(vx, vz) || 1
  return [r.cx + r.rx * Math.cos(th) - (vz / n) * w, r.cz + r.rz * Math.sin(th) + (vx / n) * w]
}

function where(r: Route, t: number, out: { x: number; z: number; heading: number }) {
  const [x, z] = at(r, t)
  const [x2, z2] = at(r, t + 0.25)
  out.x = x
  out.z = z
  out.heading = Math.atan2(z2 - z, x2 - x)
  return out
}

export function Boats() {
  const m = useMats()
  const boats = useMemo(() => ROUTES.map((r) => ({ r, ...build(r, m) })), [m])
  const groups = useRef<(THREE.Group | null)[]>([])
  const lightGeo = useMemo(() => {
    const n = boats.reduce((a, b) => a + b.lights.length, 0)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(boats.flatMap((b) => b.lights.flatMap((l) => new THREE.Color(l.color).multiplyScalar(2.2).toArray())), 3))
    return g
  }, [boats])
  const lightMat = useMemo(() => new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, opacity: 0 }), [])
  const tmp = useMemo(() => ({ p: { x: 0, z: 0, heading: 0 }, v: new THREE.Vector3() }), [])

  useFrame((st) => {
    const still = useHub.getState().prefs.reducedMotion
    const t = still ? 0 : st.clock.elapsedTime
    // Lights on from dusk: the sky's exposure climbs as the sun goes down.
    const dusk = Math.min(1, Math.max(0, (SKY.uExposure.value - 1.6) / 5))
    m.glass.emissiveIntensity = dusk * 1.6
    lightMat.opacity = dusk
    const pos = lightGeo.attributes.position as THREE.BufferAttribute
    let li = 0
    boats.forEach((b, i) => {
      const g = groups.current[i]
      const p = where(b.r, t, tmp.p)
      const D = DIMS[b.r.kind]
      if (g) {
        g.position.set(p.x, HOUSE.sea + Math.sin(t * 0.9 + i) * 0.12 * (b.r.kind === 'ship' ? 0.3 : 1), p.z)
        g.rotation.set(Math.sin(t * 0.7 + i * 2) * (b.r.kind === 'sail' ? 0.02 : 0.03) + (b.r.kind === 'sail' ? 0.14 : 0), -p.heading, Math.sin(t * 0.8 + i) * 0.02 + (b.r.kind === 'jetski' || b.r.kind === 'speed' ? 0.05 : 0), 'YXZ')
        g.updateMatrixWorld()
        for (const l of b.lights) {
          tmp.v.set(...l.at).applyMatrix4(g.matrixWorld)
          pos.setXYZ(li, tmp.v.x, tmp.v.y, tmp.v.z)
          if (li < 16) {
            WAKES.uBoatLights.value[li].set(tmp.v.x, tmp.v.y, tmp.v.z, 1)
            WAKES.uBoatLightCol.value[li].set(l.color).multiplyScalar(dusk * 1.5)
          }
          li++
        }
      }
      WAKES.uBoats.value[i].set(p.x, p.z, p.heading, still ? 0 : b.r.speed)
      WAKES.uBoatDim.value[i].set(D.L, D.B, b.r.kind === 'jetski' ? 1 : 0, 1)
    })
    pos.needsUpdate = true
  })

  return (
    <group>
      {boats.map((b, i) => (
        <group key={i} ref={(g) => void (groups.current[i] = g)}>
          {b.parts.map((p, k) => (
            <mesh key={k} geometry={p.geo} material={p.mat} />
          ))}
        </group>
      ))}
      <points geometry={lightGeo} material={lightMat} frustumCulled={false} />
    </group>
  )
}
