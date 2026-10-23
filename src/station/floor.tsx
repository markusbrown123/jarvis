import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { hexPoints, ZONES } from './layout'
import { useStation, type StationEvent } from './stationStore'

/**
 * The floor: a lit metal hex-tile deck with real surface detail, and a glow
 * layer on the same tile grid that shows what is happening.
 *
 * Surface (generated once, in code): beveled hex plates with dark seams, some
 * with raised inset panels, some vent grilles, some with an embedded light,
 * bolts at the corners — colour, relief (normal map), roughness and an
 * emissive map, so the key and fill lights and the reflections describe the
 * shapes. Visible at rest: nothing depends on activity to be seen.
 *
 * Glow layer (same UVs, so it sits exactly on the seams): faint everywhere,
 * brighter towards the island; each zone's seams pool in its colour scaled by
 * its real activity, flash orange-red on a failure, and ripple outwards on an
 * event; now and then a scan wave crosses from the reactor.
 */

const FLOOR_R = 28
/** Small tile size in world units (hex circumradius). */
const TILE = 0.62
const NX = 8
const NY = 4

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Colour, normal, roughness, emissive and the glow mask, all tiling together. */
function makeTextures() {
  const r = 1024 / (NX * Math.sqrt(3))
  const W = 1024
  const H = Math.round(3 * r * NY)
  const ri = (r * Math.sqrt(3)) / 2
  const height = new Float32Array(W * H)
  const albedo = new Uint8ClampedArray(W * H * 4)
  const rough = new Uint8ClampedArray(W * H * 4)
  const emit = new Uint8ClampedArray(W * H * 4)
  const mask = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Pixel → nearest pointy-top hex centre (cube rounding).
      const qf = ((Math.sqrt(3) / 3) * x - y / 3) / r
      const rf = ((2 / 3) * y) / r
      let q = Math.round(qf)
      let rr = Math.round(rf)
      const sf = -qf - rf
      const s = Math.round(sf)
      const dq = Math.abs(q - qf)
      const dr = Math.abs(rr - rf)
      const ds = Math.abs(s - sf)
      if (dq > dr && dq > ds) q = -rr - s
      else if (dr > ds) rr = -q - s
      const cx = r * Math.sqrt(3) * (q + rr / 2)
      const cy = r * 1.5 * rr
      const dx = x - cx
      const dy = y - cy
      const e = Math.max(Math.abs(dx), Math.abs(dx) * 0.5 + Math.abs(dy) * (Math.sqrt(3) / 2))
      const edge = ri - e // >0 inside, 0 at the seam
      // A tile's character, consistent across the texture's wrap.
      const t = hash(((cx % W) + W) % W, ((cy % H) + H) % H)
      const kind = t < 0.58 ? 'plate' : t < 0.8 ? 'inset' : t < 0.92 ? 'vent' : 'light'
      const shade = 0.86 + hash(t * 31, t * 17) * 0.28
      const seam = edge < 2.2
      const bevel = Math.min(1, Math.max(0, (edge - 2.2) / 7))
      let h = seam ? 0 : 0.55 + 0.45 * bevel
      const inner = edge > ri * 0.42
      const innerBevel = Math.min(1, Math.max(0, (edge - ri * 0.42) / 4))
      let cr = 27 * shade
      let cg = 31 * shade
      let cb = 44 * shade
      let ro = 0.42 + hash(t, 3) * 0.14
      let em = 0
      let trace = 0
      if (!seam && kind === 'inset' && inner) {
        h += 0.18 * innerBevel
        cr += 6
        cg += 7
        cb += 10
        ro -= 0.06
      }
      if (!seam && kind === 'vent' && inner) {
        const slot = Math.abs(((dy / (r * 0.11)) % 2) + 2) % 2 < 0.9
        h -= slot ? 0.32 * innerBevel : 0
        cr = slot ? 9 : 22
        cg = slot ? 10 : 25
        cb = slot ? 14 : 34
        ro = 0.8
      }
      if (!seam && kind === 'light' && inner) {
        h -= 0.06 * innerBevel
        em = innerBevel
        cr = 40
        cg = 70
        cb = 110
        ro = 0.2
      }
      // Bolts near three of the corners.
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 6 + (k * 2 * Math.PI) / 3
        const bx = cx + Math.cos(a) * ri * 0.78
        const by = cy + Math.sin(a) * ri * 0.78
        const bd = Math.hypot(x - bx, y - by)
        if (bd < 2.6) {
          h += 0.12 * (1 - bd / 2.6)
          cr = 52
          cg = 56
          cb = 66
          ro = 0.3
        }
      }
      // Brushed grain.
      const grain = (hash(x * 0.37, y * 0.011 + t) - 0.5) * 6
      const i = y * W + x
      height[i] = h
      albedo.set([cr + grain, cg + grain, cb + grain * 1.2, 255], i * 4)
      rough.set([0, ro * 255, 0, 255], i * 4)
      emit.set([em * 60, em * 150, em * 230, 255], i * 4)
      // Glow mask: R seam, G circuit trace (a third of the seams), B tile id, A embedded light.
      const seamGlow = seam ? 1 : Math.max(0, 1 - (edge - 2.2) / 2.5)
      trace = seam && hash(Math.round(cx / 9), Math.round(cy / 9) + Math.round(Math.atan2(dy, dx) * 3)) > 0.66 ? 1 : 0
      mask.set([seamGlow * 255, trace * 255, t * 255, em * 255], i * 4)
    }
  }
  // Relief → normal map.
  const normal = new Uint8ClampedArray(W * H * 4)
  const at = (x: number, y: number) => height[((y + H) % H) * W + ((x + W) % W)]
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * 3.2
      const ny = (at(x, y - 1) - at(x, y + 1)) * 3.2
      const l = Math.hypot(nx, ny, 1)
      normal.set([(nx / l) * 127 + 128, (ny / l) * 127 + 128, (1 / l) * 127 + 128, 255], (y * W + x) * 4)
    }
  const tex = (data: Uint8ClampedArray, srgb: boolean) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.needsUpdate = true
    return t
  }
  const repeat = new THREE.Vector2((2 * FLOOR_R) / (TILE * Math.sqrt(3) * NX), (2 * FLOOR_R) / (3 * TILE * NY))
  const all = { map: tex(albedo, true), normalMap: tex(normal, false), roughnessMap: tex(rough, false), emissiveMap: tex(emit, true), mask: tex(mask, false) }
  for (const t of Object.values(all)) t.repeat.copy(repeat)
  return { ...all, repeat }
}

const glowVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const glowFrag = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uRepeat;
  uniform float uTime;
  uniform float uMotion;
  uniform vec3 uBase;
  uniform vec3 uZonePos[6];
  uniform vec3 uZoneCol[6];
  uniform float uZoneLevel[6];
  uniform float uZoneFlash[6];
  uniform float uZoneRipple[6];
  varying vec3 vW;
  void main() {
    // From world position, so the floor and the island deck share one grid.
    vec2 uvw = vec2(vW.x, -vW.z) / ${(2 * FLOOR_R).toFixed(1)} + 0.5;
    vec4 m = texture2D(uMask, uvw * uRepeat);
    float d0 = length(vW.xz);
    float fade = smoothstep(${(FLOOR_R - 2).toFixed(1)}, 9.0, d0);
    float near = smoothstep(14.0, 4.0, d0);
    vec3 col = uBase * m.r * (0.16 + 0.32 * near);
    // A slow scan crossing from the reactor every twenty seconds or so.
    float front = mod(uTime * 1.4, 28.0);
    col += uBase * m.r * exp(-pow((d0 - front) / 0.9, 2.0)) * 0.55 * uMotion;
    // Circuit traces: a few seam segments carry light, changing slowly.
    float tick = floor(uTime * 0.5 * uMotion + m.b * 13.0);
    float lit = step(0.93, fract(sin(m.b * 91.7 + tick * 12.9898) * 43758.5453));
    col += uBase * 1.8 * m.g * lit * (0.4 + 0.6 * near);
    for (int i = 0; i < 6; i++) {
      float dz = length(vW.xz - uZonePos[i].xz);
      float pool = smoothstep(3.4, 0.4, dz);
      vec3 zc = uZoneCol[i];
      col += zc * m.r * pool * (0.35 + 1.4 * uZoneLevel[i]);
      col += zc * 0.035 * pool * (0.4 + uZoneLevel[i]);
      col += vec3(1.0, 0.32, 0.08) * m.r * pool * uZoneFlash[i] * 2.2;
      if (uZoneRipple[i] >= 0.0) {
        float rr = uZoneRipple[i] * 3.2;
        col += zc * m.r * exp(-pow((dz - rr) / 0.4, 2.0)) * max(0.0, 1.0 - uZoneRipple[i] / 1.4) * 3.0;
      }
    }
    col += vec3(0.24, 0.55, 0.95) * m.a * 0.22;
    gl_FragColor = vec4(col * fade, 1.0);
  }
