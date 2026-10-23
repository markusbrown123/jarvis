import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Graphics } from '../hub/client'
import { HOUSE } from './layout'
import { SKY } from './sky'
import { BAY, blob, cliffEdge, fbm, ground, landMaterial, coastMaterial, lawnNorm, shore } from './coastland'

/**
 * The coast round the house: the house's headland sits at the back of a
 * wide bay, its sandstone cliffs running away on either side to the bay's
 * two arms, with a strip of beach at their foot. Behind them the land rises
 * through chaparral — dark brush in clumps on dry gold grass, greener on
 * the slopes facing north — to the mountains, fading blue into the haze.
 * Along the cliff tops, the coast road with its streetlights and the cars'
 * lights after dark, and houses: white boxes and glass looking out to sea,
 * their windows lit at night.
 *
 * The land is worked out, not modelled (coastland.ts): its height
 * everywhere comes from the shape of the bay and layers of noise, and its
 * colour per pixel from how steep it is, which way it faces and how far
 * from the water. Here it's built into a mesh round the house, fine close
 * by and coarse in the distance, and furnished.
 */

const SEA = HOUSE.sea

// ---------------------------------------------------------------- building it

const RES: Record<Graphics, { na: number; nr: number; shrubs: number; houses: number; rocks: number }> = {
  low: { na: 420, nr: 130, shrubs: 1400, houses: 45, rocks: 300 },
  high: { na: 720, nr: 200, shrubs: 3600, houses: 70, rocks: 700 },
  ultra: { na: 960, nr: 240, shrubs: 6000, houses: 90, rocks: 1000 },
}
const R0 = 16
const R1 = 2300

/** A polar grid round the house: fine close by, coarse in the distance; only land. */
function landGeometry(na: number, nr: number) {
  const pos = new Float32Array(na * nr * 3)
  const wet = new Uint8Array(na * nr)
  for (let j = 0; j < nr; j++) {
    const r = R0 * Math.pow(R1 / R0, j / (nr - 1))
    for (let i = 0; i < na; i++) {
      const a = (i / na) * Math.PI * 2
      const x = Math.sin(a) * r
      const z = -Math.cos(a) * r
      const g = ground(x, z)
      const k = j * na + i
      pos.set([x, g.h, z], k * 3)
      wet[k] = g.s < -2 ? 1 : 0
    }
  }
  // Valleys: points lower than their neighbours, where the brush grows thick.
  const gully = new Float32Array(na * nr)
  for (let j = 1; j < nr - 1; j++) {
    const r = R0 * Math.pow(R1 / R0, j / (nr - 1))
    for (let i = 0; i < na; i++) {
      const k = j * na + i
      const around = (pos[(k - na) * 3 + 1] + pos[(k + na) * 3 + 1] + pos[(j * na + ((i + 1) % na)) * 3 + 1] + pos[(j * na + ((i + na - 1) % na)) * 3 + 1]) / 4
      gully[k] = Math.min(1, Math.max(0, (around - pos[k * 3 + 1]) / (0.02 * r)))
    }
  }
  const idx: number[] = []
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < na; i++) {
      const a = j * na + i
      const b = j * na + ((i + 1) % na)
      const c = a + na
      const d = b + na
      if (wet[a] && wet[b] && wet[c] && wet[d]) continue
      idx.push(a, b, c, b, d, c)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aGully', new THREE.BufferAttribute(gully, 1))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function rng(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** Slope at a point: 0 flat, 1 a wall. */
function slopeAt(x: number, z: number) {
  const e = 2
  const hx = ground(x + e, z).h - ground(x - e, z).h
  const hz = ground(x, z + e).h - ground(x, z - e).h
  return 1 - 1 / Math.sqrt(1 + (hx * hx + hz * hz) / (4 * e * e))
}

/** Brush, scrub oaks and the odd tall tree, on the gentler ground. */
function shrubs(count: number) {
  const r = rng(11)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const out: { m: THREE.Matrix4; c: THREE.Color }[] = []
  for (let tries = 0; out.length < count && tries < count * 12; tries++) {
    // Denser near the house, thinning out with distance.
    const d = 30 + Math.pow(r(), 1.8) * 720
    const a = r() * Math.PI * 2
    const x = Math.sin(a) * d
    const z = -Math.cos(a) * d
    const g = ground(x, z)
    if (g.s < 14 || Math.hypot(x, z) < cliffEdge(x, z) + 3 || lawnNorm(x, z) < 1.1) continue
    if (slopeAt(x, z) > 0.42) continue
    // In clumps, as chaparral grows.
    if (fbm(x * 0.03 + 4, z * 0.03, 3) < 0.42 + r() * 0.15) continue
    const tree = r() < 0.07
    const w = tree ? 2.2 + r() * 2 : 0.8 + r() * 1.5
    const h = tree ? w * (0.8 + r() * 0.5) : w * (0.5 + r() * 0.35)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2)
    m.compose(new THREE.Vector3(x, g.h + h * 0.35 + (tree ? h * 0.4 : 0), z), q, new THREE.Vector3(w, h, w * (0.8 + r() * 0.4)))
    const c = new THREE.Color().setRGB(0.03 + r() * 0.03, 0.045 + r() * 0.035, 0.022 + r() * 0.015)
    if (r() < 0.18) c.setRGB(0.09, 0.09, 0.055)
    out.push({ m: m.clone(), c })
  }
  return out
}

