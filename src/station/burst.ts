import * as THREE from 'three'

/**
 * The centrepiece: a plasma / neural burst.
 *
 *   hollow core     a dark sphere with a thin bright rim; everything behind it is hidden
 *   filaments       long curved trails that leave the core, each with a bright
 *                   head running outward and a fading tail
 *   comets          fine points streaming along the same curves
 *   node clusters   magenta, violet and green networks of fine nodes with links;
 *                   how many are lit follows real data (games, leads, jobs + sites)
 *   haze            one soft blue glow behind it all
 *
 * Every curve is evaluated in the vertex shader from a few per-filament seeds,
 * so nothing is rebuilt or uploaded per frame: the CPU sets about a dozen
 * uniforms. Line segments, comets and nodes are three draw calls, and the
 * counts are capped per graphics level.
 */

export type BurstQuality = { fil: number; seg: number; comets: number; nodes: number }

export const BURST_QUALITY: Record<'low' | 'high' | 'ultra', BurstQuality> = {
  low: { fil: 90, seg: 16, comets: 260, nodes: 38 },
  high: { fil: 170, seg: 22, comets: 640, nodes: 58 },
  ultra: { fil: 240, seg: 28, comets: 1000, nodes: 76 },
}

const CLUSTER_DIRS = [
  new THREE.Vector3(Math.cos(3.6), Math.sin(3.6) * 0.8 - 0.1, 0.3).normalize(), // magenta, lower left
  new THREE.Vector3(Math.cos(0.35), Math.sin(0.35) + 0.15, -0.2).normalize(), // violet, right
  new THREE.Vector3(Math.cos(5.3), Math.sin(5.3) - 0.1, 0.4).normalize(), // green, lower right
]
export const CLUSTER_COLORS = ['#ff3df0', '#8a5cff', '#37ff9c'] as const

/** Where the floating tags attach, in the burst's own (rotating) space. */
export const TAG_ANCHORS = [
  CLUSTER_DIRS[0].clone().multiplyScalar(2.5),
  CLUSTER_DIRS[2].clone().multiplyScalar(2.5),
  CLUSTER_DIRS[1].clone().multiplyScalar(2.4),
  new THREE.Vector3(-1.5, 2.1, 0.3),
  new THREE.Vector3(1.1, 2.3, 0.5),
  new THREE.Vector3(2.2, -1.5, 0.3),
]

