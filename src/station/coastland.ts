import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { OUTDOOR } from './environment'
import { ESTATE, HOUSE } from './layout'
import { SKY } from './sky'

/**
 * The land round the bay (coast.tsx draws it): the bay's shape, the
 * ground's height anywhere, and how the ground is shaded — sandstone where
 * it's steep, chaparral on the slopes, sand at the water — which the
 * house's own cliff and garden use too (lair.tsx), so they meet the coast
 * without a seam. The sea's surf follows the same shore (SHORE_GLSL).
 */

const SEA = HOUSE.sea
// The bay: the sea inside a circle behind the house's headland, open to the
// west past a line across its mouth.
export const BAY = { cx: 0, cz: -575, r: 628, mouth: -820, slant: 0.12 }

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** How far into the land (m, negative out at sea) a point is. */
export function shore(x: number, z: number) {
  const dx = x - BAY.cx
  const dz = z - BAY.cz
  const th = Math.atan2(dx, dz)
  const wig = 9 * Math.sin(5 * th + 1.3) + 5 * Math.sin(13 * th + 0.4) + 2.5 * Math.sin(29 * th + 2.1)
  const bay = Math.hypot(dx, dz) - BAY.r + wig
  const mouth = z - BAY.mouth - BAY.slant * x + 18 * Math.sin(x * 0.006 + 1)
  return Math.min(bay, mouth)
}

/** The same, for the sea's shader. */
export const SHORE_GLSL = /* glsl */ `
float coastShore(vec2 p) {
  vec2 d = p - vec2(${BAY.cx.toFixed(1)}, ${BAY.cz.toFixed(1)});
  float th = atan(d.x, d.y);
  float wig = 9.0 * sin(5.0 * th + 1.3) + 5.0 * sin(13.0 * th + 0.4) + 2.5 * sin(29.0 * th + 2.1);
  float bay = length(d) - ${BAY.r.toFixed(1)} + wig;
  float mouth = p.y - (${BAY.mouth.toFixed(1)}) - ${BAY.slant.toFixed(3)} * p.x + 18.0 * sin(p.x * 0.006 + 1.0);
  return min(bay, mouth);
}
`

// ---------------------------------------------------------------- the land's height

function hash(x: number, y: number) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return h - Math.floor(h)
}
export function noise(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
export function fbm(x: number, y: number, oct: number) {
  let v = 0
  let a = 0.5
  for (let i = 0; i < oct; i++) {
    v += a * noise(x, y)
    const nx = 1.6 * x + 1.2 * y + 7.1
    y = -1.2 * x + 1.6 * y + 3.3
    x = nx
    a *= 0.5
  }
  return v / (1 - 2 * a)
}
/** Sharp-crested ridges, for the mountains. */
function ridged(x: number, y: number, oct: number) {
  let v = 0
  let a = 0.5
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise(x, y) * 2 - 1)
    v += a * n * n
    const nx = 1.6 * x + 1.2 * y + 7.1
    y = -1.2 * x + 1.6 * y + 3.3
    x = nx
    a *= 0.5
  }
  return v
}

/** The house's own cliff top (lair.py's cliff_edge, less its noise). */
export function cliffEdge(x: number, z: number) {
  const a = Math.atan2(-z, x)
  const da = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)))
  const t = Math.min(1, Math.max(0, (da - 1.658) / 0.96))
  return HOUSE.deck.r + 0.4 + 40 * t * t * (3 - 2 * t)
}

/** Where a point is against the estate's lawn: under 1 inside, 1 at its edge. */
export function lawnNorm(x: number, z: number) {
  const l = ESTATE.lawn
  return Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz)
}

