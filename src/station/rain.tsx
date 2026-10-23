import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { HOUSE } from './layout'
import { ROOF_GLSL, ROOM } from './houselight'
import { SKY, SKY_STATE } from './sky'

/**
 * Rain (or snow) when it's falling where Markus is (weather.ts): streaks
 * in a box of air round the camera, slanting with the wind, as many as the
 * weather calls for — and none under the roof, so from the desk it falls
 * past the glass and onto the terrace while the house stays dry. Snow is
 * the same, slow, short and drifting.
 */

const vert = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;
uniform float uTime;
uniform float uRain;
uniform float uSnow;
uniform vec2 uWind;
uniform vec3 uCam;
varying float vShow;
${ROOF_GLSL}
void main() {
  const vec3 BOX = vec3(56.0, 26.0, 56.0);
  float snow = step(uRain, uSnow);
  float speed = mix(9.5, 1.1, snow);
  float t = uTime + aSeed.y * 40.0;
  vec3 drift = vec3(uWind.x, 0.0, uWind.y) * mix(0.25, 0.6, snow);
  vec3 p = aSeed * BOX + drift * t;
  p.y -= t * speed;
  if (snow > 0.5) p.xz += vec2(sin(t * 0.7 + aSeed.x * 20.0), cos(t * 0.6 + aSeed.z * 20.0)) * 0.4;
  p = mod(p - uCam + BOX * 0.5, BOX) + uCam - BOX * 0.5;
  vec3 dir = normalize(drift + vec3(0.0, -speed, 0.0));
  p -= dir * mix(0.55, 0.04, snow) * (0.6 + aSeed.x * 0.8) * aEnd;
  // Only as much as is falling, and none under the roof.
  float amount = max(uRain, uSnow);
  float under = p.y < ${(HOUSE.ceiling + 0.6).toFixed(2)} && length(p.xz) < houseRoofEdge(atan(-p.z, p.x)) ? 1.0 : 0.0;
  vShow = step(fract(aSeed.x * 7.13 + aSeed.z * 3.7), amount) * (1.0 - under) * step(${HOUSE.sea.toFixed(1)}, p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`

const frag = /* glsl */ `
uniform vec3 uColor;
varying float vShow;
void main() {
  if (vShow < 0.5) discard;
  gl_FragColor = vec4(uColor, 1.0);
}`

export function Rain({ count }: { count: number }) {
  const camera = useThree((s) => s.camera)
  const geo = useMemo(() => {
    const seed = new Float32Array(count * 6)
    const end = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const s = [Math.random(), Math.random(), Math.random()]
      seed.set(s, i * 6)
      seed.set(s, i * 6 + 3)
      end[i * 2 + 1] = 1
    }
    const g = new THREE.BufferGeometry()
    // Positions come from the shader; this only sizes the draw.
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 6), 3))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3))
    g.setAttribute('aEnd', new THREE.Float32BufferAttribute(end, 1))
    return g
  }, [count])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: { uTime: SKY.uTime, uRain: SKY.uRain, uSnow: SKY.uSnow, uWind: SKY.uWind, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color() } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const ref = useRef<THREE.LineSegments>(null)
  const ahead = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const amount = Math.max(SKY.uRain.value, SKY.uSnow.value)
    if (ref.current) ref.current.visible = amount > 0.01
    if (amount <= 0.01) return
    // The box of rain sits out in front of the camera, where it can be seen.
    camera.getWorldDirection(ahead)
    ahead.y = 0
    mat.uniforms.uCam.value.copy(camera.position).addScaledVector(ahead.normalize(), 24)
    // Lit by the sky, and by the house's lights after dark; snow brighter than rain.
    const k = SKY.uSnow.value > SKY.uRain.value ? 1.2 : 0.8
    mat.uniforms.uColor.value
      .copy(SKY_STATE.ambient)
      .multiplyScalar(k)
      .add(new THREE.Color().copy(ROOM.roomWarm.value).multiplyScalar(0.05 * k))
      .addScalar(SKY.uFlash.value * 0.4)
  })
  return <lineSegments ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />
}
