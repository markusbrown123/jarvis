import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { PerformanceMonitor, Sparkles } from '@react-three/drei'
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, N8AO, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { useHub, type Graphics } from '../hub/client'
import { useStore } from '../store'
import { ZoneLight } from './floor'
import { Clusters } from './clusters'
import { Foundry } from './foundry'
import { Drones } from './drones'
import { FloorWorks } from './floorworks'
import { Console } from './console'
import { Lair } from './lair'
import { Outside } from './outside'
import { HouseEnvironment } from './environment'
import { patchHouseLight, ROOM } from './houselight'
import { setSkyTime, SKY, SKY_STATE, updateSky, WEATHER } from './sky'
import { easeWeather, startWeather, tryWeather } from './weather'
import { Rain } from './rain'
import { WalkControls } from './walk'
import { Links } from './links'
import { CameraRig, Controls, TalkFraming } from './camera'
import { LabelProjector } from './labels'
import { useStation } from './stationStore'

/**
 * The station: a glass house on a sea cliff (lair.tsx), under the real sky
 * for this moment — sun, moon, stars and clouds — over a live sea with boats
 * on it (outside.tsx, sky.ts, boats.tsx). On its black marble stage: the
 * command console (console.tsx), the six systems on their pads, the
 * pathways between them, the build bay (foundry.tsx), the drones that fly
 * its deliveries from docks in the floor (drones.tsx) and the plates round
 * the console that move with his voice (floorworks.tsx). The house's own
 * light is baked in Blender with Cycles and coloured live; the sun or moon
 * shines in through the glass (houselight.ts); everything live is lit for
 * real (PBR, reflections of the room and sky, a shadow map, mirror
 * reflections in the stone) and finished with bloom, depth of field in
 * Talk, and ambient occlusion on Ultra.
 *
 * Everything that moves or glows is driven by live state through the
 * station model (model.ts); see docs/STATION.md for the full mapping.
 *
 * Quality is chosen in Settings (or on the station's top bar): Low is cheap,
 * High adds shadows and floor reflections, Ultra adds soft shadows, ambient
 * occlusion, 4096 shadow maps, full-resolution reflections, film grain and
 * lens fringing. A performance monitor steps the resolution down if frames
 * start dropping, and a guard steps quality down if a frame comes out blank.
 */

const QUALITY: Record<
  Graphics,
  { maxDpr: number; shadows: boolean; map: number; reflector: number; ao: boolean; soft: boolean; dust: number; msaa: number; lens: boolean; env: number; rain: number }
> = {
  low: { maxDpr: 1, shadows: false, map: 0, reflector: 0, ao: false, soft: false, dust: 0, msaa: 0, lens: false, env: 64, rain: 3000 },
  high: { maxDpr: 1.5, shadows: true, map: 2048, reflector: 512, ao: false, soft: false, dust: 60, msaa: 0, lens: false, env: 128, rain: 6000 },
  ultra: { maxDpr: 2, shadows: true, map: 4096, reflector: 1024, ao: true, soft: true, dust: 120, msaa: 4, lens: true, env: 256, rain: 10000 },
}

patchHouseLight()

/**
 * The key light: the sun by day, the moon by night, from where they really
 * are (sky.ts), shining in only where the house lets it (houselight.ts).
 * It's the one shadow-caster.
 */
const FLASH = new THREE.Color(0.8, 0.85, 1)

function KeyLight({ q }: { q: (typeof QUALITY)[Graphics] }) {
  const ref = useRef<THREE.DirectionalLight>(null)
  useFrame(() => {
    const l = ref.current
    if (!l) return
    const k = SKY_STATE.key
    l.position.copy(k.dir).multiplyScalar(40)
    l.color.copy(k.color)
    l.intensity = k.intensity
    // Lightning lights everything for an instant.
    if (SKY.uFlash.value > 0) {
      l.color.lerp(FLASH, Math.min(1, SKY.uFlash.value))
      l.intensity += SKY.uFlash.value * 2.5
    }
  })
  return (
    <directionalLight
      ref={ref}
      castShadow={q.shadows}
      shadow-mapSize={[q.map || 512, q.map || 512]}
      shadow-bias={-0.0002}
      shadow-normalBias={0.03}
      shadow-radius={q.soft ? 4 : 2}
      shadow-camera-left={-11}
      shadow-camera-right={11}
      shadow-camera-top={11}
      shadow-camera-bottom={-11}
      shadow-camera-near={5}
      shadow-camera-far={80}
    />
  )
}

