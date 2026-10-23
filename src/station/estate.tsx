import { useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Graphics } from '../hub/client'
import { OUTDOOR } from './environment'
import { ESTATE } from './layout'
import { SKY } from './sky'
import { blob, cliffEdge, coastMaterial, ground, lawnNorm } from './coastland'

/**
 * The rest of the estate round the house, after Tony Stark's: more white
 * disc-roofed pavilions stacked at different heights — the north one out
 * over the cliff on a great column, the south one built down into it, the
 * big one behind two storeys high — curving garden walls, and the helipad
 * with its H behind a sweeping parapet, its ramp swooping down to the drive.
 * Modelled and its shading baked in Blender (tools/blender/estate.py); the
 * sun, the sky and the shadows are live. Their glass is dark and mirrors the
 * sky by day; after dark the rooms behind it glow warm and the helipad's edge
 * lights come on.
 *
 * Round them, the grounds: the lawn (levelled and mown in coastland.ts),
 * palms along the drive and round the pavilions, Italian cypresses by the
 * walls, broad trees along the lawn's edge, and the drive itself winding in
 * from the coast road to a turning circle under the helipad's ramp.
 */

const MODEL = '/station/estate.glb'
const WARM = new THREE.Color(1.0, 0.62, 0.32)
const EDGE = new THREE.Color(0.7, 0.85, 1.6)

export function Estate({ graphics }: { graphics: Graphics }) {
  const { nodes } = useGLTF(MODEL, false) as unknown as { nodes: Record<string, THREE.Mesh> }
  const maps = useLoader(THREE.TextureLoader, [`/station/estate_white_detail_${graphics}.jpg`, `/station/estate_pad_detail_${graphics}.jpg`])
  const mats = useMemo(() => {
    for (const t of maps) {
      t.flipY = false // glTF's UVs run top-down
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      t.needsUpdate = true
    }
    const outdoor = <M extends THREE.MeshStandardMaterial>(m: M) => (OUTDOOR.add(m), m)
    return {
      white: outdoor(new THREE.MeshStandardMaterial({ map: maps[0], roughness: 0.7, envMapIntensity: 0.7 })),
      pad: outdoor(new THREE.MeshStandardMaterial({ map: maps[1], roughness: 0.85 })),
      paint: outdoor(new THREE.MeshStandardMaterial({ color: '#e9e8e3', roughness: 0.6 })),
      glass: outdoor(new THREE.MeshStandardMaterial({ color: '#091017', roughness: 0.04, metalness: 0.2, envMapIntensity: 1.8, transparent: true, opacity: 0.86 })),
      frames: outdoor(new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.35, metalness: 0.7 })),
      glow: new THREE.MeshBasicMaterial({ color: '#000' }),
      lights: new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false }),
    }
  }, [maps])

  useFrame(() => {
    // After dark the rooms behind the glass glow warm and the helipad lights up.
    const dusk = Math.min(1, Math.max(0, (SKY.uExposure.value - 1.4) / 6))
    mats.glow.color.setRGB(0.05, 0.045, 0.04).lerp(WARM, dusk).multiplyScalar(0.25 + dusk * 0.9)
    mats.lights.color.setRGB(0.2, 0.2, 0.2).lerp(EDGE, dusk)
  })

  const parts: [string, THREE.Material, boolean][] = [
    ['white', mats.white, true],
    ['pad', mats.pad, true],
    ['paint', mats.paint, false],
    ['frames', mats.frames, true],
    ['glow', mats.glow, false],
    ['glass', mats.glass, false],
    ['lights', mats.lights, false],
  ]
  return (
    <group>
      {parts.map(([n, m, cast]) =>
        nodes[n] ? <mesh key={n} geometry={nodes[n].geometry} position={nodes[n].position} quaternion={nodes[n].quaternion} material={m} castShadow={cast} receiveShadow={n !== 'glass'} renderOrder={n === 'glass' ? 4 : 0} /> : null,
      )}
    </group>
  )
}

// ---------------------------------------------------------------- the grounds

