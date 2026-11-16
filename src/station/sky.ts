import * as THREE from 'three'

/**
 * The real sky over the house, from the clock: where the sun and the moon
 * are right now, how full the moon is and which way the stars have turned,
 * for wherever this Mac is (its time zone stands in for its location).
 *
 * The house's glass looks due west, out to sea, so the sun always sets in
 * the view. Scene axes: −Z is west (straight out of the window), +X north,
 * +Z east, +Y up.
 *
 * The sky's colour is worked out the way light actually scatters in air
 * (Rayleigh and Mie scattering through a thin shell of atmosphere, after
 * wwwtyro/glsl-atmosphere, Unlicense): blue overhead at noon, white-gold
 * then orange and red as the sun drops, the deep blue of twilight after.
 * outside.tsx draws it; the same numbers light the house (lair.tsx) and
 * set the sun's or moon's light on everything live.
 *
 * Everything that shows the sky reads the shared uniforms in SKY; the
 * station's SkyDriver (StationScene.tsx) calls updateSky every few seconds.
 */

const RAD = Math.PI / 180
const OBLIQUITY = 23.4397 * RAD

/** Time zones to where they are (latitude, longitude). */
const PLACES: Record<string, [number, number]> = {
  'America/Los_Angeles': [34.05, -118.24],
  'America/Vancouver': [49.28, -123.12],
  'America/Phoenix': [33.45, -112.07],
  'America/Denver': [39.74, -104.99],
  'America/Chicago': [41.88, -87.63],
  'America/New_York': [40.71, -74.01],
  'America/Toronto': [43.65, -79.38],
  'America/Mexico_City': [19.43, -99.13],
  'Pacific/Honolulu': [21.31, -157.86],
  'Europe/London': [51.51, -0.13],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Berlin': [52.52, 13.4],
  'Asia/Tokyo': [35.68, 139.69],
  'Australia/Sydney': [-33.87, 151.21],
}

/** Where Markus is, once weather.ts has found it (from his IP address). */
let place: { lat: number; lon: number } | null = null
export function setPlace(lat: number, lon: number) {
  place = { lat, lon }
}

export function whereAmI(): { lat: number; lon: number } {
  if (place) return place
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const known = PLACES[tz]
  if (known) return { lat: known[0], lon: known[1] }
  // Otherwise the zone's own meridian, at Los Angeles's latitude.
  const jan = new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset()
  return { lat: 34, lon: -jan / 4 }
}

// ---------------------------------------------------------------- astronomy

type Eq = { ra: number; dec: number }

const daysSinceJ2000 = (d: Date) => d.getTime() / 86400000 - 10957.5

function equatorial(lng: number, lat: number): Eq {
  return {
    ra: Math.atan2(Math.sin(lng) * Math.cos(OBLIQUITY) - Math.tan(lat) * Math.sin(OBLIQUITY), Math.cos(lng)),
    dec: Math.asin(Math.sin(lat) * Math.cos(OBLIQUITY) + Math.cos(lat) * Math.sin(OBLIQUITY) * Math.sin(lng)),
  }
}

function sunCoords(d: number): Eq {
  const M = RAD * (357.5291 + 0.98560028 * d)
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  return equatorial(M + C + RAD * 102.9372 + Math.PI, 0)
}

function moonCoords(d: number): Eq {
  const L = RAD * (218.316 + 13.176396 * d)
  const M = RAD * (134.963 + 13.064993 * d)
  const F = RAD * (93.272 + 13.22935 * d)
  return equatorial(L + RAD * 6.289 * Math.sin(M), RAD * 5.128 * Math.sin(F))
}

/** A point on the celestial sphere as a direction in the scene. */
function toScene(c: Eq, d: number, lat: number, lon: number, out = new THREE.Vector3()) {
  const phi = lat * RAD
  const H = RAD * (280.16 + 360.9856235 * d) + lon * RAD - c.ra
  const alt = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H))
  // Measured from south towards west; as a compass bearing, from north.
  const bearing = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)) + Math.PI
  return out.set(Math.cos(alt) * Math.cos(bearing), Math.sin(alt), Math.cos(alt) * Math.sin(bearing))
}

