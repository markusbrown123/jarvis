import * as THREE from 'three'
import type { Phase } from '../store'

/**
 * The crystal core's shared pieces: palette, state colour, shaders and
 * geometry. Used by the dashboard core and the station's core.
 */

export const C = {
  violet: new THREE.Color('#a78bfa'),
  violetDeep: new THREE.Color('#7c3aed'),
  orange: new THREE.Color('#ff9a3c'),
  cyan: new THREE.Color('#5eead4'),
  amber: new THREE.Color('#f59e0b'),
  red: new THREE.Color('#ef4444'),
  white: new THREE.Color('#eef0ff'),
  dim: new THREE.Color('#4b4566'),
}

export function ringFor(phase: Phase, blocked: boolean, failed: boolean): THREE.Color {
  if (failed) return C.red
  if (phase === 'listening' || phase === 'waking') return C.orange
  if (phase === 'speaking') return C.cyan
  if (phase === 'thinking' || phase === 'tooling') return C.violet
  if (phase === 'offline') return C.dim
  return blocked ? C.amber : C.violet
}

export const pointVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uLevel;
  uniform float uSize;
  uniform float uMotion;
  varying float vGlow;
  void main() {
    vec3 p = position;
    float t = uTime * 0.6 * uMotion + aSeed * 6.2831;
    p *= 1.0 + 0.05 * sin(t) * uMotion + uLevel * 0.28 * aSeed;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.55 + aSeed) * (8.0 / -mv.z);
    vGlow = 0.55 + 0.45 * sin(t * 1.7);
  }
`
export const pointFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor * (0.55 + vGlow * 0.7), a * uAlpha);
  }
`

export const shellVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
export const shellFrag = /* glsl */ `
  uniform vec3 uRim;
  uniform vec3 uInner;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 2.4);
    gl_FragColor = vec4(mix(uInner, uRim, f), (f * 0.9 + 0.035) * uOpacity);
  }
`

/** A seeded random so the crystal has the same silhouette every time. */
export function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export function crystalGeometry() {
  const base = new THREE.IcosahedronGeometry(1, 1)
  const r = rng(7)
  const pos = base.attributes.position
  const seen = new Map<string, number>()
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
    let k = seen.get(key)
    if (k === undefined) {
      k = 0.82 + r() * 0.42
      seen.set(key, k)
    }
    pos.setXYZ(i, pos.getX(i) * k * 1.12, pos.getY(i) * k * 0.94, pos.getZ(i) * k)
  }
  const faceted = base.toNonIndexed()
  faceted.computeVertexNormals()
  const verts: number[] = []
  const unique = new Set<string>()
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
    if (unique.has(key)) continue
    unique.add(key)
    verts.push(pos.getX(i), pos.getY(i), pos.getZ(i))
  }
  return { faceted, edges: new THREE.EdgesGeometry(faceted, 1), vertices: new Float32Array(verts) }
}

export function nucleusGeometry(count: number) {
  const r = rng(11)
  const p = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1
    const th = r() * Math.PI * 2
    const rad = 0.6 * Math.pow(r(), 0.55)
    const s = Math.sqrt(1 - u * u)
    p.set([rad * s * Math.cos(th), rad * u, rad * s * Math.sin(th)], i * 3)
    seed[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  return g
}
