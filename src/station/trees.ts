import * as THREE from 'three'
import { coastMaterial } from './coastland'
import { SKY } from './sky'

/**
 * Trees the way games build them: wood as real tapered geometry, foliage as
 * alpha-cut cards (tools/textures/foliage.py draws the leaves), so a handful
 * of quads reads as hundreds of leaves. The cards' normals point out from
 * the middle of the crown, so a canopy shades as one soft mass, lit on the
 * sunny side, dark underneath, never flat cards.
 *
 * And they move with the real wind (weather.ts): a tree leans downwind and
 * sways, more the higher up, in gusts that come and go; leaves and frond
 * tips flutter. Every vertex carries how free it is to move (aFlex).
 *
 *   palm      a ringed, curving trunk; a crown of drooping fronds folded
 *             along their midribs, a few dead ones hanging, coconuts
 *   broadleaf a trunk forking into branches, leaf clusters at their tips
 *   cypress   a column of flame-shaped sprays round a short trunk
 *   shrub     a clump of crossed cards (chaparral, garden shrubs)
 */

const FOLIAGE = '/station/foliage/'

class Mesh {
  pos: number[] = []
  nrm: number[] = []
  uv: number[] = []
  col: number[] = []
  flex: number[] = []
  idx: number[] = []
  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, flex: number, c: [number, number, number] = [1, 1, 1]) {
    this.pos.push(p.x, p.y, p.z)
    this.nrm.push(n.x, n.y, n.z)
    this.uv.push(u, v)
    this.col.push(...c)
    this.flex.push(flex)
    return this.pos.length / 3 - 1
  }
  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('aFlex', new THREE.Float32BufferAttribute(this.flex, 1))
    g.setIndex(this.idx)
    return g
  }
  /** A tapered tube along points, bark UVs tiling `tile` metres up. */
  tube(path: THREE.Vector3[], r0: number, r1: number, sides: number, flexAt: (t: number) => number, tile = 1.2, c?: [number, number, number]) {
    const base = this.pos.length / 3
    const up = new THREE.Vector3(0, 1, 0)
    const side = new THREE.Vector3()
    const other = new THREE.Vector3()
    let along = 0
    path.forEach((p, i) => {
      const t = i / (path.length - 1)
      if (i) along += p.distanceTo(path[i - 1])
      const dir = path[Math.min(i + 1, path.length - 1)].clone().sub(path[Math.max(i - 1, 0)]).normalize()
      side.copy(Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).cross(dir).normalize()
      other.crossVectors(dir, side)
      const r = r0 + (r1 - r0) * t
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2
        const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(other, Math.sin(a))
        this.vert(p.clone().addScaledVector(n, r), n, k / sides, along / tile, flexAt(t), c)
      }
    })
    for (let i = 0; i < path.length - 1; i++)
      for (let k = 0; k < sides; k++) {
        const a = base + i * (sides + 1) + k
        const b = a + sides + 1
        this.idx.push(a, a + 1, b, a + 1, b + 1, b)
      }
  }
  /** A flat card centred at c, spanning `right` and `up`, its normals bent out from `centre`. */
  card(c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, centre: THREE.Vector3, flex: [number, number], bend = 0.75) {
    const face = new THREE.Vector3().crossVectors(right, up).normalize()
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    const ids = corners.map(([sx, sy]) => {
      const p = c.clone().addScaledVector(right, sx).addScaledVector(up, sy)
      const out = p.clone().sub(centre).normalize()
      const n = face.clone().multiplyScalar(Math.sign(face.dot(out)) || 1).lerp(out, bend).normalize()
      return this.vert(p, n, (sx + 1) / 2, (sy + 1) / 2, sy < 0 ? flex[0] : flex[1])
    })
    this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3])
  }
}

