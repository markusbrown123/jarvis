import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, MeshReflectorMaterial, OrbitControls, PerformanceMonitor, Sparkles } from '@react-three/drei'
import { Bloom, ChromaticAberration, EffectComposer, N8AO, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { useHub, type Graphics } from '../hub/client'
import { useStore } from '../store'
import { BackScreen, Drones, FloorMarks, HoloTable, LightShaft, Racks, RobotArm, Room, StationCore } from './parts'
import { stateColor } from './shared'

/**
 * The station: a dark workshop round a holo-table, lit for real — PBR
 * metals, image-based reflections, shadow maps, a reflective floor and
 * volumetric light — then finished with ambient occlusion and bloom.
 *
 * Quality is chosen in Settings (or on the station's top bar): Low is
 * flat-shaded and cheap, High adds shadows, reflections and light shafts,
 * Ultra adds wide-filtered soft shadows, ambient occlusion, 4096 shadow
 * maps, full-resolution reflections, film grain and lens fringing. A
 * performance monitor steps the resolution down if frames start dropping.
 */

const QUALITY: Record<
  Graphics,
  { maxDpr: number; shadows: boolean; map: number; reflector: number; ao: boolean; soft: boolean; dust: number; volumetric: boolean; msaa: number; lens: boolean; env: number }
> = {
  low: { maxDpr: 1, shadows: false, map: 0, reflector: 0, ao: false, soft: false, dust: 120, volumetric: false, msaa: 0, lens: false, env: 64 },
  high: { maxDpr: 1.5, shadows: true, map: 2048, reflector: 512, ao: false, soft: false, dust: 380, volumetric: true, msaa: 0, lens: false, env: 128 },
  ultra: { maxDpr: 2, shadows: true, map: 4096, reflector: 1024, ao: true, soft: true, dust: 900, volumetric: true, msaa: 4, lens: true, env: 256 },
}

const TARGET: [number, number, number] = [0, 1.75, 0]

/** Key, fill, rims, the core's own light, and a shaft from the ceiling. */
function Lights({ q }: { q: (typeof QUALITY)[Graphics] }) {
  const shaft = useRef<THREE.SpotLight>(null)
  const col = useMemo(() => new THREE.Color('#a78bfa'), [])
  const target = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.set(0, 1, 0)
    return o
  }, [])
  useFrame((_, dt) => {
    stateColor(col, Math.min(1, dt * 2))
    if (shaft.current) shaft.current.color.copy(col).lerp(new THREE.Color('#ffffff'), 0.55)
  })
  return (
    <>
      <primitive object={target} />
      <hemisphereLight args={['#3a3160', '#060509', 0.45]} />
      {/* Key: high front-right, the light that throws the shadows. */}
      <spotLight
        position={[6, 11, 7]}
        angle={0.42}
        penumbra={0.75}
        intensity={1100}
        distance={45}
        decay={2}
        color="#f0ecff"
        castShadow={q.shadows}
        shadow-mapSize={[q.map || 512, q.map || 512]}
        shadow-bias={-0.00012}
        shadow-normalBias={0.025}
        shadow-radius={q.soft ? 5 : 2}
        shadow-camera-near={4}
        shadow-camera-far={30}
        target={target}
      />
      {/* Cool rim from back-left, warm rim from back-right. */}
      <spotLight position={[-8, 6, -5]} angle={0.5} penumbra={1} intensity={420} distance={30} decay={2} color="#7c6cff" target={target} />
      <spotLight position={[8, 5, -4]} angle={0.5} penumbra={1} intensity={300} distance={30} decay={2} color="#4fd1c5" target={target} />
      {/* A low warm bounce so the floor-side of things isn't black. */}
      <pointLight position={[0, 0.6, 5]} intensity={6} distance={12} decay={2} color="#ff9a5a" />
      {/* The shaft from the ceiling ring onto the table. */}
      <spotLight
        ref={shaft}
        position={[0, 7.5, 0]}
        angle={0.36}
        penumbra={0.8}
        intensity={160}
        distance={10}
        decay={2}
        target={target}
      />
      {/* Only the key light casts shadows; the visible shaft is a mesh. */}
      {q.volumetric && <LightShaft />}
    </>
  )
}

function Floor({ q }: { q: (typeof QUALITY)[Graphics] }) {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[18, 96]} />
      {q.reflector ? (
        <MeshReflectorMaterial
          resolution={q.reflector}
          blur={q.reflector >= 1024 ? [520, 140] : [300, 90]}
          mixBlur={1}
          mixStrength={14}
          mixContrast={1.1}
          roughness={0.78}
          depthScale={1.1}
          minDepthThreshold={0.35}
          maxDepthThreshold={1.4}
          color="#0c0b12"
          metalness={0.55}
          mirror={0.65}
        />
      ) : (
        <meshStandardMaterial color="#0e0d15" roughness={0.55} metalness={0.4} />
      )}
    </mesh>
  )
}

/**
 * The room is framed for a 16:10 window. A narrower one pulls the camera
 * back so the table, arms and racks still fit.
 */
function FitCamera() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as { update?: () => void } | null
  useEffect(() => {
    // The first measurement can be 0×0; an aspect from that is NaN, and a
    // NaN camera never recovers.
    if (!size.width || !size.height) return
    const target = new THREE.Vector3(...TARGET)
    const dir = camera.position.clone().sub(target)
    if (!Number.isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-6) dir.set(0, 1.35, 11.8)
    dir.normalize()
    camera.position.copy(target).addScaledVector(dir, 11.9 * Math.max(1, 1.6 / (size.width / size.height)))
    controls?.update?.()
  }, [camera, size.width, size.height, controls])
  return null
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

/** A slow sway of the whole world, so the room breathes even untouched. */
function Drift({ children }: { children: ReactNode }) {
  const g = useRef<THREE.Group>(null)
  useFrame((state) => {
    const reduced = useHub.getState().prefs.reducedMotion
    if (g.current) g.current.rotation.y = reduced ? 0 : Math.sin(state.clock.elapsedTime * 0.045) * 0.05
  })
  return <group ref={g}>{children}</group>
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
      camera={{ position: [0, 3.1, 11.8], fov: 38, near: 0.1, far: 80 }}
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
      <fog attach="fog" args={['#060510', 14, 36]} />
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
      <Drift>
        <Floor q={q} />
        <FloorMarks />
        <Room />
        <Racks />
        <BackScreen />
        <HoloTable />
        <StationCore />
        <RobotArm position={[-2.5, 0, 1.25]} side={-1} seed={1} />
        <RobotArm position={[2.5, 0, 1.25]} side={1} seed={2} />
        <Drones />
        <Sparkles count={q.dust} scale={[18, 7, 14]} position={[0, 3.5, -1]} size={1.6} speed={0.18} opacity={0.32} color="#c4b5fd" noise={1.2} />
      </Drift>
      <OrbitControls
        makeDefault
        target={TARGET}
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        minDistance={6.5}
        maxDistance={22}
        minPolarAngle={0.95}
        maxPolarAngle={1.52}
        minAzimuthAngle={-0.62}
        maxAzimuthAngle={0.62}
        rotateSpeed={0.5}
        zoomSpeed={0.6}
      />
      <FitCamera />
      <Post q={q} />
    </Canvas>
  )
}

