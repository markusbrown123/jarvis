import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { MOON_DIR } from './layout'

/**
 * What's outside the lair's window: the sea far below at blue hour — the
 * last warm light of the sunset low on the horizon, a moon, stars, and the
 * lights of the coast across the bay. Drawn entirely in shaders (no image
 * files): the sky is a gradient with the moon and stars in it, and the sea
 * computes its own waves per pixel and reflects that same sky, so the
 * moon's path glitters on the water.
 *
 * The moon sits where the baked moonlight in the room comes from
 * (tools/blender/lair.py: 17° up, 14° right of straight out).
 */

const SUNSET_DIR = new THREE.Vector3(-0.55, 0, -0.84).normalize()
const SEA_Y = -28

const SKY = /* glsl */ `
uniform vec3 uMoon;
uniform vec3 uSunset;
uniform float uTime;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec3 skyColor(vec3 d, bool stars) {
  float h = d.y;
  vec3 zenith = vec3(0.004, 0.009, 0.03);
  vec3 mid = vec3(0.016, 0.036, 0.095);
  vec3 horizon = vec3(0.07, 0.1, 0.19);
  vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.16, h));
  c = mix(c, zenith, smoothstep(0.16, 0.8, h));
  // The last of the sunset, low on one side.
  vec2 ground = normalize(d.xz + 1e-5);
  float toward = max(0.0, dot(ground, normalize(uSunset.xz)));
  float low = exp(-max(h, 0.0) * 11.0);
  c += vec3(0.62, 0.24, 0.12) * pow(toward, 5.0) * low * 0.55;
  c += vec3(0.3, 0.16, 0.2) * pow(toward, 2.0) * low * 0.12;
  // Moon: a disc with a soft halo.
  float md = dot(d, uMoon);
  c += vec3(0.85, 0.9, 1.0) * smoothstep(0.99975, 0.99985, md) * 6.0;
  c += vec3(0.2, 0.27, 0.45) * pow(max(md, 0.0), 220.0) * 0.9;
  c += vec3(0.05, 0.07, 0.12) * pow(max(md, 0.0), 14.0) * 0.6;
  if (stars && h > 0.0) {
    vec3 p = d * 220.0;
    vec3 cell = floor(p);
    float r = hash3(cell);
    if (r > 0.9965) {
      vec3 centre = cell + 0.5 + (vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3)) - 0.5) * 0.6;
      float s = smoothstep(0.32, 0.0, length(p - centre));
      float tw = 0.75 + 0.25 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
      // Fewer near the bright horizon and the moon.
      float fade = smoothstep(0.03, 0.3, h) * (1.0 - pow(max(md, 0.0), 6.0));
      c += vec3(0.9, 0.94, 1.0) * s * tw * fade * (r - 0.9965) * 900.0;
    }
  }
  return c;
}
`

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`

const skyFrag = /* glsl */ `
${SKY}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(skyColor(normalize(vDir), true), 1.0);
}`

const seaVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const seaFrag = /* glsl */ `
${SKY}
uniform float uWaves;
varying vec3 vWorld;

// Swell from a few directions plus chop, as surface slopes; fading with
// distance so far water doesn't shimmer.
vec2 slope(vec2 p, float t, float detail) {
  vec2 s = vec2(0.0);
  float k = 0.035;
  float a = 1.0;
  vec2 dir = normalize(vec2(0.3, 1.0));
  for (int i = 0; i < 7; i++) {
    float w = sqrt(9.8 * k);
    float ph = dot(dir, p) * k + t * w * uWaves;
    float amp = a * k * 0.55 * (i < 3 ? 1.0 : detail);
    s += dir * amp * cos(ph);
    k *= 1.83;
    a *= 0.55;
    dir = vec2(dir.x * 0.6 - dir.y * 0.8, dir.x * 0.8 + dir.y * 0.6);
  }
  return s;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float detail = 1.0 - smoothstep(50.0, 400.0, dist);
  vec2 s = slope(vWorld.xz, uTime, detail) * mix(1.0, 0.35, smoothstep(150.0, 1000.0, dist));
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 body = vec3(0.002, 0.008, 0.016);
  vec3 c = mix(body, skyColor(R, false), fres);
  // The moon's path: sharp glints on the wave slopes facing it.
  float g = max(dot(R, uMoon), 0.0);
  c += vec3(0.75, 0.82, 1.0) * (pow(g, 1400.0) * 30.0 + pow(g, 160.0) * 0.5);
  // Into the haze at the horizon.
  vec3 haze = skyColor(normalize(vec3(-V.x, 0.004, -V.z)), false);
  c = mix(c, haze, smoothstep(260.0, 1300.0, dist));
  gl_FragColor = vec4(c, 1.0);
}`

function hillsGeometry(a0: number, a1: number, r: number, height: number, seed: number) {
  const n = 96
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    const t = i / n
    const env = Math.sin(t * Math.PI) ** 0.6
    const h = height * env * (0.6 + 0.25 * Math.sin(a * 23 + seed) + 0.15 * Math.sin(a * 61 + seed * 2))
    pos.push(Math.sin(a) * r, SEA_Y - 2, -Math.cos(a) * r, Math.sin(a) * r, SEA_Y + h, -Math.cos(a) * r)
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
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < count; i++) {
    const a = a0 + (a1 - a0) * rnd()
    const rr = r - 6 - rnd() * 22
    pos.push(Math.sin(a) * rr, SEA_Y + 0.4 + rnd() * 5 * Math.sin(((a - a0) / (a1 - a0)) * Math.PI), -Math.cos(a) * rr)
    const warm = rnd() > 0.25
    col.push(...(warm ? [1.0, 0.72, 0.42] : [0.75, 0.85, 1.0]).map((v) => v * (0.8 + rnd() * 1.6)))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

export function Outside() {
  const uniforms = useMemo(() => ({ uMoon: { value: MOON_DIR }, uSunset: { value: SUNSET_DIR }, uTime: { value: 0 }, uWaves: { value: 1 } }), [])
  const sky = useMemo(() => new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms, side: THREE.BackSide, depthWrite: false, fog: false }), [uniforms])
  const sea = useMemo(() => new THREE.ShaderMaterial({ vertexShader: seaVert, fragmentShader: seaFrag, uniforms, fog: false }), [uniforms])
  const land = useMemo(() => new THREE.MeshBasicMaterial({ color: '#020308', fog: false }), [])
  const dots = useMemo(() => new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, toneMapped: false, fog: false, transparent: true, depthWrite: false }), [])
  const coasts = useMemo(
    () => [
      { hills: hillsGeometry(-2.3, -0.55, 850, 38, 1), lights: coastLights(-2.2, -0.65, 850, 420, 7) },
      { hills: hillsGeometry(0.75, 1.9, 1050, 30, 4), lights: coastLights(0.85, 1.8, 1050, 260, 13) },
    ],
    [],
  )
  useFrame((st) => {
    const still = useHub.getState().prefs.reducedMotion
    uniforms.uTime.value = st.clock.elapsedTime
    uniforms.uWaves.value = still ? 0 : 1
  })
  return (
    <group>
      <mesh material={sky} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[1500, 48, 24]} />
      </mesh>
      <mesh material={sea} rotation-x={-Math.PI / 2} position-y={SEA_Y} renderOrder={-9}>
        <planeGeometry args={[4400, 4400, 1, 1]} />
      </mesh>
      {coasts.map((c, i) => (
        <group key={i}>
          <mesh geometry={c.hills} material={land} />
          <points geometry={c.lights} material={dots} />
        </group>
      ))}
    </group>
  )
}