// ---------------------------------------------------------------- atmosphere

/** Shared with the GLSL below: planet and atmosphere radii, scattering. */
const RE = 6360e3
const RA = 6420e3
const HR = 7994
const HM = 1200
const BETA_R: [number, number, number] = [5.5e-6, 13.0e-6, 22.4e-6]
const BETA_M = 21e-6
const SUN_I = 22
/** The moon as a light: far dimmer than the sun, brighter than life so night reads. */
const MOON_I = SUN_I / 2500

export const ATMOSPHERE_GLSL = /* glsl */ `
#define PI 3.141592653589793
const float RE = ${RE.toFixed(1)};
const float RA = ${RA.toFixed(1)};
const float HR = ${HR.toFixed(1)};
const float HM = ${HM.toFixed(1)};
const vec3 BETA_R = vec3(${BETA_R.map((b) => b.toExponential(3)).join(', ')});
const float BETA_M = ${BETA_M.toExponential(3)};

vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b * b - 4.0 * c;
  if (d < 0.0) return vec2(-1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d) * 0.5;
}

// Light scattered towards the eye along r by a light from direction s.
vec3 atmosphere(vec3 r, vec3 s, float intensity) {
  vec3 r0 = vec3(0.0, RE + 60.0, 0.0);
  vec2 p = rsi(r0, r, RA);
  float tEnd = p.y;
  vec2 g = rsi(r0, r, RE);
  if (g.x > 0.0) tEnd = min(tEnd, g.x);
  float iStep = tEnd / 14.0;
  float iTime = 0.0;
  vec3 totR = vec3(0.0);
  vec3 totM = vec3(0.0);
  float iOdR = 0.0;
  float iOdM = 0.0;
  float mu = dot(r, s);
  float gm = 0.76;
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float pM = 3.0 / (8.0 * PI) * ((1.0 - gm * gm) * (mu * mu + 1.0)) / (pow(1.0 + gm * gm - 2.0 * mu * gm, 1.5) * (2.0 + gm * gm));
  for (int i = 0; i < 14; i++) {
    vec3 iPos = r0 + r * (iTime + iStep * 0.5);
    float iH = length(iPos) - RE;
    float odR = exp(-iH / HR) * iStep;
    float odM = exp(-iH / HM) * iStep;
    iOdR += odR;
    iOdM += odM;
    // In the planet's shadow? (Twilight: the sky still lit high up.)
    if (rsi(iPos, s, RE).x < 0.0) {
      float jStep = rsi(iPos, s, RA).y / 6.0;
      float jOdR = 0.0;
      float jOdM = 0.0;
      for (int j = 0; j < 6; j++) {
        vec3 jPos = iPos + s * (jStep * (float(j) + 0.5));
        float jH = max(length(jPos) - RE, 0.0);
        jOdR += exp(-jH / HR) * jStep;
        jOdM += exp(-jH / HM) * jStep;
      }
      vec3 attn = exp(-(BETA_R * (iOdR + jOdR) + BETA_M * 1.1 * (iOdM + jOdM)));
      totR += odR * attn;
      totM += odM * attn;
    }
    iTime += iStep;
  }
  return intensity * (pR * BETA_R * totR + pM * BETA_M * totM);
}
`

function rsi(r0: THREE.Vector3, rd: THREE.Vector3, sr: number): [number, number] {
  const b = 2 * rd.dot(r0)
  const c = r0.dot(r0) - sr * sr
  const d = b * b - 4 * c
  if (d < 0) return [-1e9, -1e9]
  const q = Math.sqrt(d)
  return [(-b - q) / 2, (-b + q) / 2]
}

/** What's left of sunlight after crossing the air to a point at height h. */
function transmittance(s: THREE.Vector3, h: number, out: THREE.Color) {
  const p = new THREE.Vector3(0, RE + h, 0)
  if (rsi(p, s, RE)[0] > 0) return out.setRGB(0, 0, 0)
  const len = rsi(p, s, RA)[1]
  const steps = 24
  const step = len / steps
  let odR = 0
  let odM = 0
  const q = new THREE.Vector3()
  for (let i = 0; i < steps; i++) {
    q.copy(s).multiplyScalar(step * (i + 0.5)).add(p)
    const hh = Math.max(q.length() - RE, 0)
    odR += Math.exp(-hh / HR) * step
    odM += Math.exp(-hh / HM) * step
  }
  return out.setRGB(...(BETA_R.map((b) => Math.exp(-(b * odR + BETA_M * 1.1 * odM))) as [number, number, number]))
}