function rng(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

export type TreeParts = { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; height: number }

/** A palm, 10 m: trunk and coconuts as wood; fronds (green and a few dead) as leaves. */
export function palm(): TreeParts {
  const H = 10
  const wood = new Mesh()
  const trunk: THREE.Vector3[] = []
  for (let i = 0; i <= 14; i++) {
    const t = i / 14
    trunk.push(new THREE.Vector3(1.1 * Math.pow(t, 1.7), t * H, 0))
  }
  // Flared at the foot: the first rings wider.
  wood.tube(trunk.slice(0, 2), 0.42, 0.24, 9, (t) => 0.02 * t, 1.3)
  wood.tube(trunk.slice(1), 0.24, 0.16, 9, (t) => 0.05 + 0.15 * t, 1.3)
  const top = trunk[trunk.length - 1]
  const r = rng(5)
  // Coconuts in a bunch under the crown.
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2
    const c = top.clone().add(new THREE.Vector3(Math.cos(a) * 0.28, -0.45 - r() * 0.25, Math.sin(a) * 0.28))
    const g = new THREE.SphereGeometry(0.13, 6, 4)
    const p = g.attributes.position as THREE.BufferAttribute
    const n = g.attributes.normal as THREE.BufferAttribute
    const base = wood.pos.length / 3
    for (let i = 0; i < p.count; i++) {
      wood.vert(new THREE.Vector3().fromBufferAttribute(p, i).add(c), new THREE.Vector3().fromBufferAttribute(n, i), 0.1, 0.1, 0.25, [0.55, 0.42, 0.2])
    }
    for (const i of g.index!.array) wood.idx.push(base + i)
  }
  const leaves = new Mesh()
  const centre = top.clone().add(new THREE.Vector3(0, 0.3, 0))
  const fronds = 18
  for (let f = 0; f < fronds + 4; f++) {
    const dead = f >= fronds
    const az = (f / (dead ? 4 : fronds)) * Math.PI * 2 + r() * 0.35
    const inner = !dead && f % 3 === 0
    const el = dead ? -1.25 + r() * 0.2 : inner ? 0.85 + r() * 0.3 : 0.12 + r() * 0.45
    const L = (dead ? 2.4 : inner ? 2.8 : 3.6) * (0.85 + r() * 0.3)
    const droop = dead ? 0.1 : inner ? 0.35 : 1.3 + r() * 0.6
    const W = dead ? 0.7 : 1.15
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az))
    const fold = dead ? 0.15 : 0.32
    // frond.png has the green frond on its left half, a dead one on its right.
    const u0 = dead ? 0.5 : 0
    const shade = 0.85 + r() * 0.3
    const col: [number, number, number] = [shade, shade, shade * (0.9 + r() * 0.2)]
    const n = 8
    const ids: number[][] = []
    for (let i = 0; i <= n; i++) {
      const s = i / n
      const spine = top.clone().addScaledVector(dir, s * L)
      spine.y -= droop * s * s * L * 0.45
      const row: number[] = []
      for (const sd of [-1, 0, 1]) {
        const p = spine.clone().addScaledVector(side, (sd * W) / 2)
        if (sd) p.y -= (W / 2) * fold
        const nrm = p.clone().sub(centre).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize()
        row.push(leaves.vert(p, nrm, u0 + (sd + 1) / 4, s, s, col))
      }
      ids.push(row)
    }
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 2; k++) leaves.idx.push(ids[i][k], ids[i + 1][k], ids[i][k + 1], ids[i][k + 1], ids[i + 1][k], ids[i + 1][k + 1])
  }
  return { wood: wood.geometry(), leaves: leaves.geometry(), height: H }
}

/** A broad tree (oak/ficus-like), about 7 m; `seed` makes each variant different. */
export function broadleaf(seed: number): TreeParts {
  const r = rng(seed)
  const wood = new Mesh()
  const leaves = new Mesh()
  const H = 6.5
  const tips: THREE.Vector3[] = []
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const pts: THREE.Vector3[] = []
    const bend = new THREE.Vector3(r() - 0.5, 0.15, r() - 0.5).multiplyScalar(0.35)
    const segs = depth === 2 ? 2 : depth ? 3 : 5
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      pts.push(from.clone().addScaledVector(dir, len * t).addScaledVector(bend, len * t * t))
    }
    const end = pts[pts.length - 1]
    const h0 = from.y / H
    wood.tube(pts, rad, rad * 0.6, depth === 2 ? 3 : depth ? 5 : 8, (t) => Math.pow(Math.min(1.2, h0 + t * (len / H)), 2) * 0.6, 1.0)
    if (depth >= 2) {
      tips.push(end)
      return
    }
    if (depth) tips.push(end, pts[1])
    const kids = depth ? 2 + Math.floor(r() * 2) : 4 + Math.floor(r() * 2)
    for (let k = 0; k < kids; k++) {
      const a = (k / kids) * Math.PI * 2 + r()
      const d = new THREE.Vector3(Math.cos(a), depth ? 0.6 + r() * 0.5 : 0.45 + r() * 0.4, Math.sin(a)).normalize()
      grow(end, d, len * (depth ? 0.6 + r() * 0.15 : 0.8 + r() * 0.2), rad * 0.6, depth + 1)
    }
  }
  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(r() * 0.1, 1, r() * 0.1).normalize(), 2.2 + r() * 0.5, 0.24, 0)
  const centre = tips.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(tips.length)
  centre.y -= 0.3
  for (const tip of tips) {
    for (let k = 0; k < 5; k++) {
      const s = 1.0 + r() * 0.6
      const yaw = r() * Math.PI
      const tilt = (r() - 0.5) * 1.2
      const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(s)
      const up = new THREE.Vector3(-Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt)).multiplyScalar(s)
      const c = tip.clone().add(new THREE.Vector3((r() - 0.5) * 0.8, (r() - 0.3) * 0.6, (r() - 0.5) * 0.8))
      leaves.card(c, right, up, centre, [0.5, 1])
    }
  }
  return { wood: wood.geometry(), leaves: leaves.geometry(), height: H }
}

