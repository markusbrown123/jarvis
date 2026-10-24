import { useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Graphics } from '../hub/client'
import { OUTDOOR } from './environment'
import { ESTATE, HOUSE } from './layout'
import { SKY } from './sky'
import { cliffEdge, coastMaterial, ground, lawnNorm } from './coastland'
import { GARDEN } from './garden'
import { splitByPlace } from './split'
import { broadleaf, cypress as cypressTree, grove, leafMaterial, palm, shrub, woodMaterial, type Plant } from './trees'

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
 * walls, broad trees along the lawn's edge, shrubs round the pavilions' feet
 * (trees.ts: built the way games build them, swaying in the live wind), and
 * the drive itself winding in from the coast road to a turning circle under
 * the helipad's ramp.
 */

const MODEL = '/station/estate.glb'
const WARM = new THREE.Color(1.0, 0.62, 0.32)
const EDGE = new THREE.Color(0.7, 0.85, 1.6)

/**
 * The wings stand close against the house, and two reach inside its wall:
 * the one behind it showed a column and the edge of its roof in the room, by
 * the back wall, and where its faces met the wall's they flickered through.
 * Nothing of the estate is drawn inside the house, out to the wall's outer
 * face — there it's within the walls and under the house's roof, so from
 * outside nothing changes — and nothing there casts a shadow into the room.
 */
const INSIDE = `length(vEstateW.xz) < ${(HOUSE.r + 0.45).toFixed(2)} && vEstateW.y < ${(HOUSE.ceiling + 0.4).toFixed(2)}`
function outsideOnly<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEstateW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvEstateW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEstateW;')
      .replace('void main() {', `void main() {\n  if (${INSIDE}) discard;`)
  }
  m.customProgramCacheKey = () => 'estate-outside-only'
  return m
}

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
    const outdoor = <M extends THREE.MeshStandardMaterial>(m: M) => (OUTDOOR.add(outsideOnly(m)), m)
    return {
      white: outdoor(new THREE.MeshStandardMaterial({ map: maps[0], roughness: 0.7, envMapIntensity: 0.7 })),
      pad: outdoor(new THREE.MeshStandardMaterial({ map: maps[1], roughness: 0.85 })),
      paint: outdoor(new THREE.MeshStandardMaterial({ color: '#e9e8e3', roughness: 0.6 })),
      glass: outdoor(new THREE.MeshStandardMaterial({ color: '#091017', roughness: 0.04, metalness: 0.2, envMapIntensity: 1.8, transparent: true, opacity: 0.86 })),
      frames: outdoor(new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.35, metalness: 0.7 })),
      glow: outsideOnly(new THREE.MeshBasicMaterial({ color: '#000' })),
      lights: outsideOnly(new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false })),
      // What casts the shadows, with the same cut.
      depth: outsideOnly(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })),
    }
  }, [maps])

  useFrame(() => {
    // After dark the rooms behind the glass glow warm and the helipad lights up.
    const dusk = Math.min(1, Math.max(0, (SKY.uExposure.value - 1.4) / 6))
    mats.glow.color.setRGB(0.05, 0.045, 0.04).lerp(WARM, dusk).multiplyScalar(0.25 + dusk * 0.9)
    mats.lights.color.setRGB(0.2, 0.2, 0.2).lerp(EDGE, dusk)
  })

  // Each pavilion, the helipad and the ramp drawn as pieces of their own,
  // so from the desk (looking out to sea) none of them are drawn at all.
  const pieces = useMemo(() => {
    const anchors = [...ESTATE.wings.map(([x, z]) => [x, z]), [ESTATE.helipad.x, ESTATE.helipad.z], [ESTATE.turn.x, ESTATE.turn.z]]
    const nearest = (c: THREE.Vector3) => anchors.reduce((best, [x, z], i) => (Math.hypot(c.x - x, c.z - z) < Math.hypot(c.x - anchors[best][0], c.z - anchors[best][1]) ? i : best), 0)
    return Object.fromEntries(Object.entries(nodes).filter(([, o]) => o.isMesh).map(([n, o]) => [n, splitByPlace(o.geometry, nearest)]))
  }, [nodes])

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
        nodes[n]
          ? pieces[n].map((g, i) => (
              <mesh key={`${n}${i}`} geometry={g} position={nodes[n].position} quaternion={nodes[n].quaternion} material={m} customDepthMaterial={cast ? mats.depth : undefined} castShadow={cast} receiveShadow={n !== 'glass'} renderOrder={n === 'glass' ? 4 : 0} />
            ))
          : null,
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
  // Garden shrubs in drifts round the foot of each pavilion.
  const shrubs: Tree[] = []
  for (let tries = 0; shrubs.length < 160 && tries < 6000; tries++) {
    const [wx, wz, wr] = ESTATE.wings[Math.floor(r() * ESTATE.wings.length)]
    const a = r() * Math.PI * 2
    const d = wr + 1.4 + r() * 2.6
    const x = wx + Math.cos(a) * d
    const z = wz + Math.sin(a) * d
    if (!clear(x, z, 0) || shrubs.some((b) => Math.hypot(b.x - x, b.z - z) < 1.3) || palms.some((p) => Math.hypot(p.x - x, p.z - z) < 1.2)) continue
    shrubs.push({ x, z, s: 0.6 + r() * 0.5, yaw: r() * 6.28 })
  }
  // And the house's own garden (lair.glb's), less any under the pavilions.
  const free = (x: number, z: number) => !ESTATE.wings.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 1) && Math.hypot(x - 1, z - 17) > 3.5
  const garden = GARDEN.trees.filter(([x, z]) => free(x, z)).map(([x, z, top]) => ({ x, z, s: top / 6.5, yaw: r() * 6.28 }))
  for (const [x, z, w] of GARDEN.shrubs) if (free(x, z)) shrubs.push({ x, z, s: w / 2, yaw: r() * 6.28 })
  return { palms, cypress, broad: [...broad, ...garden], shrubs }
}