type Rand = () => number
function rng(seed: number): Rand {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** Ground level for something standing on the estate (the house's island top is at −0.2). */
const standY = (x: number, z: number) => Math.max(ground(x, z).h, -0.2)

/**
 * A palm, 10 m tall: a ringed trunk leaning and curving a little, flared at
 * the foot; a crown of fronds — each a folded, serrated blade drooping
 * under its own weight — round a fibrous boot.
 */
function palmGeometry() {
  const H = 10
  const trunk = new THREE.BufferGeometry()
  {
    const along = 28
    const around = 10
    const pos: number[] = []
    const col: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= along; i++) {
      const t = i / along
      const cx = 1.1 * Math.pow(t, 1.7)
      const r = 0.2 - 0.06 * t + 0.16 * Math.pow(1 - t, 8)
      const ring = 0.72 + 0.28 * (Math.sin(t * H * 3.4 * Math.PI) > 0.6 ? 0 : 1)
      for (let k = 0; k <= around; k++) {
        const a = (k / around) * Math.PI * 2
        pos.push(cx + Math.cos(a) * r, t * H, Math.sin(a) * r)
        col.push(0.42 * ring, 0.36 * ring, 0.29 * ring)
      }
    }
    for (let i = 0; i < along; i++)
      for (let k = 0; k < around; k++) {
        const a = i * (around + 1) + k
        const b = a + around + 1
        idx.push(a, b, a + 1, a + 1, b, b + 1)
      }
    trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    trunk.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    trunk.setIndex(idx)
    trunk.computeVertexNormals()
  }
  const crown = new THREE.BufferGeometry()
  {
    const top = new THREE.Vector3(1.1, H, 0)
    const pos: number[] = []
    const col: number[] = []
    const idx: number[] = []
    const r = rng(5)
    const fronds = 17
    for (let f = 0; f < fronds; f++) {
      const az = (f / fronds) * Math.PI * 2 + r() * 0.3
      const inner = f % 3 === 0
      const el = inner ? 0.75 + r() * 0.3 : 0.15 + r() * 0.35
      const L = (inner ? 2.6 : 3.4) * (0.85 + r() * 0.3)
      const droop = inner ? 0.5 : 1.6 + r() * 0.8
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))
      const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az))
      const n = 16
      const base = pos.length / 3
      for (let i = 0; i <= n; i++) {
        const s = i / n
        const spine = top.clone().addScaledVector(dir, s * L)
        spine.y -= droop * s * s * L * 0.45
        // Serrated: leaflets alternate long and short along the blade.
        const w = 0.62 * Math.sin(Math.PI * Math.pow(s, 0.75)) * (i % 2 ? 1 : 0.45)
        // Folded down either side of the spine.
        for (const sd of [-1, 0, 1]) {
          const p = spine.clone().addScaledVector(side, sd * w)
          if (sd) p.y -= w * 0.45
          pos.push(p.x, p.y, p.z)
          const g = 0.75 + 0.35 * s + (sd ? 0 : 0.1)
          col.push(0.09 * g + 0.04 * s, 0.17 * g, 0.045 * g)
        }
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 3
        const b = a + 3
        idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2)
      }
    }
    // The boot: old frond bases round the top of the trunk.
    const boot = new THREE.SphereGeometry(0.42, 10, 8)
    boot.scale(1, 1.3, 1)
    boot.translate(top.x, top.y - 0.35, top.z)
    const bp = boot.attributes.position as THREE.BufferAttribute
    const base = pos.length / 3
    for (let i = 0; i < bp.count; i++) {
      pos.push(bp.getX(i), bp.getY(i), bp.getZ(i))
      col.push(0.3, 0.24, 0.15)
    }
    const bi = boot.index!.array
    for (let i = 0; i < bi.length; i++) idx.push(base + bi[i])
    crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    crown.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    crown.setIndex(idx)
    crown.computeVertexNormals()
  }
  return { trunk, crown }
}

/** The drive: in from the coast road, winding across the lawn to the turning circle. */
function drivePath() {
  const t = ESTATE.turn
  const ctrl = [new THREE.Vector3(t.x, 0, t.z), new THREE.Vector3(t.x + 5, 0, t.z + 14), new THREE.Vector3(t.x + 18, 0, t.z + 24), new THREE.Vector3(t.x + 36, 0, t.z + 30)]
  // On out to where the coast road runs round the back of the grounds.
  const last = ctrl[ctrl.length - 1].clone()
  const away = new THREE.Vector3(last.x, 0, last.z + 575).normalize()
  while (lawnNorm(last.x, last.z) < 1.2) last.addScaledVector(away, 1.5)
  ctrl.push(last)
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal')
  return curve.getSpacedPoints(Math.ceil(curve.getLength() / 2))
}

