import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { Boats } from './boats'
import { MAX_BOATS, WAKES } from './wakes'
import { HOUSE } from './layout'
import { ATMOSPHERE_GLSL, SKY, SKY_COMMON, SKY_STATE, skyMaterial } from './sky'

/**
 * What's outside the glass: the real sky over the sea, for this moment.
 *
 * The sky's colour comes from scattering sunlight (and moonlight) through
 * the atmosphere (sky.ts), worked out into a small table whenever the sun
 * moves; on top of it the sun's disc, the moon with its real phase lit from
 * the sun's side, the stars and a faint Milky Way turned to the right
 * sidereal time, and drifting clouds lit from the sun — white at noon, gold
 * and then pink at sunset, grey-blue in twilight.
 *
 * The sea far below works out its own waves per pixel and reflects that
 * sky and those clouds: the sun's glitter path by day, the moon's by night,
 * surf breaking white round the foot of the cliffs, boats' wakes and their
 * lights after dark (boats.tsx). Distant headlands fade into the haze, and
 * the towns along them light up at dusk.
 */

const lutVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const lutFrag = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform vec3 uSun;
uniform vec3 uMoon;
uniform float uSunI;
uniform float uMoonI;
uniform float uMoonLit;
uniform float uExposure;
uniform float uNight;
varying vec2 vUv;
void main() {
  float az = (vUv.x - 0.5) * 2.0 * PI;
  float y = vUv.y * vUv.y;
  float c = sqrt(max(1.0 - y * y, 0.0));
  vec3 d = vec3(cos(az) * c, max(y, 0.002), sin(az) * c);
  vec3 col = atmosphere(d, uSun, uSunI) + atmosphere(d, uMoon, uMoonI * uMoonLit);
  // Airglow and starlight: the sky's never quite black.
  col = col * uExposure + vec3(0.0016, 0.0028, 0.0065) * uNight;
  gl_FragColor = vec4(col, 1.0);
}`

const seaVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const seaFrag = /* glsl */ `
${SKY_COMMON}
#define BOATS ${MAX_BOATS}
uniform float uWaves;
uniform vec4 uBoats[BOATS];
uniform vec4 uBoatDim[BOATS];
uniform vec4 uBoatLights[16];
uniform vec3 uBoatLightCol[16];
varying vec3 vWorld;

// Swell from a few directions plus chop, as surface slopes; rougher in
// wind, fading with distance so far water doesn't shimmer.
vec2 slope(vec2 p, float t, float detail, float rough) {
  vec2 s = vec2(0.0);
  float k = 0.028;
  float a = 1.0;
  vec2 dir = normalize(vec2(0.35, 1.0));
  for (int i = 0; i < 11; i++) {
    float w = sqrt(9.8 * k);
    float ph = dot(dir, p) * k + t * w * uWaves + float(i) * 1.7;
    // Sharper crests than a sine: slopes bunch at the tops of waves.
    float c = cos(ph);
    float amp = a * k * 1.5 * rough * (i < 3 ? 1.0 : detail);
    s += dir * amp * c * (1.0 + 0.6 * sin(ph));
    k *= 1.62;
    a *= 0.6;
    dir = vec2(dir.x * 0.6 - dir.y * 0.8, dir.x * 0.8 + dir.y * 0.6);
  }
  return s;
}

