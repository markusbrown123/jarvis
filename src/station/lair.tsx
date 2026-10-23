import { useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { MeshReflectorMaterial, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Graphics } from '../hub/client'
import { reactorState } from './shared'
import { useStation } from './stationStore'
import { HOUSE } from './layout'
import { ROOM, roomify } from './houselight'

// The terrace's downlights, softer on its pale stone than indoors.
const TERRACE_WARM = { value: new THREE.Color() }
import { OUTDOOR } from './environment'
import { SKY, SKY_COMMON } from './sky'

/**
 * The house: a round glass pavilion on a sea cliff. Polished travertine
 * floors round a black marble stage, board-formed concrete behind, a white
 * ceiling with a glowing coffer over the console, and the front half all
 * glass in slim black frames, its middle panel slid open onto a terrace with
 * an infinity pool, a glass balustrade and the roof cantilevered out over it.
 *
 * Modelled and lit in Blender (tools/blender/lair.py). Each stone, concrete
 * and plaster surface comes with a detail map (veins, pores, cracks, board
 * marks, crevices darkened) and a lightmap whose channels hold the house's
 * warm lights, JARVIS's light and the sky's light apart (houselight.ts), so
 * they're coloured live: the sky's by the real time of day, JARVIS's with
 * his state. The sun or moon shines in through the glass on top of that,
 * striped by the frames. Floor and stage add live mirror reflections on High
 * and Ultra; the pool's water and the glass are live shaders.
 *
 * In Command mode the roof and the nearest wall are cut away so the
 * overview can look in from above.
 */

const MODEL = '/station/lair.glb'
// Matches LM_SCALE in lair.py; π because three divides baked light by π.
const LIGHT_SCALE = 6 * Math.PI
const BAKED = ['floor', 'stage', 'deck', 'pool', 'wall_left', 'wall_front', 'wall_right', 'roof', 'pillars'] as const
const DETAIL = ['terrain', 'cliff', 'plants'] as const
const NORMALS = ['floor', 'stage', 'deck', 'wall_left', 'wall_front', 'wall_right', 'terrain', 'cliff'] as const
type Name = (typeof BAKED)[number] | (typeof DETAIL)[number]

function useMaps(graphics: Graphics) {
  const urls = [
    ...BAKED.flatMap((n) => [`/station/${n}_detail_${graphics}.jpg`, `/station/${n}_light_${graphics}.jpg`]),
    ...DETAIL.map((n) => `/station/${n}_detail_${graphics}.jpg`),
    ...NORMALS.map((n) => `/station/${n}_normal_${graphics}.jpg`),
  ]
  const tex = useLoader(THREE.TextureLoader, urls)
  return useMemo(() => {
    const out = {} as Record<Name, { detail: THREE.Texture; light?: THREE.Texture; normal?: THREE.Texture }>
    let i = 0
    for (const n of BAKED) out[n] = { detail: tex[i++], light: tex[i++] }
    for (const n of DETAIL) out[n] = { detail: tex[i++] }
    for (const n of NORMALS) out[n].normal = tex[i++]
    for (const t of tex) {
      t.flipY = false // glTF's UVs run top-down
      t.anisotropy = 8
      t.needsUpdate = true
    }
    for (const n of [...BAKED, ...DETAIL]) {
      out[n].detail.colorSpace = THREE.SRGBColorSpace
      if (out[n].light) out[n].light.colorSpace = THREE.SRGBColorSpace
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex])
}

/** A node's own placement, for drawing its geometry with our materials. */
const at = (o: THREE.Object3D) => ({ position: o.position, quaternion: o.quaternion, scale: o.scale })

/**
 * A floor for the mirror: drei's reflector takes the mesh's own +Z as the
 * mirror's normal and its origin as a point on it, so the slab is laid in
 * that frame — its top surface through the origin, facing +Z — and the mesh
 * turned back to lie flat at the top surface's height.
 */
function mirrorFloor(node: THREE.Mesh) {
  const g = node.geometry.clone()
  node.updateMatrixWorld()
  g.applyMatrix4(node.matrixWorld)
  g.computeBoundingBox()
  const top = g.boundingBox!.max.y
  g.translate(0, -top, 0)
  g.rotateX(Math.PI / 2)
  return { geometry: g, top }
}

/** The light strips, split into the ones up in the ceiling and the rest. */
function splitByHeight(g: THREE.BufferGeometry, y: number) {
  const src = g.index ? g.toNonIndexed() : g
  const p = src.attributes.position
  const hi: number[] = []
  const lo: number[] = []
  for (let i = 0; i < p.count; i += 3) {
    const tri = [0, 1, 2].flatMap((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)])
    ;(Math.max(tri[1], tri[4], tri[7]) > y ? hi : lo).push(...tri)
  }
  const make = (a: number[]) => {
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', new THREE.Float32BufferAttribute(a, 3))
    return out
  }
  return { high: make(hi), low: make(lo) }
}

const surfaceVert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`

// Glass as glass: almost clear head-on, mirror-like at grazing angles;
// from inside it gives back the room (strongest at night), from outside
// the sky. Output premultiplied, so what's behind shows through.
const glassFrag = /* glsl */ `
${SKY_COMMON}
uniform vec3 uInterior;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal);
  if (dot(N, V) < 0.0) N = -N;
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl;
  if (length(cameraPosition.xz) < length(vWorld.xz) - 0.05) {
    refl = uInterior * (0.55 + 0.45 * smoothstep(-0.3, 0.5, R.y));
  } else {
    vec4 cl = clouds(R, 3);
    refl = mix(skyLut(R), cl.rgb, cl.a);
  }
  float smudge = vnoise(vWorld.xy * 3.0 + vWorld.z * 2.0) * vnoise(vWorld.zy * 7.0);
  // Rain on the glass: fine beads, and bigger drops running down it.
  float drops = 0.0;
  if (uRain > 0.02) {
    float u = atan(-vWorld.z, vWorld.x) * 15.0;
    vec2 g = vec2(u, vWorld.y) * vec2(9.0, 6.0);
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = hash12(id);
    if (h < uRain * 0.8) {
      float slide = fract(uTime * (0.05 + 0.2 * hash12(id + 5.0)) + h * 7.0);
      vec2 c = vec2(0.3 + 0.4 * hash12(id + 1.3), 1.0 - slide);
      float r = 0.1 + 0.08 * hash12(id + 9.1);
      float drop = smoothstep(r, r * 0.55, length((f - c) * vec2(1.0, 1.5)));
      float trail = smoothstep(0.04, 0.0, abs(f.x - c.x)) * step(c.y, f.y) * (1.0 - f.y) * 0.45;
      drops = max(drop, trail);
    }
    vec2 g2 = vec2(u, vWorld.y) * 30.0;
    vec2 id2 = floor(g2);
    vec2 o2 = vec2(hash12(id2), hash12(id2 + 2.0)) - 0.5;
    drops = max(drops, step(hash12(id2 + 17.0), uRain * 0.18) * smoothstep(0.16, 0.06, length(fract(g2) - 0.5 - o2 * 0.4)) * 0.45);
  }
  vec3 dropLight = skyLut(vec3(0.0, 1.0, 0.0)) * 1.2 + uInterior * 0.6;
  float a = clamp(F + 0.025 + smudge * 0.02 + drops * 0.22, 0.0, 1.0);
  gl_FragColor = vec4(refl * F + uInterior * smudge * 0.01 + dropLight * drops * 0.35, a);
}`

// The pool: rippling, reflecting the sky, aqua tiles seen through it with
// caustics dancing on them, and lit from below after dark.
const waterFrag = /* glsl */ `
${SKY_COMMON}
uniform vec3 uGlow;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec2 p = vWorld.xz;
  float t = uTime;
  vec2 s = vec2(0.0);
  s += vec2(cos(p.x * 1.7 + t * 1.1), sin(p.y * 1.9 - t * 0.9)) * 0.02;
  s += vec2(sin(dot(p, vec2(2.3, 3.1)) + t * 1.7), cos(dot(p, vec2(-3.7, 2.2)) - t * 1.3)) * 0.012;
  s += (vec2(vnoise(p * 4.0 + t * 0.5), vnoise(p * 4.0 - t * 0.4)) - 0.5) * 0.03;
  s += (vec2(vnoise(p * 9.0 + t * 1.4), vnoise(p * 9.0 - t * 1.2 + 3.0)) - 0.5) * 0.02;
  // Raindrops landing: rings spreading on the surface.
  if (uRain > 0.02) {
    for (int k = 0; k < 2; k++) {
      vec2 g = p * (2.5 + float(k) * 1.7) + float(k) * 13.1;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5 - (vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5) * 0.5;
      float h = hash12(id);
      float tt = fract(t * (0.7 + 0.5 * h) + h);
      float d = length(f);
      float ring = sin((d - tt * 0.45) * 55.0) * exp(-d * 6.0) * (1.0 - tt) * step(h, uRain);
      s += f / max(d, 1e-3) * ring * 0.09;
    }
  }
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec4 cl = clouds(R, 3);
  vec3 refl = mix(skyLut(R), cl.rgb, cl.a);
  float c1 = vnoise(p * 2.2 + vec2(t * 0.35, t * 0.2) + s * 20.0);
  float c2 = vnoise(p * 3.1 - vec2(t * 0.25, -t * 0.3) - s * 18.0);
  float caustic = pow(1.0 - abs(c1 - c2), 6.0);
  vec3 skyUp = skyLut(vec3(0.0, 1.0, 0.0));
  vec3 below = vec3(0.05, 0.36, 0.4) * (skyUp * 0.9 + uSunColor * 0.25 * max(uSun.y, 0.0) * (1.0 - 0.7 * cloudShadow(vWorld))) * (0.75 + 0.8 * caustic * (1.0 - 0.6 * uCloud));
  below += uGlow * (0.7 + 0.5 * caustic);
  vec3 c = mix(below, refl, F);
  c += uSunColor * pow(max(dot(R, uSun), 0.0), 900.0) * 30.0;
  gl_FragColor = vec4(c, 1.0);
}`

export function Lair({ graphics, reflector }: { graphics: Graphics; reflector: number }) {
  const { nodes } = useGLTF(MODEL, false) as unknown as { nodes: Record<string, THREE.Mesh> }
  const maps = useMaps(graphics)
  const mode = useStation((s) => s.mode)
  const inside = mode !== 'command'
  const mats = useMemo(() => {
    const baked = (n: (typeof BAKED)[number], o: THREE.MeshStandardMaterialParameters, own = {}) =>
      roomify(new THREE.MeshStandardMaterial({ map: maps[n].detail, lightMap: maps[n].light, lightMapIntensity: LIGHT_SCALE, normalMap: maps[n].normal ?? null, ...o }), own)
    const outdoor = (m: THREE.MeshStandardMaterial) => (OUTDOOR.add(m), m)
    return {
      deck: outdoor(baked('deck', { roughness: 0.45, normalScale: new THREE.Vector2(0.6, 0.6) }, { roomWarm: TERRACE_WARM })),
      pool: outdoor(baked('pool', { roughness: 0.25 }, { roomWarm: TERRACE_WARM })),
      wall_left: baked('wall_left', { roughness: 0.86, envMapIntensity: 0.25 }),
      wall_front: baked('wall_front', { roughness: 0.86, envMapIntensity: 0.25 }),
      wall_right: baked('wall_right', { roughness: 0.86, envMapIntensity: 0.25 }),
      roof: baked('roof', { roughness: 0.9, envMapIntensity: 0.2 }),
      pillars: baked('pillars', { roughness: 0.32, metalness: 0.7, envMapIntensity: 1.2 }),
      terrain: outdoor(new THREE.MeshStandardMaterial({ map: maps.terrain.detail, normalMap: maps.terrain.normal, roughness: 0.95 })),
      cliff: outdoor(new THREE.MeshStandardMaterial({ map: maps.cliff.detail, normalMap: maps.cliff.normal, roughness: 0.92 })),
      plants: outdoor(new THREE.MeshStandardMaterial({ map: maps.plants.detail, roughness: 0.8 })),
      frames: new THREE.MeshStandardMaterial({ color: '#0a0a0c', metalness: 0.85, roughness: 0.3 }),
      rail: outdoor(new THREE.MeshStandardMaterial({ color: '#c4c8cf', metalness: 1, roughness: 0.18 })),
      led: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc890').multiplyScalar(2.4), toneMapped: false }),
      halo: new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }),
      edge: new THREE.MeshBasicMaterial({ color: '#7c8bff', toneMapped: false }),
      glass: new THREE.ShaderMaterial({
        vertexShader: surfaceVert,
        fragmentShader: glassFrag,
        uniforms: { ...SKY, uInterior: { value: new THREE.Color() } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
      water: new THREE.ShaderMaterial({ vertexShader: surfaceVert, fragmentShader: waterFrag, uniforms: { ...SKY, uGlow: { value: new THREE.Color() } } }),
    }
  }, [maps])
  const led = useMemo(() => (nodes.led_warm ? splitByHeight(nodes.led_warm.geometry, 2.5) : null), [nodes])
  const floors = useMemo(() => (['floor', 'stage'] as const).filter((n) => nodes[n]).map((n) => ({ n, ...mirrorFloor(nodes[n]) })), [nodes])
  const pool = HOUSE.pool

  useFrame(() => {
    const st = reactorState()
    TERRACE_WARM.value.copy(ROOM.roomWarm.value).multiplyScalar(0.15)
    // JARVIS's own light: the coffer's halo, the line round the stage, and
    // the light they throw on the room (the lightmaps' green).
    ROOM.roomJarvis.value.copy(st.color).multiplyScalar(0.55 + st.level * 0.9)
    mats.halo.color.copy(st.color).multiplyScalar(1.6 + st.level * 1.4)
    mats.edge.color.copy(st.color).multiplyScalar(1.1 + st.level)
    const dusk = Math.min(1, Math.max(0, (SKY.uExposure.value - 1.4) / 6))
    mats.glass.uniforms.uInterior.value.copy(ROOM.roomWarm.value).multiplyScalar(0.05 + 0.2 * dusk)
    mats.water.uniforms.uGlow.value.setRGB(0.05, 0.42, 0.5).multiplyScalar(0.06 + 0.5 * dusk)
    // After rain the terrace and the garden go dark and glossy, puddled.
    const wet = SKY.uWet.value
    mats.deck.roughness = 0.45 - 0.33 * wet
    mats.deck.color.setScalar(1 - 0.3 * wet)
    for (const m of [mats.terrain, mats.cliff, mats.plants]) {
      m.color.setScalar(1 - 0.35 * wet)
      m.roughness = 0.92 - 0.4 * wet
    }
  })

  const stone = (n: 'floor' | 'stage') => {
    const m = maps[n]
    const common = { map: m.detail, lightMap: m.light, lightMapIntensity: LIGHT_SCALE, normalMap: m.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: n === 'stage' ? 0.1 : 0.14, metalness: 0.0, envMapIntensity: 0.45 }
    return reflector ? (
      <MeshReflectorMaterial
        ref={(mat) => void (mat && roomify(mat))}
        {...common}
        resolution={reflector}
        blur={reflector >= 1024 ? [300, 90] : [200, 60]}
        mixBlur={0.6}
        mixStrength={n === 'stage' ? 3 : 2.2}
        mixContrast={1}
        mirror={0.75}
        depthScale={0.6}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.3}
      />
    ) : (
      <meshStandardMaterial ref={(mat) => void (mat && roomify(mat))} {...common} />
    )
  }

  const show = (n: string) => inside || (n !== 'roof' && n !== 'wall_front')
  return (
    <group>
      {floors.map(({ n, geometry, top }) => (
        <mesh key={`${n}-${reflector}`} geometry={geometry} position-y={top} rotation-x={-Math.PI / 2} receiveShadow>
          {stone(n)}
        </mesh>
      ))}
      {(['deck', 'pool', 'wall_left', 'wall_front', 'wall_right', 'roof', 'pillars', 'terrain', 'cliff', 'plants', 'frames', 'rail'] as const).map((n) =>
        nodes[n] && show(n) ? <mesh key={n} geometry={nodes[n].geometry} {...at(nodes[n])} material={mats[n]} receiveShadow={n === 'deck' || n === 'pool'} /> : null,
      )}
      {nodes.glass && <mesh geometry={nodes.glass.geometry} {...at(nodes.glass)} material={mats.glass} renderOrder={5} />}
      {led && nodes.led_warm && <mesh geometry={led.low} {...at(nodes.led_warm)} material={mats.led} />}
      {led && nodes.led_warm && inside && <mesh geometry={led.high} {...at(nodes.led_warm)} material={mats.led} />}
      {nodes.emit_stage && <mesh geometry={nodes.emit_stage.geometry} {...at(nodes.emit_stage)} material={mats.edge} />}
      {inside && nodes.emit_halo && <mesh geometry={nodes.emit_halo.geometry} {...at(nodes.emit_halo)} material={mats.halo} />}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.06} material={mats.water}>
        <ringGeometry args={[pool.r0, pool.r1, 64, 1, pool.a0, pool.a1 - pool.a0]} />
      </mesh>
    </group>
  )
}