`

/** Seconds since this zone's most recent event of a kind, or −1. */
function since(events: StationEvent[], zone: string, kinds: StationEvent['kind'][], now: number) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.zone === zone && kinds.includes(e.kind)) return (now - e.at) / 1000
  }
  return -1
}

export function Floor({ reflector }: { reflector: number }) {
  const tex = useMemo(makeTextures, [])
  const deckTop = useMemo(() => {
    const shape = new THREE.Shape()
    hexPoints(8.08).forEach((p, i) => (i ? shape.lineTo(p.x, p.z) : shape.moveTo(p.x, p.z)))
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const glow = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: glowVert,
        fragmentShader: glowFrag,
        uniforms: {
          uMask: { value: tex.mask },
          uRepeat: { value: tex.repeat },
          uTime: { value: 0 },
          uMotion: { value: 1 },
          uBase: { value: new THREE.Color('#5a7dff') },
          uZonePos: { value: ZONES.map((z) => new THREE.Vector3(...z.pos)) },
          uZoneCol: { value: ZONES.map((z) => new THREE.Color(z.color)) },
          uZoneLevel: { value: ZONES.map(() => 0) },
          uZoneFlash: { value: ZONES.map(() => 0) },
          uZoneRipple: { value: ZONES.map(() => -1) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [tex],
  )
  useEffect(() => () => Object.values(tex).forEach((t) => (t as THREE.Texture).dispose?.()), [tex])
  const shown = useRef(ZONES.map(() => 0))
  useFrame((state, dt) => {
    const u = glow.uniforms
    const reduced = useHub.getState().prefs.reducedMotion
    u.uTime.value = state.clock.elapsedTime
    u.uMotion.value = reduced ? 0 : 1
    const { model, events } = useStation.getState()
    const now = performance.now()
    ZONES.forEach((z, i) => {
      const zm = model?.zones[z.id]
      // Attention and errors keep a zone visibly lit even when idle.
      const want = !zm ? 0 : zm.state === 'active' ? 0.35 + zm.level * 0.65 : zm.state === 'attention' ? 0.45 : zm.state === 'error' ? 0.25 : zm.state === 'unavailable' ? 0 : 0.08
      shown.current[i] += (want - shown.current[i]) * Math.min(1, dt * 2)
      u.uZoneLevel.value[i] = shown.current[i]
      const f = since(events, z.id, ['fail'], now)
      const errorGlow = zm?.state === 'error' ? 0.18 + 0.12 * Math.sin(state.clock.elapsedTime * 2) * (reduced ? 0 : 1) : 0
      u.uZoneFlash.value[i] = Math.max(errorGlow, f >= 0 && f < 2 ? 1 - f / 2 : 0)
      const r = since(events, z.id, ['assign', 'complete', 'lead', 'studio', 'need', 'voice'], now)
      u.uZoneRipple.value[i] = r >= 0 && r < 1.4 ? r : -1
    })
  })
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[FLOOR_R, 128]} />
        {reflector ? (
          <MeshReflectorMaterial
            resolution={reflector}
            blur={reflector >= 1024 ? [480, 120] : [300, 80]}
            mixBlur={0.9}
            mixStrength={3.2}
            mixContrast={1}
            depthScale={0.9}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
            mirror={0.45}
            metalness={0.82}
            roughness={1}
            color="#ffffff"
            map={tex.map}
            normalMap={tex.normalMap}
            normalScale={new THREE.Vector2(0.9, 0.9)}
            roughnessMap={tex.roughnessMap}
            emissiveMap={tex.emissiveMap}
            emissive="#ffffff"
            emissiveIntensity={0.55}
            envMapIntensity={0.9}
          />
        ) : (
          <meshStandardMaterial
            color="#ffffff"
            map={tex.map}
            normalMap={tex.normalMap}
            normalScale={new THREE.Vector2(0.9, 0.9)}
            roughnessMap={tex.roughnessMap}
            metalness={0.78}
            roughness={1}
            emissiveMap={tex.emissiveMap}
            emissive="#ffffff"
            emissiveIntensity={0.55}
            envMapIntensity={0.9}
          />
        )}
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004} material={glow}>
        <circleGeometry args={[FLOOR_R, 128]} />
      </mesh>
      {/* The same light on the island's deck, where the zones actually are. */}
      <mesh geometry={deckTop} material={glow} position-y={0.163} />
    </group>
  )
}

// ---------------------------------------------------------------- the island

/** Soft dark contact shadow under anything standing on the floor. */
let blobTex: THREE.Texture | null = null
function blobTexture() {
  if (blobTex) return blobTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64)
  grad.addColorStop(0, 'rgba(0,0,0,0.85)')
  grad.addColorStop(0.55, 'rgba(0,0,0,0.45)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  blobTex = new THREE.CanvasTexture(c)
  return blobTex
}

export function Blob({ radius, position = [0, 0, 0], opacity = 0.75 }: { radius: number; position?: [number, number, number]; opacity?: number }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity, toneMapped: false }), [opacity])
  return (
    <mesh rotation-x={-Math.PI / 2} position={[position[0], 0.012, position[2]]} material={mat} renderOrder={1}>
      <planeGeometry args={[radius * 2, radius * 2]} />
    </mesh>
  )
}

/**
 * The installation: a raised hex deck carrying the reactor and the six zone
 * pads, edged with light strips, with service vents and markings.
 */
export function Island() {
  const deck = useMemo(() => {
    const shape = new THREE.Shape()
    hexPoints(8.1).forEach((p, i) => (i ? shape.lineTo(p.x, p.z) : shape.moveTo(p.x, p.z)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.06, bevelSegments: 3 })
    g.rotateX(Math.PI / 2)
    g.translate(0, 0.09 + 0.035, 0)
    return g
  }, [])
  const deckMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#191c27', metalness: 0.8, roughness: 0.42, envMapIntensity: 0.8 }), [])
  const rim = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#6d8bff').multiplyScalar(1.6), toneMapped: false }), [])
  const rimDim = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#5b4bd6').multiplyScalar(1.1), toneMapped: false }), [])
  const grille = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0b0c12', metalness: 0.6, roughness: 0.7 }), [])
  const vents = useRef<THREE.InstancedMesh>(null)
  // Vents: two slotted grilles on each side of the deck, between the pads.
  const ventSpots = useMemo(() => {
    const out: { x: number; z: number; a: number }[] = []
    for (let k = 0; k < 6; k++) {
      const a = ((k * 60 + 0) * Math.PI) / 180
      for (const off of [-0.55, 0.55]) {
        const r = 7.1
        out.push({ x: Math.cos(a) * r - Math.sin(a) * off, z: Math.sin(a) * r + Math.cos(a) * off, a })
      }
    }
    return out
  }, [])
  useEffect(() => {
    const im = vents.current
    if (!im) return
    const o = new THREE.Object3D()
    let n = 0
    for (const v of ventSpots)
      for (let s = 0; s < 5; s++) {
        o.position.set(v.x + Math.cos(v.a) * (s - 2) * 0.13, 0.165, v.z + Math.sin(v.a) * (s - 2) * 0.13)
        o.rotation.set(0, -v.a, 0)
        o.updateMatrix()
        im.setMatrixAt(n++, o.matrix)
      }
    im.instanceMatrix.needsUpdate = true
  }, [ventSpots])
  // Light strips along each deck edge, broken at the middle.
  const strips = useMemo(() => {
    const pts = hexPoints(8.14)
    const out: { pos: THREE.Vector3; len: number; rot: number }[] = []
    for (let i = 0; i < 6; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      for (const [t0, t1] of [
        [0.06, 0.44],
        [0.56, 0.94],
      ]) {
        const p0 = a.clone().lerp(b, t0)
        const p1 = a.clone().lerp(b, t1)
        out.push({ pos: p0.clone().add(p1).multiplyScalar(0.5).setY(0.168), len: p0.distanceTo(p1), rot: -Math.atan2(p1.z - p0.z, p1.x - p0.x) })
      }
    }
    return out
  }, [])
  return (
    <group>
      <mesh geometry={deck} material={deckMat} receiveShadow castShadow />
      {strips.map((s, i) => (
        <mesh key={i} position={s.pos} rotation-y={s.rot} material={i % 2 ? rimDim : rim}>
          <boxGeometry args={[s.len, 0.025, 0.05]} />
        </mesh>
      ))}
      {/* Inner ring etched into the deck round the reactor platform. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.165} material={rimDim}>
        <ringGeometry args={[2.62, 2.66, 96]} />
      </mesh>
      <instancedMesh ref={vents} args={[undefined, undefined, ventSpots.length * 5]} material={grille} receiveShadow>
        <boxGeometry args={[0.06, 0.02, 0.62]} />
      </instancedMesh>
    </group>
  )
}