/** The sky's radiance in one direction (the CPU twin of the GLSL). */
function skyRadiance(r: THREE.Vector3, s: THREE.Vector3, intensity: number, out: THREE.Color) {
  const r0 = new THREE.Vector3(0, RE + 60, 0)
  let tEnd = rsi(r0, r, RA)[1]
  const g = rsi(r0, r, RE)
  if (g[0] > 0) tEnd = Math.min(tEnd, g[0])
  const N = 14
  const iStep = tEnd / N
  const tot = [0, 0, 0]
  let iOdR = 0
  let iOdM = 0
  const mu = r.dot(s)
  const gm = 0.76
  const pR = (3 / (16 * Math.PI)) * (1 + mu * mu)
  const pM = ((3 / (8 * Math.PI)) * ((1 - gm * gm) * (mu * mu + 1))) / (Math.pow(1 + gm * gm - 2 * mu * gm, 1.5) * (2 + gm * gm))
  const iPos = new THREE.Vector3()
  const jPos = new THREE.Vector3()
  for (let i = 0; i < N; i++) {
    iPos.copy(r).multiplyScalar(iStep * (i + 0.5)).add(r0)
    const iH = iPos.length() - RE
    const odR = Math.exp(-iH / HR) * iStep
    const odM = Math.exp(-iH / HM) * iStep
    iOdR += odR
    iOdM += odM
    if (rsi(iPos, s, RE)[0] >= 0) continue
    const jStep = rsi(iPos, s, RA)[1] / 6
    let jOdR = 0
    let jOdM = 0
    for (let j = 0; j < 6; j++) {
      jPos.copy(s).multiplyScalar(jStep * (j + 0.5)).add(iPos)
      const jH = Math.max(jPos.length() - RE, 0)
      jOdR += Math.exp(-jH / HR) * jStep
      jOdM += Math.exp(-jH / HM) * jStep
    }
    for (let c = 0; c < 3; c++) {
      const attn = Math.exp(-(BETA_R[c] * (iOdR + jOdR) + BETA_M * 1.1 * (iOdM + jOdM)))
      tot[c] += (pR * BETA_R[c] * odR + pM * BETA_M * odM) * attn
    }
  }
  return out.setRGB(tot[0] * intensity, tot[1] * intensity, tot[2] * intensity)
}

// ---------------------------------------------------------------- shared state

/** The sky as every shader and light sees it. */
export const SKY = {
  uSun: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
  uMoon: { value: new THREE.Vector3(0.3, 0.3, -1).normalize() },
  /** Sunlight reaching the house and the clouds, exposure applied. */
  uSunColor: { value: new THREE.Color() },
  uCloudSun: { value: new THREE.Color() },
  uMoonColor: { value: new THREE.Color() },
  /** Scales everything in the sky: the eye adjusting from noon to night. */
  uExposure: { value: 1 },
  uSunI: { value: SUN_I },
  uMoonI: { value: MOON_I },
  /** 0 by day, 1 by full night. */
  uNight: { value: 0 },
  uStars: { value: new THREE.Matrix3() },
  uTime: { value: 0 },
  uLut: { value: null as THREE.Texture | null },
  // The weather, eased (weather.ts): cloud cover, rain and snow (0..1), how
  // wet things are, haze, a lightning flash, and the wind (m/s, x and z).
  uCloud: { value: 0.3 },
  uRain: { value: 0 },
  uSnow: { value: 0 },
  uWet: { value: 0 },
  uFog: { value: 0 },
  uFlash: { value: 0 },
  uWind: { value: new THREE.Vector2(3, 0) },
}

/**
 * The weather where Markus is right now (weather.ts fills it in; until it
 * can, fair weather with a few clouds).
 */