type Ground = { h: number; s: number }
export function ground(x: number, z: number): Ground {
  const s = shore(x, z)
  const rH = Math.hypot(x, z)
  if (s < 0) return { h: SEA - 1.6 + Math.max(s, -40) * 0.5, s }
  // Cliff tops at the house's level by the house, higher along the bay.
  const top = -0.25 + 9 * smooth(55, 160, rH) * fbm(x * 0.02 + 6, z * 0.02, 3) + 30 * smooth(90, 520, rH) * (0.55 + 0.75 * fbm(x * 0.004 + 3, z * 0.004, 3))
  const beach = 1.5 + 9 * fbm(x * 0.01, z * 0.01 + 7, 2) * smooth(70, 300, rH)
  // Coves cut back into the cliffs here and there; some stretches are sheer
  // rock (always by the house, like its own), others steep scrubby bluffs.
  const along = smooth(80, 220, rH)
  const t = s - 14 * smooth(0.56, 0.78, fbm(x * 0.022 + 2, z * 0.022 + 9, 3)) * along
  const sheer = 1 - smooth(0.38, 0.68, fbm(x * 0.005 + 8, z * 0.005, 3)) * along
  const face = 7 + 32 * (1 - sheer) + 7 * fbm(x * 0.02 + 1, z * 0.02, 2)
  let h: number
  if (t < beach) h = SEA - 1.6 + 2.4 * Math.min(1, s / beach)
  else if (t < beach + face) {
    const u = (t - beach) / face
    // A scree slope at the foot, then the face (or a rounded bluff).
    const cliff = u < 0.3 ? 0.14 * Math.pow(u / 0.3, 0.7) : 0.14 + 0.86 * Math.pow((u - 0.3) / 0.7, 0.5)
    const prof = sheer * cliff + (1 - sheer) * u * u * (3 - 2 * u)
    // Ledges and buttresses down the face.
    h = SEA + 0.8 + (top - SEA - 0.8) * prof + 2.2 * (fbm(x * 0.11, z * 0.11, 3) - 0.5) * Math.sin(Math.PI * u)
  } else {
    const k = t - beach - face
    const far = smooth(45, 240, rH)
    const hills = 0.07 * k + 330 * smooth(250, 1500, k) * (0.45 + 0.8 * fbm(x * 0.0016, z * 0.0016 + 5, 4))
    const ridges = 46 * ridged(x * 0.0045, z * 0.0045, 4) * smooth(30, 320, k)
    // Canyons wind down through them to the sea.
    const canyon = Math.pow(1 - Math.abs(fbm(x * 0.0032 + 4, z * 0.0032 + 1, 3) * 2 - 1), 6)
    h = top + far * (hills + ridges - 34 * canyon * smooth(25, 260, k)) + 1.4 * (fbm(x * 0.05, z * 0.05, 3) - 0.5) * smooth(4, 20, k)
    // The estate's grounds are levelled to a lawn.
    const lawn = 1 - smooth(0.85, 1.05, lawnNorm(x, z))
    h += (ESTATE.lawn.y - h) * lawn
  }
  // Under the house's own headland the land stays below its ground.
  if (rH < cliffEdge(x, z) - 1.5) h = Math.min(h, -0.6)
  return { h, s }
}