/** Boulders fallen from the cliffs, along their foot and out into the surf. */
function boulders(count: number) {
  const r = rng(53)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const out: { m: THREE.Matrix4; c: THREE.Color }[] = []
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const th = (r() - 0.5) * 2 * 1.95
    const dist = BAY.r - 25 + r() * 60
    const x = BAY.cx + Math.sin(th) * dist
    const z = BAY.cz + Math.cos(th) * dist
    const g = ground(x, z)
    if (g.s < -6 || g.h > SEA + 3 || Math.hypot(x, z) < cliffEdge(x, z) + 4) continue
    const size = 0.4 + Math.pow(r(), 2.5) * 3.2
    e.set(r() * 6, r() * 6, r() * 6)
    m.compose(new THREE.Vector3(x, Math.max(g.h, SEA - 1.5) + size * 0.3, z), q.setFromEuler(e), new THREE.Vector3(size * (0.8 + r() * 0.5), size * (0.6 + r() * 0.4), size))
    const k = 0.75 + r() * 0.4
    out.push({ m: m.clone(), c: new THREE.Color(0.36 * k, 0.29 * k, 0.21 * k) })
  }
  return out
}

type Home = { x: number; y: number; z: number; yaw: number; w: number; d: number; h: number; lit: boolean; up: boolean; wall: THREE.Color; roof: THREE.Color }

const WALLS = ['#ece8df', '#ece8df', '#dccfb9', '#a9a8a3', '#6e5644']
const ROOFS = ['#f1eee8', '#2c2d30']

/** Houses along the cliff tops, a few more up the hills, all looking out to sea. */
function homes(count: number) {
  const r = rng(29)
  const out: Home[] = []
  for (let tries = 0; out.length < count && tries < count * 80; tries++) {
    const d = 140 + Math.pow(r(), 1.2) * 1050
    const a = r() * Math.PI * 2
    const x = Math.sin(a) * d
    const z = -Math.cos(a) * d
    const g = ground(x, z)
    // Most along the cliff tops, past the road; in neighbourhoods, not evenly spread.
    const row = g.s > 48 && g.s < 170
    if (!row && (g.s < 170 || g.s > 650 || r() < 0.55)) continue
    if (lawnNorm(x, z) < 1.4) continue
    if (fbm(x * 0.006 + 1, z * 0.006 + 4, 3) < 0.46) continue
    if (slopeAt(x, z) > 0.2) continue
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 32)) continue
    // Facing the water: towards the middle of the bay.
    const yaw = Math.atan2(BAY.cx - x, BAY.cz - z)
    const w = 11 + r() * 9
    out.push({
      x,
      y: g.h,
      z,
      yaw,
      w,
      d: 8 + r() * 5,
      h: 3.2 + r() * 0.8,
      lit: r() < 0.7,
      up: r() < 0.6,
      wall: new THREE.Color(WALLS[Math.floor(r() * WALLS.length)]),
      roof: new THREE.Color(ROOFS[r() < 0.7 ? 0 : 1]),
    })
  }
  return out
}

/** The coast road along the cliff tops, as points every few metres. */
function roadPath() {
  const pts: THREE.Vector3[] = []
  for (let th = -1.95; th <= 1.95; th += 0.0025) {
    // Walk inland from the bay's edge to 32 m past the cliff tops.
    const dir = new THREE.Vector2(Math.sin(th), Math.cos(th))
    let lo = BAY.r - 40
    let hi = BAY.r + 160
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      const s = shore(BAY.cx + dir.x * mid, BAY.cz + dir.y * mid)
      if (s < 32) lo = mid
      else hi = mid
    }
    if (shore(BAY.cx + dir.x * lo, BAY.cz + dir.y * lo) > 40) {
      if (pts.length && pts[pts.length - 1].x !== Infinity) pts.push(new THREE.Vector3(Infinity, 0, 0))
      continue
    }
    // Round the back of the estate's grounds, not through them.
    while (lawnNorm(BAY.cx + dir.x * lo, BAY.cz + dir.y * lo) < 1.18 && lo < BAY.r + 400) lo += 1.5
    const x = BAY.cx + dir.x * lo
    const z = BAY.cz + dir.y * lo
    if (Math.hypot(x, z) < 70) {
      if (pts.length && pts[pts.length - 1].x !== Infinity) pts.push(new THREE.Vector3(Infinity, 0, 0))
      continue
    }
    pts.push(new THREE.Vector3(x, ground(x, z).h, z))
  }
  return pts
}