/** An Italian cypress, about 10 m: a short trunk in a tall column of sprays. */
export function cypress(): TreeParts {
  const r = rng(9)
  const wood = new Mesh()
  wood.tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.4, 0)], 0.16, 0.12, 7, () => 0, 1)
  const leaves = new Mesh()
  const H = 10
  for (let y = 0.9; y < H; y += 0.55) {
    const t = y / H
    const w = 0.95 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)), 0.8) + 0.15
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + r() * 0.6
      const right = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(w)
      const up = new THREE.Vector3(0, 0.95, 0)
      leaves.card(new THREE.Vector3((r() - 0.5) * 0.15, y, (r() - 0.5) * 0.15), right, up, new THREE.Vector3(0, y, 0), [t * 0.6, t * 0.8], 0.85)
    }
  }
  return { wood: wood.geometry(), leaves: leaves.geometry(), height: H }
}

/** A shrub about 1 m high and 2 m across: crossed cards and a domed top. */
export function shrub(seed: number): TreeParts {
  const r = rng(seed)
  const leaves = new Mesh()
  const centre = new THREE.Vector3(0, 0.25, 0)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI + r() * 0.4
    leaves.card(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), new THREE.Vector3(0, 0.55, 0), centre, [0, 0.8])
  }
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2
    const tilt = 0.5 + r() * 0.4
    const right = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.9)
    const up = new THREE.Vector3(-Math.sin(a) * Math.cos(tilt), Math.sin(tilt), Math.cos(a) * Math.cos(tilt)).multiplyScalar(0.7)
    leaves.card(new THREE.Vector3((r() - 0.5) * 0.5, 0.65, (r() - 0.5) * 0.5), right, up, centre, [0.3, 1])
  }
  return { wood: new THREE.BufferGeometry(), leaves: leaves.geometry(), height: 1.2 }
}

// ---------------------------------------------------------------- materials

const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uSwayH;
uniform float uFlutter;
attribute float aFlex;
// How far the wind moves this vertex (in the mesh's own units).
vec3 windOffset(vec3 p) {
  vec3 base = vec3(0.0);
  mat3 toLocal = mat3(1.0);
  #ifdef USE_INSTANCING
    base = instanceMatrix[3].xyz;
    toLocal = transpose(mat3(instanceMatrix)) / dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz);
  #endif
  float ph = dot(base.xz, vec2(0.37, 0.71));
  float w = length(uWind);
  vec2 dir = w > 0.01 ? uWind / w : vec2(1.0, 0.0);
  float gust = 0.55 + 0.45 * sin(uTime * 0.6 + ph * 0.21) * sin(uTime * 0.23 + ph);
  float h = clamp(p.y / uSwayH, 0.0, 1.5);
  float bend = h * h * uSwayH;
  // Leaning downwind in the gusts, and swaying.
  vec2 sway = dir * w * (0.0015 + 0.0025 * gust) * bend
            + vec2(sin(uTime * 1.1 + ph), cos(uTime * 0.9 + ph * 1.7)) * (0.0025 + 0.0008 * w) * bend;
  // Leaves and frond tips flutter.
  vec3 flutter = vec3(sin(uTime * 5.3 + ph + p.y * 2.1), 0.6 * sin(uTime * 6.7 + ph * 1.3 + p.x * 2.7), cos(uTime * 4.9 + ph + p.z * 2.3))
               * aFlex * uFlutter * (0.4 + 0.1 * w) * (0.7 + 0.5 * gust);
  return toLocal * vec3(sway.x, 0.0, sway.y) + flutter;
}
`

// Alpha-cut leaves thin out in the distance as the mipmaps average their
// edges away; scaling alpha up by the mip level keeps a far crown as full
// as a near one.
const MIP_ALPHA = /* glsl */ `
#ifdef USE_MAP
  vec2 texel = vMapUv * vec2(textureSize(map, 0));
  float mip = max(0.0, 0.5 * log2(max(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)))));
  diffuseColor.a *= 1.0 + mip * 0.25;