/** A lumpy blob: foliage (soft lumps) or a boulder (faceted). */
export function blob(rock = false) {
  let g: THREE.BufferGeometry = rock ? new THREE.DodecahedronGeometry(1, 1) : new THREE.IcosahedronGeometry(1, 3)
  // Foliage shares its vertices so it shades smooth; rock keeps its facets.
  if (!rock) {
    g.deleteAttribute('normal')
    g.deleteAttribute('uv')
    g = mergeVertices(g)
  }
  const p = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n1 = noise(v.x * 2.1 + 5, v.y * 2.1 + v.z * 1.7)
    const n2 = noise(v.x * 5.3 + v.z * 3.1, v.y * 5.3 + 11)
    const n3 = noise(v.z * 11 + v.x * 4, v.y * 11 - 3)
    v.multiplyScalar(rock ? 0.75 + 0.35 * n1 + 0.1 * n2 : 0.7 + 0.26 * n1 + 0.16 * n2 + 0.1 * n3)
    if (v.y < -0.3) v.y = -0.3 - (v.y + 0.3) * 0.2
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------- shaders

const NOISE_GLSL = /* glsl */ `
varying vec3 vCoastW;
uniform sampler2D uLut;
uniform float uFog;
uniform float uWet;
uniform float uFlash;
vec3 coastSky(vec3 d) {
  vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, sqrt(clamp(d.y, 0.0, 1.0)));
  return texture2D(uLut, uv).rgb;
}
float cHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float cNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cHash(i), cHash(i + vec3(1, 0, 0)), f.x), mix(cHash(i + vec3(0, 1, 0)), cHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(cHash(i + vec3(0, 0, 1)), cHash(i + vec3(1, 0, 1)), f.x), mix(cHash(i + vec3(0, 1, 1)), cHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float cFbm(vec3 p, int oct) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    v += a * cNoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return v;
}
// Into the haze with distance, the sky's own colour at the horizon.
vec3 coastHaze(vec3 col) {
  vec3 toP = vCoastW - cameraPosition;
  float dist = length(toP);
  vec3 d = toP / dist;
  vec3 haze = coastSky(normalize(vec3(d.x, 0.03, d.z)));
  float k = (1.0 - exp(-dist / mix(1300.0, 300.0, uFog))) * mix(0.85, 1.0, uFog);
  return mix(col, haze, k) + vec3(0.6, 0.65, 0.85) * uFlash * 0.06;
}
`

/** Height bumps (world metres) as a shading normal, from screen-space slopes. */
const BUMP_GLSL = /* glsl */ `
vec3 coastBump(vec3 pos, vec3 n, float h) {
  vec3 dpdx = dFdx(pos);
  vec3 dpdy = dFdy(pos);
  float dhdx = dFdx(h);
  float dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  vec3 b = abs(det) * n - grad;
  // (Seen exactly edge-on there's nothing to go on.)
  return dot(b, b) > 1e-20 ? normalize(b) : n;
}
`

const LAND_GLSL = /* glsl */ `
varying vec3 vCoastN;
varying float vGully;
vec3 gAlbedo;
float gBump;
float gRough;
void coastSurface(vec3 p, vec3 n, float dist, float gully) {
  float lod = 1.0 - smoothstep(60.0, 500.0, dist);
  int oct = dist < 120.0 ? 5 : dist < 500.0 ? 3 : 2;
  float slope = 1.0 - n.y;
  float macro = cFbm(p * 0.004 + 5.0, 3);
  // Sandstone in soft, wavering layers, streaked where water runs down
  // the face, cracked; paler where it's freshly broken.
  float warp = cFbm(p * 0.03, 3);
  float strata = p.y * 0.3 + warp * 6.0 + cNoise(p * 0.08) * 2.0;
  float band = smoothstep(0.1, 0.9, abs(fract(strata) - 0.5) * 2.0);
  vec3 rock = mix(vec3(0.29, 0.165, 0.105), vec3(0.45, 0.3, 0.2), band * 0.22 + 0.78 * cFbm(p * vec3(0.07, 0.16, 0.07), 4));
  rock = mix(rock, vec3(0.33, 0.29, 0.26), smoothstep(0.55, 0.75, cFbm(p * 0.03 + 21.0, 3)) * 0.6);
  rock = mix(rock, vec3(0.55, 0.49, 0.41), smoothstep(0.55, 0.8, cFbm(p * 0.12, oct)) * 0.5);
  rock *= 0.62 + 0.5 * cFbm(p * vec3(0.02, 0.05, 0.02), 4);
  rock *= 0.7 + 0.42 * cNoise(p * vec3(0.25, 0.012, 0.25));
  float crack = (1.0 - smoothstep(0.0, 0.06, abs(cNoise(p * vec3(0.3, 0.06, 0.3)) - 0.5))) * lod;
  rock *= 1.0 - 0.55 * crack;
  // Chaparral: dark brush in clumps over dry gold grass and bare earth,
  // thickest down the gullies and on the slopes facing north (+x).
  float north = clamp(n.x * 2.5, -1.0, 1.0);
  float clump = cFbm(p * 0.18 + 3.0, oct) + gully * 0.7 + (macro - 0.5) * 0.7 + north * 0.15;
  float cover = smoothstep(0.3, 0.46, clump);
  vec3 brush = mix(vec3(0.028, 0.042, 0.02), vec3(0.08, 0.095, 0.048), cNoise(p * 0.7) * lod + 0.4 * (1.0 - lod));
  brush = mix(brush, vec3(0.095, 0.092, 0.06), smoothstep(0.55, 0.8, macro) * 0.5);
  vec3 dry = mix(vec3(0.3, 0.24, 0.14), vec3(0.19, 0.15, 0.1), cFbm(p * 0.05 + 9.0, 2));
  dry = mix(dry, vec3(0.29, 0.24, 0.18), cNoise(p * 2.5) * 0.4 * lod);
  vec3 veg = mix(dry, brush, cover);
  // The estate's lawn: mown in stripes, flower beds round its edge.
  float lawnN = length((p.xz - vec2(${ESTATE.lawn.x.toFixed(1)}, ${ESTATE.lawn.z.toFixed(1)})) / vec2(${ESTATE.lawn.rx.toFixed(1)}, ${ESTATE.lawn.rz.toFixed(1)}));
  float lawn = (1.0 - smoothstep(0.82, 0.96, lawnN + (cNoise(p * 0.08) - 0.5) * 0.06)) * (1.0 - smoothstep(0.1, 0.25, slope)) * step(-1.5, p.y);
  vec3 grass = vec3(0.055, 0.12, 0.028) * (0.9 + 0.18 * step(0.5, fract(p.x * 0.09 + p.z * 0.03)));
  grass *= 0.82 + 0.3 * cNoise(p * 0.45) + 0.1 * cNoise(p * 4.0) * lod;
  float bed = smoothstep(0.66, 0.69, lawnN) * (1.0 - smoothstep(0.76, 0.79, lawnN)) * smoothstep(0.48, 0.58, cNoise(p * 0.12 + 4.0));
  grass = mix(grass, mix(vec3(0.42, 0.06, 0.18), vec3(0.62, 0.36, 0.52), cNoise(p * 2.5)), bed * 0.75);
  veg = mix(veg, grass, lawn);
  // Rock where it's steep; sand down at the water, dark where it's wet.
  float rocky = smoothstep(0.4, 0.62, slope + (cFbm(p * 0.09, 2) - 0.5) * 0.35);
  // Scrub hangs on in patches even on the steep faces.
  rock = mix(rock, brush, smoothstep(0.5, 0.64, cFbm(p * 0.06 + 11.0, 3) + n.y * 0.25) * 0.9);
  vec3 col = mix(veg, rock, rocky);
  float sand = (1.0 - smoothstep(${(SEA + 0.9).toFixed(2)}, ${(SEA + 1.8).toFixed(2)}, p.y)) * (1.0 - rocky * 0.6);
  vec3 sandCol = mix(vec3(0.55, 0.47, 0.36), vec3(0.27, 0.23, 0.18), 1.0 - smoothstep(${(SEA - 0.3).toFixed(2)}, ${(SEA + 0.6).toFixed(2)}, p.y));
  col = mix(col, sandCol, sand);
  // Darker down in the folds of the land, where less of the sky reaches.
  gAlbedo = col * (1.0 - 0.4 * uWet) * (1.0 - 0.35 * gully);
  gRough = mix(0.95, 0.55, uWet) - sand * 0.1;
  gBump = (rocky * (band * 0.8 + cFbm(p * 0.5, oct) * 1.1) + (1.0 - rocky) * (cover * 0.35 * (1.0 - lawn) + cNoise(p * 1.7) * 0.08)) * lod;
}
`

/** World position (and haze) for an outdoor material; `land` adds the ground's own surface. */
export function coastMaterial(m: THREE.MeshStandardMaterial, land = false) {
  OUTDOOR.add(m)
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uLut: SKY.uLut, uFog: SKY.uFog, uWet: SKY.uWet, uFlash: SKY.uFlash })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCoastW;${land ? '\nvarying vec3 vCoastN;\nattribute float aGully;\nvarying float vGully;' : ''}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 coastW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          coastW = instanceMatrix * coastW;
        #endif
        vCoastW = (modelMatrix * coastW).xyz;${land ? '\nvCoastN = normalize(mat3(modelMatrix) * objectNormal);\nvGully = aGully;' : ''}`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}${land ? BUMP_GLSL + LAND_GLSL : ''}`)
      .replace('#include <dithering_fragment>', `gl_FragColor.rgb = coastHaze(gl_FragColor.rgb);\n#include <dithering_fragment>`)
    if (land) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          coastSurface(vCoastW, normalize(vCoastN), length(vCoastW - cameraPosition), vGully);
          diffuseColor.rgb *= gAlbedo;`,
        )
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = gRough;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = coastBump(-vViewPosition, normal, gBump * 0.35);`)
    }
  }
  m.customProgramCacheKey = () => (land ? 'coast-land' : 'coast')
  return m
}

/** The ground's own material: rock, scrub and sand by where it lies. */
export function landMaterial() {
  return coastMaterial(new THREE.MeshStandardMaterial({ roughness: 0.95 }), true)
}