export function Grounds() {
  const built = useMemo(() => {
    const drive = drivePath()
    return { drive, plants: planting(drive), road: ribbon(drive, 6, 0.06) }
  }, [])
  const mats = useMemo(
    () => ({
      paving: coastMaterial(new THREE.MeshStandardMaterial({ color: '#c8c2b6', roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      bed: coastMaterial(new THREE.MeshStandardMaterial({ color: '#2b4a1c', roughness: 0.9 })),
      palmBark: woodMaterial('palmbark.jpg', 10),
      fronds: leafMaterial('frond.png', 10, 0.08),
      bark: woodMaterial('bark.jpg', 6.5),
      leaves: leafMaterial('leaves.png', 6.5, 0.05),
      cypress: leafMaterial('cypress.png', 10, 0.02),
      shrubs: leafMaterial('leaves.png', 1.2, 0.03),
    }),
    [],
  )
  // Palms, cypresses, three shapes of broad tree and the shrubs: two draw
  // calls a kind, every tree a little different in size, turn and green.
  const groves = useMemo(() => {
    const { palms, cypress, broad, shrubs } = built.plants
    const r = rng(17)
    const at = (t: { x: number; z: number; s: number; yaw: number }, dy: number, green: number): Plant => {
      const k = 1 - green / 2 + r() * green
      return { x: t.x, y: standY(t.x, t.z) + dy, z: t.z, s: t.s, yaw: t.yaw, tint: new THREE.Color(k * (0.92 + r() * 0.16), k, k * (0.9 + r() * 0.2)) }
    }
    const kinds = [broadleaf(3), broadleaf(8), broadleaf(13)]
    return [
      grove(palm(), palms.map((t) => at(t, -0.1, 0.2)), mats.palmBark, mats.fronds),
      grove(cypressTree(), cypress.map((t) => at(t, -0.05, 0.15)), mats.bark, mats.cypress),
      ...kinds.map((k, i) =>
        grove(
          k,
          broad.filter((_, j) => j % kinds.length === i).map((t) => at(t, -0.05, 0.3)),
          mats.bark,
          mats.leaves,
        ),
      ),
      grove(shrub(4), shrubs.map((t) => at(t, -0.1, 0.3)), null, mats.shrubs),
    ]
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
      {groves.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
    </group>
  )
}
