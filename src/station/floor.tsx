import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useHub } from '../hub/client'
import { DECK_TOP, ZONES } from './layout'
import { useStation, type StationEvent } from './stationStore'

/**
 * Live light on the stage's polished stone, round each zone: a soft pool in
 * the zone's colour that brightens while it's busy and stays lit while it
 * needs Markus, a red-orange flash when something fails there (and a slow
 * pulse while it's in error), and a ring of light rippling out when an event
 * lands. The stone itself is the room's (lair.tsx).
 */

const vert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const frag = /* glsl */ `
  uniform vec3 uZonePos[6];
  uniform vec3 uZoneCol[6];
  uniform float uZoneLevel[6];
  uniform float uZoneFlash[6];
  uniform float uZoneRipple[6];
  varying vec3 vW;
  void main() {
    vec3 col = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float d = length(vW.xz - uZonePos[i].xz);
      float pool = exp(-pow(d / 2.1, 2.0));
      col += uZoneCol[i] * pool * (0.04 + 0.55 * uZoneLevel[i]);
      col += vec3(1.0, 0.32, 0.08) * pool * uZoneFlash[i] * 1.3;
      if (uZoneRipple[i] >= 0.0) {
        float r = uZoneRipple[i] * 3.4;
        col += uZoneCol[i] * exp(-pow((d - r) / 0.18, 2.0)) * max(0.0, 1.0 - uZoneRipple[i] / 1.4) * 1.6;
      }
    }
    // Fade before the stage's edge.
    col *= 1.0 - smoothstep(7.4, 8.0, length(vW.xz));
    gl_FragColor = vec4(col, 1.0);
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

export function ZoneLight() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
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
    [],
  )
  const shown = useRef(ZONES.map(() => 0))
  useFrame((state, dt) => {
    const u = mat.uniforms
    const reduced = useHub.getState().prefs.reducedMotion
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
    <mesh rotation-x={-Math.PI / 2} position-y={DECK_TOP + 0.003} material={mat} renderOrder={1}>
      <circleGeometry args={[8.05, 128]} />
    </mesh>
  )
}

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

/** Defaults to the stage, where everything stands. */
export function Blob({ radius, position = [0, DECK_TOP, 0], opacity = 0.75 }: { radius: number; position?: [number, number, number]; opacity?: number }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity, toneMapped: false }), [opacity])
  return (
    <mesh rotation-x={-Math.PI / 2} position={[position[0], position[1] + 0.012, position[2]]} material={mat} renderOrder={1}>
      <planeGeometry args={[radius * 2, radius * 2]} />
    </mesh>
  )
}