function roadGeometry(path: THREE.Vector3[]) {
  const pos: number[] = []
  const idx: number[] = []
  let start = -1
  const side = new THREE.Vector3()
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    if (p.x === Infinity) {
      start = -1
      continue
    }
    const q = path[i + 1] && path[i + 1].x !== Infinity ? path[i + 1] : path[i - 1]
    if (!q || q.x === Infinity) continue
    side.set(q.z - p.z, 0, -(q.x - p.x)).normalize().multiplyScalar(4.5)
    const n = pos.length / 3
    const hl = ground(p.x + side.x, p.z + side.z).h
    const hr = ground(p.x - side.x, p.z - side.z).h
    const y = Math.max(p.y, hl, hr) + 0.25
    pos.push(p.x + side.x, y, p.z + side.z, p.x - side.x, y, p.z - side.z)
    if (start >= 0) idx.push(n - 2, n - 1, n, n - 1, n + 1, n)
    start = n
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function Coast({ graphics }: { graphics: Graphics }) {
  const res = RES[graphics]
  const built = useMemo(() => {
    const land = landGeometry(res.na, res.nr)
    const brush = shrubs(res.shrubs)
    const rocks = boulders(res.rocks)
    const houses = homes(res.houses)
    const path = roadPath()
    const road = roadGeometry(path)
    const lane = path.filter((p) => p.x !== Infinity)
    // Night lights: windows, streetlights every 40 m, and the towns up the hills.
    const lights: number[] = []
    const colors: number[] = []
    const warm = [1, 0.7, 0.4]
    const sodium = [1, 0.62, 0.28]
    const r = rng(41)
    for (const h of houses) {
      if (!h.lit) continue
      const fx = Math.sin(h.yaw)
      const fz = Math.cos(h.yaw)
      for (let k = 0; k < 3; k++) {
        const s = (r() - 0.5) * h.w * 0.8
        lights.push(h.x + fx * (h.d / 2 + 0.3) + fz * s, h.y + 1.6 + (h.up && r() < 0.5 ? h.h : 0), h.z + fz * (h.d / 2 + 0.3) - fx * s)
        colors.push(...warm.map((v) => v * (0.7 + r() * 0.8)))
      }
    }
    lane.forEach((p, i) => {
      if (i % 16) return
      lights.push(p.x, p.y + 7, p.z)
      colors.push(...sodium.map((v) => v * 1.3))
    })
    for (let i = 0; i < 900; i++) {
      const d = 900 + r() * 1300
      const a = (r() - 0.5) * 2 * 2.6
      const x = Math.sin(a) * d
      const z = -Math.cos(a) * d
      const g = ground(x, z)
      if (g.s < 60 || fbm(x * 0.004, z * 0.004 + 2, 3) < 0.48) continue
      lights.push(x, g.h + 2, z)
      colors.push(...(r() < 0.8 ? warm : [0.8, 0.88, 1]).map((v) => v * (0.5 + r())))
    }
    const lightGeo = new THREE.BufferGeometry()
    lightGeo.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3))
    lightGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return { land, brush, rocks, houses, road, lane, lightGeo }
  }, [res])

  const mats = useMemo(
    () => ({
      land: landMaterial(),
      brush: coastMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9 })),
      wall: coastMaterial(new THREE.MeshStandardMaterial({ roughness: 0.8 })),
      rock: coastMaterial(new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true })),
      glass: coastMaterial(new THREE.MeshStandardMaterial({ color: '#0b0e12', roughness: 0.06, envMapIntensity: 1.4, emissive: new THREE.Color('#ffb070'), emissiveIntensity: 0 })),
      road: coastMaterial(new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      dots: new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, opacity: 0 }),
      cars: new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, opacity: 0 }),
    }),
    [],
  )

  const brush = useMemo(() => {
    const mesh = new THREE.InstancedMesh(blob(), mats.brush, built.brush.length)
    built.brush.forEach((b, i) => {
      mesh.setMatrixAt(i, b.m)
      mesh.setColorAt(i, b.c)
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }, [built, mats])

  // Each house: a box, an upper storey set back on most, flat roofs
  // overhanging both, and glass across the front of each floor.
  const houses = useMemo(() => {
    const n = built.houses.length * 2
    const box = new THREE.BoxGeometry(1, 1, 1)
    const walls = new THREE.InstancedMesh(box, mats.wall, n)
    const roofs = new THREE.InstancedMesh(box, mats.wall, n)
    const glass = new THREE.InstancedMesh(box, mats.glass, n)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const v = new THREE.Vector3()
    const s = new THREE.Vector3()
    const f = new THREE.Vector3()
    let k = 0
    for (const h of built.houses) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw)
      f.set(Math.sin(h.yaw), 0, Math.cos(h.yaw))
      for (let st = 0; st < (h.up ? 2 : 1); st++) {
        const w = st ? h.w * 0.62 : h.w
        const d = st ? h.d * 0.7 : h.d
        const base = h.y + (st ? h.h + 0.35 : 0)
        const back = st ? -h.d * 0.18 : 0
        // Walls (run down into the ground on a slope), the roof slab, the glass.
        const sunk = st ? 0 : 2.5
        v.set(h.x, base - sunk + (h.h + sunk) / 2, h.z).addScaledVector(f, back)
        walls.setMatrixAt(k, m.compose(v, q, s.set(w, h.h + sunk, d)))
        walls.setColorAt(k, h.wall)
        v.set(h.x, base + h.h + 0.17, h.z).addScaledVector(f, back + 0.5)
        roofs.setMatrixAt(k, m.compose(v, q, s.set(w + 1.2, 0.35, d + 2.2)))
        roofs.setColorAt(k, h.roof)
        v.set(h.x, base + h.h * 0.46, h.z).addScaledVector(f, back + d / 2 + 0.03)
        glass.setMatrixAt(k, m.compose(v, q, s.set(w * 0.88, h.h * 0.8, 0.12)))
        glass.setColorAt(k, new THREE.Color().setScalar(h.lit ? 1 : 0.02))
        k++
      }
    }
    for (const mesh of [walls, roofs, glass]) {
      mesh.count = k
      mesh.castShadow = mesh !== glass
      mesh.receiveShadow = true
    }
    return { walls, roofs, glass }
  }, [built, mats])

  const rocks = useMemo(() => {
    const mesh = new THREE.InstancedMesh(blob(true), mats.rock, built.rocks.length)
    built.rocks.forEach((b, i) => {
      mesh.setMatrixAt(i, b.m)
      mesh.setColorAt(i, b.c)
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }, [built, mats])

  // Cars along the road after dark: white lights one way, red the other.
  const cars = useMemo(() => {
    const N = Math.min(60, Math.floor(built.lane.length / 30))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3))
    const col = new Float32Array(N * 3)
    const r = rng(77)
    const list = Array.from({ length: N }, (_, i) => {
      const dir = i % 2 ? 1 : -1
      col.set(dir > 0 ? [1.4, 1.3, 1.1] : [1.6, 0.08, 0.05], i * 3)
      return { at: r() * built.lane.length, dir, speed: 14 + r() * 8 }
    })
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    return { g, list }
  }, [built])

  useFrame((_, dt) => {
    // The lights come on as it gets dark.
    const dusk = Math.min(1, Math.max(0, (SKY.uExposure.value - 1.5) / 4))
    mats.dots.opacity = dusk
    mats.cars.opacity = dusk
    mats.glass.emissiveIntensity = dusk * 1.6
    if (dusk <= 0) return
    const p = cars.g.attributes.position as THREE.BufferAttribute
    const L = built.lane
    cars.list.forEach((c, i) => {
      // The road's points are about 1.6 m apart.
      c.at = (c.at + (c.dir * c.speed * Math.min(dt, 0.1)) / 1.6 + L.length) % L.length
      const a = L[Math.floor(c.at)]
      const b = L[Math.min(L.length - 1, Math.floor(c.at) + 1)]
      const t = c.at % 1
      p.setXYZ(i, a.x + (b.x - a.x) * t, Math.max(a.y, b.y) + 1.0, a.z + (b.z - a.z) * t)
    })
    p.needsUpdate = true
  })

  return (
    <group>
      <mesh geometry={built.land} material={mats.land} receiveShadow />
      <mesh geometry={built.road} material={mats.road} receiveShadow />
      <primitive object={brush} />
      <primitive object={rocks} />
      <primitive object={houses.walls} />
      <primitive object={houses.roofs} />
      <primitive object={houses.glass} />
      <points geometry={built.lightGeo} material={mats.dots} frustumCulled={false} />
      <points geometry={cars.g} material={mats.cars} frustumCulled={false} />
    </group>
  )
}