#endif
#include <alphatest_fragment>`

function addWind(shader: THREE.WebGLProgramParametersWithUniforms, height: number, flutter: number) {
  Object.assign(shader.uniforms, { uTime: SKY.uTime, uWind: SKY.uWind, uSwayH: { value: height }, uFlutter: { value: flutter } })
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WIND_GLSL}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += windOffset(transformed);')
  shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', MIP_ALPHA)
}

/**
 * A material that moves with the wind (and fades into the haze like the rest
 * of the coast): `height` is how tall the plant is in its own units, `flutter`
 * how much its tips shake (metres). Foliage cards keep their bent normals on
 * both sides, so a crown shades as one mass.
 */
export function windy(m: THREE.MeshStandardMaterial, height: number, flutter: number) {
  coastMaterial(m)
  const haze = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    haze.call(m, shader, renderer)
    addWind(shader, height, flutter)
    if (m.side === THREE.DoubleSide)
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
  }
  m.customProgramCacheKey = () => `windy-${m.side}`
  m.userData.wind = { height, flutter }
  return m
}

/** The shadow a windy material casts, swaying with it (three copies the map and alpha cut-out in). */
function windyDepth(height: number, flutter: number) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  m.onBeforeCompile = (shader) => addWind(shader, height, flutter)
  m.customProgramCacheKey = () => 'windy-depth'
  return m
}

const loaded = new Map<string, THREE.Texture>()
/** A foliage texture (loaded once; the opening waits for it like everything else). */
export function foliageTexture(name: string) {
  let t = loaded.get(name)
  if (!t) {
    t = new THREE.TextureLoader().load(FOLIAGE + name)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    if (name.endsWith('.jpg')) t.wrapS = t.wrapT = THREE.RepeatWrapping
    loaded.set(name, t)
  }
  return t
}

/** Leaves: alpha-cut cards, two-sided, tinted per vertex and per instance. */
export function leafMaterial(texture: string, height: number, flutter = 0.06) {
  return windy(new THREE.MeshStandardMaterial({ map: foliageTexture(texture), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.78, vertexColors: true }), height, flutter)
}

/** Wood: bark, swaying with its tree. */
export function woodMaterial(texture: string, height: number) {
  return windy(new THREE.MeshStandardMaterial({ map: foliageTexture(texture), roughness: 0.92, vertexColors: true }), height, 0)
}

export type Plant = { x: number; y: number; z: number; s: number; yaw: number; tint?: THREE.Color }

/**
 * One kind of tree at many places: its wood and its leaves as instanced
 * meshes, a pair per `cell` metres of ground, so only the cells in view get
 * drawn (and only those near the house go into its shadow map). Shadows
 * sway with the trees.
 */
export function grove(parts: TreeParts, at: Plant[], wood: THREE.MeshStandardMaterial | null, leaves: THREE.MeshStandardMaterial, { cell = 60, shadows = true } = {}) {
  const group = new THREE.Group()
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const white = new THREE.Color(1, 1, 1)
  const cells = new Map<string, Plant[]>()
  for (const p of at) {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`
    cells.set(k, [...(cells.get(k) ?? []), p])
  }
  for (const here of cells.values())
    for (const [geometry, material] of [
      [parts.wood, wood],
      [parts.leaves, leaves],
    ] as const) {
      if (!material || !geometry.attributes.position) continue
      const mesh = new THREE.InstancedMesh(geometry, material, here.length)
      here.forEach((p, i) => {
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), new THREE.Vector3(p.s, p.s, p.s)))
        mesh.setColorAt(i, p.tint ?? white)
      })
      if (shadows) {
        const w = material.userData.wind as { height: number; flutter: number }
        mesh.customDepthMaterial = windyDepth(w.height, w.flutter)
        mesh.castShadow = true
      }
      mesh.receiveShadow = shadows
      // Bound this cell's trees, not the one tree at the origin.
      mesh.computeBoundingSphere()
      group.add(mesh)
    }
  return group
}