// Where the cliff meets the water, round the house (lair.py's cliff_edge).
float cliffFoot(vec2 p) {
  float a = atan(-p.y, p.x);
  float da = abs(atan(sin(a - PI * 0.5), cos(a - PI * 0.5)));
  float t = clamp((da - 1.658) / 0.96, 0.0, 1.0);
  return 24.4 + 40.0 * t * t * (3.0 - 2.0 * t) + 5.2;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float detail = 1.0 - smoothstep(60.0, 450.0, dist);
  float wind = length(uWind);
  float rough = clamp(0.75 + wind * 0.05 + uRain * 0.25, 0.7, 1.6);
  vec2 s = slope(vWorld.xz, uTime, detail, rough) * mix(1.0, 0.55, smoothstep(150.0, 1100.0, dist));
  // Close up: ripples riding on the waves, and rain dimpling the surface.
  float near = 1.0 - smoothstep(25.0, 180.0, dist);
  vec2 q = vWorld.xz;
  s += (vec2(vnoise(q * 0.9 + uTime * 0.7), vnoise(q * 0.9 - uTime * 0.6 + 4.0)) - 0.5) * 0.16 * near;
  s += (vec2(vnoise(q * 3.1 - uTime * 1.3), vnoise(q * 3.1 + uTime * 1.1 + 9.0)) - 0.5) * 0.1 * near;
  s += (vec2(vnoise(q * 6.0 + uTime * 9.0), vnoise(q * 6.0 - uTime * 8.0 + 2.0)) - 0.5) * 0.35 * uRain * near;

  // Wakes: churned water behind each boat, the V of its bow waves.
  float foam = 0.0;
  for (int i = 0; i < BOATS; i++) {
    vec4 b = uBoats[i];
    vec4 dim = uBoatDim[i];
    if (dim.w < 0.5 || b.w <= 0.0) continue;
    vec2 f = vec2(cos(b.z), sin(b.z));
    vec2 rel = vWorld.xz - b.xy;
    float behind = -dot(rel, f) + dim.x * 0.5;
    float side = dot(rel, vec2(-f.y, f.x));
    float reach = b.w * 40.0 + dim.x * 2.0;
    if (behind < -dim.x * 0.2 || behind > reach || abs(side) > behind * 0.45 + dim.y * 2.0) continue;
    float decay = exp(-behind / (b.w * 10.0 + 25.0));
    float w = dim.y * 0.55 + behind * (dim.z > 0.5 ? 0.02 : 0.045);
    float n = vnoise(rel * 0.4 + vec2(uTime * 0.6, 0.0)) * 0.6 + vnoise(rel * 1.3 - uTime) * 0.4;
    float trail = exp(-pow(side / w, 2.0)) * smoothstep(dim.x * 0.3, dim.x * 0.9, behind);
    float arm = abs(side) - max(behind - dim.x * 0.4, 0.0) * 0.354;
    float arms = exp(-pow(arm / (0.5 + behind * 0.025), 2.0)) * smoothstep(dim.x * 0.4, dim.x * 1.5, behind);
    float bow = exp(-pow(length(rel - f * dim.x * 0.45) / (dim.y * 0.8), 2.0));
    float k = min(b.w / 7.0, 1.5);
    foam += ((trail * (0.55 + 0.7 * n) + arms * 0.5 * n) * decay + bow * 0.6) * k;
    s += vec2(-f.y, f.x) * sign(side) * arms * 0.08 * decay * k;
  }
  // Surf round the foot of the cliffs.
  float shore = length(vWorld.xz) - cliffFoot(vWorld.xz);
  float surge = 0.55 + 0.45 * sin(shore * 1.1 - uTime * 1.4 + vnoise(vWorld.xz * 0.15) * 5.0);
  foam += exp(-max(shore + 3.0, 0.0) / 4.0) * surge * (0.5 + 0.6 * vnoise(vWorld.xz * 0.6 + uTime * 0.25)) * step(-6.0, shore);

  // Whitecaps where the wind breaks the steepest crests.
  float steep = length(s);
  foam += smoothstep(0.2, 0.38, steep) * smoothstep(4.0, 11.0, wind) * (0.4 + 0.6 * vnoise(vWorld.xz * 0.3 + uTime * 0.4)) * detail;

  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.002;
  // Clouds' shadows drift across the water.
  float shade = 1.0 - 0.75 * cloudShadow(vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec4 cr = clouds(R, 3);
  vec3 refl = mix(skyLut(R), cr.rgb, cr.a * 0.65);
  // The water itself: dark blue-green, lit by the sky; greener in the
  // shallows by the rocks, and through the backs of waves facing the sun.
  vec3 skyUp = skyLut(vec3(0.0, 1.0, 0.0));
  vec3 body = vec3(0.008, 0.04, 0.07) * (skyUp * 1.6 + uSunColor * 0.12 * shade);
  body += vec3(0.02, 0.09, 0.08) * exp(-max(shore, 0.0) / 14.0) * (skyUp + uSunColor * 0.2 * shade);
  // Sunlight through the backs of the waves: turquoise in the crests.
  body += vec3(0.0, 0.09, 0.075) * uSunColor * 0.22 * shade * smoothstep(0.05, 0.3, steep) * max(dot(normalize(vec3(-V.x, 0.0, -V.z)), -uSun), 0.2) * detail;
  vec3 c = mix(body, refl, fres);
  // The sun's glitter path by day, the moon's by night.
  float g = max(dot(R, uSun), 0.0);
  c += uSunColor * (pow(g, 2400.0) * 120.0 + pow(g, 160.0) * 1.4) * (1.0 - cr.a * 0.8) * shade;
  float gm = max(dot(R, uMoon), 0.0);
  c += uMoonColor * (pow(gm, 1600.0) * 10.0 + pow(gm, 110.0) * 0.12) * (1.0 - cr.a * 0.8);
  // Boats' lights, glinting on the water after dark.
  for (int i = 0; i < 16; i++) {
    vec4 L = uBoatLights[i];
    if (L.w < 0.5) continue;
    vec3 toL = L.xyz - vWorld;
    float gl = max(dot(R, normalize(toL)), 0.0);
    c += uBoatLightCol[i] * (pow(gl, 700.0) * 4.0 + pow(gl, 90.0) * 0.08);
  }
  vec3 foamCol = skyUp * 1.6 + uSunColor * 0.5 * max(uSun.y, 0.0) * shade + uMoonColor * 0.03;
  c = mix(c, foamCol, clamp(foam, 0.0, 1.0) * 0.85);
  // Into the haze at the horizon.
  vec3 haze = skyLut(normalize(vec3(-V.x, 0.01, -V.z)));
  c = mix(c, haze, smoothstep(400.0 * (1.0 - 0.8 * uFog), 1900.0 * (1.0 - 0.55 * uFog), dist) * mix(0.75, 1.0, uFog));
  c += vec3(0.6, 0.65, 0.85) * uFlash * 0.12;
  gl_FragColor = vec4(c, 1.0);
}`

const hillFrag = /* glsl */ `
${SKY_COMMON}
varying vec3 vWorld;
void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  vec3 skyUp = skyLut(vec3(0.0, 1.0, 0.0));
  float shade = 0.7 + 0.3 * vnoise(vWorld.xz * 0.02 + vWorld.y * 0.05);
  vec3 land = vec3(0.05, 0.06, 0.045) * shade * (skyUp * 1.3 + uSunColor * 0.25 * max(uSun.y, 0.0));
  vec3 haze = skyLut(normalize(vec3(d.x, 0.02, d.z)));
  gl_FragColor = vec4(mix(land, haze, 0.62), 1.0);
}`

function hillsGeometry(a0: number, a1: number, r: number, height: number, seed: number) {
  const n = 128
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    const t = i / n
    const env = Math.sin(t * Math.PI) ** 0.6
    const h = height * env * (0.6 + 0.25 * Math.sin(a * 23 + seed) + 0.15 * Math.sin(a * 61 + seed * 2))
    pos.push(Math.sin(a) * r, HOUSE.sea - 2, -Math.cos(a) * r, Math.sin(a) * r, HOUSE.sea + h, -Math.cos(a) * r)
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

function coastLights(a0: number, a1: number, r: number, count: number, seed: number) {
  const pos: number[] = []
  const col: number[] = []
  let s = seed
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < count; i++) {
    const a = a0 + (a1 - a0) * rnd()
    const rr = r - 6 - rnd() * 22
    pos.push(Math.sin(a) * rr, HOUSE.sea + 0.4 + rnd() * 5 * Math.sin(((a - a0) / (a1 - a0)) * Math.PI), -Math.cos(a) * rr)
    const warm = rnd() > 0.25
    col.push(...(warm ? [1.0, 0.72, 0.42] : [0.75, 0.85, 1.0]).map((v) => v * (0.8 + rnd() * 1.6)))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

/**
 * The sky table: the atmosphere's colour in every direction, recomputed
 * (into a 128×64 texture) whenever the sky moves on.
 */
function SkyTable() {
  const gl = useThree((s) => s.gl)
  const pass = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType, depthBuffer: false })
    target.texture.wrapS = THREE.RepeatWrapping
    const material = new THREE.ShaderMaterial({
      vertexShader: lutVert,
      fragmentShader: lutFrag,
      uniforms: { uSun: SKY.uSun, uMoon: SKY.uMoon, uSunI: SKY.uSunI, uMoonI: SKY.uMoonI, uMoonLit: { value: 0.5 }, uExposure: SKY.uExposure, uNight: SKY.uNight },
      depthTest: false,
      depthWrite: false,
    })
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))
    SKY.uLut.value = target.texture
    return { target, material, scene, camera: new THREE.OrthographicCamera(), drawn: -1 }
  }, [])
  useFrame(() => {
    if (pass.drawn === SKY_STATE.version) return
    pass.drawn = SKY_STATE.version
    pass.material.uniforms.uMoonLit.value = SKY_STATE.moonLit
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(pass.target)
    gl.render(pass.scene, pass.camera)
    gl.setRenderTarget(prev)
  })
  return null
}

export function Outside() {
  const sky = useMemo(() => skyMaterial(true), [])
  const uniforms = useMemo(() => ({ ...SKY, ...WAKES, uWaves: { value: 1 } }), [])
  const sea = useMemo(() => new THREE.ShaderMaterial({ vertexShader: seaVert, fragmentShader: seaFrag, uniforms }), [uniforms])
  const land = useMemo(() => new THREE.ShaderMaterial({ vertexShader: seaVert, fragmentShader: hillFrag, uniforms: SKY }), [])
  const dots = useMemo(() => new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, opacity: 0 }), [])
  const coasts = useMemo(
    () => [
      { hills: hillsGeometry(-2.3, -0.55, 850, 38, 1), lights: coastLights(-2.2, -0.65, 850, 420, 7) },
      { hills: hillsGeometry(0.75, 1.9, 1050, 30, 4), lights: coastLights(0.85, 1.8, 1050, 260, 13) },
    ],
    [],
  )
  useFrame((st) => {
    const still = useHub.getState().prefs.reducedMotion
    SKY.uTime.value = st.clock.elapsedTime
    uniforms.uWaves.value = still ? 0 : 1
    // The towns light up as it gets dark.
    dots.opacity = Math.min(1, Math.max(0, (SKY.uExposure.value - 1.5) / 4))
  })
  return (
    <group>
      <SkyTable />
      <mesh material={sky} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[1500, 48, 24]} />
      </mesh>
      <mesh material={sea} rotation-x={-Math.PI / 2} position-y={HOUSE.sea} renderOrder={-9}>
        <planeGeometry args={[4400, 4400, 1, 1]} />
      </mesh>
      {coasts.map((c, i) => (
        <group key={i}>
          <mesh geometry={c.hills} material={land} />
          <points geometry={c.lights} material={dots} />
        </group>
      ))}
      <Boats />
    </group>
  )
}
