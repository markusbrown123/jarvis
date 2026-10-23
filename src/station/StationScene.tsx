import { Component, Suspense, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, PerformanceMonitor, Sparkles } from '@react-three/drei'
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, N8AO, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { useHub, type Graphics } from '../hub/client'
import { useStore } from '../store'
import { ZoneLight } from './floor'
import { Clusters } from './clusters'
import { Console } from './console'
import { Lair } from './lair'
import { Outside } from './outside'
import { MOON_DIR } from './layout'
import { WalkControls } from './walk'
import { Links } from './links'
import { CameraRig, Controls, TalkFraming } from './camera'
import { LabelProjector } from './labels'
import { useStation } from './stationStore'

/**
 * The station: a lair cut into a sea cliff (lair.tsx) — rock walls and vault,
 * a polished stone floor and stage, and a wall of glass over the sea at blue
 * hour (outside.tsx). On the stage: the command console (console.tsx), the
 * six systems on their pads and the pathways between them. The
 * room's light is baked in Blender with Cycles; what's live — JARVIS, the
 * zones, the console — is lit for real (PBR, image-based
 * reflections, a moonlight shadow map, mirror reflections in the stone) and
 * finished with bloom, depth of field in Talk, and ambient occlusion on Ultra.
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
  { maxDpr: number; shadows: boolean; map: number; reflector: number; ao: boolean; soft: boolean; dust: number; msaa: number; lens: boolean; env: number }
> = {
  low: { maxDpr: 1, shadows: false, map: 0, reflector: 0, ao: false, soft: false, dust: 0, msaa: 0, lens: false, env: 64 },
  high: { maxDpr: 1.5, shadows: true, map: 2048, reflector: 512, ao: false, soft: false, dust: 60, msaa: 0, lens: false, env: 128 },
  ultra: { maxDpr: 2, shadows: true, map: 4096, reflector: 1024, ao: true, soft: true, dust: 120, msaa: 4, lens: true, env: 256 },
}

/**
 * Live light for the live things, matched to the baked room: moonlight in
 * through the window (the one shadow-caster), a cool sky fill, and the warm
 * glow of the vault's coves from above.
 */
function Lights({ q }: { q: (typeof QUALITY)[Graphics] }) {
  const moon = MOON_DIR.clone().multiplyScalar(30)
  return (
    <>
      <hemisphereLight args={['#2c3a66', '#07070b', 0.35]} />
      <directionalLight
        position={[moon.x, moon.y, moon.z]}
        intensity={0.3}
        color="#b9c9ff"
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
        shadow-camera-far={60}
      />
      <pointLight position={[0, 8.2, 0]} intensity={60} distance={22} decay={2} color="#ffb877" />
      <pointLight position={[0, 1.4, 7]} intensity={8} distance={12} decay={2} color="#ff9a5a" />
    </>
  )
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
 * mode on High and Ultra a shallow depth of field — the desk and its
 * monitors sharp, the room beyond them softening away.
 */
function Post({ q, dof }: { q: (typeof QUALITY)[Graphics]; dof: boolean }) {
  return (
    <EffectComposer multisampling={q.msaa} enableNormalPass={false}>
      <>{q.ao && <N8AO aoRadius={1.2} distanceFalloff={1} intensity={2.4} quality="medium" halfRes />}</>
      <>{dof && <DepthOfField worldFocusDistance={5.6} worldFocusRange={4.5} bokehScale={2.5} resolutionScale={0.5} />}</>
      <Bloom intensity={q.ao ? 1.15 : 0.95} luminanceThreshold={0.62} luminanceSmoothing={0.25} mipmapBlur radius={0.78} />
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
      {/* What metal and glass reflect: the moonlit window wall, the warm vault coves, dark rock. */}
      <Environment resolution={q.env} frames={1}>
        <color attach="background" args={['#05060a']} />
        <Lightformer form="rect" intensity={0.7} color="#5f78c8" position={[0, 4, -14]} scale={[26, 7, 1]} />
        <Lightformer form="circle" intensity={2} color="#dfe8ff" position={[MOON_DIR.x * 40, MOON_DIR.y * 40, MOON_DIR.z * 40]} scale={1.5} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={3} color="#ffb877" position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={6} />
        <Lightformer form="rect" intensity={0.8} color="#ff9a5a" position={[0, 0.5, 13]} scale={[18, 1, 1]} target={[0, 1, 0]} />
      </Environment>
      {import.meta.env.DEV && <FrameProbe />}
      <BlankGuard graphics={graphics} />
      <Lights q={q} />
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
      {/* Dust hanging in the moonlight. */}
      {q.dust > 0 && <Sparkles count={q.dust} scale={[16, 6, 14]} position={[0, 3.2, -3]} size={1.2} speed={0.08} opacity={0.18} color="#cdd8ff" noise={1} />}
      {mode === 'walk' && <WalkControls />}
      <Controls />
      <CameraRig />
      <TalkFraming />
      <LabelProjector />
      <Post q={q} dof={mode === 'talk' && graphics !== 'low'} />
    </Canvas>
  )
}

