import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, PerformanceMonitor, Sparkles } from '@react-three/drei'
import { Bloom, ChromaticAberration, EffectComposer, N8AO, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { useHub, type Graphics } from '../hub/client'
import { useStore } from '../store'
import { BackScreen, Racks, RobotArm, Room } from './parts'
import { Floor, Island } from './floor'
import { Reactor } from './reactor'
import { Clusters } from './clusters'
import { Desk } from './desk'
import { Links } from './links'
import { CameraRig, Controls } from './camera'
import { LabelProjector } from './labels'
import { useStation } from './stationStore'

/**
 * The station: a control room round the reactor. An illuminated hex floor,
 * a raised island carrying the reactor and the six systems on their pads,
 * the pathways between them, two arms, racks and the curved back wall — lit
 * for real (PBR metals, image-based reflections, shadow maps, a reflective
 * floor) and finished with bloom, and ambient occlusion on Ultra.
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

/** Sky fill, a shadow-throwing key over the island, cool and teal rims. */
function Lights({ q }: { q: (typeof QUALITY)[Graphics] }) {
  return (
    <>
      <hemisphereLight args={['#4a4878', '#0a0910', 0.9]} />
      {/* Key: high front-right, the light that throws the shadows. */}
      <spotLight
        position={[7, 14, 9]}
        angle={0.62}
        penumbra={0.7}
        intensity={1500}
        distance={50}
        decay={2}
        color="#f0ecff"
        castShadow={q.shadows}
        shadow-mapSize={[q.map || 512, q.map || 512]}
        shadow-bias={-0.00012}
        shadow-normalBias={0.025}
        shadow-radius={q.soft ? 5 : 2}
        shadow-camera-near={6}
        shadow-camera-far={36}
      />
      {/* Cool rim from back-left, teal rim from back-right. */}
      <spotLight position={[-10, 7, -7]} angle={0.6} penumbra={1} intensity={520} distance={34} decay={2} color="#7c6cff" />
      <spotLight position={[10, 6, -6]} angle={0.6} penumbra={1} intensity={380} distance={34} decay={2} color="#4fd1c5" />
      {/* A low warm bounce so the front faces aren't black. */}
      <pointLight position={[0, 1.2, 9]} intensity={10} distance={16} decay={2} color="#ff9a5a" />
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

function Post({ q }: { q: (typeof QUALITY)[Graphics] }) {
  return (
    <EffectComposer multisampling={q.msaa} enableNormalPass={false}>
      <>{q.ao && <N8AO aoRadius={1.2} distanceFalloff={1} intensity={2.4} quality="medium" halfRes />}</>
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
      camera={{ position: [0, 9.6, 15.2], fov: 38, near: 0.1, far: 90 }}
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
      <color attach="background" args={['#050409']} />
      <fog attach="fog" args={['#060510', 26, 62]} />
      <Environment resolution={q.env} frames={1}>
        <color attach="background" args={['#06050b']} />
        <Lightformer form="rect" intensity={2.2} color="#8b7cff" position={[0, 7, -6]} scale={[14, 1.5, 1]} />
        <Lightformer form="ring" intensity={2.6} color="#5eead4" position={[-7, 3, 4]} scale={3} target={[0, 1.5, 0]} />
        <Lightformer form="rect" intensity={1.8} color="#ffffff" position={[7, 4, 5]} scale={[5, 3, 1]} target={[0, 1.5, 0]} />
        <Lightformer form="rect" intensity={3} color="#ff9a3c" position={[0, -1, 9]} scale={[10, 0.4, 1]} target={[0, 1, 0]} />
        <Lightformer form="circle" intensity={4} color="#e8e2ff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={4} />
      </Environment>
      {import.meta.env.DEV && <FrameProbe />}
      <BlankGuard graphics={graphics} />
      <Lights q={q} />
      <Floor reflector={q.reflector} />
      <Island />
      <Room />
      <Racks />
      {/* Talk mode keeps the view over the desk clear. */}
      {mode !== 'talk' && <BackScreen />}
      <Reactor />
      <Links />
      <Clusters />
      <Desk />
      {/* Between the pads, front left and right: each serves the three zones on its side. */}
      <RobotArm position={[2.6, 0.16, 1.5]} side={1} seed={2} zones={['automaton', 'finance', 'jobs']} />
      <RobotArm position={[-2.6, 0.16, 1.5]} side={-1} seed={1} zones={['needs', 'core', 'roblox']} />
      {q.dust > 0 && <Sparkles count={q.dust} scale={[20, 6, 18]} position={[0, 3.2, 0]} size={1.4} speed={0.12} opacity={0.22} color="#c4b5fd" noise={1} />}
      <Controls />
      <CameraRig />
      <LabelProjector />
      <Post q={q} />
    </Canvas>
  )
}