export const WEATHER = {
  live: false,
  place: '',
  /** 0..1 */
  cloud: 0.3,
  /** 0..1, light drizzle to downpour */
  rain: 0,
  snow: 0,
  fog: 0,
  storm: false,
  /** m/s, and the compass direction it blows from */
  wind: 4,
  windFrom: 270,
  summary: 'fair',
}

/** Values for the lights and the house, beside the uniforms. */
export const SKY_STATE = {
  sunAlt: 20,
  moonAlt: -10,
  moonLit: 0.5,
  /** The sky's average light through the window (for the house's lightmaps). */
  ambient: new THREE.Color(0.4, 0.5, 0.7),
  /** The key light: the sun by day, the moon by night. */
  key: { dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(), intensity: 0 },
  version: 0,
  at: new Date(),
}

/** Development: look at another time of day (null for now). */
let override: Date | null = null
export function setSkyTime(at: Date | string | null) {
  override = at ? new Date(at) : null
}
export function skyNow() {
  return override ?? new Date()
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const _c = new THREE.Color()
const _v = new THREE.Vector3()

export function updateSky(at: Date = skyNow()) {
  const { lat, lon } = whereAmI()
  const d = daysSinceJ2000(at)
  const sun = toScene(sunCoords(d), d, lat, lon, SKY.uSun.value)
  const moon = toScene(moonCoords(d), d, lat, lon, SKY.uMoon.value)
  const sunAlt = Math.asin(sun.y) / RAD
  const moonAlt = Math.asin(moon.y) / RAD
  const moonLit = (1 - sun.dot(moon)) / 2

  // The eye adjusts: full daylight as it is, twilight and night brightened.
  const night = 1 - smooth(-14, -2, sunAlt)
  // 0.6: the view stays readable through the glass rather than blown out.
  const exposure = 0.6 * Math.exp(4.6 * (1 - smooth(-15, 3, sunAlt)))
  SKY.uExposure.value = exposure
  SKY.uNight.value = night

  // The stars: celestial axes as scene directions, inverted for the shader.
  const ax = (ra: number, dec: number) => toScene({ ra, dec }, d, lat, lon, new THREE.Vector3())
  const m = new THREE.Matrix3().set(...flatColumns(ax(0, 0), ax(Math.PI / 2, 0), ax(0, Math.PI / 2)))
  SKY.uStars.value.copy(m).transpose()

  // Sunlight on the house (60 m up) and on the clouds (3 km up).
  transmittance(sun, 60, _c)
  const sunUp = smooth(-1.2, 1.5, sunAlt)
  SKY.uSunColor.value.copy(_c).multiplyScalar(SUN_I * 0.09 * sunUp * exposure)
  transmittance(sun, 3000, _c)
  SKY.uCloudSun.value.copy(_c).multiplyScalar(smooth(-5, 0, sunAlt))
  SKY.uMoonColor.value.setRGB(0.85, 0.9, 1).multiplyScalar(moonLit * smooth(-2, 4, moonAlt))

  // The sky's light coming in through the glass: an average looking out.
  const amb = SKY_STATE.ambient.setRGB(0, 0, 0)
  const looks: [number, number][] = [[-50, 6], [0, 6], [50, 6], [-30, 30], [30, 30], [0, 65]]
  for (const [az, el] of looks) {
    const a = az * RAD
    const e = el * RAD
    _v.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e))
    amb.add(skyRadiance(_v, sun, SUN_I, _c))
    amb.add(skyRadiance(_v, moon, MOON_I * moonLit, _c))
  }
  amb.multiplyScalar(exposure / looks.length)
  // Under thick cloud the light coming in is greyer and dimmer.
  const overcast = smooth(0.5, 1, WEATHER.cloud) * 0.85 + WEATHER.rain * 0.15
  const grey = amb.r * 0.3 + amb.g * 0.5 + amb.b * 0.2
  amb.lerp(new THREE.Color(grey, grey, grey * 1.05), overcast * 0.8).multiplyScalar(1 - 0.45 * overcast)
  SKY.uSunColor.value.multiplyScalar(1 - 0.92 * overcast)
  amb.r += 0.002
  amb.g += 0.003
  amb.b += 0.006

  // The key light: whichever of the sun or moon is up and brighter.
  const key = SKY_STATE.key
  if (sunAlt > 0) {
    key.dir.copy(sun)
    transmittance(sun, 60, key.color)
    const lum = key.color.r * 0.2126 + key.color.g * 0.7152 + key.color.b * 0.0722
    key.color.multiplyScalar(1 / Math.max(lum, 1e-3))
    key.intensity = 2.8 * sunUp * Math.min(1, lum * 1.6 + 0.15)
  } else {
    key.dir.copy(moon)
    key.color.setRGB(0.62, 0.72, 1)
    key.intensity = 0.55 * moonLit * smooth(-1, 6, moonAlt)
  }
  if (key.dir.y < 0.02) key.dir.y = 0.02
  key.intensity *= 1 - 0.85 * overcast

  Object.assign(SKY_STATE, { sunAlt, moonAlt, moonLit, at })
  SKY_STATE.version++
}