function rngOf(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CURVE = /* glsl */ `
  uniform float uT; uniform float uLen; uniform float uR0; uniform float uLevel; uniform float uSwirl;
  attribute vec3 aDir; attribute vec4 aS;
  vec3 curve(float u, vec3 d, vec4 s) {
    vec3 ref = abs(d.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.);
    vec3 t1 = normalize(cross(d, ref));
    vec3 t2 = cross(d, t1);
    float ang = s.y * 6.2831;
    vec3 t = t1 * cos(ang) + t2 * sin(ang);
    float L = uLen * (.5 + .8 * s.x);
    float r = uR0 + L * pow(u, .82);
    float th = (s.z - .5) * 2.6 * pow(u, 1.25) * (1. + uSwirl * .5) + sin(uT * .25 + s.w * 20.) * .2 * u;
    vec3 dir = d * cos(th) + t * sin(th);
    vec3 side = cross(dir, t);
    float wob = sin(u * 7. + uT * (.6 + s.y) + s.w * 30.) * .05 * u * (1. + uLevel);
    return dir * r + side * wob * r;
  }
  vec3 tintOf(float cl, vec3 cool, vec3 mag, vec3 vio, vec3 grn) {
    return cl < .5 ? cool : cl < 1.5 ? mag : cl < 2.5 ? vio : grn;
  }
`

const lineVert = /* glsl */ `
  ${CURVE}
  attribute float aU; attribute float aCl; attribute float aRank;
  uniform float uSpeed; uniform float uEnergy; uniform float uFill;
  uniform vec3 uCool; uniform vec3 uMag; uniform vec3 uVio; uniform vec3 uGrn;
  varying vec3 vCol;
  void main() {
    vec3 p = curve(aU, aDir, aS);
    float speed = .06 + .15 * aS.x + uSpeed * .3;
    float head = fract(uT * speed + aS.w * 7.);
    float behind = head - aU;
    float tail = behind > 0. ? exp(-behind * 5.5) : 0.;
    float cap = exp(-pow((aU - head) * 16., 2.));
    float fade = smoothstep(0., .07, aU) * pow(1. - aU, .85);
    float I = (.26 + .3 * aS.z + tail * 2.1 + cap * 4.2) * fade * (.85 + uLevel * 1.3 + uEnergy * .7) * step(aRank, uFill);
    vec3 tint = tintOf(aCl, uCool, uMag, uVio, uGrn);
    vCol = mix(tint, vec3(1.), clamp(cap * .85 + tail * .25, 0., 1.)) * I;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
  }
`
const lineFrag = /* glsl */ `
  varying vec3 vCol;
  void main() { gl_FragColor = vec4(vCol, 1.); }
`

const cometVert = /* glsl */ `
  ${CURVE}
  attribute float aPh; attribute float aCl; attribute float aRank;
  uniform float uSpeed; uniform float uEnergy; uniform float uPx; uniform float uFill;
  uniform vec3 uCool; uniform vec3 uMag; uniform vec3 uVio; uniform vec3 uGrn;
  varying vec3 vCol;
  void main() {
    float u = fract(aPh + uT * (.05 + .2 * aS.x + uSpeed * .3));
    vec3 p = curve(u, aDir, aS);
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    float life = pow(sin(3.14159 * u), .7);
    gl_PointSize = (1.3 + 2.8 * aS.z) * (1. + uLevel * .6) * uPx * 60. / max(.1, -mv.z) * step(aRank, uFill);
    vec3 tint = tintOf(aCl, uCool, uMag, uVio, uGrn);
    vCol = mix(tint, vec3(1.), .55) * (.9 + 2.4 * aS.y) * life * (.9 + uEnergy * .7 + uLevel);
    gl_Position = projectionMatrix * mv;
  }
`
const cometFrag = /* glsl */ `
  varying vec3 vCol;
  void main() {
    float d = length(gl_PointCoord - .5);
    float a = smoothstep(.5, 0., d);
    gl_FragColor = vec4(vCol * a * a, 1.);
  }
`

const nodeVert = /* glsl */ `
  attribute vec3 aPos; attribute float aCl; attribute float aRank; attribute float aSeed; attribute float aE;
  uniform float uT; uniform float uPx; uniform float uLevel; uniform float uEnergy; uniform vec3 uFillC; uniform float uMode;
  uniform vec3 uMag; uniform vec3 uVio; uniform vec3 uGrn;
  varying vec3 vCol;
  void main() {
    float fill = aCl < 1.5 ? uFillC.x : aCl < 2.5 ? uFillC.y : uFillC.z;
    float on = step(aRank, fill);
    vec3 p = aPos + .05 * vec3(sin(uT * .3 + aSeed * 17.), cos(uT * .27 + aSeed * 23.), sin(uT * .22 + aSeed * 11.));
    vec3 col = aCl < 1.5 ? uMag : aCl < 2.5 ? uVio : uGrn;
    float tw = .55 + .45 * sin(uT * (.8 + aSeed) + aSeed * 40.);
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    if (uMode < .5) {
      gl_PointSize = (1.2 + 3. * aSeed) * (1. + uLevel * .5) * uPx * 60. / max(.1, -mv.z) * on;
      vCol = mix(col, vec3(1.), .25) * (.7 + 1.1 * tw) * (.8 + uEnergy * .5);
    } else {
      float pulse = exp(-pow(fract(uT * .35 + aSeed * 3.) - aE, 2.) * 60.);
      vCol = col * (.16 + .22 * tw + pulse * 1.1) * on;
    }
    gl_Position = projectionMatrix * mv;
  }
`
const nodeFrag = /* glsl */ `
  uniform float uMode;
  varying vec3 vCol;
  void main() {
    if (uMode < .5) {
      float d = length(gl_PointCoord - .5);
      float a = smoothstep(.5, .08, d);
      gl_FragColor = vec4(vCol * a, 1.);
    } else {
      gl_FragColor = vec4(vCol, 1.);
    }
  }
`

const rimVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const rimFrag = /* glsl */ `
  uniform vec3 uCool; uniform float uLevel; uniform float uEnergy; uniform float uT;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float fr = 1. - abs(dot(normalize(vN), normalize(vV)));
    float ring = pow(fr, 3.2) * (1.4 + uLevel * 2.2 + uEnergy);
    float shimmer = .85 + .15 * sin(uT * 2.1 + fr * 14.);
    vec3 c = mix(uCool, vec3(1.), .5) * ring * shimmer;
    gl_FragColor = vec4(c, 1.);
  }
`

function hazeTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, 'rgba(70,130,255,0.55)')
  grad.addColorStop(0.35, 'rgba(50,90,230,0.22)')
  grad.addColorStop(1, 'rgba(30,50,200,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

type Uniforms = Record<string, { value: unknown }>

export type Burst = ReturnType<typeof buildBurst>

export function buildBurst(q: BurstQuality) {
  const group = new THREE.Group()
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T): T => (owned.push(x), x)
  const rnd = rngOf(90210)

  const shared: Uniforms = {
    uT: { value: 0 },
    uLen: { value: 3 },
    uR0: { value: 0.5 },
    uLevel: { value: 0 },
    uSwirl: { value: 0 },
    uSpeed: { value: 0 },
    uEnergy: { value: 0 },
    uPx: { value: 1 },
    uFill: { value: 1 },
    uCool: { value: new THREE.Color('#7fe6ff') },
    uMag: { value: new THREE.Color(CLUSTER_COLORS[0]) },
    uVio: { value: new THREE.Color(CLUSTER_COLORS[1]) },
    uGrn: { value: new THREE.Color(CLUSTER_COLORS[2]) },
    uFillC: { value: new THREE.Vector3(1, 1, 1) },
  }
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const

  // ---- filaments: one direction each, spread evenly over the sphere
  const dirs: THREE.Vector3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < q.fil; i++) {
    const y = 1 - ((i + 0.5) / q.fil) * 2
    const r = Math.sqrt(1 - y * y)
    const a = i * golden
    const d = new THREE.Vector3(Math.cos(a) * r + (rnd() - 0.5) * 0.12, y + (rnd() - 0.5) * 0.12, Math.sin(a) * r + (rnd() - 0.5) * 0.12).normalize()
    dirs.push(d)
  }
  const clusterOf = (d: THREE.Vector3) => {
    let best = 0
    let bd = -2
    CLUSTER_DIRS.forEach((c, i) => {
      const dot = d.dot(c)
      if (dot > bd) {
        bd = dot
        best = i
      }
    })
    return bd > 0.55 && rnd() < 0.7 ? best + 1 : 0
  }
  const seeds = dirs.map(() => [rnd(), rnd(), rnd(), rnd()])
  const cls = dirs.map(clusterOf)
  const ranks = dirs.map((_, i) => i / q.fil)

  const lineVerts = q.fil * q.seg * 2
  const lDir = new Float32Array(lineVerts * 3)
  const lS = new Float32Array(lineVerts * 4)
  const lU = new Float32Array(lineVerts)
  const lCl = new Float32Array(lineVerts)
  const lRank = new Float32Array(lineVerts)
  let v = 0
  for (let f = 0; f < q.fil; f++) {
    for (let s = 0; s < q.seg; s++) {
      for (let e = 0; e < 2; e++) {
        lDir.set([dirs[f].x, dirs[f].y, dirs[f].z], v * 3)
        lS.set(seeds[f], v * 4)
        lU[v] = (s + e) / q.seg
        lCl[v] = cls[f]
        lRank[v] = ranks[f]
        v++
      }
    }
  }
  const lineGeo = own(new THREE.BufferGeometry())
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineVerts * 3), 3))
  lineGeo.setAttribute('aDir', new THREE.BufferAttribute(lDir, 3))
  lineGeo.setAttribute('aS', new THREE.BufferAttribute(lS, 4))
  lineGeo.setAttribute('aU', new THREE.BufferAttribute(lU, 1))
  lineGeo.setAttribute('aCl', new THREE.BufferAttribute(lCl, 1))
  lineGeo.setAttribute('aRank', new THREE.BufferAttribute(lRank, 1))
  const lineMat = own(new THREE.ShaderMaterial({ vertexShader: lineVert, fragmentShader: lineFrag, uniforms: shared, ...additive }))
  const lines = new THREE.LineSegments(lineGeo, lineMat)
  lines.frustumCulled = false

  // ---- comets: points riding the same curves
  const cDir = new Float32Array(q.comets * 3)
  const cS = new Float32Array(q.comets * 4)
  const cPh = new Float32Array(q.comets)
  const cCl = new Float32Array(q.comets)
  const cRank = new Float32Array(q.comets)
  for (let i = 0; i < q.comets; i++) {
    const f = Math.floor(rnd() * q.fil)
    cDir.set([dirs[f].x, dirs[f].y, dirs[f].z], i * 3)
    cS.set([seeds[f][0], rnd(), rnd(), seeds[f][3]], i * 4)
    cPh[i] = rnd()
    cCl[i] = cls[f]
    cRank[i] = i / q.comets
  }
  const cometGeo = own(new THREE.BufferGeometry())
  cometGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(q.comets * 3), 3))
  cometGeo.setAttribute('aDir', new THREE.BufferAttribute(cDir, 3))
  cometGeo.setAttribute('aS', new THREE.BufferAttribute(cS, 4))
  cometGeo.setAttribute('aPh', new THREE.BufferAttribute(cPh, 1))
  cometGeo.setAttribute('aCl', new THREE.BufferAttribute(cCl, 1))
  cometGeo.setAttribute('aRank', new THREE.BufferAttribute(cRank, 1))
  const cometMat = own(new THREE.ShaderMaterial({ vertexShader: cometVert, fragmentShader: cometFrag, uniforms: shared, ...additive }))
  const comets = new THREE.Points(cometGeo, cometMat)
  comets.frustumCulled = false

  // ---- node clusters and their links
  const nPos: number[] = []
  const nCl: number[] = []
  const nRank: number[] = []
  const nSeed: number[] = []
  const eA: number[] = []
  const eCl: number[] = []
  const eRank: number[] = []
  const eSeed: number[] = []
  const eE: number[] = []
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 0.7
  CLUSTER_DIRS.forEach((c, ci) => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < q.nodes; i++) {
      const rad = 1.3 + rnd() * 1.9
      const p = c.clone().multiplyScalar(rad).add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(0.62))
      pts.push(p)
      nPos.push(p.x, p.y, p.z)
      nCl.push(ci + 1)
      nRank.push(i / q.nodes)
      nSeed.push(rnd())
    }
    pts.forEach((p, i) => {
      const near = pts
        .map((o, j) => ({ j, d: o.distanceToSquared(p) }))
        .filter((x) => x.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
      for (const { j } of near) {
        if (j < i) continue
        const o = pts[j]
        const seed = rnd()
        const rank = Math.max(i, j) / q.nodes
        eA.push(p.x, p.y, p.z, o.x, o.y, o.z)
        eE.push(0, 1)
        eCl.push(ci + 1, ci + 1)
        eRank.push(rank, rank)
        eSeed.push(seed, seed)
      }
    })
  })
  const nodeU = { ...shared, uMode: { value: 0 } }
  const edgeU = { ...shared, uMode: { value: 1 } }
  const nodeGeo = own(new THREE.BufferGeometry())
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nPos.length), 3))
  nodeGeo.setAttribute('aPos', new THREE.BufferAttribute(new Float32Array(nPos), 3))
  nodeGeo.setAttribute('aCl', new THREE.BufferAttribute(new Float32Array(nCl), 1))
  nodeGeo.setAttribute('aRank', new THREE.BufferAttribute(new Float32Array(nRank), 1))
  nodeGeo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(nSeed), 1))
  nodeGeo.setAttribute('aE', new THREE.BufferAttribute(new Float32Array(nSeed.length), 1))
  const nodes = new THREE.Points(nodeGeo, own(new THREE.ShaderMaterial({ vertexShader: nodeVert, fragmentShader: nodeFrag, uniforms: nodeU, ...additive })))
  nodes.frustumCulled = false
  const edgeGeo = own(new THREE.BufferGeometry())
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(eA.length), 3))
  edgeGeo.setAttribute('aPos', new THREE.BufferAttribute(new Float32Array(eA), 3))
  edgeGeo.setAttribute('aCl', new THREE.BufferAttribute(new Float32Array(eCl), 1))
  edgeGeo.setAttribute('aRank', new THREE.BufferAttribute(new Float32Array(eRank), 1))
  edgeGeo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(eSeed), 1))
  edgeGeo.setAttribute('aE', new THREE.BufferAttribute(new Float32Array(eE), 1))
  const edges = new THREE.LineSegments(edgeGeo, own(new THREE.ShaderMaterial({ vertexShader: nodeVert, fragmentShader: nodeFrag, uniforms: edgeU, ...additive })))
  edges.frustumCulled = false

  // ---- the hollow core and its rim
  const hollowMat = own(new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }))
  const hollow = new THREE.Mesh(own(new THREE.SphereGeometry(1, 48, 32)), hollowMat)
  hollow.renderOrder = -2
  const rimMat = own(new THREE.ShaderMaterial({ vertexShader: rimVert, fragmentShader: rimFrag, uniforms: shared, ...additive, side: THREE.FrontSide }))
  const rim = new THREE.Mesh(own(new THREE.SphereGeometry(1, 48, 32)), rimMat)
  rim.renderOrder = -1

  // ---- haze: a soft blue glow that always faces the camera
  const tex = own(hazeTexture())
  const hazeMat = own(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6, toneMapped: false }))
  const haze = new THREE.Sprite(hazeMat)
  haze.scale.setScalar(11)
  haze.renderOrder = -3

  const spin = new THREE.Group()
  spin.add(lines, comets, nodes, edges)
  group.add(haze, spin, hollow, rim)

  return {
    group,
    spin,
    hollow,
    rim,
    haze,
    hazeMat,
    uniforms: shared,
    counts: { fil: q.fil, seg: q.seg, comets: q.comets, nodes: q.nodes * 3, links: eE.length / 2 },
    dispose() {
      for (const o of owned) o.dispose()
    },
  }
}
