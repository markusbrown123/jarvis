import * as THREE from 'three'
import { HOUSE } from './layout'

/**
 * How light gets into the house, for every lit material in the station.
 *
 * Sun and moon: three.js's directional light shines through walls, so the
 * station's shaders are taught the house's shape. Before the sun (or the
 * moon) lights a point, the shader follows the ray back towards it: inside,
 * it must leave through the glass — not the concrete, not the ceiling, not
 * a mullion — and then pass outside the roof's overhang; outside, it must
 * miss the house and the roof. So sunlight falls in through the window as
 * long bright panes striped by the frames, late in the afternoon when the
 * sun is low enough to get under the roof, and the terrace has the roof's
 * shadow on it at noon. (Shadows of the console and the zones themselves
 * come from the shadow map, on High and Ultra.)
 *
 * The house's own light: the baked lightmaps (tools/blender/lair.py) keep
 * three kinds of light apart in their colour channels — red the house's
 * warm lights, green JARVIS's light, blue the sky's light through the
 * glass — and materials marked with roomify() mix them back together with
 * the colours in ROOM, which change live: the sky's by the time of day,
 * JARVIS's with his state.
 */

const PI_STEP = (Math.PI / HOUSE.bays).toFixed(6)

/** The roof's outline (lair.py's roof_edge): how far out it reaches at house angle a. */
export const ROOF_GLSL = /* glsl */ `
float houseRoofEdge(float a) {
  float w = pow(max(sin(a), 0.0), 1.3);
  return ${HOUSE.roofBack.toFixed(2)} + ${HOUSE.roofReach.toFixed(2)} * w + ${HOUSE.roofSwoop.toFixed(2)} * sin(2.0 * a + 0.6) * w;
}
`

const HOUSE_GLSL = /* glsl */ `
${ROOF_GLSL}
// 0..1: how much of a light from direction L (world, towards the light)
// reaches world point p, given the house in the way.
float houseLight(vec3 p, vec3 L) {
  if (L.y <= 0.0) return 0.0;
  const float R = ${HOUSE.r.toFixed(2)};
  const float H = ${HOUSE.ceiling.toFixed(2)};
  float lit = 1.0;
  vec2 q = p.xz;
  vec2 d = L.xz;
  float a2 = dot(d, d);
  float r0 = length(q);
  if (a2 > 1e-6) {
    float b = dot(q, d);
    float disc = b * b - a2 * (dot(q, q) - R * R);
    if (disc > 0.0) {
      float t = r0 < R ? (-b + sqrt(disc)) / a2 : (-b - sqrt(disc)) / a2;
      if (t > 0.0) {
        vec3 h = p + L * t;
        float a = atan(-h.z, h.x);
        if (r0 >= R) {
          if (h.y < H) lit = 0.0;
        } else if (h.y > H || a < 0.0) {
          lit = 0.0;
        } else {
          float f = a / ${PI_STEP};
          float dm = abs(f - floor(f + 0.5)) * ${PI_STEP} * R;
          lit *= smoothstep(0.03, 0.07, dm) * smoothstep(0.03, 0.08, h.y);
        }
      }
    }
  } else if (r0 < R) {
    lit = 0.0;
  }
  if (lit > 0.0 && p.y < H) {
    vec3 h2 = p + L * ((H - p.y) / L.y);
    if (length(h2.xz) < houseRoofEdge(atan(-h2.z, h2.x))) lit = 0.0;
  }
  return lit;
}
#ifdef ROOM_LIGHTMAP
uniform vec3 roomWarm;
uniform vec3 roomJarvis;
uniform vec3 roomSky;
#endif
`

let patched = false
/** Teach three.js's lit materials about the house. Call once, before anything compiles. */
export function patchHouseLight() {
  if (patched) return
  patched = true
  const C = THREE.ShaderChunk as unknown as Record<string, string>
  C.lights_pars_begin += HOUSE_GLSL
  const dir = 'getDirectionalLightInfo( directionalLight, directLight );'
  if (!C.lights_fragment_begin.includes(dir)) throw new Error('three.js lighting changed: houseLight patch needs updating')
  C.lights_fragment_begin = C.lights_fragment_begin.replace(
    dir,
    `${dir}
		directLight.color *= houseLight( transpose( mat3( viewMatrix ) ) * ( geometryPosition - viewMatrix[ 3 ].xyz ), transpose( mat3( viewMatrix ) ) * directLight.direction );`,
  )
  const lm = 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;'
  if (!C.lights_fragment_maps.includes(lm)) throw new Error('three.js lightmaps changed: room patch needs updating')
  C.lights_fragment_maps = C.lights_fragment_maps.replace(
    lm,
    `#ifdef ROOM_LIGHTMAP
		vec3 lightMapIrradiance = ( lightMapTexel.r * roomWarm + lightMapTexel.g * roomJarvis + lightMapTexel.b * roomSky ) * lightMapIntensity;
	#else
		${lm}
	#endif`,
  )
}

/** The colours the house's three kinds of baked light are shown in now. */
export const ROOM = {
  roomWarm: { value: new THREE.Color(1, 0.74, 0.5) },
  roomJarvis: { value: new THREE.Color('#7c8bff') },
  roomSky: { value: new THREE.Color(0.3, 0.4, 0.6) },
}

const done = new WeakSet<THREE.Material>()
/**
 * Have a material read its lightmap as the house's three kinds of light;
 * `own` swaps in its own colours for some of them.
 */
export function roomify<M extends THREE.Material>(m: M, own: Partial<typeof ROOM> = {}): M {
  if (done.has(m)) return m
  done.add(m)
  m.defines = { ...(m.defines ?? {}), ROOM_LIGHTMAP: '' }
  // Keyed on the material's own shader changes (the floor's mirror has some).
  const key = m.onBeforeCompile.toString() + '|room'
  const before = m.onBeforeCompile.bind(m)
  m.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer)
    Object.assign(shader.uniforms, ROOM, own)
  }
  m.customProgramCacheKey = () => key
  m.needsUpdate = true
  return m
}