/**
 * Keeps the sky on the clock: works out the sun and moon every few seconds,
 * and how the house's lights and the sky's light share the room — the warm
 * lights carry the house at night and soften by day.
 */
function applySky() {
  updateSky()
  // Indoors the eye adjusts too: daylight through the glass fills the room.
  ROOM.roomSky.value.copy(SKY_STATE.ambient).multiplyScalar(3.5)
  const day = Math.min(1, Math.max(0, (SKY_STATE.sunAlt + 4) / 14))
  ROOM.roomWarm.value.setRGB(1, 0.74, 0.5).multiplyScalar(0.85 - 0.35 * day)
}

function SkyDriver() {
  const last = useRef(-1e9)
  // The real weather where Markus is (and his real location for the sun).
  useEffect(() => startWeather(() => (last.current = -1e9)), [])
  useFrame((st, dt) => {
    easeWeather(dt, st.clock.elapsedTime)
    if (st.clock.elapsedTime - last.current < 5) return
    last.current = st.clock.elapsedTime
    applySky()
  })
  return null
}

if (import.meta.env.DEV) {
  // Look at another time of day: __sky.at('2026-10-23T18:05'), __sky.at(null) for now.
  ;(window as unknown as { __sky: object }).__sky = {
    at: (t: string | null) => {
      setSkyTime(t)
      applySky()
      return { sunAlt: SKY_STATE.sunAlt, moonAlt: SKY_STATE.moonAlt }
    },
    // Try weather: __sky.weather({ rain: 0.8, cloud: 1, storm: true }), and it eases in.
    weather: (w: Partial<typeof WEATHER>, now = false) => {
      tryWeather(w)
      if (now) {
        SKY.uCloud.value = WEATHER.cloud
        SKY.uRain.value = WEATHER.rain
        SKY.uSnow.value = WEATHER.snow
        SKY.uWet.value = WEATHER.rain > 0 ? 1 : 0
        SKY.uFog.value = Math.max(WEATHER.fog, WEATHER.rain * 0.5)
      }
      applySky()
      return { ...WEATHER }
    },
  }
}

const LOWER = { ultra: 'high', high: 'low', low: null } as const

/** Drop one quality level, once, and say why. */
function stepDown(from: Graphics, why: string) {
  const lower = LOWER[from]
  if (!lower || useHub.getState().prefs.graphics !== from) return
  useHub.getState().setPrefs({ graphics: lower })
  useHub.getState().say(`${why} — station switched to ${lower} quality`)
}

/**
 * Some graphics stacks fail silently at high settings: no error, just an
 * empty frame. A few frames in, look at what was actually drawn (after
 * post-processing, hence priority 2) and step down if it's blank.
 */