function flatColumns(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): [number, number, number, number, number, number, number, number, number] {
  // Matrix3.set takes rows; these are its columns.
  return [a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z]
}

// ---------------------------------------------------------------- the sky's shaders

/** What every shader that shows the sky shares: the table, clouds, noise. */
export const SKY_COMMON = /* glsl */ `
#define PI 3.141592653589793
uniform sampler2D uLut;
uniform vec3 uSun;
uniform vec3 uMoon;
uniform vec3 uSunColor;
uniform vec3 uCloudSun;
uniform vec3 uMoonColor;
uniform float uExposure;
uniform float uNight;
uniform float uTime;
uniform mat3 uStars;
uniform float uCloud;
uniform float uRain;
uniform float uSnow;
uniform float uWet;
uniform float uFog;
uniform float uFlash;
uniform vec2 uWind;

vec3 skyLut(vec3 d) {
  vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, sqrt(clamp(d.y, 0.0, 1.0)));
  return texture2D(uLut, uv).rgb;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    v += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.1;
    a *= 0.5;
  }
  return v;
}

// A layer of cloud 3 km up, drifting with the wind: broken cumulus and
// streaks on a fair day, a closed grey deck when it's overcast, dark and
// heavy in rain, lit from inside by lightning in a storm.
vec2 cloudDrift() {
  return uWind * uTime * 0.00035 + vec2(uTime * 0.002, uTime * 0.0008);
}
float cloudCover(vec2 p) {
  return mix(0.7, 0.22, uCloud) + 0.08 * sin(p.x * 0.27 + 1.3) + 0.05 * sin(p.y * 0.41);
}
// How much cloud stands between a world point and the sun (its shadow).
float cloudShadow(vec3 w) {
  if (uSun.y < 0.04) return 0.0;
  vec2 p = (w.xz + uSun.xz / uSun.y * (3000.0 - w.y)) * 0.00032 + cloudDrift();
  float cov = cloudCover(p);
  return smoothstep(cov, cov + 0.24, fbm(p, 3));
}
vec4 clouds(vec3 d, int oct) {
  if (d.y < 0.012) return vec4(0.0);
  vec2 p = d.xz * (3000.0 / d.y) * 0.00032 + cloudDrift();
  float c = fbm(p, oct);
  float cover = cloudCover(p);
  float dens = smoothstep(cover, cover + 0.24, c);
  if (dens <= 0.001) return vec4(0.0);
  float toward = fbm(p + normalize(uSun.xz + 1e-4) * 0.22, oct < 3 ? oct : 3);
  float lit = exp(-max(toward - cover, 0.0) * 7.0);
  float mu = max(dot(d, uSun), 0.0);
  vec3 sun = uCloudSun * uExposure * (0.55 + 1.6 * pow(mu, 7.0)) * lit;
  vec3 amb = skyLut(vec3(0.0, 1.0, 0.0)) * 1.2 + skyLut(normalize(vec3(d.x, 0.04, d.z))) * 0.45;
  float heavy = smoothstep(0.55, 1.0, uCloud);
  vec3 col = amb * (1.0 - 0.45 * dens) + sun * 0.85 * (1.0 - 0.75 * heavy) + uMoonColor * 0.012 * lit * uNight;
  col *= mix(1.0, 0.42, heavy * (0.35 + 0.65 * max(uRain, uSnow)));
  col += vec3(0.75, 0.8, 1.0) * uFlash * 1.6 * (0.4 + 0.6 * c);
  float fade = smoothstep(0.012, 0.16, d.y);
  return vec4(col, dens * fade * 0.96);
}
`

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`

const skyFrag = /* glsl */ `
${SKY_COMMON}
varying vec3 vDir;

