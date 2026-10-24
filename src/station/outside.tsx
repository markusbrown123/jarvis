import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { Boats } from './boats'
import { MAX_BOATS, WAKES } from './wakes'
import { HOUSE } from './layout'
import { ATMOSPHERE_GLSL, SKY, SKY_COMMON, SKY_STATE, skyMaterial } from './sky'
import { Coast } from './coast'
import { SHORE_GLSL } from './coastland'
import type { Graphics } from '../hub/client'

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
 * lights after dark (boats.tsx). The land round the bay is coast.tsx.
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
${SHORE_GLSL}
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
  // Surf round the foot of the cliffs, and up the beaches along the bay.
  float shore = min(length(vWorld.xz) - cliffFoot(vWorld.xz), -coastShore(vWorld.xz) - 1.0);
  // Ragged, not drawn round with a compass: the line wanders, the sets come
  // in broken, and the foam fades in under the rocks rather than starting at
  // an edge.
  float rag = shore + (vnoise(vWorld.xz * 0.045) - 0.5) * 9.0 + (vnoise(vWorld.xz * 0.2) - 0.5) * 3.0;
  float surge = 0.55 + 0.45 * sin(rag * 1.1 - uTime * 1.4 + vnoise(vWorld.xz * 0.15) * 5.0);
  foam += exp(-max(rag + 3.0, 0.0) / 3.0) * surge * (0.35 + 0.8 * vnoise(vWorld.xz * 0.6 + uTime * 0.25)) * smoothstep(-10.0, -4.0, rag);

  // Whitecaps where the wind breaks the steepest crests.
  float steep = length(s);
  foam += smoothstep(0.2, 0.38, steep) * smoothstep(4.0, 11.0, wind) * (0.4 + 0.6 * vnoise(vWorld.xz * 0.3 + uTime * 0.4)) * detail;

  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 R = reflect(-V, N);
  // A facet tipped away from the camera reflects the next waves, not the
  // sky: it goes dark below (folding it back up drew a rim of the hazy
  // horizon round every wave, sand-coloured speckle all over the sea).
  float upward = R.y;
  R.y = max(R.y, 0.0) + 0.002;
  // Clouds' shadows drift across the water.
  float shade = 1.0 - 0.75 * cloudShadow(vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec4 cr = clouds(R, 3);
  // (Clouds low over the horizon smear out in the reflection rather than
  // breaking into speckles.)
  vec3 refl = mix(skyLut(R), cr.rgb, cr.a * 0.65 * smoothstep(0.02, 0.16, R.y));
  // The water itself: dark blue-green, lit by the sky; greener in the
  // shallows by the rocks, and through the backs of waves facing the sun.
  vec3 skyUp = skyLut(vec3(0.0, 1.0, 0.0));
  vec3 body = vec3(0.008, 0.04, 0.07) * (skyUp * 1.6 + uSunColor * 0.12 * shade);
  body += vec3(0.02, 0.09, 0.08) * exp(-max(shore, 0.0) / 14.0) * (skyUp + uSunColor * 0.2 * shade);
  // Sunlight through the backs of the waves: turquoise in the crests.
  body += vec3(0.0, 0.09, 0.075) * uSunColor * 0.22 * shade * smoothstep(0.05, 0.3, steep) * max(dot(normalize(vec3(-V.x, 0.0, -V.z)), -uSun), 0.2) * detail;
  refl = mix(body * 1.4, refl, smoothstep(-0.04, 0.07, upward));
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

export function Outside({ graphics }: { graphics: Graphics }) {
  const sky = useMemo(() => skyMaterial(true), [])
  const uniforms = useMemo(() => ({ ...SKY, ...WAKES, uWaves: { value: 1 } }), [])
  const sea = useMemo(() => new THREE.ShaderMaterial({ vertexShader: seaVert, fragmentShader: seaFrag, uniforms }), [uniforms])
  useFrame((st) => {
    const still = useHub.getState().prefs.reducedMotion
    SKY.uTime.value = st.clock.elapsedTime
    uniforms.uWaves.value = still ? 0 : 1
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
      <Coast graphics={graphics} />
      <Boats />
    </group>
  )
}