function BlankGuard({ graphics }: { graphics: Graphics }) {
  const n = useRef(0)
  useFrame((state) => {
    n.current++
    if (graphics === 'low' || (n.current !== 24 && n.current !== 90)) return
    const gl = state.gl.getContext()
    const W = gl.drawingBufferWidth
    const H = gl.drawingBufferHeight
    const px = new Uint8Array(4)
    let lit = 0
    for (const [x, y] of [[0.5, 0.42], [0.5, 0.3], [0.38, 0.35], [0.62, 0.35], [0.5, 0.15], [0.3, 0.12], [0.7, 0.12]]) {
      gl.readPixels(Math.floor(W * x), Math.floor(H * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      if (Math.max(px[0], px[1], px[2]) > 14) lit++
    }
    if (lit === 0) stepDown(graphics, 'This Mac drew a blank frame at that setting')
  }, 2)
  return null
}

/** Development only: lets the render test see that frames are being drawn. */
function FrameProbe() {
  useFrame(() => {
    const w = window as unknown as { __stationFrames?: number }
    w.__stationFrames = (w.__stationFrames ?? 0) + 1
  })
  return null
}

/**
 * If a model or its textures can't be loaded (a file missing after an
 * update), the rest of the station still draws, and JARVIS says why.
 */
class ConsoleGuard extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: Error) {
    useHub.getState().say(`The station's ${this.props.what} couldn't load (${err.message}) — run git pull in ~/jarvis`)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Finishing: ambient occlusion (Ultra), bloom on the lights, and in Talk
 * mode on High and Ultra a gentle depth of field — the desk, the room and
 * the view sharp, only the far horizon softening.
 */
function Post({ q, dof }: { q: (typeof QUALITY)[Graphics]; dof: boolean }) {
  return (
    <EffectComposer multisampling={q.msaa} enableNormalPass={false}>
      <>{q.ao && <N8AO aoRadius={1.2} distanceFalloff={1} intensity={2.4} quality="medium" halfRes />}</>
      <>{dof && <DepthOfField worldFocusDistance={6} worldFocusRange={14} bokehScale={1.2} resolutionScale={0.5} />}</>
      <Bloom intensity={q.ao ? 0.85 : 0.7} luminanceThreshold={1.3} luminanceSmoothing={0.3} mipmapBlur radius={0.62} />
      <>{q.lens && <ChromaticAberration offset={new THREE.Vector2(0.00045, 0.0006)} radialModulation modulationOffset={0.35} />}</>
      <Vignette eskil={false} offset={0.22} darkness={0.72} />
      <>{q.lens && <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.35} />}</>
      <ToneMapping mode={ToneMappingMode.AGX} />
      <>{q.msaa === 0 && <SMAA />}</>
    </EffectComposer>
  )
}

export function StationScene({ graphics }: { graphics: Graphics }) {
  const q = QUALITY[graphics]
  const mode = useStation((s) => s.mode)
  const [dpr, setDpr] = useState(Math.min(q.maxDpr, window.devicePixelRatio || 1))
  // Nothing to draw behind the power-up screen. (Rendering on demand there
  // instead breaks the first-frame environment and shadow setup.)
  const asleep = useStore((s) => s.phase === 'offline')
  if (asleep) return null
  return (
    // Keyed on quality: shadow-map type and multisampling are fixed when
    // the renderer is made.
    <Canvas
      key={graphics}
      className="station-canvas"
      shadows={q.shadows}
      dpr={dpr}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ position: [0, 9.6, 15.2], fov: 38, near: 0.12, far: 2400 }}
      onPointerMissed={() => useStation.getState().select(null, false)}
      onCreated={({ gl }) => {
        // If the graphics card drops the context (too much for it, or a
        // driver reset), step down a quality level instead of sitting black.
        gl.domElement.addEventListener(
          'webglcontextlost',
          (e) => {
            e.preventDefault()
            stepDown(graphics, 'The graphics card reset')
          },
          { once: true },
        )
      }}
    >
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setDpr((d) => Math.max(1, Math.round((d - 0.25) * 4) / 4))}
        onIncline={() => setDpr((d) => Math.min(q.maxDpr, Math.min(window.devicePixelRatio || 1, d + 0.25)))}
        onFallback={() => setDpr(1)}
      />
      <color attach="background" args={['#04060c']} />
      <SkyDriver />
      {/* What metal, stone and glass reflect: the room, and the sky through the glass. */}
      <HouseEnvironment size={q.env} />
      {import.meta.env.DEV && <FrameProbe />}
      <BlankGuard graphics={graphics} />
      <KeyLight q={q} />
      <Outside />
      {/* The room and the console stream in their models and textures; what's ready draws meanwhile. */}
      <ConsoleGuard what="room">
        <Suspense fallback={null}>
          <Lair graphics={graphics} reflector={q.reflector} />
        </Suspense>
      </ConsoleGuard>
      <ZoneLight />
      <ConsoleGuard what="centre console">
        <Suspense fallback={null}>
          <Console graphics={graphics} />
        </Suspense>
      </ConsoleGuard>
      <Links />
      <Clusters />
      <Foundry />
      <Drones />
      <FloorWorks />
      {/* Dust hanging in the light. */}
      {q.dust > 0 && <Sparkles count={q.dust} scale={[18, 4, 16]} position={[0, 2.3, -2]} size={1.2} speed={0.08} opacity={0.18} color="#cdd8ff" noise={1} />}
      <Rain count={q.rain} />
      {mode === 'walk' && <WalkControls />}
      <Controls />
      <CameraRig />
      <TalkFraming />
      <LabelProjector />
      <Post q={q} dof={mode === 'talk' && graphics !== 'low'} />
    </Canvas>
  )
}