function ribbon(path: THREE.Vector3[], width: number, lift: number) {
  const pos: number[] = []
  const idx: number[] = []
  const side = new THREE.Vector3()
  path.forEach((p, i) => {
    const q = path[Math.min(i + 1, path.length - 1)]
    const o = path[Math.max(i - 1, 0)]
    side.set(q.z - o.z, 0, -(q.x - o.x)).normalize().multiplyScalar(width / 2)
    const y = Math.max(standY(p.x + side.x, p.z + side.z), standY(p.x - side.x, p.z - side.z), standY(p.x, p.z)) + lift
    pos.push(p.x + side.x, y, p.z + side.z, p.x - side.x, y, p.z - side.z)
    if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

type Tree = { x: number; z: number; s: number; yaw: number }

/** Where the trees go: along the drive, round the pavilions and the lawn's edge, never on a roof. */
function planting(drive: THREE.Vector3[]) {
  const r = rng(71)
  const clear = (x: number, z: number, pad: number) => {
    if (Math.hypot(x, z) < 22 + pad) return false
    for (const [wx, wz, wr] of ESTATE.wings) if (Math.hypot(x - wx, z - wz) < wr + pad) return false
    const h = ESTATE.helipad
    if (Math.hypot(x - h.x, z - h.z) < h.r + 2 + pad) return false
    const t = ESTATE.turn
    if (Math.hypot(x - t.x, z - t.z) < t.r + pad && Math.hypot(x - t.x, z - t.z) > 1) return false
    // The ramp's line from the helipad to the turning circle.
    for (let k = 0; k <= 10; k++) {
      const u = k / 10
      if (Math.hypot(x - (h.x - 7.3 + (t.x - h.x + 7.3) * u), z - (h.z - 6.8 + (t.z - 5 - h.z + 6.8) * u)) < 4 + pad) return false
    }
    for (const p of drive) if (Math.hypot(x - p.x, z - p.z) < 4.2 + pad) return false
    return lawnNorm(x, z) < 1.02 && (ground(x, z).s > 3 || Math.hypot(x, z) < cliffEdge(x, z) - 3)
  }
  const palms: Tree[] = []
  const cypress: Tree[] = []
  const broad: Tree[] = []
  // Palms both sides of the drive, and one in the turning circle.
  palms.push({ x: ESTATE.turn.x, z: ESTATE.turn.z, s: 1.15, yaw: r() * 6.28 })
  for (let i = 4; i < drive.length - 2; i += 6) {
    const p = drive[i]
    const q = drive[i + 1]
    const sx = q.z - p.z
    const sz = -(q.x - p.x)
    const n = Math.hypot(sx, sz)
    for (const sd of [-1, 1]) {
      const x = p.x + (sx / n) * 6 * sd
      const z = p.z + (sz / n) * 6 * sd
      if (clear(x, z, 0.5)) palms.push({ x, z, s: 0.9 + r() * 0.35, yaw: r() * 6.28 })
    }
  }
  // More round the pavilions and out on the lawn, in loose groups.
  for (let tries = 0; palms.length < 34 && tries < 4000; tries++) {
    const [wx, wz, wr] = ESTATE.wings[Math.floor(r() * ESTATE.wings.length)]
    const a = r() * Math.PI * 2
    const d = wr + 3 + r() * 14
    const x = wx + Math.cos(a) * d
    const z = wz + Math.sin(a) * d
    if (clear(x, z, 1.5) && palms.every((p) => Math.hypot(p.x - x, p.z - z) > 5)) palms.push({ x, z, s: 0.85 + r() * 0.45, yaw: r() * 6.28 })
  }
  // Cypresses in rows along the garden walls behind the pavilions.
  for (const [x0, z0, x1, z1, n] of [
    [-12, 22, -16, 42, 6],
    [36, 20, 40, 34, 5],
    [-28, 13, -32, 28, 5],
  ] as const)
    for (let k = 0; k < n; k++) {
      const x = x0 + ((x1 - x0) * k) / (n - 1) + (r() - 0.5)
      const z = z0 + ((z1 - z0) * k) / (n - 1) + (r() - 0.5)
      if (clear(x, z, 0.5)) cypress.push({ x, z, s: 0.85 + r() * 0.35, yaw: r() * 6.28 })
    }
  // Broad trees along the lawn's edge, thickest to the south-east.
  for (let tries = 0; broad.length < 40 && tries < 6000; tries++) {
    const a = r() * Math.PI * 2
    const l = ESTATE.lawn
    const k = 0.78 + r() * 0.2
    const x = l.x + Math.cos(a) * l.rx * k
    const z = l.z + Math.sin(a) * l.rz * k
    if ((x > l.x && r() < 0.6) || !clear(x, z, 2)) continue
    if (broad.some((b) => Math.hypot(b.x - x, b.z - z) < 6) || palms.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue
    broad.push({ x, z, s: 0.8 + r() * 0.6, yaw: r() * 6.28 })
  }
  return { palms, cypress, broad }
}

export function Grounds() {
  const built = useMemo(() => {
    const drive = drivePath()
    const plants = planting(drive)
    return { drive, plants, road: ribbon(drive, 6, 0.06), palm: palmGeometry(), foliage: blob() }
  }, [])
  const mats = useMemo(
    () => ({
      paving: coastMaterial(new THREE.MeshStandardMaterial({ color: '#c8c2b6', roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      bed: coastMaterial(new THREE.MeshStandardMaterial({ color: '#2b4a1c', roughness: 0.9 })),
      trunk: coastMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })),
      frond: coastMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide })),
      leaves: coastMaterial(new THREE.MeshStandardMaterial({ roughness: 0.85 })),
      bark: coastMaterial(new THREE.MeshStandardMaterial({ color: '#3a2e24', roughness: 0.95 })),
    }),
    [],
  )
  const meshes = useMemo(() => {
    const { palms, cypress, broad } = built.plants
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const v = new THREE.Vector3()
    const sc = new THREE.Vector3()
    const trunks = new THREE.InstancedMesh(built.palm.trunk, mats.trunk, palms.length)
    const crowns = new THREE.InstancedMesh(built.palm.crown, mats.frond, palms.length)
    palms.forEach((p, i) => {
      m.compose(v.set(p.x, standY(p.x, p.z) - 0.1, p.z), q.setFromAxisAngle(up, p.yaw), sc.setScalar(p.s))
      trunks.setMatrixAt(i, m)
      crowns.setMatrixAt(i, m)
    })
    // Cypresses: tall dark spindles. Broad trees: a short trunk under a few heads of leaves.
    const heads = 4
    const leaves = new THREE.InstancedMesh(built.foliage, mats.leaves, cypress.length + broad.length * heads)
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.26, 1, 7).translate(0, 0.5, 0), mats.bark, broad.length)
    const r = rng(17)
    const c = new THREE.Color()
    let n = 0
    for (const t of cypress) {
      const y = standY(t.x, t.z)
      m.compose(v.set(t.x, y + 4.6 * t.s, t.z), q.setFromAxisAngle(up, t.yaw), sc.set(1.05 * t.s, 5.2 * t.s, 1.05 * t.s))
      leaves.setMatrixAt(n, m)
      leaves.setColorAt(n++, c.setRGB(0.025, 0.05, 0.025))
    }
    broad.forEach((t, i) => {
      const y = standY(t.x, t.z)
      const h = 3.2 * t.s
      stems.setMatrixAt(i, m.compose(v.set(t.x, y, t.z), q.setFromAxisAngle(up, t.yaw), sc.set(t.s, h, t.s)))
      for (let k = 0; k < heads; k++) {
        const a = t.yaw + (k / heads) * Math.PI * 2
        const d = k ? 1.6 * t.s : 0
        const w = (k ? 2.2 : 2.8) * t.s * (0.85 + r() * 0.3)
        m.compose(v.set(t.x + Math.cos(a) * d, y + h + (k ? 0.6 : 1.5) * t.s, t.z + Math.sin(a) * d), q.setFromAxisAngle(up, r() * 6.28), sc.set(w, w * 0.8, w))
        leaves.setMatrixAt(n, m)
        leaves.setColorAt(n++, c.setRGB(0.04 + r() * 0.03, 0.075 + r() * 0.04, 0.03 + r() * 0.015))
      }
    })
    for (const mesh of [trunks, crowns, leaves, stems]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    return { trunks, crowns, leaves, stems }
  }, [built, mats])
  const t = ESTATE.turn
  return (
    <group>
      <mesh geometry={built.road} material={mats.paving} receiveShadow />
      <mesh position={[t.x, ESTATE.lawn.y + 0.07, t.z]} rotation-x={-Math.PI / 2} material={mats.paving} receiveShadow>
        <ringGeometry args={[3.2, t.r, 64]} />
      </mesh>
      <mesh position={[t.x, ESTATE.lawn.y + 0.15, t.z]} material={mats.bed} receiveShadow>
        <cylinderGeometry args={[3.2, 3.3, 0.3, 48]} />
      </mesh>
      <primitive object={meshes.trunks} />
      <primitive object={meshes.crowns} />
      <primitive object={meshes.stems} />
      <primitive object={meshes.leaves} />
    </group>
  )
}