vec3 skyColor(vec3 d) {
  vec3 c = skyLut(d);
  if (d.y < 0.0) c = skyLut(normalize(vec3(d.x, 0.0, d.z))) * max(0.0, 1.0 + d.y * 6.0);
  // Stars and the Milky Way, turned with the sky.
  if (uNight > 0.01 && d.y > 0.0) {
    vec3 e = uStars * d;
    vec3 p = e * 260.0;
    vec3 cell = floor(p);
    float r = hash3(cell);
    float vis = uNight * smoothstep(0.0, 0.25, d.y);
    if (r > 0.9963) {
      vec3 centre = cell + 0.5 + (vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3)) - 0.5) * 0.6;
      float s = smoothstep(0.34, 0.0, length(p - centre));
      float tw = 0.7 + 0.3 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
      vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), hash3(cell + 9.1));
      c += tint * s * tw * vis * (r - 0.9963) * 700.0;
    }
    vec3 gp = vec3(-0.8676, -0.1981, 0.4560);
    float band = exp(-pow(dot(e, gp) / 0.16, 2.0));
    c += vec3(0.6, 0.65, 0.8) * band * (0.4 + 0.6 * fbm(e.xy * 9.0 + e.z * 4.0, 4)) * 0.011 * vis;
  }
  // The moon: a lit sphere — its phase is where the sun really is.
  float md = dot(d, uMoon);
  float mr = 0.0115;
  vec3 o = (d - uMoon * md) / sin(mr);
  float rr = dot(o, o);
  if (md > 0.0 && rr < 1.0) {
    vec3 N = o - uMoon * sqrt(1.0 - rr);
    float lit = max(dot(N, uSun), 0.0);
    float maria = 0.62 + 0.38 * smoothstep(0.35, 0.7, fbm(N.xy * 2.6 + N.z * 1.7 + 3.0, 4));
    vec3 moon = vec3(0.93, 0.94, 1.0) * (lit * 2.2 + 0.015) * maria * (0.35 + 0.65 * uNight);
    c = mix(c, c * (1.0 - 0.9 * uNight) + moon, smoothstep(1.0, 0.9, rr));
  }
  c += uMoonColor * (pow(max(md, 0.0), 2500.0) * 0.4 + pow(max(md, 0.0), 60.0) * 0.02) * uNight;
  // The sun's disc and its glare.
  float sd = dot(d, uSun);
  c += uSunColor * (smoothstep(0.99996, 0.999975, sd) * 22.0 + pow(max(sd, 0.0), 900.0) * 0.6 + pow(max(sd, 0.0), 60.0) * 0.05);
  return c;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d);
  vec4 cl = clouds(d, 5);
  c = mix(c, cl.rgb, cl.a);
  // Grey and close under heavy cloud, rain or fog; lit up by lightning.
  float murk = max(smoothstep(0.55, 1.0, uCloud) * 0.6, uFog * 0.8);
  c = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))) * vec3(0.95, 0.98, 1.05), murk * (1.0 - smoothstep(0.0, 0.5, d.y) * 0.4));
  c += vec3(0.7, 0.75, 0.95) * uFlash * 0.25;
  gl_FragColor = vec4(c, 1.0);
}`

/** The sky as a material: the backdrop (outside.tsx), and for reflections (environment.tsx). */
export function skyMaterial(backdrop: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: backdrop ? skyVert : skyVert.replace('gl_Position = p.xyww; // always at the far plane', 'gl_Position = p;'),
    fragmentShader: skyFrag,
    uniforms: SKY,
    side: THREE.BackSide,
    depthWrite: false,
  })
}

